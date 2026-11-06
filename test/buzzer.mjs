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
    const ana = await join('Ana'), ben = await join('Ben'), bo = await join('Bo'), cy = await join('Cy');
    for (const [p, who] of [[ana, 'ana'], [ben, 'ben'], [bo, 'bo']]) await ok(call('POST', `${E}/push`, sub(who), p.H));
    await sleep(1500);
    const G = `/api/manager/events/${ev.id}/games`;
    let st = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    const [g1, g2, g3] = st.games.filter(g => g.status === 'open');
    await ok(call('POST', `${E}/games/${g1.id}/signup`, {}, bo.H));
    await ok(call('POST', `${E}/games/${g1.id}/signup`, {}, cy.H));
    // First game starts with nobody buzzed before -> the start alert is the buzzer
    await ok(call('POST', `${G}/${g1.id}/action`, { action: 'start' }, M));
    await ok(call('POST', `${E}/ack`, {}, bo.H));
    // Ana is now first in line -> a normal notification, not the buzzer
    await ok(call('POST', `${E}/games/${g2.id}/signup`, {}, ana.H));
    await ok(call('POST', `${E}/games/${g3.id}/signup`, {}, ben.H));
    await sleep(1500);
    let a = titles('ana');
    assert.ok(a.includes('Your game is next'), 'first in line = normal alert: ' + a);
    assert.ok(!a.some(t => t.includes('[big]')), 'no buzzer yet: ' + a);
    assert.ok(titles('bo').some(t => /^You're playing.*\[big\]/.test(t)), 'start buzzes when nobody was buzzed before: ' + titles('bo'));

    // 2 minutes left -> normal "You're on in about 2 min"
    const mins = st.settings.gameMinutes;
    await ok(call('POST', `${G}/${g1.id}/action`, { action: 'addtime', seconds: -(mins * 60 - 100) }, M));
    await sleep(2500);
    a = titles('ana');
    assert.ok(a.some(t => /^You're on in about 2 min$/.test(t)), 'heads-up is a normal alert: ' + a);
    assert.ok(!a.some(t => t.includes('[big]')), 'still no buzzer: ' + a);

    // Time runs out -> the buzzer: "You're on deck — go now!" with the field, repeated twice (no answer)
    await ok(call('POST', `${G}/${g1.id}/action`, { action: 'addtime', seconds: -100 }, M));
    await sleep(9500);
    a = titles('ana');
    const go = inbox.ana.find(n => n.big && !n.repeat);
    assert.ok(go && /go now/.test(go.title) && /Head to Field 1 now/.test(go.body), 'buzzer when the game ends, with the field: ' + JSON.stringify(go));
    assert.strictEqual(a.filter(t => /go now! \[repeat\] \[big\]/.test(t)).length, 2, 'repeated twice: ' + a);

    // Organizer ends it and starts Ana's game -> start is just a confirmation (she was already buzzed)
    await ok(call('POST', `${G}/${g1.id}/action`, { action: 'end' }, M));
    await ok(call('POST', `${G}/${g2.id}/action`, { action: 'start' }, M));
    await sleep(1500);
    a = titles('ana');
    assert.ok(a.some(t => /^You're playing/.test(t) && !t.includes('[big]')), 'start after the buzzer is a normal alert: ' + a);
    assert.ok(!titles('ben').some(t => t.includes('[big]')), 'ending a game that already timed out does not buzz the next one twice: ' + titles('ben'));

    // Organizer ends Ana's game early -> Ben (next) gets the buzzer; he answers -> no repeats
    await ok(call('POST', `${G}/${g2.id}/action`, { action: 'end' }, M));
    await sleep(1000);
    await ok(call('POST', `${E}/ack`, {}, ben.H));
    await sleep(7000);
    const b = titles('ben');
    assert.ok(b.some(t => /go now!.*\[big\]/.test(t)), 'ending a game early buzzes the next one: ' + b);
    assert.ok(!b.some(t => t.includes('[repeat]')), 'answering stops the repeats: ' + b);
    console.log('buzzer: all checks passed');
  } finally { try { process.kill(-srv.pid); } catch { srv.kill(); } sink.close(); }
})().catch(e => { console.error('FAILED:', e.stack); process.exit(1); });
