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
// "9:42 PM" today, or "Sat 9:42 PM" if it's another day.
function clockTime(ms) {
  const d = new Date(ms), now = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t;
}
function untilText(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim();
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
  return `<div class="swatches" id="themeSw">
      ${THEMES.map(t => `<button type="button" class="swatch" data-theme="${t.id}" aria-pressed="${!custom && cur.preset === t.id}">${chipsHtml(t)}${t.name}</button>`).join('')}
    </div>
    <div class="color-row ${custom ? '' : 'hidden'}" id="customColors">
      <div><label for="c_main">Main</label><input type="color" id="c_main" value="${cur.main}"></div>
      <div><label for="c_accent">Highlight</label><input type="color" id="c_accent" value="${cur.accent}"></div>
      <div><label for="c_pinnie">Pinnies</label><input type="color" id="c_pinnie" value="${cur.pinnie}"></div>
    </div>
    <button type="button" class="set-link" id="pickOwn" aria-expanded="${custom}">${custom ? 'Using my own colors' : 'Pick my own colors'}<span aria-hidden="true">›</span></button>`;
}
function readTheme(root) {
  const pressed = $('#themeSw [aria-pressed=true]', root);
  return { preset: pressed ? pressed.dataset.theme : 'custom', main: $('#c_main', root).value, accent: $('#c_accent', root).value, pinnie: $('#c_pinnie', root).value };
}
function wireTheme(root) {
  const sw = $('#themeSw', root);
  if (!sw) return;
  const press = id => $$('[data-theme]', sw).forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === id));
  const preview = () => { applyTheme(readTheme(root)); root.dispatchEvent(new Event('settingschange')); };
  $$('[data-theme]', sw).forEach(b => b.onclick = () => {
    const t = THEMES.find(x => x.id === b.dataset.theme);
    if (t) { $('#c_main', root).value = t.main; $('#c_accent', root).value = t.accent; $('#c_pinnie', root).value = t.pinnie; }
    press(b.dataset.theme);
    preview();
  });
  for (const id of ['c_main', 'c_accent', 'c_pinnie']) $('#' + id, root).addEventListener('input', () => { press('custom'); preview(); });
  const own = $('#pickOwn', root);
  if (own) own.onclick = () => {
    const box = $('#customColors', root);
    const open = box.classList.toggle('hidden') === false;
    own.setAttribute('aria-expanded', open);
    own.firstChild.textContent = open ? 'Hide my own colors' : 'Pick my own colors';
  };
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

// Add-a-friend: name + which team. Resolves { name, team } or null.
function friendDialog(s, g) {
  return new Promise(resolve => {
    const cap = s.settings.playersPerTeam;
    const full = t => g.teams[t].length >= cap;
    const d = document.createElement('dialog');
    d.className = 'ask';
    d.innerHTML = `<form method="dialog" novalidate>
      <div class="dlg-body">
        <p class="ask-msg"><b>Add a friend to Game ${g.number}</b></p>
        <label for="fr_name" style="margin-top:12px">Friend's name</label>
        <input id="fr_name" maxlength="24" placeholder="e.g. Jo M." autocomplete="off" autocapitalize="words">
        <label style="margin-top:12px">Team</label>
        <div class="seg" id="fr_team" style="display:flex">
          <button type="button" class="grow" data-t="" aria-pressed="true">Either</button>
          <button type="button" class="grow" data-t="a" aria-pressed="false" ${full('a') ? 'disabled' : ''}>Team 1${g.pinnies === 'a' ? ' 🟧' : ''}</button>
          <button type="button" class="grow" data-t="b" aria-pressed="false" ${full('b') ? 'disabled' : ''}>Team 2${g.pinnies === 'b' ? ' 🟧' : ''}</button>
        </div>
        <p class="field-hint">🟧 = pinnies. You can switch their team later. You'll get their alerts — if they join on their own phone with this name, the spot becomes theirs.</p>
        <p class="err" id="fr_err"></p>
      </div>
      <div class="dlg-foot"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">Add friend</button></div>
    </form>`;
    let team = '';
    $$('[data-t]', d).forEach(b => b.onclick = () => {
      team = b.dataset.t;
      $$('[data-t]', d).forEach(x => x.setAttribute('aria-pressed', x === b));
    });
    const inp = $('#fr_name', d);
    const tryOk = () => {
      if (!inp.value.trim()) { $('#fr_err', d).textContent = "Enter your friend's name"; inp.focus(); return false; }
      d.close('ok'); return true;
    };
    $('form', d).addEventListener('submit', e => { if (e.submitter && e.submitter.value === 'ok') { e.preventDefault(); tryOk(); } });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryOk(); } });
    let done = false;
    d.addEventListener('close', () => {
      if (done) return; done = true;
      resolve(d.returnValue === 'ok' ? { name: inp.value.trim(), team } : null);
      d.remove();
    });
    document.body.appendChild(d);
    d.showModal();
    inp.focus();
  });
}
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
    const mine = !opts.manager && opts.meId && p.addedBy === opts.meId; // a friend this player added
    const host = p.addedBy && s.players[p.addedBy];
    let ctrls = '';
    if (opts.manager) ctrls = `
      <button class="iconbtn" title="Move to other team" aria-label="Move ${esc(p.name)} to other team" data-act="switch" data-gid="${g.id}" data-pid="${pid}">⇄</button>
      <button class="iconbtn" title="Remove from game" aria-label="Remove ${esc(p.name)}" data-act="rm-player" data-gid="${g.id}" data-pid="${pid}">✕</button>`;
    else if (me && g.status === 'open' && s.settings.allowTeamPick) ctrls = `
      <button class="iconbtn" title="Switch to the other team" aria-label="Switch to the other team" data-act="self-switch" data-gid="${g.id}">⇄</button>`;
    else if (mine && g.status === 'open') ctrls = `
      <button class="iconbtn" title="Move to other team" aria-label="Move ${esc(p.name)} to other team" data-act="friend-switch" data-gid="${g.id}" data-pid="${pid}">⇄</button>
      <button class="iconbtn" title="Take off this game" aria-label="Take ${esc(p.name)} off" data-act="friend-remove" data-gid="${g.id}" data-pid="${pid}">✕</button>`;
    let label = '';
    if (mine) label = '<span class="guest friend">your friend</span>';
    else if (host) label = `<span class="guest">friend of ${esc(host.name)}</span>`;
    else if (opts.manager && p.guest) label = '<span class="guest">walk-up</span>';
    return `<li class="${me ? 'me' : ''}${mine ? ' myfriend' : ''}"><span class="nm">${esc(p.name)}${me ? ' (you)' : ''}</span>${label}${ctrls}</li>`;
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
  if (g.status === 'playing') label = `<span class="tag live">${g.field ? esc(g.field) : 'On the field'}</span>`;
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
    ${last ? `<div class="card row"><div class="grow"><b>You're signed in to ${esc(last.eventName || 'an event')}</b><div class="muted small">as ${esc(last.name)} · joining a different event signs you out of this one</div></div><a class="btn primary" href="#/e/${esc(lastId)}">Open my board</a></div>` : ''}
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
        let r = await api('POST', '/api/join', { code, name: $('#name').value });
        if (r.needsConfirm) {
          // Someone already put this name on the list — check it's really them.
          const where = r.games.map(g => `Game ${g.number} (Team ${g.team}${g.playing ? ', playing now' : ''})`).join(', ');
          let msg;
          if (r.signedIn) msg = `"${r.name}" is already signed in at this event${where ? ` — on ${where}` : ''}.\n\nIs that you? (Got signed out, or switched phones?)`;
          else msg = `${r.addedBy ? `${r.addedBy} added "${r.name}"` : `The organizer added "${r.name}"`} to the list: ${where}.\n\nIs that you?`;
          const yes = await uiConfirm(msg, { ok: "Yes, that's me", cancel: 'No, not me' });
          if (!yes) {
            err.textContent = `"${r.name}" is taken by someone else at this event — add a last initial, e.g. "${r.name} B."`;
            $('#name').focus(); $('#name').select();
            btn.disabled = false;
            return;
          }
          r = await api('POST', '/api/join', { code, name: $('#name').value, confirmClaim: true });
          toast(r.rejoined ? `Welcome back, ${r.name} — you're signed back in` : `Welcome, ${r.name} — your spot is saved`, 'alert', 5000);
        }
        // One event per sign-in: leaving the previous event (like Kahoot) frees that name and spot.
        if (last && lastId && lastId !== r.eventId) {
          await papi(lastId, 'POST', `/api/events/${lastId}/signout`).catch(() => {});
          store.del('nu.player.' + lastId);
        }
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
  // Ended events can't be opened again: forget this sign-in and go back to the join screen.
  if (state.status !== 'active') {
    store.del('nu.player.' + eventId);
    if (store.get('nu.lastEvent') === eventId) store.del('nu.lastEvent');
    toast(`${state.name} has ended — there's no live event with that code.`, 'warn', 6000);
    history.replaceState(null, '', '#/');
    return homeView();
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
    const a = el.dataset.act, gid = el.dataset.gid, pid = el.dataset.pid;
    try {
      if (a === 'add-friend') {
        const g = live.state.games.find(x => x.id === gid);
        if (!g) return;
        const r = await friendDialog(live.state, g);
        if (!r) return;
        await papi(eventId, 'POST', `/api/events/${eventId}/games/${gid}/friend`, { name: r.name, team: r.team || undefined });
        toast(`${r.name} is on Game ${g.number} — you'll get their alerts`);
        return;
      }
      if (a === 'self-switch') {
        const r = await papi(eventId, 'POST', `/api/events/${eventId}/games/${gid}/switch`);
        toast(`You're on Team ${r.team === 'a' ? 1 : 2} now`);
        return;
      }
      if (a === 'friend-switch') {
        await papi(eventId, 'POST', `/api/events/${eventId}/games/${gid}/friends/${pid}/switch`);
        return;
      }
      if (a === 'friend-remove') {
        const nm = live.state.players[pid]?.name || 'your friend';
        const g = live.state.games.find(x => x.id === gid);
        if (!(await uiConfirm(`Take ${nm} off Game ${g ? g.number : ''}?`, { ok: 'Take off', danger: true }))) return;
        await papi(eventId, 'POST', `/api/events/${eventId}/games/${gid}/friends/${pid}/remove`);
        return;
      }
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
    app.innerHTML = `<div class="card"><h2>${esc(s.name)}</h2><p class="muted">${s.autoClosed ? 'This event closed for the day.' : 'This event has ended.'} Thanks for playing!</p><a class="btn" href="#/" data-act="signout">Back home</a></div>`;
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
      <div class="sub">${myPlaying.field ? `<b>${esc(myPlaying.field)}</b> · ` : ''}Game ${myPlaying.number} · Team ${team === 'a' ? 1 : 2} · ${myPlaying.pinnies === team ? '<b>wear a pinnie</b>' : 'no pinnie'}</div></div>`;
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

  const myFriendSpots = [];
  for (const g of s.games) for (const pid of [...g.teams.a, ...g.teams.b]) {
    const fp = s.players[pid];
    if (fp && fp.addedBy === me.id) myFriendSpots.push(`<b>${esc(fp.name)}</b> · ${g.status === 'playing' ? 'playing now' : `Game ${g.number}`}`);
  }
  const friendsLine = myFriendSpots.length ? `<p class="friends-line">👥 Your friends: ${myFriendSpots.join(' &nbsp;|&nbsp; ')} <span class="muted">— you'll get their alerts</span></p>` : '';

  const playingHtml = playing.length
    ? `<div class="boards">${playing.map(g => boardHtml(s, g, { meId: me.id })).join('')}</div>`
    : `<div class="empty">Nothing on the field right now.</div>`;

  const queueHtml = open.length ? `<div class="boards">${open.map((g, idx) => {
    const isMine = inGame(g, me.id);
    const cap = st.playersPerTeam;
    const full = g.teams.a.length + g.teams.b.length >= cap * 2;
    let footer = '';
    const friendBtn = st.maxFriends !== 0 && !full ? `<button class="btn small" data-act="add-friend" data-gid="${g.id}">+ Add a friend</button>` : '';
    if (isMine) footer = st.allowLeave ? `<span class="note grow">You're on this game.</span><button class="btn small danger" data-act="leave" data-gid="${g.id}">Take my name off</button>` : `<span class="note">You're on this game.</span>`;
    else if (full) footer = `<span class="note">This game is full.</span>`;
    else if (limitHit) footer = `<span class="note">${st.maxSignups === 1 ? "You're already on a game." : `You're on ${st.maxSignups} games — that's the limit.`}</span>`;
    else if (st.allowTeamPick) footer = ['a', 'b'].map(t => `<button class="btn primary small grow" data-act="join" data-gid="${g.id}" data-team="${t}" ${g.teams[t].length >= cap ? 'disabled' : ''}>Join Team ${t === 'a' ? 1 : 2}${g.pinnies === t ? ' (pinnies)' : ''}</button>`).join('');
    else footer = `<button class="btn primary ${friendBtn ? 'grow' : 'block'}" data-act="join" data-gid="${g.id}">Put my name down</button>`;
    if (friendBtn) footer += friendBtn;
    return boardHtml(s, g, { meId: me.id, idx, footer });
  }).join('')}</div>`
    : `<div class="empty">${s.closing ? 'No more games in the line — last call is on.' : 'No games waiting right now.'}</div>`;

  const atLimit = !s.closing && st.maxBoards !== null && !open.some(g => g.teams.a.length + g.teams.b.length < st.playersPerTeam * 2);

  app.innerHTML = `
    ${alertBar(me.alerts, 'alerts', 'alerts-off')}
    ${s.closing ? `<div class="lastcall"><b>🏁 Last call</b><span>No new games after the ones on the board. ${open.length ? `${open.length} game${open.length > 1 ? 's' : ''} left in the line.` : 'These are the final games.'}</span></div>` : ''}
    ${status}
    ${friendsLine}
    <button type="button" class="codechip" data-act="share" aria-label="Share the event code">
      <span class="codechip-label">${s.codeType === 'custom' ? 'Event password' : 'Event code'}</span>
      <span class="codechip-code ${s.codeType === 'custom' ? 'custom' : ''}">${esc(s.code)}</span>
      <span class="codechip-share">Share ↗</span>
    </button>
    <div class="meta-row"><span>${esc(s.name)}</span><span>${limitText(s)}</span>${st.maxSignups !== null ? `<span>You: <b>${mySignups.length}/${st.maxSignups}</b></span>` : ''}</div>
    <h2 class="section-title">On the field</h2>
    ${playingHtml}
    <h2 class="section-title">The line</h2>
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
function managerAuthView(startMode = 'login') {
  topnav.innerHTML = `<a href="#/">Join a game</a>`;
  let mode = startMode, sentTo = null;
  const noEmail = !cfg.emailConfigured
    ? `<p class="note-warn">Email isn't set up on this site yet, so recovery emails can't be sent. The site owner needs to finish the email step in the README.</p>` : '';
  const draw = () => {
    let body;
    if (mode === 'login' || mode === 'register') {
      body = `
        <h2>Organizer</h2>
        <p class="muted small">Sign in to create events, run the line and manage games.</p>
        <div class="tabs seg" role="tablist" style="display:flex">
          <button type="button" class="grow" aria-pressed="${mode === 'login'}" data-mode="login">Sign in</button>
          <button type="button" class="grow" aria-pressed="${mode === 'register'}" data-mode="register">Create account</button>
        </div>
        <form id="authForm" class="stack" novalidate>
          <div><label for="u">${mode === 'login' ? 'Username or email' : 'Username'}</label><input id="u" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
          ${mode === 'register' ? `<div><label for="em">Email</label><input id="em" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com">
            <div class="field-hint">Only used to reset your password or remind you of your username.</div></div>` : ''}
          <div><label for="p">Password</label><input id="p" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="6"></div>
          ${mode === 'register' && cfg.signupCodeRequired ? `<div><label for="sc">Organizer sign-up code</label><input id="sc"></div>` : ''}
          <button class="btn primary block" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
          <p class="err" id="authErr"></p>
        </form>
        ${mode === 'login' ? `<div class="forgot-links"><button type="button" class="linkbtn" data-mode="forgot-pw">Forgot password?</button><button type="button" class="linkbtn" data-mode="forgot-user">Forgot username?</button></div>` : ''}`;
    } else if (sentTo) {
      body = `
        <h2>Check your email</h2>
        <p>${mode === 'forgot-pw'
          ? 'If that matches an organizer account, we just sent a link to choose a new password. It works once, for 1 hour.'
          : 'If that email is on an organizer account, we just sent your username to it.'}</p>
        <p class="muted small">Nothing there after a few minutes? Check your spam folder, or try again.</p>
        ${noEmail}
        <div class="stack"><button type="button" class="btn primary block" data-mode="login">Back to sign in</button></div>`;
    } else {
      const pw = mode === 'forgot-pw';
      body = `
        <h2>${pw ? 'Reset your password' : 'Find your username'}</h2>
        <p class="muted small">${pw ? "Enter your username or the email on your account and we'll email you a link to choose a new password." : "Enter the email on your account and we'll email you your username."}</p>
        <form id="forgotForm" class="stack" novalidate>
          <div><label for="fw">${pw ? 'Username or email' : 'Email'}</label><input id="fw" ${pw ? '' : 'type="email"'} autocomplete="${pw ? 'username' : 'email'}" autocapitalize="none" spellcheck="false"></div>
          <button class="btn primary block" type="submit">${pw ? 'Email me a reset link' : 'Email me my username'}</button>
          <p class="err" id="fErr"></p>
        </form>
        ${noEmail}
        <div class="forgot-links"><button type="button" class="linkbtn" data-mode="login">← Back to sign in</button>${pw ? '<button type="button" class="linkbtn" data-mode="forgot-user">Forgot username?</button>' : '<button type="button" class="linkbtn" data-mode="forgot-pw">Forgot password?</button>'}</div>`;
    }
    app.innerHTML = `
      <div style="max-width:440px;margin:0 auto">${installNudge('', 'organizer')}</div>
      <section class="card" style="max-width:440px;margin:20px auto">${body}</section>
      <p class="muted small" style="text-align:center">Here to play? <a href="#/">Join a game as a player</a></p>`;
    $$('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; sentTo = null; draw(); });
    const auth = $('#authForm');
    if (auth) {
      auth.onsubmit = async e => {
        e.preventDefault();
        const errEl = $('#authErr'); errEl.textContent = '';
        const body = { username: $('#u').value.trim(), password: $('#p').value };
        if (!body.username) { errEl.textContent = mode === 'login' ? 'Enter your username or email' : 'Choose a username'; return $('#u').focus(); }
        if (mode === 'register') {
          body.email = $('#em').value.trim();
          if (!body.email) { errEl.textContent = 'Enter your email — it lets you reset your password if you forget it'; return $('#em').focus(); }
        }
        if (!body.password) { errEl.textContent = 'Enter your password'; return $('#p').focus(); }
        if ($('#sc')) body.signupCode = $('#sc').value;
        try {
          const r = await api('POST', `/api/manager/${mode}`, body);
          store.set('nu.manager', r);
          route();
        } catch (ex) { errEl.textContent = ex.message; }
      };
      $('#u').focus();
    }
    const fg = $('#forgotForm');
    if (fg) {
      fg.onsubmit = async e => {
        e.preventDefault();
        const v = $('#fw').value.trim();
        if (!v) { $('#fErr').textContent = mode === 'forgot-pw' ? 'Enter your username or email' : 'Enter your email'; return; }
        try {
          await api('POST', mode === 'forgot-pw' ? '/api/manager/forgot-password' : '/api/manager/forgot-username', mode === 'forgot-pw' ? { who: v } : { email: v });
          sentTo = v; draw();
        } catch (ex) { $('#fErr').textContent = ex.message; }
      };
      $('#fw').focus();
    }
  };
  draw();
}

// Reset link from the email: choose a new password, then you're signed in.
function resetView(token) {
  topnav.innerHTML = `<a href="#/manager">Organizer sign in</a>`;
  app.innerHTML = `
    <section class="card" style="max-width:440px;margin:20px auto">
      <h2>Choose a new password</h2>
      <form id="resetForm" class="stack" novalidate>
        <div><label for="np">New password</label><input id="np" type="password" autocomplete="new-password" minlength="6"></div>
        <div><label for="np2">Type it again</label><input id="np2" type="password" autocomplete="new-password" minlength="6"></div>
        <button class="btn primary block" type="submit">Save new password</button>
        <p class="err" id="rErr"></p>
      </form>
      <p class="muted small">Saving signs you out on every other device.</p>
    </section>`;
  $('#resetForm').onsubmit = async e => {
    e.preventDefault();
    const a = $('#np').value, b = $('#np2').value, errEl = $('#rErr');
    if (a.length < 6) { errEl.textContent = 'Use at least 6 characters'; return; }
    if (a !== b) { errEl.textContent = "The two passwords don't match"; return; }
    try {
      const r = await api('POST', '/api/manager/reset-password', { token, password: a });
      store.set('nu.manager', r);
      toast('Password changed — you are signed in', 'alert');
      location.hash = '#/manager';
    } catch (ex) { errEl.innerHTML = `${esc(ex.message)} <button type="button" class="linkbtn" id="again">Send a new link</button>`; $('#again').onclick = () => { location.hash = '#/manager/forgot'; }; }
  };
  $('#np').focus();
}

// Organizer account: email + password.
async function accountView() {
  app.innerHTML = '<div class="spinner"></div>';
  let acct;
  try { acct = await mapi('GET', '/api/manager/account'); }
  catch (e) { if (e.status === 401) { store.del('nu.manager'); return managerAuthView(); } app.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  topnav.innerHTML = `<a href="#/manager">← Your events</a>`;
  app.innerHTML = `
    <div class="page-head">
      <a class="back" href="#/manager" aria-label="Back to your events"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4.5L7.5 11l6.5 6.5"></path></svg></a>
      <h1>Account</h1>
    </div>
    <section class="card stack">
      <div><span class="muted small">Username</span><div style="font-weight:700;font-size:17px">${esc(acct.username)}</div></div>
      <form id="emailForm" class="stack" novalidate>
        <div><label for="ae">Email</label><input id="ae" type="email" autocomplete="email" autocapitalize="none" value="${esc(acct.email || '')}" placeholder="you@example.com">
          <div class="field-hint">Used to reset your password or remind you of your username.</div></div>
        <button class="btn primary" type="submit">Save email</button>
        <p class="err" id="eErr"></p>
      </form>
    </section>
    <section class="card">
      <h2 style="font-size:20px">Change password</h2>
      <form id="pwForm" class="stack" novalidate>
        <div><label for="cp">Current password</label><input id="cp" type="password" autocomplete="current-password"></div>
        <div><label for="np">New password</label><input id="np" type="password" autocomplete="new-password" minlength="6"></div>
        <div><label for="np2">Type it again</label><input id="np2" type="password" autocomplete="new-password"></div>
        <button class="btn primary" type="submit">Change password</button>
        <p class="err" id="pErr"></p>
        <p class="field-hint">Changing it signs you out on every other device.</p>
      </form>
    </section>`;
  $('#emailForm').onsubmit = async e => {
    e.preventDefault(); $('#eErr').textContent = '';
    try { await mapi('POST', '/api/manager/account', { email: $('#ae').value.trim() }); toast('Email saved'); }
    catch (ex) { $('#eErr').textContent = ex.message; }
  };
  $('#pwForm').onsubmit = async e => {
    e.preventDefault(); const errEl = $('#pErr'); errEl.textContent = '';
    const a = $('#np').value, b = $('#np2').value;
    if (a.length < 6) { errEl.textContent = 'New password: at least 6 characters'; return; }
    if (a !== b) { errEl.textContent = "The two new passwords don't match"; return; }
    try {
      const r = await mapi('POST', '/api/manager/account', { currentPassword: $('#cp').value, newPassword: a });
      if (r.token) store.set('nu.manager', { token: r.token, username: r.username });
      $('#pwForm').reset();
      toast('Password changed');
    } catch (ex) { errEl.textContent = ex.message; }
  };
}

/* ---------------- event settings editor (−/+ steppers, No-limit switches) ---------------- */
const STEP_LISTS = {
  s_min: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 150, 180]
};
function stepValText(id, v) {
  if (id === 's_min') return `${v} min`;
  if (id === 's_warn') return v === 0 ? 'Off' : `${v} min`;
  if (id === 's_friends') return v === 0 ? 'Off' : String(v);
  if (id === 's_hours') return `${v} h`;
  if (id === 's_every') return v === 1 ? 'Every week' : `Every ${v} weeks`;
  return String(v);
}
function stepHint(id, v) {
  if (id === 's_ppt') return `${v}v${v} · ${v * 2} names per game`;
  return null;
}
function stepperRow(id, title, hint, val, { min, max, less, more, unl = null, unlLabel = '' }) {
  const off = unl === true;
  const shown = val ?? (id === 's_boards' ? 3 : 1);
  return `<div class="set-row-wrap">
    <div class="set-row">
      <div class="set-text"><span class="set-title">${title}</span>${hint ? `<span class="set-hint" id="${id}_hint">${stepHint(id, shown) || hint}</span>` : ''}</div>
      <div class="stepper ${off ? 'off' : ''}" data-id="${id}" data-min="${min}" data-max="${max}" data-val="${shown}">
        <button type="button" data-step="-1" aria-label="${less}" ${off ? 'disabled' : ''}>−</button>
        <output id="${id}" aria-live="polite">${off ? '∞' : stepValText(id, shown)}</output>
        <button type="button" data-step="1" aria-label="${more}" ${off ? 'disabled' : ''}>+</button>
      </div>
    </div>
    ${unl !== null ? `<div class="set-sub"><span>No limit</span><button type="button" role="switch" class="switch" id="${id}Unl" data-for="${id}" aria-checked="${off}" aria-label="${unlLabel}"></button></div>` : ''}
  </div>`;
}
function switchRow(id, title, on) {
  return `<div class="set-row"><span class="set-title">${title}</span><button type="button" role="switch" class="switch" id="${id}" aria-checked="${!!on}" aria-label="${title}"></button></div>`;
}
function fieldNameInputs(n, names) {
  return Array.from({ length: n }, (_, i) => `<input class="fn-input" data-i="${i}" maxlength="24" value="${esc((names[i] || '').trim() || `Field ${i + 1}`)}" aria-label="Name of field ${i + 1}">`).join('');
}
function settingsFields(st) {
  const friends = st.maxFriends === undefined ? null : st.maxFriends;
  return `
    <section class="set-group"><h3>Games</h3>
      ${stepperRow('s_ppt', 'Players per team', 'names per game', st.playersPerTeam, { min: 1, max: 30, less: 'Fewer players per team', more: 'More players per team' })}
      ${stepperRow('s_min', 'Game length', 'Timer for each game', st.gameMinutes, { min: 1, max: 180, less: 'Shorter games', more: 'Longer games' })}
      ${stepperRow('s_fields', 'Games at once', 'Fields in use', st.fields, { min: 1, max: 10, less: 'Fewer fields', more: 'More fields' })}
      <div class="set-fields" id="fieldNames" data-names="${esc(JSON.stringify(st.fieldNames || []))}">
        <span class="set-hint">Field names — shown to players and picked when a game starts</span>
        <div class="fn-grid">${fieldNameInputs(st.fields || 1, st.fieldNames || [])}</div>
      </div>
    </section>
    <section class="set-group"><h3>Event</h3>
      <div class="set-row"><span class="set-title">Event ends</span>
        <div class="seg" id="s_closeMode" role="group" aria-label="Event ends">
          <button type="button" data-v="hours" aria-pressed="${st.closeMode !== 'time'}">After</button>
          <button type="button" data-v="time" aria-pressed="${st.closeMode === 'time'}">At a time</button>
        </div>
      </div>
      <div id="closeHoursRow" class="${st.closeMode === 'time' ? 'hidden' : ''}">
        ${stepperRow('s_hours', 'Open for', 'Then it closes on its own and frees the code', st.closeHours || 12, { min: 1, max: 24, less: 'Shorter event', more: 'Longer event' })}
      </div>
      <div id="closeTimeRow" class="set-row ${st.closeMode === 'time' ? '' : 'hidden'}">
        <div class="set-text"><label class="set-title" for="s_closeTime">Ends at</label><span class="set-hint">Closes on its own and frees the code</span></div>
        <input type="time" id="s_closeTime" class="time-input" value="${esc(st.closeTime || '22:00')}">
      </div>
    </section>
    <section class="set-group"><h3>The line</h3>
      ${stepperRow('s_boards', 'Boards in the line', "Like whiteboards — the game on the field doesn't count", st.maxBoards, { min: 1, max: 50, less: 'Fewer boards', more: 'More boards', unl: st.maxBoards === null, unlLabel: 'No limit on boards' })}
      ${stepperRow('s_signups', 'Sign-ups per person', 'Games one person can be on at a time', st.maxSignups, { min: 1, max: 50, less: 'Fewer sign-ups', more: 'More sign-ups', unl: st.maxSignups === null, unlLabel: 'No limit on sign-ups' })}
      ${stepperRow('s_friends', 'Friends each player can add', "0 = off · they get their friends' alerts", friends ?? 1, { min: 0, max: 50, less: 'Fewer friends', more: 'More friends', unl: friends === null, unlLabel: 'No limit on friends' })}
    </section>
    <section class="set-group"><h3>Teams</h3>
      <div class="set-row"><span class="set-title">Pinnies go to</span>
        <div class="seg pin-seg" id="s_pin" role="group" aria-label="Pinnies go to">
          <button type="button" data-v="a" aria-pressed="${st.defaultPinnies !== 'b'}">Team 1</button>
          <button type="button" data-v="b" aria-pressed="${st.defaultPinnies === 'b'}">Team 2</button>
        </div>
      </div>
      ${switchRow('s_pick', 'Players pick their own team', st.allowTeamPick)}
      ${switchRow('s_leave', 'Players can take their name off', st.allowLeave)}
    </section>
    <section class="set-group"><h3>Alerts</h3>
      ${stepperRow('s_warn', 'Heads-up before a game ends', 'Tells the next game to warm up', st.warnMinutes, { min: 0, max: 30, less: 'Earlier heads-up', more: 'Later heads-up' })}
    </section>
    <section class="set-group"><h3>Colors</h3>
      ${themeFields(st.theme)}
      <p class="set-note">Tip: match "Pinnies" to your real bibs.</p>
    </section>`;
}
function wireSettings(root) {
  wireTheme(root);
  const changed = () => root.dispatchEvent(new Event('settingschange'));
  $$('.stepper', root).forEach(st => {
    const id = st.dataset.id, min = +st.dataset.min, max = +st.dataset.max;
    const list = STEP_LISTS[id];
    const set = v => {
      st.dataset.val = v;
      $('output', st).textContent = stepValText(id, v);
      const h = stepHint(id, v); if (h && $('#' + id + '_hint', root)) $('#' + id + '_hint', root).textContent = h;
      if (id === 's_fields') { const names = readFieldNames(root); $('#fieldNames .fn-grid', root).innerHTML = fieldNameInputs(v, names); }
      changed();
    };
    $$('[data-step]', st).forEach(b => b.onclick = () => {
      const cur = +st.dataset.val, dir = +b.dataset.step;
      let next;
      if (list) {
        const i = list.findIndex(x => x >= cur);
        next = dir > 0 ? list[Math.min(list.length - 1, list[i] === cur ? i + 1 : i)] : list[Math.max(0, (i === -1 ? list.length : i) - 1)];
        if (next === undefined) next = cur;
      } else next = cur + dir;
      set(Math.min(max, Math.max(min, next)));
    });
  });
  $$('.switch', root).forEach(sw => sw.onclick = () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', on);
    if (sw.dataset.for) {
      const st = $(`.stepper[data-id="${sw.dataset.for}"]`, root);
      st.classList.toggle('off', on);
      $$('button', st).forEach(b => { b.disabled = on; });
      $('output', st).textContent = on ? '∞' : stepValText(st.dataset.id, +st.dataset.val);
    }
    changed();
  });
  const fn = $('#fieldNames', root);
  if (fn) fn.addEventListener('input', changed);
  const pin = $('#s_pin', root);
  if (pin) $$('button', pin).forEach(b => b.onclick = () => {
    $$('button', pin).forEach(x => x.setAttribute('aria-pressed', x === b));
    changed();
  });
  const cm = $('#s_closeMode', root);
  if (cm) $$('button', cm).forEach(b => b.onclick = () => {
    $$('button', cm).forEach(x => x.setAttribute('aria-pressed', x === b));
    $('#closeHoursRow', root).classList.toggle('hidden', b.dataset.v === 'time');
    $('#closeTimeRow', root).classList.toggle('hidden', b.dataset.v !== 'time');
    changed();
  });
  const ct = $('#s_closeTime', root);
  if (ct) ct.addEventListener('change', changed);
}
const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
// "19:30" -> "7:30 PM"
function hmText(hm) {
  const [h, m] = String(hm || '0:0').split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
// Every field name typed so far (kept even when the field count goes down, so going back up restores them).
function readFieldNames(root) {
  const box = $('#fieldNames', root);
  if (!box) return [];
  let names = [];
  try { names = JSON.parse(box.dataset.names || '[]'); } catch {}
  $$('.fn-input', box).forEach(inp => { names[+inp.dataset.i] = inp.value.replace(/\s+/g, ' ').trim() || `Field ${+inp.dataset.i + 1}`; });
  box.dataset.names = JSON.stringify(names);
  return names;
}
function readSettings(root) {
  const val = id => +$(`.stepper[data-id="${id}"]`, root).dataset.val;
  const unl = id => $('#' + id + 'Unl', root).getAttribute('aria-checked') === 'true';
  const on = id => $('#' + id, root).getAttribute('aria-checked') === 'true';
  return {
    playersPerTeam: val('s_ppt'),
    gameMinutes: val('s_min'),
    fields: val('s_fields'),
    fieldNames: readFieldNames(root).slice(0, 10),
    maxBoards: unl('s_boards') ? null : val('s_boards'),
    maxSignups: unl('s_signups') ? null : val('s_signups'),
    maxFriends: unl('s_friends') ? null : val('s_friends'),
    warnMinutes: val('s_warn'),
    closeMode: $('#s_closeMode [aria-pressed=true]', root)?.dataset.v || 'hours',
    closeHours: val('s_hours'),
    closeTime: $('#s_closeTime', root)?.value || '22:00',
    tz: myTz(),
    defaultPinnies: $('#s_pin [aria-pressed=true]', root)?.dataset.v || 'a',
    allowTeamPick: on('s_pick'),
    allowLeave: on('s_leave'),
    theme: readTheme(root)
  };
}
// One-line chips summarizing an event's settings.
function settingsChips(st) {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const t = st.theme && st.theme.main ? st.theme : DEFAULT_THEME;
  const tname = (THEMES.find(x => x.id === t.preset) || { name: 'My colors' }).name;
  const friends = st.maxFriends === undefined ? null : st.maxFriends;
  const chips = [
    `${st.playersPerTeam}v${st.playersPerTeam}`,
    `${st.gameMinutes} min games`,
    st.closeMode === 'time' ? `Ends ${hmText(st.closeTime)}` : `Ends after ${st.closeHours || 12} h`,
    st.maxBoards === null ? 'Unlimited line' : `${plural(st.maxBoards, 'board')} in the line`,
    st.maxSignups === null ? 'Unlimited sign-ups' : `${plural(st.maxSignups, 'sign-up')} each`,
    friends === null ? 'Friends: no limit' : friends === 0 ? 'Friends: off' : `Friends: up to ${friends}`,
    st.warnMinutes ? `Heads-up ${st.warnMinutes} min` : 'No heads-up',
    `Pinnies: Team ${st.defaultPinnies === 'b' ? 2 : 1}`
  ];
  const fnames = fieldNamesOf(st);
  if (st.fields > 1) chips.splice(2, 0, `${st.fields} fields: ${fnames.join(', ')}`);
  else if (fnames[0] !== 'Field 1') chips.splice(2, 0, `Field: ${fnames[0]}`);
  if (!st.allowTeamPick) chips.push('Organizer picks teams');
  if (!st.allowLeave) chips.push("Can't take name off");
  return chips.map(c => `<span class="chip">${esc(c)}</span>`).join('') +
    `<span class="chip">${chipsHtml(t)}${esc(tname)}</span>`;
}
const DEFAULTS = { playersPerTeam: 5, gameMinutes: 10, maxBoards: 3, maxSignups: 1, maxFriends: null, fields: 1, fieldNames: [], warnMinutes: 2, defaultPinnies: 'a', allowTeamPick: true, allowLeave: true, closeMode: 'hours', closeHours: 12, closeTime: '22:00' };
// Field names for an event's settings, padded with "Field N".
const fieldNamesOf = st => Array.from({ length: Math.max(1, st.fields || 1) }, (_, i) =>
  (((st.fieldNames || [])[i]) || '').trim() || `Field ${i + 1}`);
const fieldChoice = {}; // organizer's pick of field for a waiting game, kept across re-renders

/* ---------------- organizer home: live → new event → ended ---------------- */
const chev = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5l4.5 4.5L6 12.5"></path></svg>';
const repeatIcon = '<svg class="ic-repeat" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5A5.5 5.5 0 0 1 12.6 4M13.5 9.5A5.5 5.5 0 0 1 3.4 12"></path><path d="M12.8 1.5V4.3H10M3.2 14.5v-2.8H6"></path></svg>';
const plusIcon = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"></path></svg>';
function startedText(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? `Started ${time}` : `Started ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

async function managerHomeView() {
  app.innerHTML = '<div class="spinner"></div>';
  let me;
  try { me = await mapi('GET', '/api/manager/me'); }
  catch (e) { if (e.status === 401) { store.del('nu.manager'); return managerAuthView(); } app.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  topnav.innerHTML = `<a class="who" href="#/manager/account" title="Account">${esc(me.username)}</a><button id="logout">Sign out</button>`;
  $('#logout').onclick = async () => { await mapi('POST', '/api/manager/logout').catch(() => {}); store.del('nu.manager'); route(); };
  const emailNote = me.email ? '' : `<div class="alertbar"><span><b>Add an email</b> so you can reset your password if you ever forget it.</span><a class="btn lime small" href="#/manager/account">Add email</a></div>`;

  const series = me.series || [];
  if (!me.events.length && !series.length) {
    app.innerHTML = `${emailNote}<section class="empty-home">
      <svg width="150" height="110" viewBox="0 0 150 110" fill="none" role="img" aria-label="Three empty sign-up boards">
        <rect x="6" y="18" width="42" height="56" rx="6" stroke="currentColor" stroke-width="2.5"></rect>
        <rect x="54" y="10" width="42" height="64" rx="6" stroke="currentColor" stroke-width="2.5" fill="var(--surface)"></rect>
        <rect x="102" y="18" width="42" height="56" rx="6" stroke="currentColor" stroke-width="2.5"></rect>
        <path d="M62 24h26M62 34h20M62 44h24M62 54h16" stroke="var(--ink-3)" stroke-width="2.5" stroke-linecap="round"></path>
        <path d="M27 74v18M75 74v26M123 74v18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path>
      </svg>
      <h1>No events yet</h1>
      <p>Make an event, share the code, and the whiteboards run themselves.</p>
      <a class="btn primary block big" href="#/manager/new">${plusIcon} New event</a>
      <p class="small muted">Players don't need an account — they join with the code and their name.</p>
    </section>
    <p class="muted small" style="text-align:center">Here to play? <a href="#/">Join a game as a player</a></p>`;
    return;
  }

  const newest = (a, b) => b.createdAt - a.createdAt;
  const liveEvents = me.events.filter(e => e.status === 'active').sort(newest);
  const endedEvents = me.events.filter(e => e.status !== 'active').sort(newest);
  const hasSaved = !!store.get('nu.lastSettings');
  const liveCard = e => `
    <article class="live-card">
      <div class="live-top">
        <div class="row" style="justify-content:space-between">
          <span class="row" style="gap:6px"><span class="live-pill"><span></span>Live</span>${e.seriesId ? `<span class="rep-pill">${repeatIcon} Repeats</span>` : ''}</span>
          <span class="muted small">${startedText(e.createdAt)}</span>
        </div>
        <h3>${esc(e.name)}</h3>
        <div class="live-stats">
          <div><span>${e.codeType === 'custom' ? 'Password' : 'Code'}</span><b class="${e.codeType === 'custom' ? 'pw' : 'code'}">${esc(e.code)}</b></div>
          <div><span>Players</span><b>${e.players}</b></div>
          <div><span>Played</span><b>${e.gamesPlayed}</b></div>
        </div>
      </div>
      <a class="live-open" href="#/manager/e/${e.id}">Open event <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"></path></svg></a>
    </article>`;
  const endedRow = e => {
    const d = new Date(e.createdAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `<a class="ended-row" href="#/manager/e/${e.id}">
      <span class="grow"><b>${esc(e.name)}${e.seriesId ? ` <span class="rep-mark" title="Repeating event">${repeatIcon}</span>` : ''}</b><span>${d} · ${e.gamesPlayed} game${e.gamesPlayed === 1 ? '' : 's'} · ${e.players} player${e.players === 1 ? '' : 's'}</span></span>${chev}</a>`;
  };
  const seriesCard = sr => `
    <article class="live-card series-card">
      <div class="live-top">
        <div class="row" style="justify-content:space-between">
          <span class="rep-pill">${repeatIcon} ${esc(scheduleText(sr.schedule))}</span>
        </div>
        <h3>${esc(sr.name)}</h3>
        <div class="live-stats two-stats">
          <div><span>${sr.codeType === 'custom' ? 'Password' : 'Code'}</span><b class="${sr.codeType === 'custom' ? 'pw' : 'code'}">${esc(sr.code)}</b></div>
          <div><span>${sr.liveEventId ? 'Now' : 'Opens'}</span><b>${sr.liveEventId ? 'On now' : sr.next ? esc(new Date(sr.next.openAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + new Date(sr.next.openAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : 'No dates'}</b></div>
        </div>
      </div>
      <div class="series-actions">
        ${sr.liveEventId ? `<a href="#/manager/e/${sr.liveEventId}">Go to event</a>` : `<button type="button" data-open-series="${sr.id}">Open it now</button>`}
        <a href="#/manager/s/${sr.id}">Manage ${chev}</a>
      </div>
    </article>`;
  app.innerHTML = `
    ${emailNote}
    ${liveEvents.length ? `<h2 class="section-title" style="margin-top:4px">Live now</h2>
      <div class="ev-list">${liveEvents.map(liveCard).join('')}</div>` : ''}
    ${series.length ? `<h2 class="section-title" style="${liveEvents.length ? '' : 'margin-top:4px'}">Repeating</h2>
      <div class="ev-list">${series.map(seriesCard).join('')}</div>` : ''}
    <a class="new-cta" href="#/manager/new" style="${liveEvents.length || series.length ? '' : 'margin-top:4px'}">
      <span class="new-cta-icon">${plusIcon}</span>
      <span class="grow"><b>New event</b><span>${hasSaved ? 'Same settings as last time' : 'Right now, or on repeat'}</span></span>${chev}
    </a>
    ${endedEvents.length ? `<div class="section-title"><span>Ended</span><span class="muted small" style="text-transform:none;font-family:var(--font)">${endedEvents.length} event${endedEvents.length === 1 ? '' : 's'}</span></div>
      <nav class="ended-list" aria-label="Ended events">${endedEvents.map(endedRow).join('')}</nav>` : ''}`;
  $$('[data-open-series]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const r = await mapi('POST', `/api/manager/series/${b.dataset.openSeries}/open`); location.hash = '#/manager/e/' + r.eventId; }
    catch (ex) { toast(ex.message, 'warn'); b.disabled = false; }
  });
}

/* ---------------- repeating event page ---------------- */
const isScheduledToday = sr => !!(sr.next && sr.next.date === todayYmd());
async function seriesPageView(id) {
  topnav.innerHTML = `<a href="#/manager">← Your events</a>`;
  app.innerHTML = '<div class="spinner"></div>';
  let sr, me;
  try { [sr, me] = await Promise.all([mapi('GET', `/api/manager/series/${id}`), mapi('GET', '/api/manager/me')]); }
  catch (e) {
    if (e.status === 401) { store.del('nu.manager'); return managerAuthView(); }
    app.innerHTML = `<section class="card"><p>${esc(e.message)}</p><a class="btn" href="#/manager">← Your events</a></section>`; return;
  }
  const base = `/api/manager/series/${id}`;
  const past = me.events.filter(e => e.seriesId === id && e.status !== 'active').sort((a, b) => b.createdAt - a.createdAt);
  const render = () => {
    const firstOpen = sr.upcoming.find(o => !o.skipped);
    const until = ms => { const m = Math.round((ms - Date.now()) / 60000); return m <= 0 ? 'now' : m < 60 ? `in ${m} min` : m < 1440 ? `in ${Math.round(m / 60)} h` : `in ${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'}`; };
    app.innerHTML = `
      <div class="page-head">
        <a class="back" href="#/manager" aria-label="Back to your events"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4.5L7.5 11l6.5 6.5"></path></svg></a>
        <h1>Repeating event</h1>
      </div>
      <section class="card series-head">
        <h2>${esc(sr.name)}</h2>
        <p class="rep-line">${repeatIcon}<span>${esc(scheduleText(sr.schedule))}${sr.schedule.opensBefore ? ` · sign-ups ${sr.schedule.opensBefore >= 60 ? sr.schedule.opensBefore / 60 + ' h' : sr.schedule.opensBefore + ' min'} before` : ''}${sr.schedule.endDate ? ` · until ${dateText(Date.parse(sr.schedule.endDate + 'T12:00'))}` : ''}</span></p>
        <div class="code-box">
          <div><span>${sr.codeType === 'custom' ? 'Password' : 'Code'} — same every time</span><b class="${sr.codeType === 'custom' ? 'pw' : 'code'}">${esc(sr.code)}</b></div>
          <button class="btn small" id="srShare">Share</button>
        </div>
        <p class="field-hint">The code only works while a date is open. The rest of the time, players are told when it's next on.</p>
        ${sr.liveEventId ? '' : `<button class="btn primary block" data-open-now style="margin-bottom:10px">Open an event now</button>
        <p class="field-hint" style="margin-top:-4px">Starts one right away with this code and settings. ${isScheduledToday(sr) ? "Today's date opens early." : 'Your scheduled dates stay as they are.'}</p>`}
        <div class="row">
          <button class="btn small" id="srEdit">Edit name, days &amp; time</button>
          <button class="btn small" id="srSettings">⚙ Game settings</button>
        </div>
      </section>
      ${sr.liveEventId ? `<a class="lastcall series-live" href="#/manager/e/${sr.liveEventId}"><div><b><span class="live-pill"><span></span>Live</span> On now</b><span>Go to the event to run the games.</span></div>${chev}</a>` : ''}
      <h3 class="section-title">Next dates</h3>
      ${sr.upcoming.length ? `<ul class="ended-list date-list" aria-label="Next dates">${sr.upcoming.map(o => `
        <li class="${o.skipped ? 'skipped' : ''}">
          <span class="grow"><b>${dateText(o.startAt)} · ${new Date(o.startAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b>
            <span>${o.skipped ? 'Skipped — no game that week' : o === firstOpen && !sr.liveEventId ? `Opens ${until(o.openAt)}` : ''}</span></span>
          <button class="btn small" data-skip="${o.date}" data-on="${!o.skipped}">${o.skipped ? 'Undo' : 'Skip'}</button>
        </li>`).join('')}</ul>` : '<div class="empty">No more dates — edit the days or the end date to add some.</div>'}
      <section class="set-summary" aria-label="Game settings">
        <div class="sum-head"><div><b>Game settings</b><span>Used every time · changes apply from the next date</span></div></div>
        <div class="sum-chips">${settingsChips({ ...DEFAULTS, ...sr.settings })}</div>
      </section>
      ${past.length ? `<h3 class="section-title">Past dates</h3>
        <nav class="ended-list" aria-label="Past dates">${past.map(e => `<a class="ended-row" href="#/manager/e/${e.id}"><span class="grow"><b>${dateText(e.createdAt)}</b><span>${e.gamesPlayed} game${e.gamesPlayed === 1 ? '' : 's'} · ${e.players} player${e.players === 1 ? '' : 's'}</span></span>${chev}</a>`).join('')}</nav>` : ''}
      <button class="btn block danger" id="srStop" style="margin-top:18px">Stop repeating</button>
      <p class="muted small" style="text-align:center">Past dates stay in your events and the code is freed.</p>`;

    $('#srShare').onclick = () => shareJoin(sr.code);
    $$('[data-skip]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { sr = await mapi('POST', `${base}/skip`, { date: b.dataset.skip, skip: b.dataset.on === 'true' }); render(); }
      catch (ex) { toast(ex.message, 'warn'); b.disabled = false; }
    });
    const on = $('[data-open-now]');
    if (on) on.onclick = async () => {
      on.disabled = true;
      try { const r = await mapi('POST', `${base}/open`); location.hash = '#/manager/e/' + r.eventId; }
      catch (ex) { toast(ex.message, 'warn'); on.disabled = false; }
    };
    $('#srStop').onclick = async () => {
      if (!(await uiConfirm(`Stop repeating ${sr.name}?

No more dates will open and the code ${sr.code} is freed. Past dates stay in your events${sr.liveEventId ? ', and the one on now keeps going until it ends' : ''}.`, { ok: 'Stop repeating', danger: true }))) return;
      try { await mapi('DELETE', base); toast('Stopped repeating'); location.hash = '#/manager'; } catch (ex) { toast(ex.message, 'warn'); }
    };
    $('#srEdit').onclick = () => {
      dlg.innerHTML = `<form method="dialog">
        <div class="dlg-head"><h2>Name, days &amp; time</h2><button class="iconbtn" value="cancel" aria-label="Close">✕</button></div>
        <div class="dlg-body stack">
          <div><label for="sr_name">Event name</label><input id="sr_name" maxlength="60" value="${esc(sr.name)}"></div>
          ${repeatFields(sr.schedule)}
          <p class="field-hint">Changes apply from the next date. A date that's already open isn't changed.</p>
        </div>
        <div class="dlg-foot"><button class="btn" value="cancel">Cancel</button><button class="btn primary" id="srSave">Save</button></div>
      </form>`;
      wireSettings(dlg); wireRepeat(dlg);
      $('#srSave', dlg).onclick = async ev => {
        ev.preventDefault();
        try { sr = await mapi('PATCH', base, { name: $('#sr_name', dlg).value, schedule: readSchedule(dlg) }); dlg.close(); toast('Saved'); render(); }
        catch (ex) { toast(ex.message, 'warn'); }
      };
      dlg.showModal();
    };
    $('#srSettings').onclick = () => {
      dlg.innerHTML = `<form method="dialog">
        <div class="dlg-head"><h2>Game settings</h2><button class="iconbtn" value="cancel" aria-label="Close">✕</button></div>
        <div class="dlg-body stack"><div class="set-editor">${settingsFields({ ...DEFAULTS, ...sr.settings })}</div>
          <p class="field-hint">Used from the next date. ${sr.liveEventId ? "To change today's, use Settings on the event." : ''}</p></div>
        <div class="dlg-foot"><button class="btn" value="cancel">Cancel</button><button class="btn primary" id="srSaveSet">Save</button></div>
      </form>`;
      wireSettings(dlg);
      $('#srSaveSet', dlg).onclick = async ev => {
        ev.preventDefault();
        try { sr = await mapi('PATCH', base, { settings: readSettings(dlg) }); dlg.close(); toast('Saved for the next date'); render(); }
        catch (ex) { toast(ex.message, 'warn'); }
      };
      dlg.onclose = () => resetTheme();
      dlg.showModal();
    };
  };
  render();
}

/* ---------------- repeating events ---------------- */
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const joinAnd = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
// "Every 2 weeks on Tue & Thu · 7:00 PM"
function scheduleText(sc, { time = true } = {}) {
  const days = joinAnd(MON_FIRST.filter(d => sc.days.includes(d)).map(d => DAY_SHORT[d]));
  return (sc.everyWeeks > 1 ? `Every ${sc.everyWeeks} weeks on ${days}` : `Every ${days}`) + (time ? ` · ${hmText(sc.startTime)}` : '');
}
const dateText = ms => new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
// Next game start times for a schedule, in this browser's time zone (preview only; the server decides).
function localOccurrences(sc, count = 3) {
  const out = [];
  if (!sc.days.length || !sc.startTime || !sc.startDate) return out;
  const dn = s => { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
  const first = dn(sc.startDate), fw = Math.floor((first + 3) / 7);
  const last = sc.endDate ? dn(sc.endDate) : Infinity;
  const [h, mi] = sc.startTime.split(':').map(Number);
  for (let n = Math.max(first, dn(todayYmd())), i = 0; i < 800 && out.length < count && n <= last; i++, n++) {
    if (!sc.days.includes(((n + 4) % 7 + 7) % 7)) continue;
    if ((Math.floor((n + 3) / 7) - fw) % sc.everyWeeks) continue;
    const d = new Date(n * 864e5);
    const start = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi).getTime();
    if (start + 3 * 3600000 < Date.now()) continue;
    out.push(start);
  }
  return out;
}
function repeatFields(sc) {
  const opens = [[0, 'At start time'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [120, '2 hours before']];
  return `
    <div class="rep-grid">
      ${stepperRow('s_every', 'How often', null, sc.everyWeeks || 1, { min: 1, max: 8, less: 'More often', more: 'Less often' })}
      <div class="field"><span class="lbl" id="daysLbl">On</span>
        <div class="daychips" id="repDays" role="group" aria-labelledby="daysLbl">
          ${MON_FIRST.map(d => `<button type="button" data-d="${d}" aria-pressed="${sc.days.includes(d)}" aria-label="${DAY_LONG[d]}">${DAY_SHORT[d][0]}</button>`).join('')}
        </div>
      </div>
      <div class="two">
        <div class="field"><label for="repStart">Games start</label><input type="time" id="repStart" value="${esc(sc.startTime || '19:00')}"></div>
        <div class="field"><label for="repOpens">Sign-ups open</label>
          <select id="repOpens">${opens.map(([v, t]) => `<option value="${v}" ${v === (sc.opensBefore ?? 30) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="two">
        <div class="field"><label for="repFrom">Starting</label><input type="date" id="repFrom" value="${esc(sc.startDate || todayYmd())}"></div>
        <div class="field"><label for="repUntil">Until <span class="muted">(optional)</span></label><input type="date" id="repUntil" value="${esc(sc.endDate || '')}"></div>
      </div>
      <div class="rep-preview" id="repPreview" aria-live="polite"></div>
    </div>`;
}
function readSchedule(root) {
  return {
    days: $$('#repDays [aria-pressed=true]', root).map(b => +b.dataset.d),
    everyWeeks: +$('.stepper[data-id="s_every"]', root).dataset.val,
    startTime: $('#repStart', root).value,
    opensBefore: +$('#repOpens', root).value,
    startDate: $('#repFrom', root).value || todayYmd(),
    endDate: $('#repUntil', root).value || null
  };
}
function repeatPreview(root) {
  const sc = readSchedule(root);
  const box = $('#repPreview', root);
  if (!box) return;
  if (!sc.days.length) { box.innerHTML = 'Pick at least one day.'; return; }
  if (!sc.startTime) { box.innerHTML = 'Pick a start time.'; return; }
  const occ = localOccurrences(sc, 1)[0];
  const opens = occ ? occ - sc.opensBefore * 60000 : null;
  box.innerHTML = `<b>${esc(scheduleText(sc))}</b>. ` + (occ
    ? `First game <b>${dateText(occ)}</b>${sc.opensBefore ? ` — sign-ups open at ${new Date(opens).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.`
    : 'No dates in that range.');
}
function wireRepeat(root) {
  $$('#repDays button', root).forEach(b => b.onclick = () => { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); repeatPreview(root); });
  ['#repStart', '#repOpens', '#repFrom', '#repUntil'].forEach(id => $(id, root).addEventListener('change', () => repeatPreview(root)));
  const st = $('.stepper[data-id="s_every"]', root);
  $$('[data-step]', st).forEach(b => b.addEventListener('click', () => setTimeout(() => repeatPreview(root))));
  repeatPreview(root);
}

/* ---------------- new event page ---------------- */
async function newEventView() {
  topnav.innerHTML = `<a href="#/manager">← Your events</a>`;
  const last = store.get('nu.lastSettings');
  const saved = { ...DEFAULTS, ...(last || {}) };
  app.innerHTML = `
    <div class="page-head">
      <a class="back" href="#/manager" aria-label="Back to your events"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4.5L7.5 11l6.5 6.5"></path></svg></a>
      <h1>New event</h1>
    </div>
    <form id="newEv" class="newev" novalidate autocomplete="off">
      <div class="field">
        <label for="evname">Event name</label>
        <input id="evname" maxlength="60" placeholder="Thursday night pickup">
      </div>
      <div class="field">
        <span class="lbl" id="whenLbl">When</span>
        <div class="seg seg-full" id="whenSeg" role="group" aria-labelledby="whenLbl">
          <button type="button" data-w="now" aria-pressed="true">Right now</button>
          <button type="button" data-w="repeat" aria-pressed="false">${repeatIcon} Repeats</button>
        </div>
      </div>
      <section class="rep-panel hidden" id="repPanel" aria-label="Repeat">
        ${repeatFields({ days: [new Date().getDay()], everyWeeks: 1, startTime: '19:00', opensBefore: 30, startDate: todayYmd(), endDate: null })}
      </section>
      <div class="field">
        <span class="lbl" id="joinLbl">How players join</span>
        <div class="seg seg-full" id="codeSeg" role="group" aria-labelledby="joinLbl">
          <button type="button" data-ct="pin" aria-pressed="true">4-digit code</button>
          <button type="button" data-ct="custom" aria-pressed="false">Custom password</button>
        </div>
        <input id="customCode" class="hidden" maxlength="32" placeholder="e.g. tuesdayfooty" autocapitalize="none" aria-label="Custom password">
        <span class="field-hint" id="codeHint">A random code is made for you — share it or show the QR.</span>
      </div>

      <section class="set-summary" id="setSummary" aria-label="Game settings">
        <div class="sum-head">
          <div><b>Game settings</b><span id="sumSub">${last ? 'Same as your last event' : 'Standard settings'}</span></div>
          ${last ? '<span class="saved-pill" id="savedPill">✓ Saved</span>' : ''}
        </div>
        <div class="sum-chips" id="sumChips">${settingsChips(saved)}</div>
        <button type="button" class="set-link" id="openSet" aria-expanded="false" aria-controls="setEditor">Change settings<span aria-hidden="true">›</span></button>
      </section>

      <div id="setEditor" class="set-editor hidden">
        <div class="set-head"><h2>Game settings</h2><button type="button" class="linkbtn" id="closeSet">Done</button></div>
        ${settingsFields(saved)}
      </div>

      <p class="err" id="newErr"></p>
      <div class="startbar">
        <button class="btn primary block big" type="submit" id="startBtn">Start event</button>
        <span id="startHint">You'll get a join code and QR code to share.</span>
      </div>
    </form>`;

  const form = $('#newEv');
  wireSettings(form);
  wireRepeat(form);
  let repeating = false;
  const codeHint = () => repeating
    ? 'The same code every time, so regulars only learn it once. It only works while a date is open.'
    : ($('[data-ct="custom"]', form).getAttribute('aria-pressed') === 'true' ? 'Players type this password to join (4–32 characters).' : 'A random code is made for you — share it or show the QR.');
  $$('[data-w]', form).forEach(b => b.onclick = () => {
    repeating = b.dataset.w === 'repeat';
    $$('[data-w]', form).forEach(x => x.setAttribute('aria-pressed', x === b));
    $('#repPanel').classList.toggle('hidden', !repeating);
    $('#startBtn').textContent = repeating ? 'Create repeating event' : 'Start event';
    $('#startHint').textContent = repeating ? 'Each date opens on its own when sign-ups open.' : "You'll get a join code and QR code to share.";
    $('#codeHint').textContent = codeHint();
  });
  let edited = false;
  form.addEventListener('settingschange', () => {
    edited = true;
    $('#sumChips').innerHTML = settingsChips(readSettings(form));
  });
  const seg = $('#codeSeg');
  $$('[data-ct]', seg).forEach(b => b.onclick = () => {
    $$('[data-ct]', seg).forEach(x => x.setAttribute('aria-pressed', x === b));
    const custom = b.dataset.ct === 'custom';
    $('#customCode').classList.toggle('hidden', !custom);
    $('#codeHint').textContent = codeHint();
    if (custom) $('#customCode').focus();
  });
  const showEditor = open => {
    $('#setEditor').classList.toggle('hidden', !open);
    $('#setSummary').classList.toggle('hidden', open);
    $('#openSet').setAttribute('aria-expanded', open);
    $('#startHint').textContent = open ? 'These become your settings for next time too.' : repeating ? 'Each date opens on its own when sign-ups open.' : "You'll get a join code and QR code to share.";
    if (!open && edited) {
      $('#sumSub').textContent = 'Changed for this event';
      const pill = $('#savedPill'); if (pill) pill.remove();
    }
    (open ? $('#setEditor') : $('#setSummary')).scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  $('#openSet').onclick = () => showEditor(true);
  $('#closeSet').onclick = () => showEditor(false);

  form.onsubmit = async e => {
    e.preventDefault();
    const err = $('#newErr'); err.textContent = '';
    const name = $('#evname').value.trim();
    const custom = $('[data-ct="custom"]', form).getAttribute('aria-pressed') === 'true';
    if (!name) { err.textContent = 'Give your event a name'; $('#evname').focus(); return; }
    if (custom && $('#customCode').value.trim().length < 4) { err.textContent = 'Custom password must be 4–32 characters'; $('#customCode').focus(); return; }
    const settings = readSettings(form);
    if (repeating) {
      const schedule = readSchedule(form);
      if (!schedule.days.length) { err.textContent = 'Pick at least one day'; return; }
      if (!schedule.startTime) { err.textContent = 'Pick a start time'; $('#repStart').focus(); return; }
      const btn = $('#startBtn'); btn.disabled = true;
      try {
        const r = await mapi('POST', '/api/manager/series', { name, codeType: custom ? 'custom' : 'pin', code: $('#customCode').value, settings, schedule });
        store.set('nu.lastSettings', settings);
        if (r.liveEventId) toast("Today's game is open now");
        location.hash = '#/manager/s/' + r.id;
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      return;
    }
    const btn = $('#startBtn'); btn.disabled = true;
    try {
      const r = await mapi('POST', '/api/manager/events', { name, codeType: custom ? 'custom' : 'pin', code: $('#customCode').value, settings });
      store.set('nu.lastSettings', settings);
      location.hash = '#/manager/e/' + r.id;
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
  $('#evname').focus();
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
          const sel = app.querySelector(`.pick-start[data-gid="${gid}"]`);
          await gameAct(gid, 'start', { field: sel && sel.value !== '__other' ? sel.value : undefined });
          delete fieldChoice[gid];
          break;
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
        case 'extend': {
          const r = await mapi('POST', `${base}/extend`);
          toast('Open until ' + clockTime(r.autoCloseAt)); break;
        }
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
          if (!(await uiConfirm('End this event? Players can no longer join or sign up, and the code is freed for a new event. This can\'t be undone.', { ok: 'End event', danger: true }))) return;
          await mapi('POST', `${base}/end`); break;
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
  // Field dropdowns: pick for a waiting game, or move a game in progress. "Other…" asks for a name.
  const onFieldChange = async e => {
    const sel = e.target.closest('.field-pick');
    if (!sel) return;
    const gid = sel.dataset.gid, g = findG(gid);
    let val = sel.value;
    if (val === '__other') {
      val = (await uiPrompt(`Field name for Game ${g ? g.number : ''}:`, '', { ok: 'Use this field' }) || '').trim().slice(0, 24);
      if (!val) { render(); return; }
    }
    try {
      if (sel.classList.contains('pick-move')) { await gameAct(gid, 'field', { field: val }); toast(`Game ${g.number} is on ${val}`); }
      else { fieldChoice[gid] = val; render(); }
    } catch (ex) { toast(ex.message, 'warn'); render(); }
  };
  app.addEventListener('change', onFieldChange);
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
        <div class="set-editor">${settingsFields(s.settings)}</div>
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

  view = { cleanup() { es.close(); render.dispose(); app.removeEventListener('click', onClick); app.removeEventListener('change', onFieldChange); app.removeEventListener('submit', onSubmit); if (dlg.open) dlg.close(); live = null; } };
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
        <p class="muted" style="margin:0 0 4px">${s.autoClosed ? 'This event closed on its own at its end time and is saved in your events.' : 'This event is over and saved in your events.'}</p>
        <div class="ended-stats">
          <div><b>${s.history.length}</b><span>game${s.history.length === 1 ? '' : 's'} played</span></div>
          <div><b>${players}</b><span>player${players === 1 ? '' : 's'}</span></div>
        </div>
        <div class="stack">
          ${s.seriesId ? `<a class="btn block" href="#/manager/s/${s.seriesId}">${repeatIcon} See the next dates</a>` : ''}
          <a class="btn primary block" href="#/manager">← Back to all events</a>
          <a class="btn block" href="#/manager/new">+ Start a new event</a>
        </div>
      </section>
      <details class="more card">
        <summary>More options</summary>
        <p class="muted small">Its code is free for a new event. Deleting removes this recap from your events for good.</p>
        <div class="row">
          <button class="btn small danger" data-act="delete-event">Delete event</button>
        </div>
      </details>`;
    return;
  }

  const names = fieldNamesOf(st);
  const busyFields = new Set(playing.map(g => g.field));
  const firstFree = names.find(n => !busyFields.has(n)) || names[0];
  const fieldSelect = (cls, gid, current, label) => {
    const opts = [...new Set([...names, current].filter(Boolean))];
    return `<select class="field-pick ${cls}" data-gid="${gid}" aria-label="${label}">${opts.map(n => `<option value="${esc(n)}" ${n === current ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__other">Other…</option></select>`;
  };
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
        ${fieldSelect('pick-move', g.id, g.field || names[0], `Field for Game ${g.number}`)}
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
    const pick = fieldChoice[g.id] || firstFree;
    const footer = `<div class="start-group">${fieldSelect('pick-start', g.id, pick, `Field for Game ${g.number}`)}<button class="btn small primary" data-act="start" data-gid="${g.id}">▶ Start game</button></div>
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
            ${s.seriesId ? `<a class="btn small" href="#/manager/s/${s.seriesId}">${repeatIcon} Repeats — same code</a>` : `<button class="btn small" data-act="newpin">New code</button>
            <button class="btn small" data-act="custompw">Set password</button>`}
          </div>
        </div>
        ${qr ? `<div class="qr" aria-label="QR code to join">${qr}</div>` : ''}
      </div>
      ${s.autoCloseAt ? `<div class="autoclose">
        <span>⏱ Closes on its own at <b>${clockTime(s.autoCloseAt)}</b>${s.autoCloseAt - s.serverNow < 7200000 ? ` <span class="soon">(${untilText(s.autoCloseAt - s.serverNow)})</span>` : ''}</span>
        <button class="linkbtn" data-act="extend">Keep open 1 more hour</button>
      </div>` : ''}
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
          <span class="nm">${esc(p.name)}${p.guest ? ` <span class="muted small">(${p.addedBy ? 'friend of ' + esc(p.addedBy) : 'walk-up'})</span>` : ''}</span>
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
  // Logo: organizer screens go to the organizer home (your events); player screens go to the join page.
  const brand = document.querySelector('.brand');
  if (brand) {
    const org = h.startsWith('/manager');
    const lid = store.get('nu.lastEvent');
    brand.setAttribute('href', org ? '#/manager' : (lid && playerSession(lid) ? '#/e/' + lid : '#/'));
    brand.setAttribute('aria-label', org ? 'Next Up — your events' : 'Next Up home');
  }
  if ((m = h.match(/^\/e\/([\w-]+)$/))) return playerView(m[1]);
  // Signed in to an event? The home page is that event's board (one event per sign-in).
  if (h === '/') {
    const lid = store.get('nu.lastEvent');
    if (lid && playerSession(lid)) { history.replaceState(null, '', '#/e/' + lid); return playerView(lid); }
  }
  if ((m = h.match(/^\/join\/(.+)$/))) return homeView(decodeURIComponent(m[1]));
  if (h === '/install') return installView();
  if ((m = h.match(/^\/install\/(.+)$/))) return installView(decodeURIComponent(m[1]));
  if ((m = h.match(/^\/manager\/e\/([\w-]+)$/))) return mgrSession() ? managerEventView(m[1]) : managerAuthView();
  if (h === '/manager') return mgrSession() ? managerHomeView() : managerAuthView();
  if ((m = h.match(/^\/manager\/s\/([\w-]+)$/))) return mgrSession() ? seriesPageView(m[1]) : managerAuthView();
  if (h === '/manager/new') return mgrSession() ? newEventView() : managerAuthView();
  if (h === '/manager/account') return mgrSession() ? accountView() : managerAuthView();
  if (h === '/manager/forgot') return managerAuthView('forgot-pw');
  if ((m = h.match(/^\/reset\/([\w-]+)$/))) return resetView(m[1]);
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
