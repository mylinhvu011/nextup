'use strict';
/* Next Up — front end (no build step). */

const app = document.getElementById('app');
const topnav = document.getElementById('topnav');
const dlg = document.getElementById('dlg');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const mgrSession = () => store.get('nu.manager');
const playerSession = eid => store.get('nu.player.' + eid);

let cfg = { vapidPublicKey: '', signupCodeRequired: false };

/* ---------------- color themes ---------------- */
// main = buttons & field headers (darker shades are derived), accent = highlights, pinnie = bib color
const THEMES = [
  { id: 'pitch', name: 'Pitch green', main: '#1f8a5b', accent: '#c6f24e', pinnie: '#ff7a1a' },
  { id: 'midnight', name: 'Midnight', main: '#2f5fb3', accent: '#ffd23f', pinnie: '#ff5a5f' },
  { id: 'crimson', name: 'Crimson', main: '#c8102e', accent: '#ffd166', pinnie: '#1fb5d6' },
  { id: 'royal', name: 'Royal', main: '#6b3fd1', accent: '#7ef0c9', pinnie: '#ff8a3d' },
  { id: 'ocean', name: 'Ocean', main: '#0f8f8a', accent: '#a8f0ff', pinnie: '#ff6f91' },
  { id: 'sunset', name: 'Sunset', main: '#e0661f', accent: '#ffe066', pinnie: '#2bb3a3' }
];
const DEFAULT_THEME = { preset: 'pitch', main: THEMES[0].main, accent: THEMES[0].accent, pinnie: THEMES[0].pinnie };
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const shade = (h, amt) => rgbHex(...hexRgb(h).map(v => v * (1 - amt)));
function luminance(h) {
  const c = hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const textOn = h => (luminance(h) > 0.22 ? '#111a15' : '#ffffff'); // readable text on any background
const THEME_VARS = ['--grass', '--pitch', '--pitch-2', '--lime', '--pinnie', '--on-primary', '--on-accent', '--on-pinnie', '--accent-on-dark'];
const themeMeta = () => document.querySelector('meta[name=theme-color]');

function resetTheme() {
  const r = document.documentElement.style;
  THEME_VARS.forEach(v => r.removeProperty(v));
  themeMeta()?.setAttribute('content', '#0d3b2a');
}
function applyTheme(t) {
  if (!t || !t.main || !t.accent || !t.pinnie) t = DEFAULT_THEME;
  const isDefault = t.main === DEFAULT_THEME.main && t.accent === DEFAULT_THEME.accent && t.pinnie === DEFAULT_THEME.pinnie;
  if (isDefault) return resetTheme(); // keeps the hand-tuned dark-mode greens
  const r = document.documentElement.style;
  const pitch = shade(t.main, 0.62);
  r.setProperty('--grass', t.main);
  r.setProperty('--pitch', pitch);
  r.setProperty('--pitch-2', shade(t.main, 0.38));
  r.setProperty('--lime', t.accent);
  r.setProperty('--pinnie', t.pinnie);
  r.setProperty('--on-primary', textOn(t.main));
  r.setProperty('--on-accent', textOn(t.accent));
  r.setProperty('--on-pinnie', textOn(t.pinnie));
  // highlight text drawn on the dark header: fall back to white if the highlight is too dark to read
  r.setProperty('--accent-on-dark', luminance(t.accent) > 0.2 ? t.accent : '#ffffff');
  themeMeta()?.setAttribute('content', pitch);
}
const chipsHtml = t => `<span class="chips"><span style="background:${shade(t.main, 0.62)}"></span><span style="background:${t.main}"></span><span style="background:${t.accent}"></span><span style="background:${t.pinnie}"></span></span>`;

function themeFields(cur) {
  cur = cur && cur.main ? cur : DEFAULT_THEME;
  const custom = !THEMES.some(t => t.id === cur.preset);
  return `<div class="full">
    <label>Colors</label>
    <div class="swatches" id="themeSw">
      ${THEMES.map(t => `<button type="button" class="swatch" data-theme="${t.id}" aria-pressed="${!custom && cur.preset === t.id}">${chipsHtml(t)}${t.name}</button>`).join('')}
      <button type="button" class="swatch" data-theme="custom" aria-pressed="${custom}"><span id="customChips">${chipsHtml(cur)}</span>Custom</button>
    </div>
    <div class="color-row">
      <div><label for="c_main">Main</label><input type="color" id="c_main" value="${cur.main}"></div>
      <div><label for="c_accent">Highlight</label><input type="color" id="c_accent" value="${cur.accent}"></div>
      <div><label for="c_pinnie">Pinnies</label><input type="color" id="c_pinnie" value="${cur.pinnie}"></div>
    </div>
    <div class="field-hint">Pick a scheme or set your own — tip: match "Pinnies" to your real bibs. Everyone's screen updates when you save.</div>
  </div>`;
}
function readTheme(root) {
  const pressed = $('#themeSw [aria-pressed=true]', root);
  return { preset: pressed ? pressed.dataset.theme : 'custom', main: $('#c_main', root).value, accent: $('#c_accent', root).value, pinnie: $('#c_pinnie', root).value };
}
function wireTheme(root) {
  const sw = $('#themeSw', root);
  if (!sw) return;
  const press = id => $$('[data-theme]', sw).forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === id));
  const preview = () => { const t = readTheme(root); $('#customChips', root).innerHTML = chipsHtml(t); applyTheme(t); };
  $$('[data-theme]', sw).forEach(b => b.onclick = () => {
    const t = THEMES.find(x => x.id === b.dataset.theme);
    if (t) { $('#c_main', root).value = t.main; $('#c_accent', root).value = t.accent; $('#c_pinnie', root).value = t.pinnie; }
    press(b.dataset.theme);
    preview();
  });
  for (const id of ['c_main', 'c_accent', 'c_pinnie']) $('#' + id, root).addEventListener('input', () => { press('custom'); preview(); });
}
let view = null;          // current view's cleanup handle
let live = null;          // { state, offset } for timers

/* ---------------- network ---------------- */
async function api(method, url, body, headers = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    const e = new Error("Can't reach the server — check your connection"); e.status = 0; throw e;
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const e = new Error((data && data.error) || `Request failed (${res.status})`);
    e.status = res.status; throw e;
  }
  return data;
}
const mapi = (method, url, body) => api(method, url, body, { Authorization: 'Bearer ' + (mgrSession()?.token || '') });
const papi = (eid, method, url, body) => api(method, url, body, { 'X-Player-Token': playerSession(eid)?.token || '' });

/* ---------------- feedback ---------------- */
function toast(msg, kind = 'info', ms = 4200) {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 500);
}
let audioCtx = null;
document.addEventListener('pointerdown', () => {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    else if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}, { passive: true });
function beep() {
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    [0, 0.22].forEach(d => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.type = 'triangle';
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.35, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + d); o.stop(t + d + 0.2);
    });
  } catch {}
}
let quiet = false; // true when this person turned alerts off: banner only, no beep/buzz
function onNotice(n) {
  toast(n.title + (n.body ? ' — ' + n.body : ''), 'alert', 7000);
  if (quiet) return;
  beep();
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
}

/* ---------------- in-app confirm / prompt ----------------
   The browser's built-in confirm()/prompt() boxes are silently blocked in some places
   (in-app browsers like Instagram/Messenger/GroupMe, or after "prevent more dialogs"),
   which made buttons like Sign out do nothing. These use the app's own dialog instead. */
function uiDialog({ message, ok = 'OK', cancel = 'Cancel', danger = false, input = null }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'ask';
    d.innerHTML = `<form method="dialog">
      <div class="dlg-body"><p class="ask-msg"></p>${input !== null ? '<input class="ask-input" maxlength="200">' : ''}</div>
      <div class="dlg-foot"><button class="btn" value="cancel">${esc(cancel)}</button><button class="btn ${danger ? 'solid-danger' : 'primary'}" value="ok">${esc(ok)}</button></div>
    </form>`;
    $('.ask-msg', d).textContent = message;
    const inp = $('.ask-input', d);
    if (inp) {
      inp.value = input;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); d.close('ok'); } });
    }
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); d.remove(); } };
    d.addEventListener('close', () => {
      const yes = d.returnValue === 'ok';
      finish(inp ? (yes ? inp.value : null) : yes);
    });
    document.body.appendChild(d);
    if (typeof d.showModal !== 'function') { // very old browsers
      d.remove();
      return resolve(inp ? window.prompt(message, input) : window.confirm(message));
    }
    d.showModal();
    (inp || $('[value=ok]', d)).focus();
  });
}
const uiConfirm = (message, opts = {}) => uiDialog({ message, ...opts });
const uiPrompt = (message, value = '', opts = {}) => uiDialog({ message, input: value ?? '', ...opts });

/* ---------------- push notifications ---------------- */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/* ---------------- install as an app (Home Screen) ---------------- */
const UA = navigator.userAgent;
const isAndroid = /android/i.test(UA);
const isMobile = isIOS || isAndroid;
const iosBrowser = !isIOS ? null : /CriOS/.test(UA) ? 'chrome' : /FxiOS/.test(UA) ? 'firefox' : /EdgiOS/.test(UA) ? 'edge' : 'safari';
const isSamsung = /SamsungBrowser/i.test(UA);
let installPrompt = null; // Android / desktop Chrome & Edge offer a one-tap install
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $$('[data-install]').forEach(b => b.classList.remove('hidden'));
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $$('[data-install]').forEach(b => b.classList.add('hidden'));
  toast('Installed! Open Next Up from your Home Screen.', 'alert', 7000);
});
async function promptInstall() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  const choice = await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  $$('[data-install]').forEach(b => b.classList.add('hidden'));
  return choice && choice.outcome === 'accepted';
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-install]')) { e.preventDefault(); promptInstall(); }
});
const installBtn = (label = 'Add to Home Screen') =>
  `<button type="button" class="btn lime small ${installPrompt ? '' : 'hidden'}" data-install>📲 ${label}</button>`;

// "Get it as an app first" card shown before joining (only on phones, only in the browser).
function installNudge(code, who = 'player') {
  if (isStandalone || !isMobile) return '';
  const why = who === 'organizer'
    ? "so your phone buzzes when a game's time is up"
    : 'so your phone buzzes when your game is up';
  const ios = isIOS ? ' On iPhone, alerts only work from the Home Screen app.' : '';
  return `<div class="nudge">
    <div class="nudge-text"><b>📲 Get it as an app first</b>
      <span>Add Next Up to your Home Screen, then join from there ${why}.${ios} Takes about 20 seconds.</span></div>
    <div class="row">${installBtn()}<a class="btn small" href="#/install${code ? '/' + encodeURIComponent(code) : ''}">Show me how</a></div>
  </div>`;
}

function iosSteps() {
  if (iosBrowser && iosBrowser !== 'safari') {
    return `<ol class="steps">
      <li>Tap the <b>Share</b> button <span class="key">⬆︎</span> in the address bar (top right).</li>
      <li>Tap <b>Add to Home Screen</b>.</li>
      <li>Tap <b>Add</b>.</li>
    </ol>
    <p class="small muted">Don't see it? Open this page in <b>Safari</b> instead — copy the link and paste it into Safari.</p>`;
  }
  return `<ol class="steps">
    <li>Tap the <b>Share</b> button <span class="key">⬆︎</span>. On iOS 26 it's inside the <span class="key">•••</span> menu at the bottom right; on older iPhones it's at the bottom of the screen.</li>
    <li>Scroll down and tap <b>Add to Home Screen</b> (tap <b>View More</b> if you don't see it).</li>
    <li>Make sure <b>Open as Web App</b> is on, then tap <b>Add</b>.</li>
  </ol>
  <p class="small muted">Needs iOS 16.4 or newer for alerts.</p>`;
}
function androidSteps() {
  if (isSamsung) {
    return `<ol class="steps">
      <li>Tap the menu <span class="key">≡</span> at the bottom right.</li>
      <li>Tap <b>Add page to</b> → <b>Home screen</b>.</li>
      <li>Tap <b>Add</b>.</li>
    </ol>`;
  }
  return `<ol class="steps">
    <li>Tap the menu <span class="key">⋮</span> at the top right of Chrome.</li>
    <li>Tap <b>Add to Home screen</b> (or <b>Install app</b>).</li>
    <li>Tap <b>Install</b>.</li>
  </ol>`;
}
function desktopSteps() {
  return `<ol class="steps">
    <li>In Chrome or Edge, click the install icon <span class="key">⊕</span> at the right end of the address bar.</li>
    <li>Click <b>Install</b>.</li>
  </ol>
  <p class="small muted">On a computer you can also just keep this tab open — alerts work in the browser.</p>`;
}

function installView(code = '') {
  topnav.innerHTML = `<a href="${code ? '#/join/' + encodeURIComponent(code) : '#/'}">← Back</a>`;
  const lastId = store.get('nu.lastEvent');
  const sess = lastId && playerSession(lastId);
  if (!code && sess && sess.eventCode) code = sess.eventCode;
  const device = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
  const steps = { ios: iosSteps(), android: androidSteps(), desktop: desktopSteps() };
  const tabs = [['ios', 'iPhone'], ['android', 'Android'], ['desktop', 'Computer']];

  if (isStandalone) {
    app.innerHTML = `<section class="card">
      <h2>You're in the app ✓</h2>
      <p class="muted">Next Up is on your Home Screen. Join your event, then tap <b>Turn on</b> in the alerts bar so your phone buzzes when you're up.</p>
      <a class="btn primary block" href="${code ? '#/join/' + encodeURIComponent(code) : '#/'}">Join a game</a>
    </section>`;
    return;
  }

  app.innerHTML = `
    <section class="card hero">
      <h1>Get Next Up on your phone</h1>
      <p>Add it to your Home Screen and it works like an app — with alerts that buzz your phone when your game is up, even with the screen locked. Free, nothing to download from an app store.</p>
      <div class="row">${installBtn('Add to Home Screen now')}</div>
    </section>

    <section class="card">
      <h2>1 · Add it to your Home Screen</h2>
      <div class="seg" role="tablist" style="margin-bottom:12px">
        ${tabs.map(([id, label]) => `<button type="button" data-dev="${id}" aria-pressed="${id === device}">${label}${id === device ? ' (this one)' : ''}</button>`).join('')}
      </div>
      <div id="devSteps">${steps[device]}</div>
    </section>

    <section class="card">
      <h2>2 · Open it and join</h2>
      <ol class="steps">
        <li>Find the <b>Next Up</b> icon on your Home Screen and open it.</li>
        <li>Enter ${code ? `the event code <span class="key big">${esc(code)}</span>` : 'the event code from the organizer'} and your name.</li>
        <li>Tap <b>Turn on</b> in the alerts bar and allow notifications.</li>
      </ol>
    </section>

    ${sess ? `<section class="card">
      <h2>Already joined in this browser?</h2>
      <p class="muted">${isIOS ? 'On iPhone the Home Screen app starts fresh, so it won\'t know you yet.' : 'If the app asks you to join again,'} Use a <b>move code</b> to bring your name and game spots with you — no new name needed.</p>
      <div id="moveBox"><button class="btn primary" id="getMove">Get my move code</button></div>
    </section>` : ''}

    <p class="muted small" style="text-align:center">Prefer not to? <a href="${code ? '#/join/' + encodeURIComponent(code) : (sess ? '#/e/' + lastId : '#/')}">Continue in the browser</a> — you just won't get lock-screen alerts${isIOS ? ' on iPhone' : ''}.</p>`;

  $$('[data-dev]').forEach(b => b.onclick = () => {
    $$('[data-dev]').forEach(x => x.setAttribute('aria-pressed', x === b));
    $('#devSteps').innerHTML = steps[b.dataset.dev];
  });
  const gm = $('#getMove');
  if (gm) gm.onclick = async () => {
    gm.disabled = true;
    try {
      const r = await papi(lastId, 'POST', `/api/events/${lastId}/move`);
      $('#moveBox').innerHTML = `<div class="movecode">${esc(r.moveCode)}</div>
        <p class="small muted">Open Next Up from your Home Screen and type this into the <b>Event code</b> box. It works once and expires in ${r.expiresInMin} minutes.</p>`;
    } catch (e) { toast(e.message, 'warn'); gm.disabled = false; }
  };
}

let swRegPromise = null;
function getReg() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!swRegPromise) {
    swRegPromise = navigator.serviceWorker.register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .catch(e => { console.warn('SW failed', e); return null; });
  }
  return swRegPromise;
}
getReg();

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function sameKey(buf, bytes) {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
}
// Must be called from a tap when permission hasn't been granted yet.
async function enablePush(postUrl, headers) {
  if (!pushSupported) throw new Error('Push alerts are not supported in this browser');
  let perm = Notification.permission;
  if (perm !== 'granted') perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed');
  const reg = await getReg();
  if (!reg) throw new Error('Could not start the notification service');
  const key = b64ToBytes(cfg.vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('POST', postUrl, { subscription: sub.toJSON() }, headers);
}

// Always-visible alerts banner with Turn on / Turn off.
function alertBar(enabled, onAct, offAct, what = 'your game is up') {
  if (enabled) {
    return `<div class="alertbar ok"><span>🔔 <b>Alerts are on</b> — we'll notify this phone when ${what}.</span><button class="btn small" data-act="${offAct}">Turn off</button></div>`;
  }
  // iPhone/iPad in the browser: alerts only work from the Home Screen app.
  if (isIOS && !isStandalone) {
    return `<div class="alertbar"><span><b>Get buzzed when you're up:</b> on iPhone, alerts only work from the Home Screen app. Add it in 20 seconds — your name and spot come with you.</span><a class="btn lime small" href="#/install">Show me how</a></div>`;
  }
  if (!pushSupported) {
    return `<div class="alertbar bad"><span>This browser can't do push alerts. Keep this page open — it will beep and vibrate when you're up.</span></div>`;
  }
  if (Notification.permission === 'denied') {
    return `<div class="alertbar bad"><span>Notifications are blocked for this site. Allow them in your browser settings to get game alerts.</span></div>`;
  }
  return `<div class="alertbar"><span>🔕 <b>Alerts are off.</b> Turn them on to get a buzz when ${what} — even with the screen locked.</span><button class="btn lime small" data-act="${onAct}">Turn on</button></div>`;
}

/* ---------------- timers ---------------- */
function remaining(g) {
  const t = g.timer;
  if (t.running && t.endsAt) return Math.max(0, t.endsAt - (Date.now() + (live?.offset || 0)));
  return Math.max(0, t.remainingMs);
}
function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
function timerHtml(g) {
  return `<span class="timer" data-timer="${g.id}">${fmt(remaining(g))}</span>`;
}
function tick() {
  if (!live) return;
  for (const el of $$('[data-timer]')) {
    const g = live.state.games.find(x => x.id === el.dataset.timer);
    if (!g) continue;
    const rem = remaining(g);
    el.textContent = g.status === 'playing' && rem <= 0 ? "TIME'S UP" : fmt(rem);
    el.classList.toggle('paused', g.status === 'playing' && !g.timer.running && rem > 0);
    el.classList.toggle('low', rem > 0 && rem <= live.state.settings.warnMinutes * 60000 && g.status === 'playing');
    el.classList.toggle('up', g.status === 'playing' && rem <= 0);
  }
}
setInterval(tick, 250);

// Re-render, but never while someone is typing in a field on the page.
function makeRenderer(fn) {
  let pending = false;
  const run = () => {
    const a = document.activeElement;
    if (a && app.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) { pending = true; return; }
    pending = false;
    fn();
    tick();
  };
  const onBlur = () => { if (pending) setTimeout(run, 50); };
  app.addEventListener('focusout', onBlur);
  run.dispose = () => app.removeEventListener('focusout', onBlur);
  return run;
}

// Live connection: a WebSocket that reconnects on its own (phones sleep,
// switch networks, etc.) and keeps itself alive with small pings.
function openStream(path, { onState, onNotice: notice, onRemoved, check }) {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path;
  let ws = null, closed = false, failures = 0, retryTimer = null, pingTimer = null;

  const connect = () => {
    if (closed) return;
    clearTimeout(retryTimer);
    try { ws = new WebSocket(url); } catch { return retry(); }
    ws.onopen = () => {
      failures = 0;
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { try { ws.readyState === 1 && ws.send('ping'); } catch {} }, 25000);
    };
    ws.onmessage = e => {
      if (e.data === 'pong') return;
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'state') onState(msg.data);
      else if (msg.type === 'notice') notice(msg.data);
      else if (msg.type === 'removed') { closed = true; onRemoved(msg.data || {}); }
    };
    ws.onclose = e => {
      clearInterval(pingTimer);
      if (closed) return;
      if (e.code === 4001) { closed = true; return onRemoved({}); }
      retry();
    };
  };
  const retry = async () => {
    if (closed) return;
    failures++;
    // After a few failed attempts, make sure we're still allowed in.
    if (failures % 3 === 0 && check && !(await check())) { closed = true; return onRemoved({ reason: 'released' }); }
    retryTimer = setTimeout(connect, Math.min(15000, 500 * 2 ** Math.min(failures, 5)));
  };
  const wake = () => {
    if (document.visibilityState === 'visible' && !closed && (!ws || ws.readyState > 1)) { failures = 0; connect(); }
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  connect();
  return {
    close() {
      closed = true;
      clearTimeout(retryTimer); clearInterval(pingTimer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      try { ws && ws.close(1000); } catch {}
    }
  };
}

/* ---------------- shared board rendering ---------------- */
const bibSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 2h2a2 2 0 0 0 4 0h2l1 4-2 1v15H9V7L7 6z"/></svg>';
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const inGame = (g, pid) => g.teams.a.includes(pid) || g.teams.b.includes(pid);

function queueLabel(s, idx) {
  if (idx < s.settings.fields) return '<span class="tag next">Up next</span>';
  return `<span class="tag">${ordinal(idx + 1)} in line</span>`;
}

function teamCol(s, g, team, opts) {
  const cap = s.settings.playersPerTeam;
  const ids = g.teams[team];
  const pinnies = g.pinnies === team;
  const rows = ids.map(pid => {
    const p = s.players[pid] || { name: '—' };
    const me = opts.meId === pid;
    const ctrls = opts.manager ? `
      <button class="iconbtn" title="Move to other team" aria-label="Move ${esc(p.name)} to other team" data-act="switch" data-gid="${g.id}" data-pid="${pid}">⇄</button>
      <button class="iconbtn" title="Remove from game" aria-label="Remove ${esc(p.name)}" data-act="rm-player" data-gid="${g.id}" data-pid="${pid}">✕</button>` : '';
    const guest = opts.manager && p.guest ? '<span class="guest">walk-up</span>' : '';
    return `<li class="${me ? 'me' : ''}"><span class="nm">${esc(p.name)}${me ? ' (you)' : ''}</span>${guest}${ctrls}</li>`;
  }).join('');
  const open = Math.max(0, cap - ids.length);
  const slots = Array.from({ length: Math.min(open, 12) }, () => '<li class="slot">open spot</li>').join('');
  const more = open > 12 ? `<li class="slot">+${open - 12} more</li>` : '';
  return `<div class="team ${pinnies ? 'pinnies' : ''}">
    <div class="team-head">
      <span class="team-name">Team ${team === 'a' ? 1 : 2}</span>
      ${pinnies ? `<span class="bib">${bibSvg}Pinnies</span>` : '<span class="bib none">No pinnies</span>'}
    </div>
    <ul class="players">${rows}${slots}${more}</ul>
  </div>`;
}

function boardHtml(s, g, opts) {
  const count = g.teams.a.length + g.teams.b.length;
  const full = count >= s.settings.playersPerTeam * 2;
  const mine = opts.meId && inGame(g, opts.meId);
  let label;
  if (g.status === 'playing') label = '<span class="tag live">On the field</span>';
  else label = queueLabel(s, opts.idx) + (full ? '<span class="tag full">Full</span>' : '');
  const right = g.status === 'playing' ? timerHtml(g) : `<span class="muted small">${count}/${s.settings.playersPerTeam * 2}</span>`;
  return `<article class="board ${g.status} ${mine ? 'mine' : ''}" id="g-${g.id}">
    <header class="board-head"><div><span class="board-num">Game ${g.number}</span>${label}</div>${right}</header>
    <div class="teams">${teamCol(s, g, 'a', opts)}${teamCol(s, g, 'b', opts)}</div>
    ${opts.footer ? `<footer class="board-foot">${opts.footer}</footer>` : ''}
  </article>`;
}

function limitText(s) {
  const st = s.settings;
  const boards = s.closing ? 'Last call — no new boards' : st.maxBoards === null ? 'Unlimited line' : `${st.maxBoards} board${st.maxBoards > 1 ? 's' : ''} in the line`;
  const signups = st.maxSignups === null ? 'unlimited sign-ups' : `${st.maxSignups} game${st.maxSignups > 1 ? 's' : ''} per person at a time`;
  return `<b>${st.playersPerTeam}v${st.playersPerTeam}</b> · ${st.gameMinutes} min games · ${boards} · ${signups}`;
}

/* ================================================================== */
/* HOME                                                               */
/* ================================================================== */
function homeView(prefill = '') {
  topnav.innerHTML = `<a href="#/manager">Organizer</a>`;
  const lastId = store.get('nu.lastEvent');
  const last = lastId && playerSession(lastId);
  app.innerHTML = `
    ${last ? `<div class="card row"><div class="grow"><b>Welcome back, ${esc(last.name)}</b><div class="muted small">${esc(last.eventName || 'Your event')}</div></div><a class="btn primary" href="#/e/${esc(lastId)}">Open board</a></div>` : ''}
    <div id="nudgeSlot">${installNudge(prefill)}</div>
    <section class="card hero">
      <h1>Who's up next?</h1>
      <p>Put your name down for a game and get a buzz on your phone when it's your turn. No account needed.</p>
      <form id="joinForm" class="stack" autocomplete="off" novalidate>
        <div id="stepCode">
          <label for="code">Event code${isStandalone ? ' <span style="font-weight:400">— or your move code</span>' : ''}</label>
          <input id="code" class="code-input" inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="32" placeholder="0000" value="${esc(prefill)}">
        </div>
        <div id="stepName" class="hidden">
          <div class="small" style="color:#cfe3d8;margin-bottom:8px">Joining <b id="evName" style="color:#fff"></b> · <a href="#/" id="changeCode" style="color:#c6f24e">change code</a></div>
          <label for="name">Your name</label>
          <input id="name" maxlength="24" autocomplete="nickname" placeholder="e.g. Sam R.">
        </div>
        <button class="btn lime block" id="joinBtn" type="submit">Continue</button>
        <p class="err" id="joinErr" style="color:#ffb4ad"></p>
      </form>
    </section>
    <p class="muted small" style="text-align:center">Running the game? <a href="#/manager">Organizer sign in</a></p>`;

  const form = $('#joinForm');
  let found = null;
  form.onsubmit = async e => {
    e.preventDefault();
    const err = $('#joinErr'); err.textContent = '';
    const btn = $('#joinBtn'); btn.disabled = true;
    try {
      const code = $('#code').value.trim();
      if (!found) {
        if (!code) throw new Error('Enter the event code');
        found = await api('POST', '/api/join', { code, checkOnly: true });
        // This phone already joined this event: go straight to the board.
        if (playerSession(found.eventId)) { location.hash = '#/e/' + found.eventId; return; }
        // Move code from the browser: sign in as the same person, no name needed.
        if (found.moving) {
          const r = await api('POST', '/api/join', { code });
          store.set('nu.player.' + r.eventId, { token: r.token, playerId: r.playerId, name: r.name, eventName: found.name });
          store.set('nu.lastEvent', r.eventId);
          toast(`Welcome back, ${r.name} — your name and spot came with you`, 'alert', 6000);
          location.hash = '#/e/' + r.eventId;
          return;
        }
        $('#nudgeSlot').innerHTML = installNudge(code);
        $('#evName').textContent = found.name;
        $('#stepCode').classList.add('hidden');
        $('#stepName').classList.remove('hidden');
        btn.textContent = "I'm in";
        $('#name').focus();
      } else {
        if (!$('#name').value.trim()) throw new Error('Enter your name');
        const r = await api('POST', '/api/join', { code, name: $('#name').value });
        store.set('nu.player.' + r.eventId, { token: r.token, playerId: r.playerId, name: r.name, eventName: found.name, eventCode: code });
        store.set('nu.lastEvent', r.eventId);
        location.hash = '#/e/' + r.eventId;
      }
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false;
  };
  $('#changeCode').onclick = e => {
    e.preventDefault();
    found = null;
    $('#stepName').classList.add('hidden');
    $('#stepCode').classList.remove('hidden');
    $('#joinBtn').textContent = 'Continue';
    $('#joinErr').textContent = '';
    $('#code').focus();
  };
  if (prefill) setTimeout(() => form.requestSubmit(), 0);
  else $('#code').focus();
}

/* ================================================================== */
/* PLAYER BOARD                                                       */
/* ================================================================== */
async function playerView(eventId) {
  const sess = playerSession(eventId);
  if (!sess) { location.hash = '#/'; return; }
  app.innerHTML = '<div class="spinner"></div>';
  let me, state;
  try {
    const r = await papi(eventId, 'GET', `/api/events/${eventId}/me`);
    me = r.player; state = r.state;
  } catch (e) {
    if (e.status === 401 || e.status === 404) {
      store.del('nu.player.' + eventId);
      if (store.get('nu.lastEvent') === eventId) store.del('nu.lastEvent');
      toast(e.message, 'warn');
      location.hash = '#/';
    } else app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  store.set('nu.lastEvent', eventId);
  store.set('nu.player.' + eventId, { ...sess, name: me.name, eventName: state.name, eventCode: state.code });
  live = { state, offset: state.serverNow - Date.now() };
  topnav.innerHTML = `<span class="who">${esc(me.name)}</span><button data-act="signout">Sign out</button>`;

  const render = makeRenderer(() => renderPlayer(live.state, me));
  render();

  const es = openStream(`/api/events/${eventId}/ws?pt=${encodeURIComponent(sess.token)}`, {
    onState: s => { live.state = s; live.offset = s.serverNow - Date.now(); render(); },
    onNotice,
    check: () => papi(eventId, 'GET', `/api/events/${eventId}/me`).then(() => true, e => e.status !== 401 && e.status !== 404),
    onRemoved: d => {
      store.del('nu.player.' + eventId); store.del('nu.lastEvent');
      toast(d.reason === 'released' ? 'The organizer signed you out. Sign in again with your name.' : 'You were removed from this event.', 'warn', 7000);
      location.hash = '#/';
    }
  });
  const refresher = setInterval(render, 15000); // keeps wait estimates fresh

  quiet = !!me.alertsOff;
  // Quietly re-register this phone for push if permission is already granted —
  // unless the person turned alerts off on purpose.
  if (pushSupported && Notification.permission === 'granted' && !me.alerts && !me.alertsOff) {
    enablePush(`/api/events/${eventId}/push`, { 'X-Player-Token': sess.token })
      .then(() => { me.alerts = true; render(); }).catch(() => {});
  }

  const act = async (el) => {
    const a = el.dataset.act, gid = el.dataset.gid;
    try {
      if (a === 'join') {
        el.disabled = true;
        await papi(eventId, 'POST', `/api/events/${eventId}/games/${gid}/signup`, { team: el.dataset.team });
        toast("You're on the list!");
      } else if (a === 'leave') {
        if (!(await uiConfirm('Take your name off this game?', { ok: 'Take me off', danger: true }))) return;
        await papi(eventId, 'POST', `/api/events/${eventId}/games/${gid}/leave`);
      } else if (a === 'alerts') {
        el.disabled = true;
        await enablePush(`/api/events/${eventId}/push`, { 'X-Player-Token': sess.token });
        me.alerts = true; me.alertsOff = false; quiet = false; render();
        toast('Alerts on — you should get a test notification now');
      } else if (a === 'alerts-off') {
        el.disabled = true;
        await papi(eventId, 'POST', `/api/events/${eventId}/push/off`);
        me.alerts = false; me.alertsOff = true; quiet = true; render();
        toast("Alerts off — you won't get notifications. You can turn them back on any time.");
      } else if (a === 'signout') {
        const ended = live && live.state.status !== 'active';
        if (!ended && !(await uiConfirm('Sign out? Your name will be taken off any games that haven\'t started.', { ok: 'Sign out', danger: true }))) return;
        await papi(eventId, 'POST', `/api/events/${eventId}/signout`).catch(() => {});
        store.del('nu.player.' + eventId); store.del('nu.lastEvent');
        location.hash = '#/';
      } else if (a === 'share') {
        shareJoin(live.state.code);
      }
    } catch (e) { toast(e.message, 'warn'); el.disabled = false; render(); }
  };
  const onClick = e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'A') e.preventDefault(); // let the action decide where to go
    act(el);
  };
  document.addEventListener('click', onClick);

  view = { cleanup() { es.close(); clearInterval(refresher); render.dispose(); document.removeEventListener('click', onClick); live = null; } };
}

function renderPlayer(s, me) {
  const st = s.settings;
  applyTheme(st.theme);
  if (s.status !== 'active') {
    app.innerHTML = `<div class="card"><h2>${esc(s.name)}</h2><p class="muted">This event has ended. Thanks for playing!</p><a class="btn" href="#/" data-act="signout">Back home</a></div>`;
    return;
  }
  const playing = s.games.filter(g => g.status === 'playing');
  const open = s.games.filter(g => g.status === 'open');
  const mySignups = s.games.filter(g => inGame(g, me.id));
  const limitHit = st.maxSignups !== null && mySignups.length >= st.maxSignups;

  // Status card
  const myPlaying = playing.find(g => inGame(g, me.id));
  const myOpenIdx = open.findIndex(g => inGame(g, me.id));
  const shortest = playing.length ? Math.min(...playing.map(remaining)) : 0;
  let status;
  if (myPlaying) {
    const team = myPlaying.teams.a.includes(me.id) ? 'a' : 'b';
    status = `<div class="card status playing"><div><div class="big">You're playing</div></div>${timerHtml(myPlaying)}
      <div class="sub">Game ${myPlaying.number} · Team ${team === 'a' ? 1 : 2} · ${myPlaying.pinnies === team ? '<b>wear a pinnie</b>' : 'no pinnie'}</div></div>`;
  } else if (myOpenIdx >= 0) {
    const g = open[myOpenIdx];
    const team = g.teams.a.includes(me.id) ? 'a' : 'b';
    const wave = Math.floor(myOpenIdx / st.fields);
    const etaMin = Math.round((shortest + wave * st.gameMinutes * 60000) / 60000);
    const next = myOpenIdx < st.fields;
    const eta = playing.length ? (next ? `Current game: ${timerHtml(playing[0])} left` : `About ${etaMin} min away`) : (next ? 'Waiting for the organizer to start' : `About ${etaMin + st.gameMinutes} min away`);
    status = `<div class="card status ${next ? 'next' : 'waiting'}">
      <div class="big">${next ? "You're up next!" : `You're ${ordinal(myOpenIdx + 1)} in line`}</div>
      <div class="muted small" style="text-align:right">Game ${g.number}</div>
      <div class="sub">${eta} · Team ${team === 'a' ? 1 : 2}${g.pinnies === team ? ' (pinnies)' : ''}</div></div>`;
  } else {
    const spotsLeft = open.some(g => g.teams.a.length + g.teams.b.length < st.playersPerTeam * 2);
    const sub = s.closing
      ? (spotsLeft && !limitHit ? 'Last call — grab an open spot below for one more game.' : 'No new games tonight. Thanks for playing!')
      : (limitHit ? 'You can sign up again once your game is played.' : 'Pick a game below and put your name down.');
    status = `<div class="card status"><div class="big">${s.closing && !playing.length && !open.length ? "That's a wrap" : 'Not on a game yet'}</div><div></div>
      <div class="sub">${sub}</div></div>`;
  }

  const playingHtml = playing.length
    ? `<div class="boards">${playing.map(g => boardHtml(s, g, { meId: me.id })).join('')}</div>`
    : `<div class="empty">Nothing on the field right now.</div>`;

  const queueHtml = open.length ? `<div class="boards">${open.map((g, idx) => {
    const isMine = inGame(g, me.id);
    const cap = st.playersPerTeam;
    const full = g.teams.a.length + g.teams.b.length >= cap * 2;
    let footer = '';
    if (isMine) footer = st.allowLeave ? `<span class="note grow">You're on this game.</span><button class="btn small danger" data-act="leave" data-gid="${g.id}">Take my name off</button>` : `<span class="note">You're on this game.</span>`;
    else if (full) footer = `<span class="note">This game is full.</span>`;
    else if (limitHit) footer = `<span class="note">${st.maxSignups === 1 ? "You're already on a game." : `You're on ${st.maxSignups} games — that's the limit.`}</span>`;
    else if (st.allowTeamPick) footer = ['a', 'b'].map(t => `<button class="btn primary small grow" data-act="join" data-gid="${g.id}" data-team="${t}" ${g.teams[t].length >= cap ? 'disabled' : ''}>Join Team ${t === 'a' ? 1 : 2}${g.pinnies === t ? ' (pinnies)' : ''}</button>`).join('');
    else footer = `<button class="btn primary block" data-act="join" data-gid="${g.id}">Put my name down</button>`;
    return boardHtml(s, g, { meId: me.id, idx, footer });
  }).join('')}</div>`
    : `<div class="empty">${s.closing ? 'No more games in the line — last call is on.' : 'No games waiting right now.'}</div>`;

  const atLimit = !s.closing && st.maxBoards !== null && !open.some(g => g.teams.a.length + g.teams.b.length < st.playersPerTeam * 2);

  app.innerHTML = `
    ${alertBar(me.alerts, 'alerts', 'alerts-off')}
    ${s.closing ? `<div class="lastcall"><b>🏁 Last call</b><span>No new games after the ones on the board. ${open.length ? `${open.length} game${open.length > 1 ? 's' : ''} left in the line.` : 'These are the final games.'}</span></div>` : ''}
    ${status}
    <div class="meta-row"><span>${esc(s.name)}</span><span>${limitText(s)}</span>${st.maxSignups !== null ? `<span>You: <b>${mySignups.length}/${st.maxSignups}</b></span>` : ''}</div>
    <h2 class="section-title">On the field</h2>
    ${playingHtml}
    <h2 class="section-title">The line <button class="btn small ghost" data-act="share">Invite · code ${esc(s.code)}</button></h2>
    ${queueHtml}
    ${atLimit && open.length ? `<p class="muted small" style="margin-top:10px">Every board is full. A new board opens as soon as the next game starts.</p>` : ''}
  `;
}

function joinLink(code) { return `${location.origin}/?code=${encodeURIComponent(code)}`; }
async function shareJoin(code) {
  const url = joinLink(code);
  if (navigator.share) { try { await navigator.share({ title: 'Join the game on Next Up', text: `Code: ${code}`, url }); return; } catch {} }
  try { await navigator.clipboard.writeText(url); toast('Join link copied'); } catch { await uiPrompt('Copy this link:', url, { ok: 'Done', cancel: 'Close' }); }
}

/* ================================================================== */
/* ORGANIZER                                                          */
/* ================================================================== */
function managerAuthView() {
  topnav.innerHTML = `<a href="#/">Join a game</a>`;
  let mode = 'login';
  const draw = () => {
    app.innerHTML = `
      <div style="max-width:440px;margin:0 auto">${installNudge('', 'organizer')}</div>
      <section class="card" style="max-width:440px;margin:20px auto">
        <h2>Organizer</h2>
        <p class="muted small">Sign in to create events, run the line and manage games.</p>
        <div class="tabs seg" role="tablist" style="display:flex">
          <button type="button" class="grow" aria-pressed="${mode === 'login'}" data-mode="login">Sign in</button>
          <button type="button" class="grow" aria-pressed="${mode === 'register'}" data-mode="register">Create account</button>
        </div>
        <form id="authForm" class="stack">
          <div><label for="u">Username</label><input id="u" autocomplete="username" autocapitalize="none" required></div>
          <div><label for="p">Password</label><input id="p" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="6"></div>
          ${mode === 'register' && cfg.signupCodeRequired ? `<div><label for="sc">Organizer sign-up code</label><input id="sc" required></div>` : ''}
          <button class="btn primary block" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
          <p class="err" id="authErr"></p>
        </form>
      </section>
      <p class="muted small" style="text-align:center">Here to play? <a href="#/">Join a game as a player</a></p>`;
    $$('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; draw(); });
    $('#authForm').onsubmit = async e => {
      e.preventDefault();
      try {
        const body = { username: $('#u').value, password: $('#p').value };
        if ($('#sc')) body.signupCode = $('#sc').value;
        const r = await api('POST', `/api/manager/${mode}`, body);
        store.set('nu.manager', r);
        route();
      } catch (ex) { $('#authErr').textContent = ex.message; }
    };
    $('#u').focus();
  };
  draw();
}

function settingsFields(st, withCode) {
  const num = (id, label, val, min, max, hint) => `<div><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${val}" required>${hint ? `<div class="field-hint">${hint}</div>` : ''}</div>`;
  const unl = (id, label, val, max, hint) => `<div><label for="${id}">${label}</label>
    <div class="inline-unl"><input id="${id}" type="number" inputmode="numeric" min="1" max="${max}" value="${val ?? ''}" ${val === null ? 'disabled' : ''} placeholder="∞">
    <label class="check"><input type="checkbox" id="${id}Unl" ${val === null ? 'checked' : ''}> Unlimited</label></div>
    ${hint ? `<div class="field-hint">${hint}</div>` : ''}</div>`;
  return `
    ${withCode ? `
    <div class="full">
      <label>How players join</label>
      <div class="seg" id="codeSeg"><button type="button" data-ct="pin" aria-pressed="true">4-digit code</button><button type="button" data-ct="custom" aria-pressed="false">Custom password</button></div>
      <input id="customCode" class="hidden" style="margin-top:8px" maxlength="32" placeholder="e.g. tuesdayfooty">
      <div class="field-hint" id="codeHint">A random 4-digit code is created for you.</div>
    </div>` : ''}
    ${num('s_ppt', 'Players per team', st.playersPerTeam, 1, 30, 'e.g. 5 = 5v5, 10 names per game')}
    ${num('s_min', 'Game length (minutes)', st.gameMinutes, 1, 180)}
    ${unl('s_boards', 'Boards in the line', st.maxBoards, 50, "Like whiteboards: waiting games shown at once. The game on the field doesn't count.")}
    ${unl('s_signups', 'Sign-ups per person', st.maxSignups, 50, 'How many games one person can be on at a time')}
    ${num('s_fields', 'Games at the same time', st.fields, 1, 10, 'Number of fields in use')}
    ${num('s_warn', 'Heads-up alert (min before end)', st.warnMinutes, 0, 30, '0 = off. Pings the next game to get ready')}
    <div><label for="s_pin">New games: pinnies go to</label>
      <select id="s_pin"><option value="a" ${st.defaultPinnies === 'a' ? 'selected' : ''}>Team 1</option><option value="b" ${st.defaultPinnies === 'b' ? 'selected' : ''}>Team 2</option></select></div>
    <div class="full stack">
      <label class="check"><input type="checkbox" id="s_pick" ${st.allowTeamPick ? 'checked' : ''}> Players choose their own team</label>
      <label class="check"><input type="checkbox" id="s_leave" ${st.allowLeave ? 'checked' : ''}> Players can take their own name off a game</label>
    </div>
    ${themeFields(st.theme)}`;
}
function wireSettings(root) {
  wireTheme(root);
  for (const id of ['s_boards', 's_signups']) {
    const box = $('#' + id + 'Unl', root), inp = $('#' + id, root);
    box.onchange = () => { inp.disabled = box.checked; if (!box.checked && !inp.value) inp.value = id === 's_boards' ? 3 : 1; };
  }
  const seg = $('#codeSeg', root);
  if (seg) {
    $$('[data-ct]', seg).forEach(b => b.onclick = () => {
      $$('[data-ct]', seg).forEach(x => x.setAttribute('aria-pressed', x === b));
      const custom = b.dataset.ct === 'custom';
      $('#customCode', root).classList.toggle('hidden', !custom);
      $('#customCode', root).required = custom;
      $('#codeHint', root).textContent = custom ? 'Players type this password to join (4–32 characters).' : 'A random 4-digit code is created for you.';
      if (custom) $('#customCode', root).focus();
    });
  }
}
function readSettings(root) {
  const n = id => Number($('#' + id, root).value);
  return {
    playersPerTeam: n('s_ppt'),
    gameMinutes: n('s_min'),
    maxBoards: $('#s_boardsUnl', root).checked ? null : n('s_boards'),
    maxSignups: $('#s_signupsUnl', root).checked ? null : n('s_signups'),
    fields: n('s_fields'),
    warnMinutes: n('s_warn'),
    defaultPinnies: $('#s_pin', root).value,
    allowTeamPick: $('#s_pick', root).checked,
    allowLeave: $('#s_leave', root).checked,
    theme: readTheme(root)
  };
}
const DEFAULTS = { playersPerTeam: 5, gameMinutes: 10, maxBoards: 3, maxSignups: 1, fields: 1, warnMinutes: 2, defaultPinnies: 'a', allowTeamPick: false, allowLeave: true };

async function managerHomeView({ startNew = false } = {}) {
  app.innerHTML = '<div class="spinner"></div>';
  let me;
  try { me = await mapi('GET', '/api/manager/me'); }
  catch (e) { if (e.status === 401) { store.del('nu.manager'); return managerAuthView(); } app.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  topnav.innerHTML = `<span class="who">${esc(me.username)}</span><button id="logout">Sign out</button>`;
  $('#logout').onclick = async () => { await mapi('POST', '/api/manager/logout').catch(() => {}); store.del('nu.manager'); route(); };

  const saved = store.get('nu.lastSettings') || DEFAULTS;
  // Live events first, then most recent
  const events = me.events.slice().sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || b.createdAt - a.createdAt);
  app.innerHTML = `
    <h2 class="section-title" style="margin-top:4px">Your events
      ${events.length ? '<a class="btn small" href="#newEvCard" id="jumpNew">+ New event</a>' : ''}</h2>
    <div class="ev-list">${events.length ? events.map(e => `
      <div class="card ev-item">
        <div class="grow">
          <h3>${esc(e.name)}</h3>
          <div class="muted small">${e.status === 'active' ? `Code <b>${esc(e.code)}</b> · ` : ''}${e.players} players · ${e.gamesPlayed} games played · ${new Date(e.createdAt).toLocaleDateString()}</div>
        </div>
        <span class="pill ${e.status === 'active' ? '' : 'ended'}">${e.status === 'active' ? 'Live' : 'Ended'}</span>
        <a class="btn small" href="#/manager/e/${e.id}">Open</a>
      </div>`).join('') : '<div class="empty">No events yet. Create your first one below.</div>'}</div>

    <h2 class="section-title">Create an event</h2>
    <section class="card" id="newEvCard">
      <form id="newEv" class="stack">
        <div><label for="evname">Event name</label><input id="evname" maxlength="60" placeholder="Tuesday night pickup" required></div>
        <div class="settings-grid">${settingsFields(saved, true)}</div>
        <button class="btn primary block" type="submit">Create event</button>
        <p class="err" id="newErr"></p>
      </form>
    </section>`;
  const goNew = () => { $('#newEvCard').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('#evname').focus({ preventScroll: true }), 400); };
  const jump = $('#jumpNew');
  if (jump) jump.onclick = e => { e.preventDefault(); goNew(); };
  if (startNew) { history.replaceState(null, '', '#/manager'); setTimeout(goNew, 50); }

  const form = $('#newEv');
  wireSettings(form);
  form.onsubmit = async e => {
    e.preventDefault();
    const settings = readSettings(form);
    const custom = $('[data-ct="custom"]', form).getAttribute('aria-pressed') === 'true';
    try {
      const r = await mapi('POST', '/api/manager/events', {
        name: $('#evname').value, codeType: custom ? 'custom' : 'pin', code: $('#customCode').value, settings
      });
      store.set('nu.lastSettings', settings);
      location.hash = '#/manager/e/' + r.id;
    } catch (ex) { $('#newErr').textContent = ex.message; }
  };
}

async function managerEventView(eventId) {
  const sess = mgrSession();
  app.innerHTML = '<div class="spinner"></div>';
  let state;
  try { state = await mapi('GET', `/api/manager/events/${eventId}`); }
  catch (e) {
    if (e.status === 401) { store.del('nu.manager'); return managerAuthView(); }
    app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><a class="btn" href="#/manager">Back</a></div>`; return;
  }
  topnav.innerHTML = `<a href="#/manager">← All events</a>`;
  live = { state, offset: state.serverNow - Date.now() };
  const render = makeRenderer(() => renderManager(live.state));
  render();

  const es = openStream(`/api/events/${eventId}/ws?mt=${encodeURIComponent(sess.token)}`, {
    onState: s => { live.state = s; live.offset = s.serverNow - Date.now(); render(); },
    onNotice,
    check: () => mapi('GET', `/api/manager/events/${eventId}`).then(() => true, e => e.status !== 401 && e.status !== 404),
    onRemoved: () => { toast('Event deleted'); location.hash = '#/manager'; }
  });

  const base = `/api/manager/events/${eventId}`;
  const gameAct = (gid, action, extra = {}) => mapi('POST', `${base}/games/${gid}/action`, { action, ...extra });
  const findG = gid => live.state.games.find(g => g.id === gid);

  const act = async el => {
    const a = el.dataset.act, gid = el.dataset.gid, pid = el.dataset.pid;
    const g = gid && findG(gid);
    const s = live.state;
    try {
      switch (a) {
        case 'start': {
          const busy = s.games.filter(x => x.status === 'playing').length;
          if (busy >= s.settings.fields && !(await uiConfirm(`${busy === 1 ? 'A game is' : `${busy} games are`} still on the field. Start Game ${g.number} anyway?`))) return;
          await gameAct(gid, 'start'); break;
        }
        case 'pause': case 'resume': case 'reset': case 'pinnies': case 'up': case 'down':
          await gameAct(gid, a); break;
        case 'addtime': await gameAct(gid, 'addtime', { seconds: Number(el.dataset.sec) }); break;
        case 'end':
          if (!(await uiConfirm(`End Game ${g.number} and clear the board?`, { ok: 'End game', danger: true }))) return;
          await gameAct(gid, 'end'); toast(`Game ${g.number} cleared`); break;
        case 'delete': {
          const n = g.teams.a.length + g.teams.b.length;
          if (!(await uiConfirm(`Delete Game ${g.number}?${n ? ` The ${n} player${n > 1 ? 's' : ''} on it will be taken off.` : ''}`, { ok: 'Delete', danger: true }))) return;
          await gameAct(gid, 'delete'); toast(`Game ${g.number} deleted`); break;
        }
        case 'clear': {
          const n = g.teams.a.length + g.teams.b.length;
          if (!(await uiConfirm(`Take all ${n} player${n > 1 ? 's' : ''} off Game ${g.number}? The board stays in the line, empty.`, { ok: 'Clear board', danger: true }))) return;
          await gameAct(gid, 'clear'); toast(`Game ${g.number} cleared`); break;
        }
        case 'switch': await mapi('POST', `${base}/games/${gid}/players/${pid}/switch`); break;
        case 'rm-player':
          if (!(await uiConfirm(`Take ${s.players[pid]?.name} off Game ${g.number}?`))) return;
          await mapi('POST', `${base}/games/${gid}/players/${pid}/remove`); break;
        case 'add-game': await mapi('POST', `${base}/games`); break;
        case 'release':
          if (!(await uiConfirm(`Sign out ${s.players[pid]?.name}'s phone so the name can be used again? Their game spots are kept.`))) return;
          await mapi('POST', `${base}/players/${pid}/release`); break;
        case 'kick':
          if (!(await uiConfirm(`Remove ${s.players[pid]?.name} from the event and all games?`, { ok: 'Remove', danger: true }))) return;
          await mapi('POST', `${base}/players/${pid}/remove`); break;
        case 'settings': openSettings(); break;
        case 'lastcall':
          if (!(await uiConfirm('Turn on last call?\n\nNo new boards will be added. Games already on the board can still be played and people can still grab open spots on them. Everyone gets a "last call" notification.'))) return;
          await mapi('POST', `${base}/lastcall`, { on: true });
          toast('Last call is on'); break;
        case 'lastcall-off':
          await mapi('POST', `${base}/lastcall`, { on: false });
          toast('The line is open again'); break;
        case 'announce': {
          const msg = await uiPrompt('Message to everyone (sent as a notification):', '', { ok: 'Send' });
          if (msg && msg.trim()) { await mapi('POST', `${base}/announce`, { message: msg }); toast('Sent'); }
          break;
        }
        case 'mgr-alerts':
          el.disabled = true;
          await enablePush(`${base}/push`, { Authorization: 'Bearer ' + sess.token });
          toast("You'll get an alert when a game's time is up"); break;
        case 'mgr-alerts-off':
          el.disabled = true;
          await mapi('POST', `${base}/push/off`);
          toast('Organizer alerts off'); break;
        case 'share': shareJoin(s.code); break;
        case 'newpin':
          if (!(await uiConfirm('Make a new 4-digit code? The old one stops working (people already in stay in).'))) return;
          await mapi('POST', `${base}/code`, { type: 'pin' }); break;
        case 'custompw': {
          const c = await uiPrompt('New join password (4–32 characters):', s.codeType === 'custom' ? s.code : '', { ok: 'Save' });
          if (c) await mapi('POST', `${base}/code`, { type: 'custom', code: c });
          break;
        }
        case 'end-event':
          if (!(await uiConfirm('End this event? Players can no longer join or sign up. You can reopen it later.', { ok: 'End event', danger: true }))) return;
          await mapi('POST', `${base}/end`); break;
        case 'reopen': await mapi('POST', `${base}/reopen`); break;
        case 'delete-event':
          if (!(await uiConfirm('Delete this event for good?', { ok: 'Delete', danger: true }))) return;
          await mapi('DELETE', base); location.hash = '#/manager'; break;
        case 'player-view':
          window.open(joinLink(s.code), '_blank'); break;
      }
    } catch (e) { toast(e.message, 'warn'); }
    if (el.isConnected) el.disabled = false;
  };
  const onClick = e => { const el = e.target.closest('[data-act]'); if (el && app.contains(el)) act(el); };
  const onSubmit = async e => {
    const f = e.target.closest('form[data-walkup]');
    if (!f) return;
    e.preventDefault();
    const inp = $('input', f);
    try {
      await mapi('POST', `${base}/games/${f.dataset.walkup}/players`, { name: inp.value });
      inp.value = ''; inp.blur();
    } catch (ex) { toast(ex.message, 'warn'); }
  };
  app.addEventListener('click', onClick);
  app.addEventListener('submit', onSubmit);

  function openSettings() {
    const s = live.state;
    dlg.innerHTML = `<form method="dialog" id="setForm">
      <div class="dlg-head"><h2>Event settings</h2><button class="iconbtn" value="cancel" aria-label="Close">✕</button></div>
      <div class="dlg-body stack">
        <div><label for="s_name">Event name</label><input id="s_name" maxlength="60" value="${esc(s.name)}"></div>
        <div class="settings-grid">${settingsFields(s.settings, false)}</div>
        <p class="field-hint">Changes apply right away. A new game length applies to games that haven't started.</p>
      </div>
      <div class="dlg-foot"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="save" id="saveSet">Save</button></div>
    </form>`;
    wireSettings(dlg);
    $('#saveSet', dlg).onclick = async ev => {
      ev.preventDefault();
      try {
        const settings = readSettings(dlg);
        const updated = await mapi('PATCH', base, { name: $('#s_name', dlg).value, settings });
        live.state = updated;
        store.set('nu.lastSettings', settings);
        dlg.close(); toast('Settings saved — everyone sees the changes now');
      } catch (ex) { toast(ex.message, 'warn'); }
    };
    dlg.onclose = () => { if (live) { applyTheme(live.state.settings.theme); render(); } };
    dlg.showModal();
  }

  view = { cleanup() { es.close(); render.dispose(); app.removeEventListener('click', onClick); app.removeEventListener('submit', onSubmit); if (dlg.open) dlg.close(); live = null; } };
}

function renderManager(s) {
  const st = s.settings;
  if (!dlg.open) applyTheme(st.theme); // don't override a live preview in Settings
  const playing = s.games.filter(g => g.status === 'playing');
  const open = s.games.filter(g => g.status === 'open');
  const fixedBoards = st.maxBoards !== null;

  if (s.status !== 'active') {
    const players = s.roster.length;
    app.innerHTML = `<section class="card ended-card">
        <div class="pill ended">Ended</div>
        <h2 style="margin-top:10px">${esc(s.name)}</h2>
        <p class="muted" style="margin:0 0 4px">This event is over and saved in your events.</p>
        <div class="ended-stats">
          <div><b>${s.history.length}</b><span>game${s.history.length === 1 ? '' : 's'} played</span></div>
          <div><b>${players}</b><span>player${players === 1 ? '' : 's'}</span></div>
        </div>
        <div class="stack">
          <a class="btn primary block" href="#/manager">← Back to all events</a>
          <a class="btn block" href="#/manager/new">+ Start a new event</a>
        </div>
      </section>
      <details class="more card">
        <summary>More options</summary>
        <p class="muted small">Ended this by mistake? Reopen it to let people join and sign up again. Deleting removes it from your events for good.</p>
        <div class="row">
          <button class="btn small" data-act="reopen">Reopen event</button>
          <button class="btn small danger" data-act="delete-event">Delete event</button>
        </div>
      </details>`;
    return;
  }

  const playingHtml = playing.length ? playing.map(g => {
    const rem = remaining(g);
    const t = g.timer;
    const timeBtns = t.running
      ? `<button class="btn small" data-act="pause" data-gid="${g.id}">⏸ Pause</button>`
      : `<button class="btn small primary" data-act="resume" data-gid="${g.id}" ${rem <= 0 ? 'disabled' : ''}>▶ Resume</button>`;
    const footer = `<div class="timer-controls grow">${timeBtns}
        <button class="btn small" data-act="addtime" data-sec="-60" data-gid="${g.id}">−1 min</button>
        <button class="btn small" data-act="addtime" data-sec="60" data-gid="${g.id}">+1 min</button>
        <button class="btn small" data-act="pinnies" data-gid="${g.id}">Swap pinnies</button>
      </div>
      <button class="btn small solid-danger" data-act="end" data-gid="${g.id}">End &amp; clear</button>
      <form data-walkup="${g.id}"><input placeholder="Add sub / walk-up name" maxlength="24" aria-label="Add player to Game ${g.number}"><button class="btn small">Add</button></form>`;
    return boardHtml(s, g, { manager: true, footer });
  }).join('') : `<div class="empty">No game on the field. Hit <b>Start</b> on the next game below.</div>`;

  // With a fixed board count (and no last call) a deleted board is replaced right away,
  // so offer "Clear board" there; otherwise "Delete" removes the board for good.
  const removeBtn = g => {
    const n = g.teams.a.length + g.teams.b.length;
    if (fixedBoards && !s.closing) return n ? `<button class="btn small danger" data-act="clear" data-gid="${g.id}">Clear board</button>` : '';
    return `<button class="btn small danger" data-act="delete" data-gid="${g.id}">Delete</button>`;
  };
  const queueHtml = open.length ? open.map((g, idx) => {
    const footer = `<button class="btn small primary" data-act="start" data-gid="${g.id}">▶ Start game</button>
      <button class="iconbtn" title="Move up" aria-label="Move up" data-act="up" data-gid="${g.id}" ${idx === 0 ? 'disabled' : ''}>↑</button>
      <button class="iconbtn" title="Move down" aria-label="Move down" data-act="down" data-gid="${g.id}" ${idx === open.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn small" data-act="pinnies" data-gid="${g.id}">Swap pinnies</button>
      ${removeBtn(g)}
      <form data-walkup="${g.id}"><input placeholder="Add walk-up name" maxlength="24" aria-label="Add player to Game ${g.number}"><button class="btn small">Add</button></form>`;
    return boardHtml(s, g, { manager: true, idx, footer });
  }).join('') : '<div class="empty">No games waiting.</div>';

  const qr = qrSvg(joinLink(s.code));
  const withAlerts = s.roster.filter(p => p.alerts).length;

  app.innerHTML = `
    <section class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">${esc(s.name)}</h2>
        <div class="row">
          <button class="btn small" data-act="settings">⚙ Settings</button>
          <button class="btn small" data-act="announce">📣 Announce</button>
          ${s.closing ? '' : '<button class="btn small" data-act="lastcall">🏁 Last call</button>'}
        </div>
      </div>
      <div class="joincard">
        <div>
          <div class="muted small">${s.codeType === 'custom' ? 'Join password' : 'Join code'}</div>
          <div class="joincode ${s.codeType === 'custom' ? 'custom' : ''}">${esc(s.code)}</div>
          <div class="muted small">Players go to <b>${esc(location.host)}</b> and enter it, or scan the QR.</div>
          <div class="row" style="margin-top:10px">
            <button class="btn small" data-act="share">Share link</button>
            <button class="btn small" data-act="newpin">New code</button>
            <button class="btn small" data-act="custompw">Set password</button>
          </div>
        </div>
        ${qr ? `<div class="qr" aria-label="QR code to join">${qr}</div>` : ''}
      </div>
    </section>
    ${alertBar(s.managerAlerts > 0, 'mgr-alerts', 'mgr-alerts-off', "a game's time is up")}
    ${s.closing ? `<div class="lastcall">
        <div><b>🏁 Last call is on</b><span>${playing.length || open.length
          ? `No new boards will be added. ${open.length} game${open.length === 1 ? '' : 's'} left in the line${playing.length ? ' plus the one on the field' : ''}.`
          : "That's a wrap — every game has been played."}</span></div>
        <div class="row">
          <button class="btn small" data-act="lastcall-off">Reopen the line</button>
          ${!playing.length && !open.length ? '<button class="btn small solid-danger" data-act="end-event">End event</button>' : ''}
        </div>
      </div>` : ''}
    <div class="meta-row"><span>${limitText(s)}</span></div>

    <h2 class="section-title">On the field</h2>
    <div class="boards">${playingHtml}</div>

    <h2 class="section-title">The line
      ${s.closing ? '<span class="muted small" style="text-transform:none;font-family:var(--font)">Last call</span>' : fixedBoards ? `<span class="muted small" style="text-transform:none;font-family:var(--font)">${st.maxBoards} board${st.maxBoards > 1 ? 's' : ''}</span>` : '<button class="btn small" data-act="add-game">+ Add game</button>'}
    </h2>
    <div class="boards">${queueHtml}</div>
    ${fixedBoards && !s.closing ? `<p class="muted small" style="margin-top:8px">The line always shows ${st.maxBoards} board${st.maxBoards > 1 ? 's' : ''}. When you start a game it moves to the field and a fresh empty board is added. Change the number in Settings.</p>` : ''}

    <h2 class="section-title">Players (${s.roster.length}) <span class="muted small" style="text-transform:none;font-family:var(--font)">${withAlerts} with alerts on</span></h2>
    <section class="card">
      ${s.roster.length ? `<ul class="roster">${s.roster.map(p => `
        <li><span class="dot ${p.alerts ? 'on' : ''}" title="${p.alerts ? 'Alerts on' : 'No alerts'}"></span>
          <span class="nm">${esc(p.name)}${p.guest ? ' <span class="muted small">(walk-up)</span>' : ''}</span>
          <span class="muted small">${p.signups} game${p.signups === 1 ? '' : 's'}</span>
          ${p.guest ? '' : `<button class="btn small" data-act="release" data-pid="${p.id}" title="Free up this name">Sign out</button>`}
          <button class="btn small danger" data-act="kick" data-pid="${p.id}">Remove</button></li>`).join('')}</ul>`
        : '<p class="muted" style="margin:0">Nobody has joined yet. Share the code above.</p>'}
    </section>

    ${s.history.length ? `<h2 class="section-title">Recent games</h2><section class="card"><ul class="roster history">${s.history.slice().reverse().map(h =>
      `<li>Game ${h.number} · ended ${new Date(h.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${h.teams.a.length + h.teams.b.length} players</li>`).join('')}</ul></section>` : ''}

    <div class="row" style="margin:22px 0 40px;justify-content:center">
      <button class="btn small" data-act="player-view">Open player view</button>
      <button class="btn small danger" data-act="end-event">End event</button>
    </div>`;
}

function qrSvg(text) {
  if (typeof window.qrcode !== 'function') return '';
  try {
    const q = window.qrcode(0, 'M');
    q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch { return ''; }
}

/* ================================================================== */
/* ROUTER                                                             */
/* ================================================================== */
function route() {
  if (view) { view.cleanup(); view = null; }
  resetTheme();
  if (dlg.open) dlg.close();
  const h = location.hash.replace(/^#/, '') || '/';
  let m;
  window.scrollTo(0, 0);
  if ((m = h.match(/^\/e\/([\w-]+)$/))) return playerView(m[1]);
  if ((m = h.match(/^\/join\/(.+)$/))) return homeView(decodeURIComponent(m[1]));
  if (h === '/install') return installView();
  if ((m = h.match(/^\/install\/(.+)$/))) return installView(decodeURIComponent(m[1]));
  if ((m = h.match(/^\/manager\/e\/([\w-]+)$/))) return mgrSession() ? managerEventView(m[1]) : managerAuthView();
  if (h === '/manager') return mgrSession() ? managerHomeView() : managerAuthView();
  if (h === '/manager/new') return mgrSession() ? managerHomeView({ startNew: true }) : managerAuthView();
  return homeView();
}

(async function boot() {
  // QR links look like /?code=1234
  const qp = new URLSearchParams(location.search);
  if (qp.get('code')) {
    const c = qp.get('code');
    history.replaceState(null, '', '/#/join/' + encodeURIComponent(c));
  }
  try { cfg = await api('GET', '/api/config'); } catch {}
  window.addEventListener('hashchange', route);
  // QR library loads with defer; re-render organizer view when it's ready.
  route();
})();