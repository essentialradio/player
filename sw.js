// Essential Radio — Service Worker (dynamic-safe)
// v4 — stricter freshness for HTML, zero risk for dynamic endpoints, same-origin only

const STATIC_CACHE = 'essential-radio-static-v4'; // bump to force update
const STATIC_ASSETS = [
  // Only truly static, versioned files should go here (e.g., hashed bundles).
  // Do NOT include '/' or '/index.html' to avoid stale shells.
  // '/assets/app.12345.js',
  // '/assets/app.12345.css',
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

// Optional control from the page
self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data) return;
  if (data && data.type === 'ER_CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle SAME-ORIGIN requests. Never touch third-party (iTunes, CDNs, etc.).
  if (url.origin !== self.location.origin) return;

  // Don't touch non-GET
  if (req.method !== 'GET') return;

  // Never cache audio streams or Range requests
  const isAudio = /\.(m3u8|aac|mp3|ogg)$/i.test(url.pathname);
  if (req.headers.get('range') || isAudio) return;

  // Never intercept your metadata/dynamic JSON or artwork endpoints
  const accept = req.headers.get('accept') || '';
  const isJSON = accept.includes('application/json') || url.pathname.endsWith('.json');
  const looksDynamicPath =
    /now|np|current|metadata|artwork|cover|track/i.test(url.pathname) ||
    /latestTrack\.json|playout_log_rolling\.json/i.test(url.pathname);

  if (isJSON || looksDynamicPath) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(req)));
    return;
  }

  // HTML navigations → network-first with cache:'reload' to force revalidation
  const isNav = req.mode === 'navigate' || req.destination === 'document';
  if (isNav) {
    event.respondWith(
      fetch(new Request(req, { cache: 'reload' })).then((resp) => {
        if (resp && resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Known static assets → cache-first
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

  // Everything else (same-origin) → try cache, then network
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});