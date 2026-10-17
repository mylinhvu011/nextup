// Repeating events + event length. Runs `wrangler dev` and uses real clock times (one wait of ~1–2 minutes
// for a scheduled week to open on its own).
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import assert from 'assert';

const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextup-sr-'));
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const ok = async p => { const r = await p; assert.ok(r.status < 300, JSON.stringify(r)); return r.data; };
const err = async (p, status) => { const r = await p; assert.strictEqual(r.status, status, JSON.stringify(r)); return r.data.error; };
const hm = ms => { const d = new Date(ms); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const ymdUTC = ms => new Date(ms).toISOString().slice(0, 10);

(async () => {
  const root = path.join(__dirname, '..');
  const srv = spawn(path.join(root, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistDir, '--log-level', 'error'],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: 'ignore', detached: true });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(BASE + '/api/config')).ok; } catch { await sleep(500); } }
    assert.ok(up, 'wrangler dev did not start');
    const m = await ok(call('POST', '/api/manager/register', { username: 'coach', password: 'secret1', email: 'c@example.com' }));
    const M = { Authorization: 'Bearer ' + m.token };
    const tz = 'UTC';

    /* ---- event length ---- */
    const e1 = await ok(call('POST', '/api/manager/events', { name: 'Short', settings: { closeMode: 'hours', closeHours: 3, tz } }, M));
    let s = await ok(call('GET', `/api/manager/events/${e1.id}`, null, M));
    assert.ok(Math.abs(s.autoCloseAt - (Date.now() + 3 * 3600000)) < 60000, 'closes 3 hours after opening');
    const end = Date.now() + 90 * 60000;
    s = await ok(call('PATCH', `/api/manager/events/${e1.id}`, { settings: { closeMode: 'time', closeTime: hm(end), tz } }, M));
    assert.ok(Math.abs(s.autoCloseAt - end) < 60000, 'closes at the set end time');
    const ext = await ok(call('POST', `/api/manager/events/${e1.id}/extend`, {}, M));
    assert.ok(Math.abs(ext.autoCloseAt - (s.autoCloseAt + 3600000)) < 1000, 'keep open adds an hour');
    s = await ok(call('PATCH', `/api/manager/events/${e1.id}`, { settings: { closeMode: 'hours', closeHours: 1, tz } }, M));
    assert.ok(Math.abs(s.autoCloseAt - (Date.now() + 3600000)) < 60000, 'changing the length drops the extra hour');

    /* ---- repeating: already-running week opens right away ---- */
    const today = new Date().getUTCDay();
    const started = Date.now() - 10 * 60000;
    const sr = await ok(call('POST', '/api/manager/series', {
      name: 'Weekly', settings: { playersPerTeam: 2, tz, closeMode: 'hours', closeHours: 3 },
      schedule: { days: [today], everyWeeks: 2, startTime: hm(started), opensBefore: 0 }
    }, M));
    assert.match(sr.code, /^\d{4}$/);
    assert.ok(sr.liveEventId, "this week's game opened right away");
    const me = await ok(call('GET', '/api/manager/me', null, M));
    assert.strictEqual(me.series.length, 1);
    const live = me.events.find(e => e.id === sr.liveEventId);
    assert.ok(live && live.status === 'active' && live.seriesId === sr.id && live.occurrence === ymdUTC(started), 'occurrence listed as a live event');
    const P = await ok(call('POST', '/api/join', { code: sr.code, name: 'Ana' }));
    assert.strictEqual(P.eventId || sr.liveEventId, sr.liveEventId);
    // upcoming dates are every 2 weeks
    const d0 = Date.parse(sr.upcoming[0].date), d1 = Date.parse(sr.upcoming[1].date);
    assert.strictEqual((d1 - d0) / 864e5, 14, 'every 2 weeks');
    // code is the series' own: no one-off event can take it; the event can't change it
    assert.match(await err(call('POST', '/api/manager/events', { name: 'Clash', codeType: 'custom', code: sr.code }, M), 409), /Your repeating event "Weekly"/);
    // a live one-off event's password: blocked while live (named), free again once it ends
    const one = await ok(call('POST', '/api/manager/events', { name: 'Friday', codeType: 'custom', code: 'fridaypw' }, M));
    assert.match(await err(call('POST', '/api/manager/events', { name: 'Dup', codeType: 'custom', code: 'FridayPW' }, M), 409), /Your live event "Friday"/);
    assert.match(await err(call('POST', '/api/manager/series', { name: 'DupS', codeType: 'custom', code: 'fridaypw', settings: { tz }, schedule: { days: [1], startTime: '19:00' } }, M), 409), /Your live event "Friday"/);
    await ok(call('POST', `/api/manager/events/${one.id}/end`, {}, M));
    const again = await ok(call('POST', '/api/manager/events', { name: 'Friday 2', codeType: 'custom', code: 'fridaypw' }, M));
    await ok(call('DELETE', `/api/manager/events/${again.id}`, null, M));
    const again2 = await ok(call('POST', '/api/manager/series', { name: 'Fri weekly', codeType: 'custom', code: 'fridaypw', settings: { tz }, schedule: { days: [(today + 3) % 7], startTime: '19:00' } }, M));
    await ok(call('DELETE', `/api/manager/series/${again2.id}`, null, M));
    await ok(call('POST', '/api/manager/events', { name: 'Friday 3', codeType: 'custom', code: 'fridaypw' }, M));
    await err(call('POST', `/api/manager/events/${sr.liveEventId}/code`, { type: 'pin' }, M), 409);

    /* ---- between weeks the code says when it's next on ---- */
    await ok(call('POST', `/api/manager/events/${sr.liveEventId}/end`, {}, M));
    let msg = await err(call('POST', '/api/join', { code: sr.code, checkOnly: true }), 404);
    assert.match(msg, /No game right now\. Weekly is next on/);
    await err(call('POST', '/api/manager/events', { name: 'Clash2', codeType: 'custom', code: sr.code }, M), 409);

    /* ---- skip + open now ---- */
    const next = sr.upcoming[1];
    let v = await ok(call('POST', `/api/manager/series/${sr.id}/skip`, { date: next.date, skip: true }, M));
    assert.ok(v.upcoming.find(o => o.date === next.date).skipped);
    assert.notStrictEqual(v.next.date, next.date, 'skipped week is not next');
    msg = await err(call('POST', '/api/join', { code: sr.code, checkOnly: true }), 404);
    const before = await ok(call('GET', `/api/manager/series/${sr.id}`, null, M));
    const opened = await ok(call('POST', `/api/manager/series/${sr.id}/open`, {}, M));
    assert.ok(opened.eventId && opened.eventId !== sr.liveEventId);
    const after = await ok(call('GET', `/api/manager/series/${sr.id}`, null, M));
    assert.strictEqual(after.liveEventId, opened.eventId);
    assert.deepStrictEqual(after.upcoming.map(o => o.date), before.upcoming.map(o => o.date), 'open now is an extra event: no scheduled date used up');
    assert.strictEqual(after.next.date, before.next.date);
    const st2 = await ok(call('GET', `/api/manager/events/${opened.eventId}`, null, M));
    assert.strictEqual(st2.settings.playersPerTeam, 2, 'uses the series settings');
    assert.strictEqual((await ok(call('POST', '/api/join', { code: sr.code, checkOnly: true }))).name, 'Weekly');
    await ok(call('POST', `/api/manager/events/${opened.eventId}/end`, {}, M));

    /* ---- settings changes apply to the next week ---- */
    v = await ok(call('PATCH', `/api/manager/series/${sr.id}`, { name: 'Weekly 7v7', settings: { playersPerTeam: 7 }, schedule: { everyWeeks: 1 } }, M));
    assert.strictEqual(v.name, 'Weekly 7v7');
    assert.strictEqual(v.settings.playersPerTeam, 7);
    assert.strictEqual(v.schedule.everyWeeks, 1);
    await err(call('PATCH', `/api/manager/series/${sr.id}`, { schedule: { days: [] } }, M), 400);

    /* ---- a week opens on its own at its time ---- */
    const soon = Date.now() + 70000;
    const s2 = await ok(call('POST', '/api/manager/series', {
      name: 'Soon', codeType: 'custom', code: 'soonpw', settings: { tz },
      schedule: { days: [new Date(soon).getUTCDay()], startTime: hm(soon + 60000), opensBefore: 1 }
    }, M));
    assert.ok(!s2.liveEventId && s2.next.openAt > Date.now(), 'not open yet');
    msg = await err(call('POST', '/api/join', { code: 'soonpw', checkOnly: true }), 404);
    assert.match(msg, /Soon is next on/);
    let opennow = false;
    for (let i = 0; i < 40 && !opennow; i++) { await sleep(5000); opennow = (await call('POST', '/api/join', { code: 'SoonPW', checkOnly: true })).status === 200; }
    assert.ok(opennow, 'opened on its own at sign-up time');

    /* ---- stop repeating frees the code ---- */
    await ok(call('DELETE', `/api/manager/series/${sr.id}`, null, M));
    await err(call('POST', '/api/join', { code: sr.code, checkOnly: true }), 404);
    await ok(call('POST', '/api/manager/events', { name: 'Now free', codeType: 'custom', code: sr.code }, M));
    const me2 = await ok(call('GET', '/api/manager/me', null, M));
    assert.strictEqual(me2.series.length, 1); // only "Soon" left
    assert.ok(me2.events.some(e => e.seriesId === sr.id && e.status === 'ended'), 'past weeks stay in your events');
    console.log('series: all checks passed');
  } finally { try { process.kill(-srv.pid); } catch { srv.kill(); } }
})().catch(e => { console.error('FAILED:', e.stack); process.exit(1); });
