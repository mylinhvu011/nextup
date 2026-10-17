// Registry: one Durable Object for the whole app.
// Holds organizer accounts + sessions, which join code belongs to which event,
// each organizer's event list, and the push-notification keys.
import { DurableObject } from 'cloudflare:workers';
import { newId, normCode } from './util.js';
import { generateVapidKeys, b64urlEncode, b64urlDecode } from './webpush.js';
import { sendEmail, emailBody } from './email.js';
import { cleanSettings } from './room.js';
import { cleanSchedule, occurrences, closeAtFor, whenText } from './schedule.js';

const SESSION_MS = 30 * 864e5;
const PBKDF2_ITER = 100000; // Workers' maximum

async function hashPassword(pw, saltB64) {
  const salt = saltB64 ? b64urlDecode(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return b64urlEncode(salt) + ':' + b64urlEncode(bits);
}
async function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const again = (await hashPassword(pw, salt)).split(':')[1];
  if (again.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ again.charCodeAt(i);
  return diff === 0;
}

const err = (status, error) => ({ error, status });
const RESET_MS = 60 * 60000; // reset links work for 1 hour
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
async function sha(str) {
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))));
}

export class Registry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.hits = new Map();
  }

  throttle(ip, key, limit, windowMs) {
    const k = key + ':' + (ip || '?');
    const now = Date.now();
    const h = this.hits.get(k);
    if (!h || now > h.reset) { this.hits.set(k, { n: 1, reset: now + windowMs }); return false; }
    if (this.hits.size > 5000) for (const [kk, v] of this.hits) if (now > v.reset) this.hits.delete(kk);
    return ++h.n > limit;
  }

  /* ---------- push keys ---------- */
  async getVapidKeys() {
    if (this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY) {
      return { publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY };
    }
    let keys = await this.ctx.storage.get('vapid');
    if (!keys) { keys = await generateVapidKeys(); await this.ctx.storage.put('vapid', keys); }
    return keys;
  }
  async getPublicKey() { return (await this.getVapidKeys()).publicKey; }

  /* ---------- organizer accounts ---------- */
  async register({ username, password, email, signupCode, ip }) {
    if (this.throttle(ip, 'register', 10, 15 * 60000)) return err(429, 'Too many tries — wait a few minutes');
    const code = this.env.MANAGER_SIGNUP_CODE || '';
    if (code && signupCode !== code) return err(403, 'Organizer sign-up code is wrong');
    username = String(username || '').trim();
    password = String(password || '');
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return err(400, 'Username: 3–32 letters, numbers, dots, dashes or underscores');
    if (password.length < 6) return err(400, 'Password must be at least 6 characters');
    email = normEmail(email);
    if (!validEmail(email)) return err(400, 'Enter a valid email — it lets you reset your password if you forget it');
    const lower = username.toLowerCase();
    if (await this.ctx.storage.get('u:' + lower)) return err(409, 'That username is taken');
    if ((await this.accountsForEmail(email)).length) return err(409, 'That email is already on another account — sign in, or use Forgot username?');
    const m = { id: newId(), username, email, pass: await hashPassword(password), created: Date.now() };
    await this.ctx.storage.put({ ['u:' + lower]: m });
    await this.indexEmail(email, lower);
    return this.issueSession(m);
  }

  async login({ username, password, ip }) {
    if (this.throttle(ip, 'login', 20, 15 * 60000)) return err(429, 'Too many tries — wait a few minutes');
    const who = String(username || '').trim().toLowerCase();
    let m = null;
    if (who.includes('@')) {
      // Sign in with email; older accounts that shared an email are matched by password
      for (const a of await this.accountsForEmail(normEmail(who))) {
        if (await checkPassword(String(password || ''), a.pass)) { m = a; break; }
      }
      if (!m) return err(401, 'Wrong email or password');
      return this.issueSession(m);
    }
    m = await this.ctx.storage.get('u:' + who);
    if (!m || !(await checkPassword(String(password || ''), m.pass))) return err(401, 'Wrong username or password');
    return this.issueSession(m);
  }

  async issueSession(m) {
    const token = newId(24);
    await this.ctx.storage.put('s:' + token, { managerId: m.id, username: m.username, created: Date.now() });
    return { token, username: m.username };
  }

  async logout(token) { if (token) await this.ctx.storage.delete('s:' + token); return { ok: true }; }

  async auth(token) {
    if (!token) return null;
    const s = await this.ctx.storage.get('s:' + token);
    if (!s) return null;
    if (Date.now() - s.created > SESSION_MS) { await this.ctx.storage.delete('s:' + token); return null; }
    const m = await this.ctx.storage.get('u:' + String(s.username).toLowerCase());
    if (!m || (m.passChangedAt && s.created < m.passChangedAt)) { await this.ctx.storage.delete('s:' + token); return null; }
    return { id: s.managerId, username: s.username, email: m.email || '' };
  }

  /* ---------- email + recovery ---------- */
  async indexEmail(email, lower) {
    if (!email) return;
    const list = (await this.ctx.storage.get('em:' + email)) || [];
    if (!list.includes(lower)) list.push(lower);
    await this.ctx.storage.put('em:' + email, list);
  }
  async unindexEmail(email, lower) {
    if (!email) return;
    const list = ((await this.ctx.storage.get('em:' + email)) || []).filter(x => x !== lower);
    if (list.length) await this.ctx.storage.put('em:' + email, list); else await this.ctx.storage.delete('em:' + email);
  }
  async accountsForEmail(email) {
    const list = (await this.ctx.storage.get('em:' + email)) || [];
    const out = [];
    for (const lower of list) { const m = await this.ctx.storage.get('u:' + lower); if (m && m.email === email) out.push(m); }
    return out;
  }

  // Change email and/or password for the signed-in organizer.
  async updateAccount({ username, email, currentPassword, newPassword }) {
    const lower = String(username || '').toLowerCase();
    const m = await this.ctx.storage.get('u:' + lower);
    if (!m) return err(401, 'Please sign in again');
    const out = { ok: true };
    if (email !== undefined) {
      const e = normEmail(email);
      if (!validEmail(e)) return err(400, 'Enter a valid email');
      if (e !== m.email && (await this.accountsForEmail(e)).some(a => a.username.toLowerCase() !== lower)) {
        return err(409, 'That email is already on another account');
      }
      if (e !== m.email) { await this.unindexEmail(m.email, lower); m.email = e; await this.indexEmail(e, lower); }
    }
    if (newPassword !== undefined) {
      if (!(await checkPassword(String(currentPassword || ''), m.pass))) return err(401, 'Current password is wrong');
      if (String(newPassword).length < 6) return err(400, 'New password must be at least 6 characters');
      m.pass = await hashPassword(String(newPassword));
      m.passChangedAt = Date.now() - 1; // signs out every other device
    }
    await this.ctx.storage.put('u:' + lower, m);
    if (newPassword !== undefined) Object.assign(out, await this.issueSession(m)); // keep this device signed in
    out.email = m.email || '';
    return out;
  }

  // "Forgot password": email a 1-hour, single-use reset link. Same reply whether or not the account exists.
  async forgotPassword({ who, ip, origin }) {
    if (this.throttle(ip, 'forgot', 10, 15 * 60000)) return err(429, 'Too many tries — wait a few minutes');
    const w = String(who || '').trim().toLowerCase();
    if (!w) return err(400, 'Enter your username or email');
    let accounts = [];
    if (w.includes('@')) accounts = await this.accountsForEmail(normEmail(w));
    else { const m = await this.ctx.storage.get('u:' + w); if (m && m.email) accounts = [m]; }
    for (const m of accounts) {
      const lower = m.username.toLowerCase();
      if (m.lastResetAt && Date.now() - m.lastResetAt < 60000) continue; // at most one email a minute
      const token = newId(32);
      await this.ctx.storage.put('rs:' + (await sha(token)), { user: lower, exp: Date.now() + RESET_MS });
      m.lastResetAt = Date.now();
      await this.ctx.storage.put('u:' + lower, m);
      const { text, html } = emailBody([
        `Someone asked to reset the password for the Next Up organizer account "${m.username}".`,
        'Tap the button to choose a new password. The link works once, for 1 hour.',
        "If you didn't ask for this, you can ignore this email — your password won't change."
      ], { label: 'Choose a new password', url: `${origin}/#/reset/${token}` });
      await sendEmail(this.env, { to: m.email, subject: 'Reset your Next Up password', text, html });
    }
    return { ok: true };
  }

  async resetPassword({ token, password }) {
    const key = 'rs:' + (await sha(String(token || '')));
    const r = await this.ctx.storage.get(key);
    if (!r || r.exp < Date.now()) { if (r) await this.ctx.storage.delete(key); return err(400, 'This reset link has expired or was already used — ask for a new one'); }
    if (String(password || '').length < 6) return err(400, 'Password must be at least 6 characters');
    const m = await this.ctx.storage.get('u:' + r.user);
    if (!m) return err(400, 'This reset link is no longer valid');
    m.pass = await hashPassword(String(password));
    m.passChangedAt = Date.now() - 1;
    await this.ctx.storage.put('u:' + r.user, m);
    await this.ctx.storage.delete(key);
    return this.issueSession(m);
  }

  // "Forgot username": email every username tied to that address. Same reply either way.
  async forgotUsername({ email, ip, origin }) {
    if (this.throttle(ip, 'forgot', 10, 15 * 60000)) return err(429, 'Too many tries — wait a few minutes');
    const e = normEmail(email);
    if (!validEmail(e)) return err(400, 'Enter the email on your account');
    const accounts = await this.accountsForEmail(e);
    if (accounts.length) {
      const names = accounts.map(m => m.username);
      const { text, html } = emailBody([
        names.length === 1
          ? `Your Next Up organizer username is: ${names[0]}`
          : `This email has ${names.length} Next Up organizer accounts: ${names.join(', ')}`,
        "If you didn't ask for this, you can ignore this email."
      ], { label: 'Sign in', url: `${origin}/#/manager` });
      await sendEmail(this.env, { to: e, subject: 'Your Next Up username', text, html });
    }
    return { ok: true };
  }

  async listEvents(managerId) {
    const rows = await this.ctx.storage.list({ prefix: `e:${managerId}:` });
    return [...rows.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async putSummary(summary) { await this.ctx.storage.put(`e:${summary.managerId}:${summary.id}`, summary); return true; }
  async removeSummary(managerId, eventId) { await this.ctx.storage.delete(`e:${managerId}:${eventId}`); return true; }

  /* ---------- join codes ----------
     c:<code>  -> the live event using it right now
     cs:<code> -> a repeating event that owns it (kept between weeks so nobody else takes it) */
  // Who is really using a code right now: a live event, a repeating event, or nobody.
  // Reservations whose event has ended, been deleted or moved to another code (or whose repeating
  // event is gone) are stale — they're cleaned up here so the code is free again.
  async codeHolder(c, { eventId = null, seriesId = null } = {}) {
    const owner = await this.ctx.storage.get('c:' + c);
    if (owner && owner !== eventId) {
      let st = null;
      try { st = await (await this.roomStub(owner).fetch('https://room/status')).json(); } catch (e) { console.error(e); }
      if (!st) return { kind: 'event' }; // couldn't check: play safe
      if (st.status === 'active' && normCode(st.code || '') === c) return { kind: 'event', name: st.name, managerId: st.managerId, seriesId: st.seriesId };
      if ((await this.ctx.storage.get('c:' + c)) === owner) await this.ctx.storage.delete('c:' + c);
    }
    const so = await this.ctx.storage.get('cs:' + c);
    if (so && so !== seriesId) {
      const sr = await this.ctx.storage.get('sr:' + so);
      if (sr && normCode(sr.code) === c) return { kind: 'series', name: sr.name, managerId: sr.managerId };
      await this.ctx.storage.delete('cs:' + c);
    }
    return null;
  }
  async codeTaken(c, opts) { return !!(await this.codeHolder(c, opts)); }
  takenError(h, managerId) {
    if (h && h.managerId && h.managerId === managerId) {
      if (h.kind === 'series' || h.seriesId) return err(409, `Your repeating event "${h.name}" uses that password — pick a different one, or stop repeating that event to free it`);
      return err(409, `Your live event "${h.name}" is using that password — end it first, or pick a different one`);
    }
    return err(409, 'Another event is using that password — pick a different one');
  }
  // type 'pin' -> random free 4-digit code; type 'custom' -> validate + claim.
  async reserveCode({ type, code, eventId, seriesId = null, managerId = null }) {
    if (type === 'custom') {
      const c = String(code || '').trim();
      if (c.length < 4 || c.length > 32) return err(400, 'Custom password must be 4–32 characters');
      const h = await this.codeHolder(normCode(c), { eventId, seriesId });
      if (h) return this.takenError(h, managerId);
      await this.ctx.storage.put('c:' + normCode(c), eventId);
      return { code: c, codeType: 'custom' };
    }
    if (type === 'keep' && code) {
      if (!(await this.codeTaken(normCode(code), { eventId, seriesId }))) { await this.ctx.storage.put('c:' + normCode(code), eventId); return { code }; }
      return err(409, 'taken');
    }
    for (let i = 0; i < 300; i++) {
      const c = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (!(await this.codeTaken(c))) {
        await this.ctx.storage.put('c:' + c, eventId);
        return { code: c, codeType: 'pin' };
      }
    }
    return err(503, 'No free codes right now — use a custom password instead');
  }

  async releaseCode(code, eventId) {
    const key = 'c:' + normCode(code);
    if ((await this.ctx.storage.get(key)) === eventId) await this.ctx.storage.delete(key);
    return true;
  }

  async lookupCode(code, ip) {
    // Only WRONG codes count toward the limit (that's what guessing looks like). Many players at one
    // field share an IP on the same Wi-Fi or carrier, so successful joins are never limited.
    const k = 'joinmiss:' + (ip || '?');
    const h = this.hits.get(k);
    if (h && Date.now() <= h.reset && h.n >= 30) return err(429, 'Too many wrong codes — wait a few minutes and try again');
    const c = normCode(code);
    if (!c) return err(400, 'Enter the event code');
    const eventId = await this.ctx.storage.get('c:' + c);
    if (eventId) return { eventId };
    // A repeating event's code between weeks: say when it's next on (not counted as a wrong code).
    const sid = await this.ctx.storage.get('cs:' + c);
    const sr = sid && await this.ctx.storage.get('sr:' + sid);
    if (sr) {
      const o = this.nextOcc(sr, Date.now());
      return err(404, o ? `No game right now. ${sr.name} is next on ${whenText(o.openAt, sr.settings.tz)}.` : `No game right now — ${sr.name} has no more dates scheduled.`);
    }
    // Move codes carry someone's sign-in from their browser into the Home Screen app.
    const mv = await this.ctx.storage.get('mv:' + c);
    if (mv && mv.exp > Date.now()) return { eventId: mv.eventId, moveCode: c };
    if (mv) await this.ctx.storage.delete('mv:' + c);
    this.throttle(ip, 'joinmiss', 30, 10 * 60000); // count the miss
    return err(404, 'No live event with that code — check with the organizer');
  }

  /* ---------- move codes ---------- */
  async reserveMove(eventId, ttlMs) {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (0/o, 1/l/i)
    for (let i = 0; i < 50; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      const code = [...bytes].map(b => alphabet[b % alphabet.length]).join('');
      if (await this.ctx.storage.get('c:' + code) || await this.ctx.storage.get('cs:' + code)) continue;
      if (await this.ctx.storage.get('mv:' + code)) continue;
      await this.ctx.storage.put('mv:' + code, { eventId, exp: Date.now() + ttlMs });
      return { code };
    }
    return err(503, 'Could not make a move code — try again');
  }
  async releaseMove(code) { await this.ctx.storage.delete('mv:' + normCode(code)); return true; }

  /* ---------- repeating events ----------
     sr:<id> -> { id, managerId, name, code, codeType, settings, schedule, skips[], lastDate, currentEventId }
     The Registry's alarm opens each occurrence as an ordinary event at its sign-up time. */
  roomStub(eventId) { return this.env.EVENTS.get(this.env.EVENTS.idFromName(eventId)); }

  // The next occurrence still to open: after the last one opened, not skipped, not already over.
  nextOcc(sr, now, { ignoreSkips = false } = {}) {
    for (const o of occurrences(sr.schedule, sr.settings.tz, now, 60)) {
      if (sr.lastDate && o.date <= sr.lastDate) continue;
      if (!ignoreSkips && sr.skips.includes(o.date)) continue;
      if (closeAtFor(o.openAt, sr.settings) <= now) continue;
      return o;
    }
    return null;
  }

  async liveEventOf(sr) {
    if (!sr.currentEventId) return null;
    const sum = await this.ctx.storage.get(`e:${sr.managerId}:${sr.currentEventId}`);
    return sum && sum.status === 'active' ? sr.currentEventId : null;
  }

  async seriesView(sr) {
    const now = Date.now();
    const live = await this.liveEventOf(sr);
    const upcoming = [];
    for (const o of occurrences(sr.schedule, sr.settings.tz, now, 12)) {
      if (sr.lastDate && o.date <= sr.lastDate) continue;
      if (closeAtFor(o.openAt, sr.settings) <= now) continue;
      upcoming.push({ ...o, skipped: sr.skips.includes(o.date) });
      if (upcoming.length >= 6) break;
    }
    const next = this.nextOcc(sr, now);
    const { id, name, code, codeType, settings, schedule, created } = sr;
    return { id, name, code, codeType, settings, schedule, created, liveEventId: live, next, upcoming };
  }

  async ownSeries(managerId, id) {
    const sr = await this.ctx.storage.get('sr:' + id);
    return sr && sr.managerId === managerId ? sr : null;
  }

  async listSeries(managerId) {
    const rows = await this.ctx.storage.list({ prefix: 'sr:' });
    const mine = [...rows.values()].filter(sr => sr.managerId === managerId).sort((a, b) => a.created - b.created);
    return Promise.all(mine.map(sr => this.seriesView(sr)));
  }

  async getSeries(managerId, id) {
    const sr = await this.ownSeries(managerId, id);
    return sr ? this.seriesView(sr) : err(404, 'Repeating event not found');
  }

  async createSeries({ managerId, name, codeType, code, settings, schedule }) {
    const st = cleanSettings(settings || {});
    const sc = cleanSchedule(schedule, st.tz);
    if (sc.error) return err(400, sc.error);
    const id = newId(9);
    let c;
    if (codeType === 'custom') {
      c = String(code || '').trim();
      if (c.length < 4 || c.length > 32) return err(400, 'Custom password must be 4–32 characters');
      const h = await this.codeHolder(normCode(c), { seriesId: id });
      if (h) return this.takenError(h, managerId);
    } else {
      for (let i = 0; i < 300 && !c; i++) {
        const t = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        if (!(await this.codeTaken(t))) c = t;
      }
      if (!c) return err(503, 'No free codes right now — use a custom password instead');
    }
    await this.ctx.storage.put('cs:' + normCode(c), id);
    const sr = {
      id, managerId, name: String(name || '').trim().slice(0, 60) || 'Pickup', code: c, codeType: codeType === 'custom' ? 'custom' : 'pin',
      settings: st, schedule: sc, skips: [], lastDate: null, currentEventId: null, created: Date.now()
    };
    await this.ctx.storage.put('sr:' + id, sr);
    await this.tickSeries(); // opens it right away if this week's is already due
    return this.seriesView(await this.ctx.storage.get('sr:' + id));
  }

  async updateSeries({ managerId, id, name, settings, schedule }) {
    const sr = await this.ownSeries(managerId, id);
    if (!sr) return err(404, 'Repeating event not found');
    if (typeof name === 'string' && name.trim()) sr.name = name.trim().slice(0, 60);
    if (settings) sr.settings = cleanSettings(settings, sr.settings);
    if (schedule) {
      const sc = cleanSchedule({ ...sr.schedule, ...schedule }, sr.settings.tz);
      if (sc.error) return err(400, sc.error);
      sr.schedule = sc;
    }
    await this.ctx.storage.put('sr:' + id, sr);
    await this.tickSeries();
    return this.seriesView(await this.ctx.storage.get('sr:' + id));
  }

  async skipSeries({ managerId, id, date, skip }) {
    const sr = await this.ownSeries(managerId, id);
    if (!sr) return err(404, 'Repeating event not found');
    sr.skips = sr.skips.filter(d => d !== date && d >= (sr.lastDate || ''));
    if (skip) sr.skips.push(String(date).slice(0, 10));
    await this.ctx.storage.put('sr:' + id, sr);
    await this.tickSeries();
    return this.seriesView(await this.ctx.storage.get('sr:' + id));
  }

  // "Open it now": opens the next date early (or returns the one already running).
  async openSeriesNow({ managerId, id }) {
    const sr = await this.ownSeries(managerId, id);
    if (!sr) return err(404, 'Repeating event not found');
    const live = await this.liveEventOf(sr);
    if (live) return { eventId: live };
    const o = this.nextOcc(sr, Date.now());
    if (!o) return err(409, 'There are no more dates scheduled');
    const eventId = await this.openOccurrence(sr, o);
    await this.tickSeries();
    return { eventId };
  }

  async deleteSeries({ managerId, id }) {
    const sr = await this.ownSeries(managerId, id);
    if (!sr) return err(404, 'Repeating event not found');
    await this.ctx.storage.delete('sr:' + id);
    const key = 'cs:' + normCode(sr.code);
    if ((await this.ctx.storage.get(key)) === id) await this.ctx.storage.delete(key);
    await this.tickSeries();
    return { ok: true };
  }

  async openOccurrence(sr, o) {
    // Finish last week's if it's somehow still running, so the code moves to the new one.
    const prev = await this.liveEventOf(sr);
    if (prev) {
      await this.roomStub(prev).fetch(new Request('https://room/m/end', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nu-manager': sr.managerId }, body: '{}'
      }));
    }
    const eventId = newId(9);
    const key = 'c:' + normCode(sr.code);
    await this.ctx.storage.put(key, eventId);
    const res = await this.roomStub(eventId).fetch(new Request('https://room/init', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, managerId: sr.managerId, name: sr.name, code: sr.code, codeType: sr.codeType, settings: sr.settings, seriesId: sr.id, occurrence: o.date })
    }));
    if (!res.ok) { await this.ctx.storage.delete(key); throw new Error('Could not open ' + sr.name + ': ' + (await res.text())); }
    await this.putSummary(await res.json());
    sr.lastDate = o.date; sr.currentEventId = eventId;
    sr.skips = sr.skips.filter(d => d > o.date);
    await this.ctx.storage.put('sr:' + sr.id, sr);
    return eventId;
  }

  // Open whatever is due and set the alarm for the next one.
  async tickSeries() {
    const now = Date.now();
    let next = Infinity;
    const rows = await this.ctx.storage.list({ prefix: 'sr:' });
    for (const sr of rows.values()) {
      let o = this.nextOcc(sr, now);
      if (o && o.openAt <= now) {
        try { await this.openOccurrence(sr, o); } catch (e) { console.error(e); next = Math.min(next, now + 60000); continue; }
        o = this.nextOcc(sr, now);
      }
      if (o) next = Math.min(next, o.openAt);
    }
    if (next === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 100));
  }

  async alarm() { await this.tickSeries(); }
}
