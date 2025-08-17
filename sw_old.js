// Essential Radio — Service Worker (dynamic-safe)
// v2 — avoids caching now playing JSON/artwork/streams

const STATIC_CACHE = 'essential-radio-static-v2';
const STATIC_ASSETS = [
  '/', '/index.html',
  // Add your core CSS/JS/fonts here for fast startup, e.g.:
  // '/assets/app.css',
  // '/assets/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Don't touch non-GET requests
  if (req.method !== 'GET') return;

  // 2) Never cache audio streams (and Range requests)
  const isAudio = /\.(m3u8|aac|mp3|ogg)$/i.test(url.pathname);
  if (req.headers.get('range') || isAudio) return;

  // 3) Bypass cache for dynamic now-playing endpoints & JSON
  const isJSON = req.headers.get('accept')?.includes('application/json');
  const looksDynamicPath =
    /now|np|current|metadata|artwork|cover|track/i.test(url.pathname);

  if (isJSON || looksDynamicPath) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(req)));
    return;
  }

  // 4) HTML navigations → network-first (so updates aren't stuck)
  const isNav = req.mode === 'navigate' || req.destination === 'document';
  if (isNav) {
    event.respondWith(
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        return resp;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 5) Known static assets → cache-first
  const isStatic = STATIC_ASSETS.some((p) => url.pathname === p || url.pathname.endsWith(p));
  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        return resp;
      }))
    );
    return;
  }

  // 6) Everything else → try cache, then network
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
