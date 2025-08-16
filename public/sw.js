const STATIC_CACHE = 'essential-radio-static-v2';
const STATIC_ASSETS = ['/', '/index.html'];

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

  if (url.hostname.endsWith('mixcloud.com')) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => fetch(req)));
    return;
  }

  if (req.method !== 'GET') return;

  const isAudio = /\.(m3u8|aac|mp3|ogg)$/i.test(url.pathname);
  if (req.headers.get('range') || isAudio) return;

  const isJSON = req.headers.get('accept')?.includes('application/json');
  const looksDynamic = /now|np|current|metadata|artwork|cover|track/i.test(url.pathname);
  if (isJSON || looksDynamic) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(req)));
    return;
  }

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

  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
