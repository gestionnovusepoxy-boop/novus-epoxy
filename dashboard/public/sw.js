// Service Worker — Novus Epoxy PWA
// Cache uniquement les assets statiques, jamais les pages HTML ni les chunks JS

const CACHE_NAME = 'novus-v3';
const STATIC_ASSETS = ['/manifest.json', '/icon-192.png', '/apple-touch-icon.png'];

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

  // Ne rien intercepter si: autre domaine, non-GET, API, auth, dashboard, _next
  if (
    url.hostname !== self.location.hostname ||
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/dashboard/') ||
    url.pathname.startsWith('/_next/')
  ) {
    return;
  }

  // Cache-first uniquement pour les assets statiques connus
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
