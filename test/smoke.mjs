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
  const srv = spawn(path.join(root, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistDir, '--log-level', 'error'],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: 'ignore', detached: true });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(BASE + '/api/config')).ok; } catch { await sleep(500); } }
    assert.ok(up, 'wrangler dev did not start');
    const cfg = await (await fetch(BASE + '/api/config')).json();
    assert.match(cfg.vapidPublicKey, /^[\w-]{80,90}$/);
    const html = await (await fetch(BASE + '/')).text();
    assert.match(html, /NEXT UP/);

    const m = await ok(call('POST', '/api/manager/register', { username: 'coach', password: 'secret1' }));
    const M = { Authorization: 'Bearer ' + m.token };
    await err(call('POST', '/api/manager/register', { username: 'Coach', password: 'secret1' }), 409);

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
    await err(call('POST', '/api/join', { code: ev.code, name: 'ana' }), 409); // name taken
    await err(call('POST', '/api/join', { code: '0000x', name: 'X' }), 404);

    let st = (await ok(call('GET', `${E}/me`, null, a.H))).state;
    assert.strictEqual(st.games.length, 1);
    const g1 = st.games[0].id;

    await ok(call('POST', `${E}/games/${g1}/signup`, {}, a.H));
    assert.match(await err(call('POST', `${E}/games/${g1}/signup`, {}, a.H), 409), /already on this game/);
    for (const p of [b, c, d]) await ok(call('POST', `${E}/games/${g1}/signup`, {}, p.H));
    st = (await ok(call('GET', `${E}/me`, null, a.H))).state;
    assert.deepStrictEqual(st.games[0].teams.a.length, 2);
    assert.deepStrictEqual(st.games[0].teams.b.length, 2);
    assert.strictEqual(st.games.length, 2, 'second board opens when first fills');
    const g2 = st.games[1].id;
    assert.match(await err(call('POST', `${E}/games/${g2}/signup`, {}, a.H), 409), /already on a game/);
    await ok(call('POST', `${E}/games/${g2}/signup`, {}, e.H));

    // Fill game 2 with walk-ups; board limit (2) means no third board
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g2}/players`, { name: 'Walk One' }, M));
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g2}/players`, { name: 'Walk Two' }, M));
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g2}/players`, { name: 'Walk Three' }, M));
    await err(call('POST', `/api/manager/events/${ev.id}/games/${g2}/players`, { name: 'Walk Four' }, M), 409);
    st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    assert.strictEqual(st.games.length, 2, 'board limit respected');
    await err(call('POST', `/api/manager/events/${ev.id}/games`, {}, M), 409);

    // Start game 1, timer runs, pause/add time, end -> new board opens
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g1}/action`, { action: 'start' }, M));
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g1}/action`, { action: 'pause' }, M));
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g1}/action`, { action: 'addtime', seconds: 60 }, M));
    st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    const t = st.games.find(g => g.id === g1).timer;
    assert.ok(!t.running && t.remainingMs > 5 * 60000 && t.remainingMs <= 6 * 60000, JSON.stringify(t));
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g1}/action`, { action: 'pinnies' }, M));
    await err(call('POST', `${E}/games/${g1}/leave`, {}, a.H), 409); // can't leave a started game
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g1}/action`, { action: 'end' }, M));
    st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    assert.strictEqual(st.games.length, 2);
    assert.strictEqual(st.history.length, 1);
    const g3 = st.games.find(g => g.id !== g2).id;
    await ok(call('POST', `${E}/games/${g3}/signup`, {}, a.H)); // Ana can sign up again

    // Unlimited sign-ups: Ana can join a 2nd game; board limit unlimited -> boards keep opening
    await ok(call('PATCH', `/api/manager/events/${ev.id}`, { settings: { maxSignups: null, maxBoards: null } }, M));
    st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    assert.strictEqual(st.settings.maxSignups, null);
    // Signup limit of 2
    await ok(call('PATCH', `/api/manager/events/${ev.id}`, { settings: { maxSignups: 2 } }, M));
    for (const p of [b, c, d]) await ok(call('POST', `${E}/games/${g3}/signup`, {}, p.H));
    st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    assert.strictEqual(st.games.length, 3, 'unlimited line opens another board');
    const g4 = st.games[2].id;
    await ok(call('POST', `${E}/games/${g4}/signup`, {}, a.H)); // 2nd sign-up allowed
    // Ana is on g3 and g4 -> limit 2 reached; put her somewhere new fails
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g4}/players`, { name: 'Walk Five' }, M));
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g4}/players`, { name: 'Walk Six' }, M));
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g4}/players`, { name: 'Walk Seven' }, M));
    st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    const g5 = st.games[3].id;
    assert.match(await err(call('POST', `${E}/games/${g5}/signup`, {}, a.H), 409), /2 games/);

    // Reorder, switch team, leave
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g4}/action`, { action: 'up' }, M));
    st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
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
      sink.close();
      assert.ok(got.length, 'push delivered to the push service');
      assert.match(got[0].headers.authorization, /^vapid t=.+, k=/);
      const note = JSON.parse(ece.decrypt(got[0].body, { version: 'aes128gcm', privateKey: ua, authSecret: auth }));
      assert.match(note.title, /signed in as Pushy/);
      console.log('✔ push notification sent, encrypted and decryptable:', note.title);
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

    console.log('All checks passed ✔');
  } finally { try { process.kill(-srv.pid); } catch { srv.kill(); } }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
