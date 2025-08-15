// Essential Radio — Service Worker (dynamic-safe)
// v3 — ignore cross-origin; never intercept /api/metadata; safe static caching only

const STATIC_CACHE = 'essential-radio-static-v3'; // bump to force update
const STATIC_ASSETS = [
  '/', '/index.html',
  // Add your core CSS/JS/fonts here for fast startup, e.g.:
  // '/assets/app.css',
  // '/assets/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC_ASSETS)).catch(() => {})
  );
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

  // NEW: Only handle SAME-ORIGIN requests. Do not touch GitHub or any third party.
  if (url.origin !== self.location.origin) return;

  // Bypass Mixcloud API and widgets entirely (same-origin guard above keeps cross-origin out anyway)
  if (url.hostname.endsWith("mixcloud.com")) {
    event.respondWith(fetch(req, { cache: "no-store" }).catch(() => fetch(req)));
    return;
  }

  // 1) Don't touch non-GET requests
  if (req.method !== 'GET') return;

  // 2) Never cache audio streams (and Range requests)
  const isAudio = /\.(m3u8|aac|mp3|ogg)$/i.test(url.pathname);
  if (req.headers.get('range') || isAudio) return;

  // NEW: Never intercept your metadata API (let it hit the network fresh)
  if (url.pathname.startsWith('/api/metadata')) return;

  // 3) Bypass cache for dynamic now-playing endpoints & JSON-like paths (same-origin only)
  const accept = req.headers.get('accept') || '';
  const isJSON = accept.includes('application/json') || url.pathname.endsWith('.json');

  const looksDynamicPath =
    /now|np|current|metadata|artwork|cover|track/i.test(url.pathname) ||
    /latestTrack\.json|playout_log_rolling\.json/i.test(url.pathname); // NEW guard

  if (isJSON || looksDynamicPath) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(req)));
    return;
  }

  // 4) HTML navigations → network-first (so updates aren't stuck)
  const isNav = req.mode === 'navigate' || req.destination === 'document';
  if (isNav) {
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        }
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
        if (resp && resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      }))
    );
    return;
  }

  // 6) Everything else → try cache, then network (same-origin only)
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
