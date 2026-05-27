// Basic Service Worker
const CACHE_NAME = 'gestion-location-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through fetch
  event.respondWith(fetch(event.request));
});
