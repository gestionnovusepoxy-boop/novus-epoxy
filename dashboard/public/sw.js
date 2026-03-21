// Service Worker — Novus Epoxy Admin
// Stratégie: cache-first pour les assets statiques, network-only pour l'API

const CACHE_NAME = 'novus-admin-v1';

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ne jamais mettre en cache les appels API
  if (url.hostname === 'novusepoxy.ca' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Stale-while-revalidate pour les assets statiques
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetched = fetch(event.request).then(res => {
          if (res.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, res.clone()));
          }
          return res;
        });
        return cached || fetched;
      })
    );
  }
});
