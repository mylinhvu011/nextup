// Auto-close check: runs `wrangler dev` with events set to close after a few seconds instead of 12 hours.
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import assert from 'assert';

const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}`;
const SECS = 4;
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextup-ac-'));
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const ok = async p => { const r = await p; assert.ok(r.status < 300, JSON.stringify(r)); return r.data; };

(async () => {
  const root = path.join(__dirname, '..');
  const srv = spawn(path.join(root, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistDir, '--log-level', 'error', '--var', `AUTO_CLOSE_SECONDS:${SECS}`],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: 'ignore', detached: true });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(BASE + '/api/config')).ok; } catch { await sleep(500); } }
    assert.ok(up, 'wrangler dev did not start');
    const m = await ok(call('POST', '/api/manager/register', { username: 'coach', password: 'secret1', email: 'c@example.com' }));
    const M = { Authorization: 'Bearer ' + m.token };
    const ev = await ok(call('POST', '/api/manager/events', { name: 'Tuesday', codeType: 'custom', code: 'tuesday' }, M));
    const P = await ok(call('POST', '/api/join', { code: 'tuesday', name: 'Ana' }));
    let s = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    assert.ok(s.autoCloseAt > Date.now() && s.autoCloseAt <= Date.now() + SECS * 1000 + 1000, 'close time is shown');

    // "Keep open 1 more hour" on another event pushes its close time out by an hour
    const ev2 = await ok(call('POST', '/api/manager/events', { name: 'Other' }, M));
    const s2 = await ok(call('GET', `/api/manager/events/${ev2.id}`, null, M));
    const ext = await ok(call('POST', `/api/manager/events/${ev2.id}/extend`, {}, M));
    assert.ok(Math.abs(ext.autoCloseAt - (s2.autoCloseAt + 3600000)) < 1000, 'extend adds an hour');

    // ...the first one closes on its own
    await sleep(SECS * 1000 + 1500);
    s = await ok(call('GET', `/api/manager/events/${ev.id}`, null, M));
    assert.strictEqual(s.status, 'ended', 'closed automatically');
    assert.ok(s.autoClosed);
    const me = await ok(call('GET', '/api/manager/me', null, M));
    assert.strictEqual(me.events.find(e => e.id === ev.id).status, 'ended', 'events list shows it ended');
    assert.strictEqual((await call('POST', '/api/join', { code: 'tuesday', checkOnly: true })).status, 404, 'password freed');
    const pst = await ok(call('GET', `/api/events/${ev.id}/me`, null, { 'X-Player-Token': P.token }));
    assert.ok(pst.state.autoClosed, 'players see it closed');

    // the freed password works for a brand-new event
    await ok(call('POST', '/api/manager/events', { name: 'Next week', codeType: 'custom', code: 'tuesday' }, M));
    assert.strictEqual((await ok(call('GET', `/api/manager/events/${ev2.id}`, null, M))).status, 'active', 'extended event still open');
    console.log('autoclose: all checks passed');
  } finally { try { process.kill(-srv.pid); } catch { srv.kill(); } }
})().catch(e => { console.error('FAILED:', e.stack); process.exit(1); });
