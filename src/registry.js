// Registry: one Durable Object for the whole app.
// Holds organizer accounts + sessions, which join code belongs to which event,
// each organizer's event list, and the push-notification keys.
import { DurableObject } from 'cloudflare:workers';
import { newId, normCode } from './util.js';
import { generateVapidKeys, b64urlEncode, b64urlDecode } from './webpush.js';

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
  async register({ username, password, signupCode, ip }) {
    if (this.throttle(ip, 'register', 10, 15 * 60000)) return err(429, 'Too many tries — wait a few minutes');
    const code = this.env.MANAGER_SIGNUP_CODE || '';
    if (code && signupCode !== code) return err(403, 'Organizer sign-up code is wrong');
    username = String(username || '').trim();
    password = String(password || '');
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return err(400, 'Username: 3–32 letters, numbers, dots, dashes or underscores');
    if (password.length < 6) return err(400, 'Password must be at least 6 characters');
    const lower = username.toLowerCase();
    if (await this.ctx.storage.get('u:' + lower)) return err(409, 'That username is taken');
    const m = { id: newId(), username, pass: await hashPassword(password), created: Date.now() };
    await this.ctx.storage.put({ ['u:' + lower]: m });
    return this.issueSession(m);
  }

  async login({ username, password, ip }) {
    if (this.throttle(ip, 'login', 20, 15 * 60000)) return err(429, 'Too many tries — wait a few minutes');
    const m = await this.ctx.storage.get('u:' + String(username || '').trim().toLowerCase());
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
    return { id: s.managerId, username: s.username };
  }

  async listEvents(managerId) {
    const rows = await this.ctx.storage.list({ prefix: `e:${managerId}:` });
    return [...rows.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async putSummary(summary) { await this.ctx.storage.put(`e:${summary.managerId}:${summary.id}`, summary); return true; }
  async removeSummary(managerId, eventId) { await this.ctx.storage.delete(`e:${managerId}:${eventId}`); return true; }

  /* ---------- join codes ---------- */
  // type 'pin' -> random free 4-digit code; type 'custom' -> validate + claim.
  async reserveCode({ type, code, eventId }) {
    if (type === 'custom') {
      const c = String(code || '').trim();
      if (c.length < 4 || c.length > 32) return err(400, 'Custom password must be 4–32 characters');
      const owner = await this.ctx.storage.get('c:' + normCode(c));
      if (owner && owner !== eventId) return err(409, 'Another live event is using that password — pick a different one');
      await this.ctx.storage.put('c:' + normCode(c), eventId);
      return { code: c, codeType: 'custom' };
    }
    if (type === 'keep' && code) {
      const owner = await this.ctx.storage.get('c:' + normCode(code));
      if (!owner || owner === eventId) { await this.ctx.storage.put('c:' + normCode(code), eventId); return { code }; }
      return err(409, 'taken');
    }
    for (let i = 0; i < 300; i++) {
      const c = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (!(await this.ctx.storage.get('c:' + c))) {
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
    if (this.throttle(ip, 'join', 25, 10 * 60000)) return err(429, 'Too many tries — wait a few minutes and try again');
    const c = normCode(code);
    if (!c) return err(400, 'Enter the event code');
    const eventId = await this.ctx.storage.get('c:' + c);
    if (!eventId) return err(404, 'No live event with that code — check with the organizer');
    return { eventId };
  }
}
