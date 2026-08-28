// Sube este número si quieres forzar el borrado de la caché en los móviles.
// Para un cambio normal en index.html no hace falta: la estrategia es "red primero".
const CACHE = 'repostajes-v3';
const ESTATICOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ESTATICOS)).then(() => self.skipWaiting())
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
  const url = new URL(req.url);

  // Fuera del alcance del service worker: otros dominios, escrituras y la API.
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

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