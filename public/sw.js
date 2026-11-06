/* Next Up service worker: shows push notifications and opens the board when tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Next Up', body: event.data && event.data.text() }; }
  const title = data.title || 'Next Up';
  // "Buzzer" alerts (you're on deck / you're on / your game started) stay on screen until tapped
  // and use a long, pager-style vibration. Phones that ignore custom vibration still buzz with
  // their normal notification pattern, and the alert is re-sent until the player answers.
  const big = !!data.big;
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || 'nextup',
    renotify: true,
    requireInteraction: big,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: big ? [900, 150, 900, 150, 900, 150, 900, 400, 1500] : [200, 100, 200],
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(url); } catch {} }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
