// Sube este número si quieres forzar el borrado de la caché en los móviles.
// Para un cambio normal en index.html no hace falta: la estrategia es "red primero".
const CACHE = 'repostajes-v7';

// Si mueves o renombras alguno de estos archivos, acuérdate de cambiarlo aquí.
const ESTATICOS = [
  './',
  './index.html',
  './manifest.json',
  './img/icon-192.png',
  './img/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Uno a uno y sin rendirse: cache.addAll() es atómico, así que un solo 404
    // (por ejemplo tras mover un icono) tumbaba la instalación entera del service
    // worker y la app se quedaba sin funcionamiento offline, sin decir nada.
    const fallos = [];
    await Promise.all(ESTATICOS.map(ruta =>
      cache.add(ruta).catch(err => fallos.push(ruta + ': ' + err.message))
    ));
    if (fallos.length) console.warn('[sw] no se pudieron cachear:', fallos);
    await self.skipWaiting();
  })());
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