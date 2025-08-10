
// Essential Radio Service Worker (v3)
const CACHE = 'essential-radio-v3';
const ASSETS = [
  '/', '/index.html',
  '/manifest.json',
  '/icon-192-yellow.png', '/icon-512-yellow.png', '/icon-180-yellow.png'
  // Add your CSS/JS here for faster startup, e.g. '/styles.css', '/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : Promise.resolve())))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return resp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
