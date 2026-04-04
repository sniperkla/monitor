const CACHE_NAME = 'webtop-monitor-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip ALL non-HTTP(S) URLs first — blob:, data:, chrome-extension:, etc.
  // Three.js GLTFLoader creates blob: object URLs for embedded GLB textures;
  // Service workers must NEVER intercept these or the texture load will fail.
  const url = event.request.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // Skip external requests (api calls, external images, fonts, socket.io)
  if (!url.startsWith(self.location.origin)) {
    return;
  }

  // Network First Strategy for everything else - ensure latest version on push
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Cache new version
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request);
      })
  );
});
