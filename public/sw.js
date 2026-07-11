// Service Worker — cache de l'app shell pour un fonctionnement hors-ligne.
// Les données (Sheets/Agenda) ne sont jamais mises en cache ici : elles
// passent par des API authentifiées et sont gérées côté app (offlineCache).
const CACHE_NAME = 'gestion-location-v3';

// Pré-cache minimal ; les assets hashés (index-*.js/css) sont ajoutés au vol.
const CORE_ASSETS = ['/', '/index.html', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // On ne gère que les ressources de l'app (même origine). Les appels /api/*
  // (proxy Google du serveur) passent directement au réseau : les mettre en
  // cache ici servirait des données périmées (le cache de données vit dans
  // offlineCache, côté app).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations : réseau d'abord, repli sur l'app shell en cache hors-ligne.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Assets statiques (JS/CSS/images/manifest) : cache d'abord, sinon réseau
  // puis mise en cache — les bundles sont hashés donc sûrs à conserver.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
