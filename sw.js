// Sube este número si quieres forzar el borrado de la caché en los móviles.
// Para un cambio normal en index.html no hace falta: la estrategia es "red primero".
const CACHE = 'repostajes-v9';

// Si mueves, renombras o añades alguno de estos archivos, acuérdate de cambiarlo
// aquí: sin cobertura, lo que no esté en esta lista no existe. `test/rutas.test.js`
// comprueba que todo lo que el front importa está en la lista.
const ESTATICOS = [
  './',
  './index.html',
  './manifest.json',
  './css/estilos.css',
  './js/app.js',
  './js/api.js',
  './js/bloqueo.js',
  './js/calculo.js',
  './js/config.js',
  './js/datos.js',
  './js/dom.js',
  './js/formato.js',
  './js/foto.js',
  './js/navegacion.js',
  './js/offline.js',
  './js/refresco.js',
  './js/servicio.js',
  './js/ubicacion.js',
  './js/validacion.js',
  './js/ui/graficos.js',
  './js/ui/repostar.js',
  './js/ui/depositos.js',
  './js/ui/resumen.js',
  './js/ui/consumos.js',
  './js/ui/estaciones.js',
  './js/ui/historial.js',
  './js/ui/curiosidades.js',
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

// Cuánto se espera a la red antes de tirar de la caché. Un `fetch` no falla
// cuando estás conectado a una wifi que no navega: se queda colgado, y con él
// la app entera. Por eso hay un tiempo límite y no solo un `catch`.
const ESPERA_RED = 3000;

/**
 * Red primero, pero con reloj: si en ESPERA_RED no ha contestado, se sirve lo
 * que haya en caché y la app arranca igual. Con el móvil ya en modo avión ni se
 * intenta. Sigue siendo red primero, así que un despliegue nuevo se ve al
 * momento; lo que cambia es que una red muerta ya no cuelga nada.
 */
async function conReloj(req) {
  const cache = await caches.open(CACHE);

  if (!self.navigator.onLine) {
    const guardada = await cache.match(req);
    if (guardada) return guardada;
  }

  const corta = new AbortController();
  const reloj = setTimeout(() => corta.abort(), ESPERA_RED);

  try {
    const res = await fetch(req, { signal: corta.signal });
    clearTimeout(reloj);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    clearTimeout(reloj);
    const guardada = await cache.match(req);
    if (guardada) return guardada;
    if (req.mode === 'navigate') {
      const inicio = await cache.match('./index.html');
      if (inicio) return inicio;
    }
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // Fuera del alcance del service worker: otros dominios, escrituras y la API.
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  e.respondWith(conReloj(req));
});