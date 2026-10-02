// Service worker: app-schil offline beschikbaar, weerdata altijd eerst vers van het netwerk.
const CACHE = 'winterwacht-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'lib/stats.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Data en API's: netwerk eerst, cache als terugval (offline)
  if (url.origin !== location.origin || url.pathname.includes('/data/') || url.pathname.endsWith('config.json')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }
  // App-schil: netwerk eerst zodat updates direct doorkomen, anders cache
  e.respondWith(
    fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});
