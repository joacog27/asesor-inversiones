// Service worker: la app funciona offline con los últimos datos guardados.
// - Archivos de la app: cache-first (se actualiza en segundo plano).
// - APIs de mercado: las maneja la app con su propia caché (IndexedDB).
const VERSION = 'asesor-v2.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './vendor/chart.umd.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app.js',
  './js/config.js',
  './js/storage.js',
  './js/data.js',
  './js/symbols.js',
  './js/portfolio.js',
  './js/advisor.js',
  './js/ui.js',
  './js/views/onboarding.js',
  './js/views/advisor.js',
  './js/views/market.js',
  './js/views/portfolio.js',
  './js/views/settings.js',
  './js/views/txform.js',
  './js/views/goals.js',
  './js/views/alerts.js',
  './js/simulator.js',
  './js/notify.js',
  './js/sync.js',
  './js/sync-engine.js',
  './js/sync-merge.js',
];
// Firebase (vendor/firebase-*.bundle.js) se cachea recién cuando se usa.

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // APIs externas: directo a la red
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      return (await network) || (await cache.match('./index.html')) || Response.error();
    }),
  );
});

// Al tocar una notificación, abrir (o enfocar) la app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './#/asesor', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope)) { c.focus(); return c.navigate ? c.navigate(target) : null; }
      }
      return self.clients.openWindow(target);
    }),
  );
});
