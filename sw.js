// Essential Radio — Service Worker (dynamic-safe)
// v4 — stricter dynamic bypass for NP/Recent; same‑origin only

const STATIC_CACHE = 'essential-radio-static-v4'; // bump to force update
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

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

// Treat these as *always dynamic* — never serve from cache.
function isDynamicPath(pathname) {
  // Common API endpoints
  if (pathname.startsWith('/api/latestTrack')) return true;
  if (pathname.startsWith('/api/metadata')) return true;

  // Player JSON/HTML that changes frequently
  if (pathname.startsWith('/player/recently-played')) return true; // .html or .json
  if (pathname.startsWith('/player/latestTrack.json')) return true;
  if (pathname.startsWith('/player/playout_log_rolling.json')) return true;

  // Generic guard: any JSON under /player/ that looks like live data
  if (pathname.startsWith('/player/') && pathname.endsWith('.json')) return true;

  // Heuristic catch‑all for live metadata/artwork/track paths
  if (/(now|np|current|metadata|artwork|cover|track)/i.test(pathname)) return true;

  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle SAME-ORIGIN requests
  if (!isSameOrigin(url)) return;

  // 1) Don't touch non-GET requests
  if (req.method !== 'GET') return;

  // 2) Never cache audio streams (and Range requests)
  const isAudio = /\.(m3u8|aac|mp3|ogg)$/i.test(url.pathname);
  if (req.headers.get('range') || isAudio) return;

  // 3) Always bypass cache for dynamic endpoints
  if (isDynamicPath(url.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => caches.match(req))
    );
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
