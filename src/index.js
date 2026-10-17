// Next Up — Cloudflare Worker entry.
// Static files in /public are served automatically. This Worker handles /api/*
// and hands each request to the right Durable Object.
import { json, errorResponse, readJson, fail, newId } from './util.js';
import { emailConfigured } from './email.js';
export { Registry } from './registry.js';
export { EventRoom } from './room.js';

const registryOf = env => env.REGISTRY.get(env.REGISTRY.idFromName('global'));
const roomOf = (env, eventId) => env.EVENTS.get(env.EVENTS.idFromName(eventId));
const bearer = req => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
const rpc = r => (r && r.error ? fail(r.status, r.error) : r);

// Forward a request to an event's Durable Object under an internal path.
async function forward(env, request, eventId, path, { managerId, body } = {}) {
  const url = new URL(request.url);
  const headers = new Headers();
  for (const h of ['Content-Type', 'X-Player-Token', 'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Extensions', 'Sec-WebSocket-Protocol']) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (managerId) headers.set('x-nu-manager', managerId);
  const init = { method: request.method, headers };
  if (body !== undefined) { init.body = JSON.stringify(body); headers.set('Content-Type', 'application/json'); }
  else if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
  return roomOf(env, eventId).fetch(new Request(`https://room${path}${url.search}`, init));
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const registry = registryOf(env);
  let m;

  if (method === 'GET' && path === '/api/config') {
    return json({ vapidPublicKey: await registry.getPublicKey(), signupCodeRequired: !!env.MANAGER_SIGNUP_CODE, emailConfigured: emailConfigured(env) });
  }

  /* ----- organizer accounts ----- */
  if (method === 'POST' && path === '/api/manager/register') {
    const b = await readJson(request);
    return json(rpc(await registry.register({ ...b, ip })));
  }
  if (method === 'POST' && path === '/api/manager/login') {
    const b = await readJson(request);
    return json(rpc(await registry.login({ ...b, ip })));
  }
  // Account recovery (no sign-in needed). Links point back at this site (or APP_URL if set).
  const origin = (env.APP_URL || url.origin).replace(/\/+$/, '');
  if (method === 'POST' && path === '/api/manager/forgot-password') {
    const b = await readJson(request);
    return json(rpc(await registry.forgotPassword({ who: b.who, ip, origin })));
  }
  if (method === 'POST' && path === '/api/manager/forgot-username') {
    const b = await readJson(request);
    return json(rpc(await registry.forgotUsername({ email: b.email, ip, origin })));
  }
  if (method === 'POST' && path === '/api/manager/reset-password') {
    const b = await readJson(request);
    return json(rpc(await registry.resetPassword({ token: b.token, password: b.password })));
  }
  if (method === 'POST' && path === '/api/manager/logout') {
    return json(await registry.logout(bearer(request)));
  }

  /* ----- players ----- */
  if (method === 'POST' && path === '/api/join') {
    const b = await readJson(request);
    const { eventId, moveCode } = rpc(await registry.lookupCode(b.code, ip));
    return forward(env, request, eventId, '/join', { body: { name: b.name, checkOnly: !!b.checkOnly, moveCode, confirmClaim: !!b.confirmClaim } });
  }
  if ((m = path.match(/^\/api\/events\/([\w-]{6,40})\/ws$/))) {
    if (url.searchParams.get('mt')) {
      const mgr = await registry.auth(url.searchParams.get('mt'));
      if (!mgr) return new Response('Forbidden', { status: 403 });
      const u = new URL(request.url); u.searchParams.delete('mt');
      return forward(env, new Request(u, request), m[1], '/ws', { managerId: mgr.id });
    }
    return forward(env, request, m[1], '/ws');
  }
  if ((m = path.match(/^\/api\/events\/([\w-]{6,40})(\/.*)$/))) {
    return forward(env, request, m[1], '/p' + m[2]);
  }

  /* ----- organizer (signed in) ----- */
  if (path.startsWith('/api/manager/')) {
    const mgr = await registry.auth(bearer(request));
    if (!mgr) fail(401, 'Please sign in again');

    if (method === 'GET' && path === '/api/manager/me') {
      const [events, series] = await Promise.all([registry.listEvents(mgr.id), registry.listSeries(mgr.id)]);
      return json({ username: mgr.username, email: mgr.email, events, series });
    }
    if (method === 'GET' && path === '/api/manager/account') {
      return json({ username: mgr.username, email: mgr.email });
    }
    if (method === 'POST' && path === '/api/manager/account') {
      const b = await readJson(request);
      return json(rpc(await registry.updateAccount({ username: mgr.username, email: b.email, currentPassword: b.currentPassword, newPassword: b.newPassword })));
    }
    if (method === 'POST' && path === '/api/manager/events') {
      const b = await readJson(request);
      const eventId = newId(9);
      const codeType = b.codeType === 'custom' ? 'custom' : 'pin';
      const code = rpc(await registry.reserveCode({ type: codeType, code: b.code, eventId, managerId: mgr.id }));
      const res = await roomOf(env, eventId).fetch(new Request('https://room/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, managerId: mgr.id, name: b.name, code: code.code, codeType, settings: b.settings || {} })
      }));
      if (!res.ok) { await registry.releaseCode(code.code, eventId); return res; }
      await registry.putSummary(await res.json());
      return json({ id: eventId, code: code.code });
    }
    /* repeating events */
    if (method === 'POST' && path === '/api/manager/series') {
      const b = await readJson(request);
      return json(rpc(await registry.createSeries({ managerId: mgr.id, name: b.name, codeType: b.codeType, code: b.code, settings: b.settings, schedule: b.schedule })));
    }
    if ((m = path.match(/^\/api\/manager\/series\/([\w-]{6,40})(\/[a-z]+)?$/))) {
      const id = m[1], sub = m[2] || '';
      const b = method === 'GET' || method === 'DELETE' ? {} : await readJson(request);
      if (method === 'GET' && !sub) return json(rpc(await registry.getSeries(mgr.id, id)));
      if (method === 'PATCH' && !sub) return json(rpc(await registry.updateSeries({ managerId: mgr.id, id, name: b.name, settings: b.settings, schedule: b.schedule })));
      if (method === 'DELETE' && !sub) return json(rpc(await registry.deleteSeries({ managerId: mgr.id, id })));
      if (method === 'POST' && sub === '/skip') return json(rpc(await registry.skipSeries({ managerId: mgr.id, id, date: b.date, skip: !!b.skip })));
      if (method === 'POST' && sub === '/open') return json(rpc(await registry.openSeriesNow({ managerId: mgr.id, id })));
    }
    if ((m = path.match(/^\/api\/manager\/events\/([\w-]{6,40})(\/.*)?$/))) {
      return forward(env, request, m[1], '/m' + (m[2] || ''), { managerId: mgr.id });
    }
  }

  fail(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env); } catch (e) { return errorResponse(e); }
    }
    // Anything else: static files (index.html, app.js, sw.js, icons…)
    return env.ASSETS.fetch(request);
  }
};
