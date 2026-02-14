// Empty Service Worker file to satisfy browser checks and prevent 404 errors.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  return self.clients.claim();
});
