// Sube este número cada vez que toques index.html, o el móvil seguirá
// sirviendo la versión antigua desde la caché.
const CACHE = 'repostajes-v2';
const ESTATICOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ESTATICOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // Solo gestionamos GET del propio sitio: las llamadas al Apps Script van directas.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Red primero, caché como red de seguridad cuando no hay cobertura.
  e.respondWith(
    fetch(req)
      .then(res => {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});