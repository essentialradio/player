// Kill-switch Service Worker
// Purpose: immediately unregister this SW, clear caches, and reload clients.
// Use case: quickly disable PWA/app mode across all users.

self.addEventListener('install', (event) => {
  // Take control ASAP
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      // 1) Nuke all caches
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      // 2) Unregister this service worker
      await self.registration.unregister();
      // 3) Force open pages to reload without a SW
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        // navigate to same URL to refresh
        client.navigate(client.url);
      }
    } catch (e) {
      // noop
    }
  })());
  // Claim control of uncontrolled clients immediately
  self.clients.claim();
});

// 4) No fetch handling: everything falls through to the network
self.addEventListener('fetch', () => {});