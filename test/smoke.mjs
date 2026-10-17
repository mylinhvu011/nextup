// End-to-end check of the core rules against a fresh server. Run: npm test
import { spawn } from "child_process";
import path from 'path';
import fs from 'fs';
import os from 'os';
import assert from 'assert';

// Runs against `wrangler dev` (the real Cloudflare runtime, locally) with a throwaway data folder.
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextup-'));
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const ok = async p => { const r = await p; assert.ok(r.status < 300, JSON.stringify(r)); return r.data; };
const err = async (p, status) => { const r = await p; assert.strictEqual(r.status, status, JSON.stringify(r)); return r.data.error; };

(async () => {
  const root = path.join(__dirname, '..');
  const srv = spawn(path.join(root, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistDir, '--log-level', 'error', '--var', 'BREVO_API_KEY:test-key', '--var', 'BREVO_API_URL:http://127.0.0.1:9913/brevo', '--var', 'MAIL_FROM:noreply@example.com'],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: 'ignore', detached: true });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(BASE + '/api/config')).ok; } catch { await sleep(500); } }
    assert.ok(up, 'wrangler dev did not start');
    const cfg = await (await fetch(BASE + '/api/config')).json();
    assert.match(cfg.vapidPublicKey, /^[\w-]{80,90}$/);
    const html = await (await fetch(BASE + '/')).text();
    assert.match(html, /NEXT UP/);

    await err(call('POST', '/api/manager/register', { username: 'coach', password: 'secret1' }), 400); // email required
    const m = await ok(call('POST', '/api/manager/register', { username: 'coach', password: 'secret1', email: 'coach@example.com' }));
    const M = { Authorization: 'Bearer ' + m.token };
    await err(call('POST', '/api/manager/register', { username: 'Coach', password: 'secret1', email: 'x@example.com' }), 409);

    // 2v2, 2 boards, 1 sign-up each
    const ev = await ok(call('POST', '/api/manager/events', { name: 'Test', settings: { playersPerTeam: 2, maxBoards: 2, maxSignups: 1, gameMinutes: 5 } }, M));
    assert.match(ev.code, /^\d{4}$/);
    const E = `/api/events/${ev.id}`;

    // custom password must be unique among live events
    await ok(call('POST', '/api/manager/events', { name: 'Other', codeType: 'custom', code: 'footy' }, M));
    await err(call('POST', '/api/manager/events', { name: 'Dup', codeType: 'custom', code: 'FOOTY' }, M), 409);
    assert.strictEqual((await ok(call('POST', '/api/join', { code: 'Footy', checkOnly: true }))).name, 'Other');

    const join = async name => { const r = await ok(call('POST', '/api/join', { code: ev.code, name })); return { ...r, H: { 'X-Player-Token': r.token } }; };
    const [a, b, c, d, e] = await Promise.all(['Ana', 'Ben', 'Cal', 'Dee', 'Eli'].map(join));
    // signed-in name: asks first, then signs this device in as the same player
    const askAna = await ok(call('POST', '/api/join', { code: ev.code, name: 'ana' }));
    assert.ok(askAna.needsConfirm && askAna.signedIn && !askAna.token, 'asks before signing in as a taken name');
    const ana2 = await ok(call('POST', '/api/join', { code: ev.code, name: 'Ana', confirmClaim: true }));
    assert.strictEqual(ana2.playerId, a.playerId, 'same player');
    assert.ok(ana2.rejoined);
    await ok(call('GET', `${E}/me`, null, a.H)); // the first phone stays signed in too
    await err(call('POST', '/api/join', { code: '0000x', name: 'X' }), 404);

    const M_ = `/api/manager/events/${ev.id}`;
    const open = st => st.games.filter(g => g.status === 'open');
    const playing = st => st.games.filter(g => g.status === 'playing');
    const mstate = () => ok(call('GET', M_, null, M));

    // Board count 2 -> the line starts with 2 empty boards
    let st = (await ok(call('GET', `${E}/me`, null, a.H))).state;
    assert.strictEqual(open(st).length, 2, 'line pre-filled with 2 boards');
    assert.ok(open(st).every(g => g.teams.a.length + g.teams.b.length === 0));
    const g1 = st.games[0].id, g2 = st.games[1].id;

    await ok(call('POST', `${E}/games/${g1}/signup`, {}, a.H));
    assert.match(await err(call('POST', `${E}/games/${g1}/signup`, {}, a.H), 409), /already on this game/);
    for (const p of [b, c, d]) await ok(call('POST', `${E}/games/${g1}/signup`, {}, p.H));
    st = (await ok(call('GET', `${E}/me`, null, a.H))).state;
    assert.strictEqual(st.games[0].teams.a.length, 2);
    assert.strictEqual(st.games[0].teams.b.length, 2);
    assert.strictEqual(st.games.length, 2, 'still exactly 2 boards');
    assert.match(await err(call('POST', `${E}/games/${g2}/signup`, {}, a.H), 409), /already on a game/);
    await ok(call('POST', `${E}/games/${g2}/signup`, {}, e.H));

    // Fill game 2 with walk-ups; a full game rejects more; no extra boards beyond 2
    for (const n of ['Walk One', 'Walk Two', 'Walk Three']) await ok(call('POST', `${M_}/games/${g2}/players`, { name: n }, M));
    await err(call('POST', `${M_}/games/${g2}/players`, { name: 'Walk Four' }, M), 409);
    st = await mstate();
    assert.strictEqual(st.games.length, 2, 'board count respected');
    await err(call('POST', `${M_}/games`, {}, M), 409);

    // Starting game 1 moves it to the field; the line refills to 2 boards
    await ok(call('POST', `${M_}/games/${g1}/action`, { action: 'start' }, M));
    st = await mstate();
    assert.strictEqual(playing(st).length, 1);
    assert.strictEqual(open(st).length, 2, 'playing game does not count; fresh board added');
    await ok(call('POST', `${M_}/games/${g1}/action`, { action: 'pause' }, M));
    await ok(call('POST', `${M_}/games/${g1}/action`, { action: 'addtime', seconds: 60 }, M));
    st = await mstate();
    const t = st.games.find(g => g.id === g1).timer;
    assert.ok(!t.running && t.remainingMs > 5 * 60000 && t.remainingMs <= 6 * 60000, JSON.stringify(t));
    await ok(call('POST', `${M_}/games/${g1}/action`, { action: 'pinnies' }, M));
    await err(call('POST', `${E}/games/${g1}/leave`, {}, a.H), 409); // can't leave a started game
    await ok(call('POST', `${M_}/games/${g1}/action`, { action: 'end' }, M));
    st = await mstate();
    assert.strictEqual(open(st).length, 2);
    assert.strictEqual(playing(st).length, 0);
    assert.strictEqual(st.history.length, 1);
    const g3 = open(st).find(g => g.id !== g2).id;
    await ok(call('POST', `${E}/games/${g3}/signup`, {}, a.H)); // Ana can sign up again

    // Raising the board count adds empty boards; lowering removes only EMPTY ones
    await ok(call('PATCH', M_, { settings: { maxBoards: 4 } }, M));
    assert.strictEqual(open(await mstate()).length, 4);
    await ok(call('PATCH', M_, { settings: { maxBoards: 3 } }, M));
    assert.strictEqual(open(await mstate()).length, 3);
    await ok(call('PATCH', M_, { settings: { maxBoards: 1 } }, M));
    st = await mstate();
    assert.strictEqual(open(st).length, 2, 'boards with names on them are never removed');
    await ok(call('PATCH', M_, { settings: { maxBoards: 3 } }, M));
    st = await mstate();
    assert.strictEqual(open(st).length, 3);
    const g4 = open(st)[2].id;

    // Unlimited line + 2 sign-ups per person
    await ok(call('PATCH', M_, { settings: { maxSignups: null, maxBoards: null } }, M));
    assert.strictEqual((await mstate()).settings.maxSignups, null);
    await ok(call('PATCH', M_, { settings: { maxSignups: 2 } }, M));
    for (const p of [b, c, d]) await ok(call('POST', `${E}/games/${g3}/signup`, {}, p.H));
    await ok(call('POST', `${E}/games/${g4}/signup`, {}, a.H)); // 2nd sign-up allowed
    for (const n of ['Walk Five', 'Walk Six', 'Walk Seven']) await ok(call('POST', `${M_}/games/${g4}/players`, { name: n }, M));
    st = await mstate();
    assert.strictEqual(open(st).length, 4, 'unlimited line opens another board when all are full');
    const g5 = open(st)[3].id;
    assert.match(await err(call('POST', `${E}/games/${g5}/signup`, {}, a.H), 409), /2 games/);
    await ok(call('POST', `${M_}/games`, {}, M)); // organizer can add boards when unlimited
    assert.strictEqual(open(await mstate()).length, 5);

    // Reorder, leave
    await ok(call('POST', `${M_}/games/${g4}/action`, { action: 'up' }, M));
    st = await mstate();
    assert.strictEqual(st.games.findIndex(g => g.id === g4), 1);
    await ok(call('POST', `${E}/games/${g4}/leave`, {}, a.H));

    // Release a name so it can be claimed again
    await ok(call('POST', `/api/manager/events/${ev.id}/players/${e.playerId}/release`, {}, M));
    await err(call('GET', `${E}/me`, null, e.H), 401);
    const e2 = await join('Eli');
    assert.strictEqual(e2.playerId, e.playerId);

    // Live updates over WebSocket + the game timer alarm
    const wsUrl = `ws://127.0.0.1:${PORT}${E}/ws?pt=${encodeURIComponent(e2.token)}`;
    const msgs = [];
    const ws = new WebSocket(wsUrl);
    ws.onmessage = m => { if (m.data !== 'pong') msgs.push(JSON.parse(m.data)); };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    await sleep(300);
    assert.strictEqual(msgs[0].type, 'state', 'initial state on connect');
    ws.send('ping');
    // Put Eli on the next game, start the first game with ~3s left, wait for the alarm.
    st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    const firstOpen = st.games.find(g => g.status === 'open');
    const secondOpen = st.games.filter(g => g.status === 'open')[1];
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${secondOpen.id}/players`, { name: 'Eli' }, M));
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${firstOpen.id}/action`, { action: 'start' }, M));
    const mins = st.settings.gameMinutes;
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${firstOpen.id}/action`, { action: 'addtime', seconds: -(mins * 60 - 3) }, M));
    await sleep(5000);
    const last = msgs.filter(x => x.type === 'state').pop();
    const g = last.data.games.find(x => x.id === firstOpen.id);
    assert.ok(g.timeUp && !g.timer.running, 'alarm marked the game time-up: ' + JSON.stringify(g.timer));
    assert.ok(msgs.some(x => x.type === 'notice' && /You're on!/.test(x.data.title)), 'next game told to go on');
    // Organizer removes Eli -> his socket is told
    await ok(call('POST', `/api/manager/events/${ev.id}/players/${e2.playerId}/remove`, {}, M));
    await sleep(300);
    assert.ok(msgs.some(x => x.type === 'removed'), 'removed message delivered');
    ws.close();
    console.log('✔ live updates, timer alarm and notices work');

    // Full push path: subscribe a fake phone, check the encrypted welcome notification arrives and decrypts.
    {
      const { createRequire } = await import('module');
      const ece = createRequire(import.meta.url)('http_ece');
      const http = await import('http');
      const crypto = await import('crypto');
      const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
      const auth = crypto.randomBytes(16);
      const got = [];
      const sink = http.createServer((req, res) => {
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => { got.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201); res.end(); });
      });
      await new Promise(r => sink.listen(9911, '127.0.0.1', r));
      const fresh = await join('Pushy');
      await ok(call('POST', `${E}/push`, { subscription: { endpoint: 'http://127.0.0.1:9911/sub/1', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }, fresh.H));
      for (let i = 0; i < 30 && !got.length; i++) await sleep(200);
      assert.ok(got.length, 'push delivered to the push service');
      assert.match(got[0].headers.authorization, /^vapid t=.+, k=/);
      const note = JSON.parse(ece.decrypt(got[0].body, { version: 'aes128gcm', privateKey: ua, authSecret: auth }));
      assert.match(note.title, /signed in as Pushy/);
      console.log('✔ push notification sent, encrypted and decryptable:', note.title);
      // Turn alerts off: stays off, and /me reports it so the app won't silently re-subscribe
      let me1 = await ok(call('GET', `${E}/me`, null, fresh.H));
      assert.ok(me1.player.alerts && !me1.player.alertsOff);
      await ok(call('POST', `${E}/push/off`, {}, fresh.H));
      me1 = await ok(call('GET', `${E}/me`, null, fresh.H));
      assert.ok(!me1.player.alerts && me1.player.alertsOff, 'alerts off sticks');
      await ok(call('POST', `/api/manager/events/${ev.id}/push`, { subscription: { endpoint: 'http://127.0.0.1:9911/sub/m', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }, M));
      assert.strictEqual((await ok(call('GET', `/api/manager/events/${ev.id}`, null, M))).managerAlerts, 1);
      await ok(call('POST', `/api/manager/events/${ev.id}/push/off`, {}, M));
      assert.strictEqual((await ok(call('GET', `/api/manager/events/${ev.id}`, null, M))).managerAlerts, 0);
      console.log('✔ alerts turn off for players and organizer');
      sink.close();
    }

    // Color theme: valid saves and reaches players; invalid colors are ignored
    {
      const theme = { preset: 'midnight', main: '#2f5fb3', accent: '#ffd23f', pinnie: '#ff5a5f' };
      await ok(call('PATCH', `/api/manager/events/${ev.id}`, { settings: { theme } }, M));
      const pub = (await ok(call('GET', `${E}/me`, null, (await join('Theme Fan')).H))).state;
      assert.deepStrictEqual(pub.settings.theme, theme);
      await ok(call('PATCH', `/api/manager/events/${ev.id}`, { settings: { theme: { main: 'red', accent: '#fff', pinnie: '#000000' } } }, M));
      assert.deepStrictEqual((await ok(call('GET', `/api/manager/events/${ev.id}`, null, M))).settings.theme, theme);
      console.log('✔ color theme saves, reaches players, rejects bad colors');
    }

    // Move code: carries a browser sign-in into the Home Screen app (same person, same spots)
    {
      const mover = await join('Mover');
      st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
      const g = st.games.find(x => x.status === 'open' && x.teams.a.length + x.teams.b.length < st.settings.playersPerTeam * 2);
      await ok(call('POST', `${E}/games/${g.id}/signup`, {}, mover.H));
      const { moveCode } = await ok(call('POST', `${E}/move`, {}, mover.H));
      assert.match(moveCode, /^[a-z2-9]{6}$/);
      const peek = await ok(call('POST', '/api/join', { code: moveCode.toUpperCase(), checkOnly: true }));
      assert.strictEqual(peek.moving, 'Mover');
      const moved = await ok(call('POST', '/api/join', { code: moveCode }));
      assert.strictEqual(moved.playerId, mover.playerId, 'same person');
      const me2 = await ok(call('GET', `${E}/me`, null, { 'X-Player-Token': moved.token }));
      assert.ok(me2.state.games.find(x => x.id === g.id).teams.a.concat(me2.state.games.find(x => x.id === g.id).teams.b).includes(mover.playerId), 'kept game spot');
      await err(call('POST', '/api/join', { code: moveCode, checkOnly: true }), 404); // single use
      console.log('✔ move code moves a player into the app with their spot');
    }

    // Last call: no new boards; remaining games still play out; reopening refills the line
    {
      const lc = await ok(call('POST', '/api/manager/events', { name: 'Last Call Night', settings: { playersPerTeam: 1, maxBoards: 3 } }, M));
      const L = `/api/manager/events/${lc.id}`;
      const lcState = () => ok(call('GET', L, null, M));
      const openL = st => st.games.filter(g => g.status === 'open');
      let s1 = await lcState();
      const [b1, b2] = openL(s1);
      for (const n of ['A1', 'A2']) await ok(call('POST', `${L}/games/${b1.id}/players`, { name: n }, M));
      await ok(call('POST', `${L}/games/${b1.id}/action`, { action: 'start' }, M));
      assert.strictEqual(openL(await lcState()).length, 3);
      const pj = await ok(call('POST', '/api/join', { code: lc.code, name: 'Late Larry' }));
      await ok(call('POST', `${L}/lastcall`, { on: true }, M));
      s1 = await lcState();
      assert.strictEqual(s1.closing, true);
      assert.strictEqual(openL(s1).length, 3, 'existing boards stay');
      // players can still take open spots on remaining boards
      await ok(call('POST', `/api/events/${lc.id}/games/${b2.id}/signup`, {}, { 'X-Player-Token': pj.token }));
      // games still start and end; nothing refills
      await ok(call('POST', `${L}/games/${b1.id}/action`, { action: 'end' }, M));
      await ok(call('POST', `${L}/games/${b2.id}/action`, { action: 'start' }, M));
      s1 = await lcState();
      assert.strictEqual(openL(s1).length, 2, 'no new board after a game starts');
      await ok(call('POST', `${L}/games/${b2.id}/action`, { action: 'end' }, M));
      for (const g of openL(await lcState())) await ok(call('POST', `${L}/games/${g.id}/action`, { action: 'delete' }, M));
      s1 = await lcState();
      assert.strictEqual(s1.games.length, 0, 'line empties out, nothing auto-added');
      assert.strictEqual(s1.history.length, 2);
      // reopen the line -> boards come back
      await ok(call('POST', `${L}/lastcall`, { on: false }, M));
      s1 = await lcState();
      assert.strictEqual(s1.closing, false);
      assert.strictEqual(openL(s1).length, 3, 'reopening refills to 3');
      await ok(call('DELETE', L, null, M));
      console.log('✔ last call stops new boards and lets remaining games finish');
    }

    // Clear board: takes everyone off a waiting game but keeps the board in place
    {
      const cb = await ok(call('POST', '/api/manager/events', { name: 'Clear Test', settings: { playersPerTeam: 2, maxBoards: 2 } }, M));
      const C = `/api/manager/events/${cb.id}`;
      let cs = await ok(call('GET', C, null, M));
      const gid = cs.games[0].id;
      await ok(call('POST', `${C}/games/${gid}/players`, { name: 'P1' }, M));
      await ok(call('POST', `${C}/games/${gid}/action`, { action: 'clear' }, M));
      cs = await ok(call('GET', C, null, M));
      assert.strictEqual(cs.games[0].id, gid, 'same board, same spot');
      assert.strictEqual(cs.games[0].teams.a.length + cs.games[0].teams.b.length, 0);
      assert.strictEqual(cs.games.length, 2);
      await ok(call('DELETE', C, null, M));
      console.log('✔ clear board empties a game and keeps it in place');
    }

    // Friends: add by name, unlimited by default, owner-only team switch/remove, alerts go to the adder, claiming the name
    {
      const fe = await ok(call('POST', '/api/manager/events', { name: 'Friends Night', settings: { playersPerTeam: 3, maxBoards: 2, maxSignups: 1 } }, M));
      assert.strictEqual(fe.code.length, 4);
      const F = `/api/events/${fe.id}`, FM = `/api/manager/events/${fe.id}`;
      const fjoin = async n => { const r = await ok(call('POST', '/api/join', { code: fe.code, name: n })); return { ...r, H: { 'X-Player-Token': r.token } }; };
      const sam = await fjoin('Sam'), kim = await fjoin('Kim');
      let fs = await ok(call('GET', FM, null, M));
      assert.strictEqual(fs.settings.maxFriends, null, 'unlimited by default');
      const [ga, gb] = fs.games.filter(g => g.status === 'open');

      // Sam listens on his socket for forwarded alerts
      const notes = [];
      const sws = new WebSocket(`ws://127.0.0.1:${PORT}${F}/ws?pt=${encodeURIComponent(sam.token)}`);
      sws.onmessage = m => { if (m.data !== 'pong') { const x = JSON.parse(m.data); if (x.type === 'notice') notes.push(x.data); } };
      await new Promise((res, rej) => { sws.onopen = res; sws.onerror = rej; });

      // add three friends (unlimited), one onto a chosen team
      const jo = await ok(call('POST', `${F}/games/${ga.id}/friend`, { name: 'Jo', team: 'b' }, sam.H));
      assert.strictEqual(jo.team, 'b');
      await ok(call('POST', `${F}/games/${ga.id}/friend`, { name: 'Lee' }, sam.H));
      await ok(call('POST', `${F}/games/${gb.id}/friend`, { name: 'Max' }, sam.H));
      // can't add yourself, a signed-in player, or the same friend twice to one game
      await err(call('POST', `${F}/games/${ga.id}/friend`, { name: 'sam' }, sam.H), 400);
      assert.match(await err(call('POST', `${F}/games/${ga.id}/friend`, { name: 'Kim' }, sam.H), 409), /own phone/);
      assert.match(await err(call('POST', `${F}/games/${ga.id}/friend`, { name: 'jo' }, sam.H), 409), /already on Game/);
      // another player can't take over Sam's friend
      assert.match(await err(call('POST', `${F}/games/${gb.id}/friend`, { name: 'Jo' }, kim.H), 409), /already added by Sam/);
      // friend follows the sign-up limit (1 game at a time)
      assert.match(await err(call('POST', `${F}/games/${gb.id}/friend`, { name: 'Jo' }, sam.H), 409), /already on a game/);

      // only Sam can switch or remove his friends
      await err(call('POST', `${F}/games/${ga.id}/friends/${jo.friendId}/switch`, {}, kim.H), 403);
      await ok(call('POST', `${F}/games/${ga.id}/friends/${jo.friendId}/switch`, {}, sam.H));
      fs = await ok(call('GET', FM, null, M));
      assert.ok(fs.games.find(g => g.id === ga.id).teams.a.includes(jo.friendId), 'switched to team 1');
      const ros = fs.roster.find(r => r.name === 'Jo');
      assert.strictEqual(ros.addedBy, 'Sam', 'organizer sees friend of Sam');

      // starting Jo's game sends Jo's alert to Sam
      await ok(call('POST', `${FM}/games/${ga.id}/action`, { action: 'start' }, M));
      await sleep(400);
      assert.ok(notes.some(n => /^For Jo: Game \d+ is on/.test(n.title)), 'Sam got Jo\'s alert: ' + JSON.stringify(notes.map(n => n.title)));
      // can't change a friend once the game started
      await err(call('POST', `${F}/games/${ga.id}/friends/${jo.friendId}/remove`, {}, sam.H), 409);

      // Max joins on his own phone: asked to confirm first, then takes over the spot
      const ask = await ok(call('POST', '/api/join', { code: fe.code, name: 'max' }));
      assert.strictEqual(ask.needsConfirm, true, 'asks before claiming a friend-added name');
      assert.strictEqual(ask.addedBy, 'Sam');
      assert.strictEqual(ask.games.length, 1);
      assert.ok(!ask.token, 'no sign-in until confirmed');
      const maxR = await ok(call('POST', '/api/join', { code: fe.code, name: 'Max', confirmClaim: true }));
      const max = { ...maxR, H: { 'X-Player-Token': maxR.token } };
      fs = await ok(call('GET', FM, null, M));
      assert.ok(fs.games.find(g => g.id === gb.id).teams.a.concat(fs.games.find(g => g.id === gb.id).teams.b).includes(max.playerId), 'kept spot');
      assert.strictEqual(fs.players[max.playerId].addedBy, null, 'link cleared once they join');
      await err(call('POST', `${F}/games/${gb.id}/friends/${max.playerId}/remove`, {}, sam.H), 403);

      // organizer walk-ups ask too; a walk-up with no games doesn't
      const gw = (await ok(call('GET', FM, null, M))).games.find(g => g.status === 'open');
      await ok(call('POST', `${FM}/games/${gw.id}/players`, { name: 'Walker' }, M));
      const askW = await ok(call('POST', '/api/join', { code: fe.code, name: 'Walker' }));
      assert.ok(askW.needsConfirm && askW.addedBy === null, 'walk-up asks, added by organizer');
      await ok(call('POST', `${FM}/games/${gw.id}/players/${(await ok(call('GET', FM, null, M))).roster.find(r => r.name === 'Walker').id}/remove`, {}, M));
      const noAsk = await ok(call('POST', '/api/join', { code: fe.code, name: 'Walker' }));
      assert.ok(noAsk.token && !noAsk.needsConfirm, 'no games on the name -> no question');

      // organizer can limit or turn friends off
      await ok(call('PATCH', FM, { settings: { maxFriends: 0 } }, M));
      const gopen = (await ok(call('GET', FM, null, M))).games.find(g => g.status === 'open');
      assert.match(await err(call('POST', `${F}/games/${gopen.id}/friend`, { name: 'Zed' }, sam.H), 403), /turned off/);
      await ok(call('PATCH', FM, { settings: { maxFriends: 2 } }, M));
      assert.match(await err(call('POST', `${F}/games/${gopen.id}/friend`, { name: 'Zed' }, sam.H), 409), /up to 2 friends/);
      sws.close();
      await ok(call('DELETE', FM, null, M));
      console.log('✔ friends: add, team switch, owner-only changes, alerts to adder, claim, limits');
    }

    // Fields + self team switch
    {
      const fe2 = await ok(call('POST', '/api/manager/events', { name: 'Fields Night', settings: { playersPerTeam: 2, maxBoards: 3, fields: 2, fieldNames: ['North', ''] } }, M));
      const FM2 = `/api/manager/events/${fe2.id}`, F2 = `/api/events/${fe2.id}`;
      let fs2 = await ok(call('GET', FM2, null, M));
      assert.strictEqual(fs2.settings.allowTeamPick, true, 'players pick teams by default');
      assert.deepStrictEqual(fs2.settings.fieldNames, ['North', 'Field 2'], 'blank field name falls back');
      const pj = await ok(call('POST', '/api/join', { code: fe2.code, name: 'Pat' }));
      const PH = { 'X-Player-Token': pj.token };
      const [o1, o2, o3] = fs2.games.filter(g => g.status === 'open');
      await ok(call('POST', `${F2}/games/${o1.id}/signup`, { team: 'a' }, PH));
      // switch own team
      const sw = await ok(call('POST', `${F2}/games/${o1.id}/switch`, {}, PH));
      assert.strictEqual(sw.team, 'b');
      // start: first free field automatically, then the next free one, then an explicit one
      await ok(call('POST', `${FM2}/games/${o1.id}/action`, { action: 'start' }, M));
      await ok(call('POST', `${FM2}/games/${o2.id}/action`, { action: 'start' }, M));
      fs2 = await ok(call('GET', FM2, null, M));
      assert.strictEqual(fs2.games.find(g => g.id === o1.id).field, 'North');
      assert.strictEqual(fs2.games.find(g => g.id === o2.id).field, 'Field 2');
      await err(call('POST', `${F2}/games/${o1.id}/switch`, {}, PH), 409); // game started
      await ok(call('POST', `${FM2}/games/${o3.id}/action`, { action: 'start', field: 'Turf C' }, M));
      await ok(call('POST', `${FM2}/games/${o1.id}/action`, { action: 'field', field: 'South' }, M));
      fs2 = await ok(call('GET', FM2, null, M));
      assert.strictEqual(fs2.games.find(g => g.id === o3.id).field, 'Turf C');
      assert.strictEqual(fs2.games.find(g => g.id === o1.id).field, 'South');
      // organizer turns team picking off -> self switch refused
      await ok(call('PATCH', FM2, { settings: { allowTeamPick: false } }, M));
      const o4 = (await ok(call('GET', FM2, null, M))).games.find(g => g.status === 'open');
      await ok(call('POST', `${F2}/games/${o4.id}/signup`, {}, (await (async () => { const q = await ok(call('POST', '/api/join', { code: fe2.code, name: 'Quin' })); return { 'X-Player-Token': q.token }; })())));
      const qtok = (await ok(call('POST', '/api/join', { code: fe2.code, name: 'Quin', confirmClaim: true }))).token;
      await err(call('POST', `${F2}/games/${o4.id}/switch`, {}, { 'X-Player-Token': qtok }), 403);
      await ok(call('DELETE', FM2, null, M));
      console.log('✔ fields: auto first free field, explicit and changed fields; self team switch');
    }

    // Organizer event list
    const me = await ok(call('GET', '/api/manager/me', null, M));
    assert.strictEqual(me.events.length, 2);

    // End event frees code
    await ok(call('POST', `/api/manager/events/${ev.id}/end`, {}, M));
    await err(call('POST', '/api/join', { code: ev.code, checkOnly: true }), 404);
    // Reopen gets it back; delete removes it
    await ok(call('POST', `/api/manager/events/${ev.id}/reopen`, {}, M));
    await ok(call('DELETE', `/api/manager/events/${ev.id}`, null, M));
    assert.strictEqual((await ok(call('GET', '/api/manager/me', null, M))).events.length, 1);

    // Login works with the stored password
    await ok(call('POST', '/api/manager/login', { username: 'coach', password: 'secret1' }));
    await err(call('POST', '/api/manager/login', { username: 'coach', password: 'nope123' }), 401);

    // Account recovery: forgot username, forgot password, reset link, sessions revoked, account changes
    {
      const http = await import('http');
      const mails = [];
      const sink = http.createServer((req, res) => {
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => { mails.push({ key: req.headers['api-key'], body: JSON.parse(Buffer.concat(chunks).toString()) }); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"messageId":"x"}'); });
      });
      await new Promise(r => sink.listen(9913, '127.0.0.1', r));
      const wait = async n => { for (let i = 0; i < 40 && mails.length < n; i++) await sleep(150); };
      const acct = await ok(call('POST', '/api/manager/register', { username: 'resetme', password: 'oldpass1', email: 'Reset.Me@Example.com' }));
      const cfg2 = await (await fetch(BASE + '/api/config')).json();
      assert.strictEqual(cfg2.emailConfigured, true);

      // forgot username
      await ok(call('POST', '/api/manager/forgot-username', { email: 'reset.me@example.com' }));
      await wait(1);
      assert.strictEqual(mails.length, 1, 'username email sent');
      assert.strictEqual(mails[0].key, 'test-key');
      assert.deepStrictEqual(mails[0].body.to, [{ email: 'reset.me@example.com' }]);
      assert.match(mails[0].body.textContent, /username is: resetme/);
      // unknown email: same answer, nothing sent
      await ok(call('POST', '/api/manager/forgot-username', { email: 'nobody@example.com' }));
      await sleep(300); assert.strictEqual(mails.length, 1, 'no email for unknown address');

      // forgot password by username -> link -> reset
      await ok(call('POST', '/api/manager/forgot-password', { who: 'ResetMe' }));
      await wait(2);
      const link = mails[1].body.textContent.match(/#\/reset\/([\w-]+)/);
      assert.ok(link, 'reset link in email');
      assert.match(mails[1].body.textContent, new RegExp(BASE.replace(/[.]/g, '\\.')), 'link points at this site');
      await err(call('POST', '/api/manager/reset-password', { token: link[1], password: '123' }), 400); // too short
      const fresh = await ok(call('POST', '/api/manager/reset-password', { token: link[1], password: 'newpass1' }));
      assert.ok(fresh.token);
      await err(call('POST', '/api/manager/reset-password', { token: link[1], password: 'another1' }), 400); // single use
      await err(call('GET', '/api/manager/me', null, { Authorization: 'Bearer ' + acct.token }), 401); // old sessions signed out
      await ok(call('GET', '/api/manager/me', null, { Authorization: 'Bearer ' + fresh.token }));
      await err(call('POST', '/api/manager/login', { username: 'resetme', password: 'oldpass1' }), 401);
      const li = await ok(call('POST', '/api/manager/login', { username: 'resetme', password: 'newpass1' }));
      const AH = { Authorization: 'Bearer ' + li.token };

      // account page: change email, change password (needs current one)
      const ch = await ok(call('POST', '/api/manager/account', { email: 'new@example.com' }, AH));
      assert.strictEqual(ch.email, 'new@example.com');
      assert.strictEqual((await ok(call('GET', '/api/manager/account', null, AH))).email, 'new@example.com');
      await err(call('POST', '/api/manager/account', { currentPassword: 'wrong', newPassword: 'abcdef1' }, AH), 401);
      const ch2 = await ok(call('POST', '/api/manager/account', { currentPassword: 'newpass1', newPassword: 'abcdef1' }, AH));
      await ok(call('GET', '/api/manager/me', null, { Authorization: 'Bearer ' + ch2.token })); // this device stays in
      // a second reset email within a minute is held back (stops email spam)
      await ok(call('POST', '/api/manager/forgot-password', { who: 'new@example.com' }));
      await sleep(400); assert.strictEqual(mails.length, 2, 'at most one reset email a minute');
      // the new email is the one on file now
      await ok(call('POST', '/api/manager/forgot-username', { email: 'new@example.com' }));
      await wait(3);
      assert.deepStrictEqual(mails[2].body.to, [{ email: 'new@example.com' }]);
      await ok(call('POST', '/api/manager/forgot-username', { email: 'reset.me@example.com' }));
      await sleep(400); assert.strictEqual(mails.length, 3, 'old email no longer linked');
      sink.close();
      console.log('✔ account recovery: forgot username, reset link (1 use, signs out other devices), account changes');
    }

    console.log('All checks passed ✔');
  } finally { try { process.kill(-srv.pid); } catch { srv.kill(); } }
})().catch(e => { console.error('FAILED:', e.stack); process.exit(1); });
