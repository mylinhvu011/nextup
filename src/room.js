// EventRoom: one Durable Object per event.
// Holds the whole board, enforces the sign-up rules, keeps every phone in sync
// over WebSockets (hibernating while idle), runs game timers with alarms and
// sends push notifications in small batches.
import { DurableObject } from 'cloudflare:workers';
import { newId, fail, json, errorResponse, readJson, cleanName } from './util.js';
import { sendPush } from './webpush.js';

const PUSH_BATCH = 40; // stay under the free plan's 50 outgoing requests per run

const DEFAULT_SETTINGS = {
  playersPerTeam: 5, gameMinutes: 10, maxBoards: 3, maxSignups: 1, fields: 1,
  warnMinutes: 2, allowTeamPick: false, allowLeave: true, defaultPinnies: 'a',
  theme: { preset: 'pitch', main: '#1f8a5b', accent: '#c6f24e', pinnie: '#ff7a1a' }
};
const hexColor = v => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toLowerCase() : undefined);

function cleanSettings(input = {}, base = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...base };
  const int = (v, min, max) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
  };
  const set = (k, v) => { if (v !== undefined) s[k] = v; };
  const unlimited = v => v === null || v === 'unlimited' || v === '' || v === 0;
  if ('playersPerTeam' in input) set('playersPerTeam', int(input.playersPerTeam, 1, 30));
  if ('gameMinutes' in input) set('gameMinutes', int(input.gameMinutes, 1, 180));
  if ('maxBoards' in input) s.maxBoards = unlimited(input.maxBoards) ? null : (int(input.maxBoards, 1, 50) ?? s.maxBoards);
  if ('maxSignups' in input) s.maxSignups = unlimited(input.maxSignups) ? null : (int(input.maxSignups, 1, 50) ?? s.maxSignups);
  if ('fields' in input) set('fields', int(input.fields, 1, 10));
  if ('warnMinutes' in input) set('warnMinutes', int(input.warnMinutes, 0, 30));
  if ('allowTeamPick' in input) s.allowTeamPick = !!input.allowTeamPick;
  if ('allowLeave' in input) s.allowLeave = !!input.allowLeave;
  if (input.defaultPinnies === 'a' || input.defaultPinnies === 'b') s.defaultPinnies = input.defaultPinnies;
  if (input.theme && typeof input.theme === 'object') {
    const t = {
      preset: String(input.theme.preset || 'custom').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'custom',
      main: hexColor(input.theme.main), accent: hexColor(input.theme.accent), pinnie: hexColor(input.theme.pinnie)
    };
    if (t.main && t.accent && t.pinnie) s.theme = t;
  }
  return s;
}

/* ---------- pure game helpers ---------- */
const teamCap = ev => ev.settings.playersPerTeam;
const gamePlayers = g => [...g.teams.a, ...g.teams.b];
const isFull = (ev, g) => gamePlayers(g).length >= teamCap(ev) * 2;
const openGames = ev => ev.games.filter(g => g.status === 'open');
const playingGames = ev => ev.games.filter(g => g.status === 'playing');
const upNextGames = ev => openGames(ev).slice(0, ev.settings.fields);
const activeSignups = (ev, pid) => ev.games.filter(g => gamePlayers(g).includes(pid)).length;
const findGame = (ev, gid) => ev.games.find(g => g.id === gid) || fail(404, 'That game is no longer on the board');
const teamLabel = (g, team) => (g.pinnies === team ? 'the PINNIES team (grab a pinnie)' : 'the no-pinnies team');
const freshTimer = ev => { const ms = ev.settings.gameMinutes * 60000; return { durationMs: ms, remainingMs: ms, endsAt: null, running: false }; };

function newGame(ev) {
  return {
    id: newId(6), number: ev.nextGameNumber++, status: 'open', teams: { a: [], b: [] },
    pinnies: ev.settings.defaultPinnies, timer: freshTimer(ev),
    warned: false, timeUp: false, notifiedNext: [], createdAt: Date.now()
  };
}
// Keep the waiting line stocked. Games being played don't count.
// - Board limit N: always exactly N waiting boards (empty ones are added automatically;
//   if the limit is lowered, extra EMPTY boards at the end are removed).
// - Unlimited: always at least one waiting board with space.
function ensureOpenBoard(ev) {
  const max = ev.settings.maxBoards;
  if (max === null) {
    if (!openGames(ev).some(g => !isFull(ev, g))) ev.games.push(newGame(ev));
    return;
  }
  while (openGames(ev).length < max) ev.games.push(newGame(ev));
  let open = openGames(ev);
  for (let i = open.length - 1; i >= 0 && open.length > max; i--) {
    if (gamePlayers(open[i]).length === 0) {
      ev.games = ev.games.filter(g => g !== open[i]);
      open = openGames(ev);
    }
  }
}
function pickTeam(ev, g, wanted) {
  const cap = teamCap(ev);
  if (wanted === 'a' || wanted === 'b') {
    if (g.teams[wanted].length >= cap) fail(409, `Team ${wanted === 'a' ? 1 : 2} is full`);
    return wanted;
  }
  const t = g.teams.a.length <= g.teams.b.length ? 'a' : 'b';
  if (g.teams[t].length >= cap) fail(409, 'That game is full');
  return t;
}
function removeFromGame(g, pid) {
  g.teams.a = g.teams.a.filter(x => x !== pid);
  g.teams.b = g.teams.b.filter(x => x !== pid);
  g.notifiedNext = (g.notifiedNext || []).filter(x => x !== pid);
}
function remainingMs(g) {
  const t = g.timer;
  if (t.running && t.endsAt) return Math.max(0, t.endsAt - Date.now());
  return Math.max(0, t.remainingMs);
}

export class EventRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ev = null;
    ctx.blockConcurrencyWhile(async () => { this.ev = (await ctx.storage.get('ev')) || null; });
    // Answer keep-alive pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  get registry() { return this.env.REGISTRY.get(this.env.REGISTRY.idFromName('global')); }

  /* ---------- state views ---------- */
  publicState() {
    const ev = this.ev;
    return {
      id: ev.id, name: ev.name, code: ev.code, codeType: ev.codeType, status: ev.status,
      settings: ev.settings, serverNow: Date.now(),
      players: Object.fromEntries(Object.values(ev.players).map(p => [p.id, { id: p.id, name: p.name, guest: !!p.guest }])),
      games: ev.games.map(g => ({
        id: g.id, number: g.number, status: g.status, teams: g.teams, pinnies: g.pinnies,
        timer: g.timer, timeUp: !!g.timeUp, startedAt: g.startedAt || null
      })),
      history: ev.history.slice(-8)
    };
  }
  managerState() {
    const ev = this.ev;
    const s = this.publicState();
    s.roster = Object.values(ev.players)
      .map(p => ({ id: p.id, name: p.name, guest: !!p.guest, alerts: p.subs.length > 0, signups: activeSignups(ev, p.id), joinedAt: p.joinedAt }))
      .sort((a, b) => a.name.localeCompare(b.name));
    s.managerAlerts = ev.managerSubs.length;
    return s;
  }
  summary() {
    const ev = this.ev;
    return {
      id: ev.id, managerId: ev.managerId, name: ev.name, code: ev.code, codeType: ev.codeType,
      status: ev.status, createdAt: ev.createdAt, players: Object.keys(ev.players).length, gamesPlayed: ev.history.length
    };
  }
  syncSummary() { return this.registry.putSummary(this.summary()); }

  /* ---------- live sockets ---------- */
  broadcast() {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const pub = JSON.stringify({ type: 'state', data: this.publicState() });
    let mgr = null;
    for (const ws of sockets) {
      let att = null;
      try { att = ws.deserializeAttachment(); } catch {}
      try {
        if (att && att.role === 'manager') ws.send(mgr || (mgr = JSON.stringify({ type: 'state', data: this.managerState() })));
        else ws.send(pub);
      } catch {}
    }
  }
  sendTo(tag, msg) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(tag)) { try { ws.send(text); } catch {} }
  }
  kickSockets(tag, reason) {
    for (const ws of this.ctx.getWebSockets(tag)) {
      try { ws.send(JSON.stringify({ type: 'removed', data: { reason } })); ws.close(4001, reason); } catch {}
    }
  }
  webSocketMessage(ws, msg) { if (msg === 'ping') { try { ws.send('pong'); } catch {} } }
  webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch {} }
  webSocketError() {}

  /* ---------- notifications ---------- */
  queuePush(subs, payload, to) {
    const ev = this.ev;
    ev.pq = ev.pq || [];
    for (const sub of subs) if (ev.pq.length < 1000) ev.pq.push({ sub, payload, to });
  }
  notifyPlayer(pid, title, body, tag) {
    const ev = this.ev;
    const p = ev.players[pid];
    if (!p) return;
    const payload = { title, body, tag: tag || 'nextup-' + ev.id, url: `/#/e/${ev.id}` };
    this.sendTo('p:' + pid, { type: 'notice', data: payload });
    if (p.subs.length) this.queuePush(p.subs, payload, pid);
  }
  notifyManager(title, body) {
    const ev = this.ev;
    const payload = { title, body, tag: 'nextup-mgr-' + ev.id, url: `/#/manager/e/${ev.id}` };
    this.sendTo('m', { type: 'notice', data: payload });
    if (ev.managerSubs.length) this.queuePush(ev.managerSubs, payload, 'm');
  }
  checkUpNext() {
    const ev = this.ev;
    const anyPlaying = playingGames(ev).length > 0;
    for (const g of upNextGames(ev)) {
      for (const pid of gamePlayers(g)) {
        if (g.notifiedNext.includes(pid)) continue;
        g.notifiedNext.push(pid);
        this.notifyPlayer(pid, "You're up next!",
          anyPlaying ? `Game ${g.number} plays after the current game. Stay close to the field.` : `Game ${g.number} is first in line.`,
          'game-' + g.id);
      }
    }
  }
  async drainPush() {
    const ev = this.ev;
    if (!ev || !ev.pq || !ev.pq.length) return;
    const batch = ev.pq.splice(0, PUSH_BATCH);
    let vapid;
    try {
      vapid = await this.registry.getVapidKeys();
    } catch (e) { console.error('No push keys', e); return; }
    vapid.subject = this.env.VAPID_SUBJECT || 'mailto:organizer@example.com';
    const results = await Promise.allSettled(batch.map(item => sendPush(item.sub, item.payload, vapid)));
    results.forEach((r, i) => {
      const status = r.status === 'fulfilled' ? r.value.status : 0;
      if (status === 404 || status === 410 || status === 403) {
        const { sub, to } = batch[i];
        if (to === 'm') ev.managerSubs = ev.managerSubs.filter(s => s.endpoint !== sub.endpoint);
        else if (ev.players[to]) ev.players[to].subs = ev.players[to].subs.filter(s => s.endpoint !== sub.endpoint);
      } else if (r.status === 'rejected' || status >= 400) {
        console.warn('Push failed', status || r.reason);
      }
    });
  }

  /* ---------- timers via alarms ---------- */
  async scheduleAlarm() {
    const ev = this.ev;
    if (!ev) return;
    let next = Infinity;
    if (ev.pq && ev.pq.length) next = Date.now();
    if (ev.status === 'active') {
      const warnMs = ev.settings.warnMinutes * 60000;
      for (const g of playingGames(ev)) {
        const t = g.timer;
        if (!t.running || !t.endsAt) continue;
        if (!g.warned && warnMs > 0 && t.durationMs > warnMs) next = Math.min(next, t.endsAt - warnMs);
        if (!g.timeUp) next = Math.min(next, t.endsAt);
      }
    }
    if (next === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, Date.now()));
  }

  async alarm() {
    const ev = this.ev;
    if (!ev) return;
    let changed = false;
    if (ev.status === 'active') {
      const now = Date.now();
      const warnMs = ev.settings.warnMinutes * 60000;
      for (const g of playingGames(ev)) {
        const t = g.timer;
        if (!t.running || !t.endsAt) continue;
        const rem = t.endsAt - now;
        if (!g.warned && warnMs > 0 && t.durationMs > warnMs && rem > 0 && rem <= warnMs + 500) {
          g.warned = true; changed = true;
          const mins = Math.max(1, Math.round(rem / 60000));
          for (const ng of upNextGames(ev)) for (const pid of gamePlayers(ng)) {
            this.notifyPlayer(pid, 'Get ready!', `About ${mins} min left in Game ${g.number}. You're on Game ${ng.number} next — warm up.`, 'game-' + ng.id);
          }
        }
        if (!g.timeUp && rem <= 500) {
          g.timeUp = true; changed = true;
          t.running = false; t.endsAt = null; t.remainingMs = 0;
          this.notifyManager(`Time's up — Game ${g.number}`, 'End the game to clear the board and bring on the next one.');
          for (const ng of upNextGames(ev)) for (const pid of gamePlayers(ng)) {
            this.notifyPlayer(pid, "You're on!", `Game ${g.number} just finished. Head to the field for Game ${ng.number}.`, 'game-' + ng.id);
          }
        }
      }
    }
    try { await this.drainPush(); } catch (e) { console.error(e); }
    await this.ctx.storage.put('ev', ev);
    if (changed) this.broadcast();
    await this.scheduleAlarm();
  }

  async commit() {
    await this.ctx.storage.put('ev', this.ev);
    this.broadcast();
    await this.scheduleAlarm();
  }

  /* ---------- HTTP ---------- */
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/ws') return this.acceptSocket(request, url);
      const body = request.method === 'GET' ? {} : await readJson(request);
      return json(await this.route(request.method, url.pathname, body, request.headers));
    } catch (e) { return errorResponse(e); }
  }

  acceptSocket(request, url) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const ev = this.ev;
    if (!ev) return new Response('Not found', { status: 404 });
    let att;
    const mgr = request.headers.get('x-nu-manager');
    if (mgr) {
      if (mgr !== ev.managerId) return new Response('Forbidden', { status: 403 });
      att = { role: 'manager' };
    } else {
      const pid = ev.tokens[url.searchParams.get('pt') || ''];
      if (!pid) return new Response('Forbidden', { status: 403 });
      att = { role: 'player', pid };
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [att.role === 'manager' ? 'm' : 'p:' + att.pid]);
    server.serializeAttachment(att);
    server.send(JSON.stringify({ type: 'state', data: att.role === 'manager' ? this.managerState() : this.publicState() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async route(method, path, b, headers) {
    // Event creation (called by the Worker after it reserved a code)
    if (method === 'POST' && path === '/init') {
      if (this.ev) fail(409, 'Event exists');
      const ev = {
        id: b.eventId, managerId: b.managerId, name: String(b.name || '').trim().slice(0, 60) || 'Pickup',
        code: b.code, codeType: b.codeType, status: 'active', createdAt: Date.now(),
        settings: cleanSettings(b.settings || {}), players: {}, tokens: {}, games: [], history: [],
        managerSubs: [], pq: [], nextGameNumber: 1
      };
      ensureOpenBoard(ev);
      this.ev = ev;
      await this.commit();
      return this.summary();
    }

    const ev = this.ev || fail(404, 'Event not found');
    let m;

    /* ----- player join ----- */
    if (method === 'POST' && path === '/join') {
      if (ev.status !== 'active') fail(404, 'No live event with that code');
      if (b.checkOnly) return { eventId: ev.id, name: ev.name };
      const name = cleanName(b.name);
      if (!name) fail(400, 'Enter your name');
      let p = Object.values(ev.players).find(x => x.name.toLowerCase() === name.toLowerCase());
      if (p && !p.guest) fail(409, `Someone is already signed in as "${p.name}". Add a last initial (e.g. "${name} B.") or ask the organizer to free up the name.`);
      const isNew = !p;
      if (!p) { p = { id: newId(6), name, guest: false, subs: [], joinedAt: Date.now() }; ev.players[p.id] = p; }
      p.guest = false;
      const token = newId(18);
      ev.tokens[token] = p.id;
      await this.commit();
      if (isNew) await this.syncSummary();
      return { eventId: ev.id, token, playerId: p.id, name: p.name };
    }

    /* ----- player routes ----- */
    if (path.startsWith('/p/')) {
      const pid = ev.tokens[headers.get('x-player-token') || ''];
      const p = pid && ev.players[pid];
      if (!p) fail(401, "You're not signed in to this event anymore");

      if (method === 'GET' && path === '/p/me') {
        return { player: { id: p.id, name: p.name, alerts: p.subs.length > 0, alertsOff: !!p.alertsOff }, state: this.publicState() };
      }
      if (method === 'POST' && path === '/p/push/off') {
        p.subs = [];
        p.alertsOff = true;
        if (ev.pq) ev.pq = ev.pq.filter(item => item.to !== p.id);
        await this.commit();
        return { ok: true };
      }
      if (method === 'POST' && path === '/p/push') {
        const sub = b.subscription;
        if (!sub || !sub.endpoint || !sub.keys) fail(400, 'Missing push subscription');
        for (const other of Object.values(ev.players)) other.subs = other.subs.filter(s => s.endpoint !== sub.endpoint);
        p.subs.push({ endpoint: sub.endpoint, keys: sub.keys });
        p.alertsOff = false;
        this.queuePush([sub], { title: `You're signed in as ${p.name}`, body: `We'll ping you here when your game at ${ev.name} is up.`, tag: 'nextup-' + ev.id, url: `/#/e/${ev.id}` }, p.id);
        await this.commit();
        return { ok: true };
      }
      if (method === 'POST' && (m = path.match(/^\/p\/games\/([\w-]+)\/signup$/))) {
        if (ev.status !== 'active') fail(409, 'This event has ended');
        const g = findGame(ev, m[1]);
        if (g.status !== 'open') fail(409, 'That game already started');
        if (gamePlayers(g).includes(p.id)) fail(409, "You're already on this game");
        const max = ev.settings.maxSignups;
        if (max !== null && activeSignups(ev, p.id) >= max) {
          fail(409, max === 1 ? "You're already on a game. You can sign up again once it's played." : `You can be on ${max} games at a time.`);
        }
        if (isFull(ev, g)) fail(409, 'That game is full');
        const team = pickTeam(ev, g, ev.settings.allowTeamPick ? b.team : undefined);
        g.teams[team].push(p.id);
        ensureOpenBoard(ev);
        this.checkUpNext();
        await this.commit();
        return { ok: true, team };
      }
      if (method === 'POST' && (m = path.match(/^\/p\/games\/([\w-]+)\/leave$/))) {
        if (!ev.settings.allowLeave) fail(403, 'Ask the organizer to take your name off');
        const g = findGame(ev, m[1]);
        if (g.status !== 'open') fail(409, 'That game already started');
        if (!gamePlayers(g).includes(p.id)) fail(404, "You're not on that game");
        removeFromGame(g, p.id);
        ensureOpenBoard(ev);
        await this.commit();
        return { ok: true };
      }
      if (method === 'POST' && path === '/p/signout') {
        for (const g of openGames(ev)) removeFromGame(g, p.id);
        for (const [t, x] of Object.entries(ev.tokens)) if (x === p.id) delete ev.tokens[t];
        p.guest = true; p.subs = [];
        ensureOpenBoard(ev);
        await this.commit();
        return { ok: true };
      }
      fail(404, 'Not found');
    }

    /* ----- organizer routes ----- */
    if (path === '/m' || path.startsWith('/m/')) {
      if (headers.get('x-nu-manager') !== ev.managerId) fail(404, 'Event not found');
      const live = () => { if (ev.status !== 'active') fail(409, 'This event has ended — reopen it first'); };

      if (method === 'GET' && path === '/m') return this.managerState();

      if (method === 'PATCH' && path === '/m') {
        let renamed = false;
        if (typeof b.name === 'string' && b.name.trim() && b.name.trim() !== ev.name) { ev.name = b.name.trim().slice(0, 60); renamed = true; }
        if (b.settings) {
          ev.settings = cleanSettings(b.settings, ev.settings);
          for (const g of openGames(ev)) g.timer = freshTimer(ev);
          ensureOpenBoard(ev);
          this.checkUpNext();
        }
        await this.commit();
        if (renamed) await this.syncSummary();
        return this.managerState();
      }

      if (method === 'DELETE' && path === '/m') {
        await this.registry.releaseCode(ev.code, ev.id);
        await this.registry.removeSummary(ev.managerId, ev.id);
        this.kickSockets(undefined, 'deleted');
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        this.ev = null;
        return { ok: true };
      }

      if (method === 'POST' && path === '/m/code') {
        live();
        const r = await this.registry.reserveCode({ type: b.type === 'custom' ? 'custom' : 'pin', code: b.code, eventId: ev.id });
        if (r.error) fail(r.status, r.error);
        if (r.code.toLowerCase() !== ev.code.toLowerCase()) await this.registry.releaseCode(ev.code, ev.id);
        ev.code = r.code; ev.codeType = r.codeType;
        await this.commit();
        await this.syncSummary();
        return { code: ev.code, codeType: ev.codeType };
      }

      if (method === 'POST' && path === '/m/end') {
        if (ev.status === 'active') {
          ev.status = 'ended'; ev.endedAt = Date.now();
          for (const g of playingGames(ev)) { g.timer.remainingMs = remainingMs(g); g.timer.running = false; g.timer.endsAt = null; }
          await this.registry.releaseCode(ev.code, ev.id);
          await this.commit();
          await this.syncSummary();
        }
        return { ok: true };
      }

      if (method === 'POST' && path === '/m/reopen') {
        if (ev.status !== 'active') {
          let r = await this.registry.reserveCode({ type: 'keep', code: ev.code, eventId: ev.id });
          if (r.error) r = await this.registry.reserveCode({ type: 'pin', eventId: ev.id });
          if (r.error) fail(r.status, r.error);
          ev.code = r.code; if (r.codeType) ev.codeType = r.codeType;
          ev.status = 'active'; delete ev.endedAt;
          ensureOpenBoard(ev);
          await this.commit();
          await this.syncSummary();
        }
        return { ok: true, code: ev.code };
      }

      if (method === 'POST' && path === '/m/push/off') {
        ev.managerSubs = [];
        if (ev.pq) ev.pq = ev.pq.filter(item => item.to !== 'm');
        await this.commit();
        return { ok: true };
      }

      if (method === 'POST' && path === '/m/push') {
        const sub = b.subscription;
        if (!sub || !sub.endpoint || !sub.keys) fail(400, 'Missing push subscription');
        ev.managerSubs = ev.managerSubs.filter(s => s.endpoint !== sub.endpoint);
        ev.managerSubs.push({ endpoint: sub.endpoint, keys: sub.keys });
        this.queuePush([sub], { title: 'Organizer alerts on', body: `You'll hear when a game's time is up at ${ev.name}.`, tag: 'nextup-mgr-' + ev.id, url: `/#/manager/e/${ev.id}` }, 'm');
        await this.commit();
        return { ok: true };
      }

      if (method === 'POST' && path === '/m/announce') {
        live();
        const msg = String(b.message || '').trim().slice(0, 200);
        if (!msg) fail(400, 'Write a message first');
        for (const pid of Object.keys(ev.players)) this.notifyPlayer(pid, ev.name, msg, 'announce-' + ev.id);
        await this.commit();
        return { ok: true };
      }

      if (method === 'POST' && path === '/m/games') {
        live();
        if (ev.settings.maxBoards !== null && openGames(ev).length >= ev.settings.maxBoards) {
          fail(409, `The line already has ${ev.settings.maxBoards} boards. Raise the board count in settings to add more.`);
        }
        ev.games.push(newGame(ev));
        await this.commit();
        return { ok: true };
      }

      if (method === 'POST' && (m = path.match(/^\/m\/games\/([\w-]+)\/action$/))) {
        live();
        const g = findGame(ev, m[1]);
        let ended = false;
        this.gameAction(g, b);
        if (b.action === 'end') ended = true;
        await this.commit();
        if (ended) await this.syncSummary();
        return { ok: true };
      }

      if (method === 'POST' && (m = path.match(/^\/m\/games\/([\w-]+)\/players$/))) {
        live();
        const g = findGame(ev, m[1]);
        const name = cleanName(b.name);
        if (!name) fail(400, 'Enter a name');
        let p = Object.values(ev.players).find(x => x.name.toLowerCase() === name.toLowerCase());
        if (!p) { p = { id: newId(6), name, guest: true, subs: [], joinedAt: Date.now() }; ev.players[p.id] = p; }
        if (gamePlayers(g).includes(p.id)) fail(409, `${p.name} is already on Game ${g.number}`);
        const team = pickTeam(ev, g, b.team);
        g.teams[team].push(p.id);
        if (g.status === 'playing') g.notifiedNext.push(p.id);
        ensureOpenBoard(ev);
        this.checkUpNext();
        await this.commit();
        return { ok: true };
      }

      if (method === 'POST' && (m = path.match(/^\/m\/games\/([\w-]+)\/players\/([\w-]+)\/(remove|switch)$/))) {
        live();
        const g = findGame(ev, m[1]);
        const pid = m[2];
        if (!gamePlayers(g).includes(pid)) fail(404, 'Player is not on that game');
        if (m[3] === 'remove') {
          removeFromGame(g, pid);
          this.notifyPlayer(pid, `Removed from Game ${g.number}`, 'The organizer took your name off that game.');
          ensureOpenBoard(ev);
        } else {
          const from = g.teams.a.includes(pid) ? 'a' : 'b';
          const to = from === 'a' ? 'b' : 'a';
          if (g.teams[to].length >= teamCap(ev)) fail(409, `Team ${to === 'a' ? 1 : 2} is full`);
          g.teams[from] = g.teams[from].filter(x => x !== pid);
          g.teams[to].push(pid);
          if (g.status === 'playing') this.notifyPlayer(pid, 'Team switch', `You're now on ${teamLabel(g, to)} in Game ${g.number}.`);
        }
        await this.commit();
        return { ok: true };
      }

      if (method === 'POST' && (m = path.match(/^\/m\/players\/([\w-]+)\/(release|remove)$/))) {
        const p = ev.players[m[1]] || fail(404, 'Player not found');
        for (const [t, x] of Object.entries(ev.tokens)) if (x === p.id) delete ev.tokens[t];
        this.kickSockets('p:' + p.id, m[2] === 'release' ? 'released' : 'removed');
        if (m[2] === 'release') { p.guest = true; p.subs = []; }
        else {
          for (const g of ev.games) removeFromGame(g, p.id);
          delete ev.players[p.id];
          ensureOpenBoard(ev);
        }
        await this.commit();
        if (m[2] === 'remove') await this.syncSummary();
        return { ok: true };
      }
    }

    fail(404, 'Not found');
  }

  gameAction(g, b) {
    const ev = this.ev;
    const t = g.timer;
    switch (b.action) {
      case 'start': {
        if (g.status !== 'open') fail(409, 'That game already started');
        const ms = ev.settings.gameMinutes * 60000;
        g.status = 'playing'; g.startedAt = Date.now();
        g.timer = { durationMs: ms, remainingMs: ms, endsAt: Date.now() + ms, running: true };
        g.warned = false; g.timeUp = false;
        ev.games = [...playingGames(ev), ...openGames(ev)];
        ensureOpenBoard(ev); // the game left the line, so a fresh board takes its place
        for (const team of ['a', 'b']) for (const pid of g.teams[team]) {
          this.notifyPlayer(pid, `Game ${g.number} is on!`, `You're on ${teamLabel(g, team)}. ${ev.settings.gameMinutes} minutes on the clock.`, 'game-' + g.id);
        }
        this.checkUpNext();
        break;
      }
      case 'pause':
        if (g.status !== 'playing' || !t.running) fail(409, 'Timer is not running');
        t.remainingMs = remainingMs(g); t.endsAt = null; t.running = false;
        break;
      case 'resume':
        if (g.status !== 'playing') fail(409, 'Game has not started');
        if (remainingMs(g) <= 0) fail(409, 'No time left — add time first');
        t.endsAt = Date.now() + t.remainingMs; t.running = true;
        break;
      case 'addtime': {
        const sec = Math.round(Number(b.seconds) || 60);
        const next = Math.max(0, remainingMs(g) + sec * 1000);
        if (t.running) t.endsAt = Date.now() + next; else t.remainingMs = next;
        if (g.status === 'open') t.durationMs = Math.max(60000, next);
        if (next > 0 && g.timeUp) {
          g.timeUp = false;
          if (g.status === 'playing') { t.running = true; t.endsAt = Date.now() + next; }
        }
        if (next > ev.settings.warnMinutes * 60000) g.warned = false;
        break;
      }
      case 'reset':
        Object.assign(t, freshTimer(ev));
        g.warned = false; g.timeUp = false;
        break;
      case 'end': {
        if (g.status !== 'playing') fail(409, 'Only a game in progress can be ended');
        ev.games = ev.games.filter(x => x !== g);
        ev.history.push({
          number: g.number, endedAt: Date.now(), pinnies: g.pinnies,
          teams: { a: g.teams.a.map(p => ev.players[p]?.name || '?'), b: g.teams.b.map(p => ev.players[p]?.name || '?') }
        });
        if (ev.history.length > 50) ev.history.shift();
        ensureOpenBoard(ev);
        this.checkUpNext();
        break;
      }
      case 'delete': {
        if (g.status === 'playing') fail(409, 'End the game instead of deleting it');
        ev.games = ev.games.filter(x => x !== g);
        for (const pid of gamePlayers(g)) this.notifyPlayer(pid, `Game ${g.number} was removed`, 'The organizer cleared that board. Put your name down on another game.');
        ensureOpenBoard(ev);
        this.checkUpNext();
        break;
      }
      case 'pinnies':
        g.pinnies = g.pinnies === 'a' ? 'b' : 'a';
        break;
      case 'up':
      case 'down': {
        if (g.status !== 'open') fail(409, 'Only waiting games can be moved');
        const open = openGames(ev);
        const i = open.indexOf(g);
        const j = b.action === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= open.length) break;
        [open[i], open[j]] = [open[j], open[i]];
        ev.games = [...playingGames(ev), ...open];
        this.checkUpNext();
        break;
      }
      default: fail(400, 'Unknown action');
    }
  }
}