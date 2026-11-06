// Buzzer alerts: big alerts are flagged, re-sent until the phone answers "I'm coming", and stop
// once answered. Runs `wrangler dev` with repeats every 3 s instead of 30 s.
import { spawn } from 'child_process';
import { createRequire } from 'module';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import assert from 'assert';

const ece = createRequire(import.meta.url)('http_ece');
const PORT = 8796, SINK = 9915;
const BASE = `http://127.0.0.1:${PORT}`;
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextup-bz-'));
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const ok = async p => { const r = await p; assert.ok(r.status < 300, JSON.stringify(r)); return r.data; };

// A fake push service: collects decrypted notifications per phone.
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const inbox = {};
const sink = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const who = req.url.split('/').pop();
    (inbox[who] = inbox[who] || []).push(JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: ua, authSecret: auth })));
    res.writeHead(201); res.end();
  });
});
const sub = who => ({ subscription: { endpoint: `http://127.0.0.1:${SINK}/sub/${who}`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } });
const titles = who => (inbox[who] || []).map(n => n.title + (n.repeat ? ' [repeat]' : '') + (n.big ? ' [big]' : ''));

(async () => {
  await new Promise(r => sink.listen(SINK, '127.0.0.1', r));
  const root = path.join(__dirname, '..');
  const srv = spawn(path.join(root, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistDir, '--log-level', 'error', '--var', 'BUZZ_REPEAT_SECONDS:3'],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: 'ignore', detached: true });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(BASE + '/api/config')).ok; } catch { await sleep(500); } }
    assert.ok(up, 'wrangler dev did not start');
    const m = await ok(call('POST', '/api/manager/register', { username: 'coach', password: 'secret1', email: 'c@example.com' }));
    const M = { Authorization: 'Bearer ' + m.token };
    const ev = await ok(call('POST', '/api/manager/events', { name: 'Buzz', settings: { playersPerTeam: 1, maxBoards: 3 } }, M));
    const join = async name => { const r = await ok(call('POST', '/api/join', { code: ev.code, name })); return { ...r, H: { 'X-Player-Token': r.token } }; };
    const E = `/api/events/${ev.id}`;
    const ana = await join('Ana'), ben = await join('Ben');
    await ok(call('POST', `${E}/push`, sub('ana'), ana.H));
    await ok(call('POST', `${E}/push`, sub('ben'), ben.H));
    await sleep(1500);
    let st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    const [g1, g2] = st.games.filter(g => g.status === 'open');

    // Ana takes the On deck board -> big alert, then it repeats twice (no answer)
    await ok(call('POST', `${E}/games/${g1.id}/signup`, {}, ana.H));
    // Ben takes the Almost there board -> no buzzer yet
    await ok(call('POST', `${E}/games/${g2.id}/signup`, {}, ben.H));
    await sleep(9000);
    const a = titles('ana');
    assert.ok(a.includes("You're on deck! [big]"), 'on-deck alert is a buzzer: ' + a);
    assert.strictEqual(a.filter(t => t === "You're on deck! [repeat] [big]").length, 2, 'repeated twice: ' + a);
    assert.ok(!titles('ben').some(t => t.includes('[big]')), 'nobody buzzes for Almost there: ' + titles('ben'));

    // Start Ana's game: Ana gets "You're playing", Ben is now On deck. Ben answers right away -> no repeats.
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g1.id}/action`, { action: 'start' }, M));
    await sleep(800);
    await ok(call('POST', `${E}/ack`, {}, ben.H));
    await ok(call('POST', `${E}/ack`, {}, ana.H));
    await sleep(7000);
    const b = titles('ben');
    assert.ok(b.includes("You're on deck! [big]"), 'Ben buzzed when his game moved on deck: ' + b);
    assert.ok(!b.some(t => t.includes('[repeat]')), "answering stops the repeats: " + b);
    const a2 = titles('ana');
    assert.ok(a2.some(t => /^You're playing/.test(t) && t.includes('[big]')), 'game start is a buzzer: ' + a2);
    assert.ok(!a2.some(t => /^You're playing.*\[repeat\]/.test(t)), 'Ana answered: no repeats of the start alert: ' + a2);

    // Repeats stop by themselves if the player is no longer on that game
    await ok(call('POST', `/api/manager/events/${ev.id}/games/${g1.id}/action`, { action: 'end' }, M));
    st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    const g3 = st.games.filter(g => g.status === 'open')[1];
    await ok(call('POST', `${E}/games/${g3.id}/signup`, {}, ana.H)); // Almost there: no buzzer
    await ok(call('POST', `${E}/games/${g2.id}/leave`, {}, ben.H));  // Ben leaves while his on-deck alert is pending
    const before = titles('ben').length;
    await sleep(7000);
    assert.ok(!titles('ben').slice(before).some(t => t.includes('[repeat]')), 'no repeats after leaving the game');
    console.log('buzzer: all checks passed');
  } finally { try { process.kill(-srv.pid); } catch { srv.kill(); } sink.close(); }
})().catch(e => { console.error('FAILED:', e.stack); process.exit(1); });
