// ==========================================================
//  COLA OFFLINE (IndexedDB)
//
//  Sin cobertura el repostaje se guarda aquí, foto incluida, y se
//  sube solo en cuanto vuelve la conexión.
// ==========================================================

import { BD } from './config.js';
import { api } from './api.js';
import { info } from './dom.js';
import { cargarDashboard } from './datos.js';

let pendientes = 0;
const suscriptores = [];

export const cuantosPendientes = () => pendientes;

/** Avisa cada vez que cambia la cuenta de repostajes sin subir. */
export function alCambiarPendientes(fn) { suscriptores.push(fn); }
const avisar = () => suscriptores.forEach(fn => fn(pendientes));

function abrirBD() {
  return new Promise((ok, mal) => {
    if (!window.indexedDB) return mal(new Error('sin IndexedDB'));
    const req = indexedDB.open(BD.nombre, BD.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BD.almacen)) {
        db.createObjectStore(BD.almacen, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}

async function conAlmacen(modo, fn) {
  const db = await abrirBD();
  return new Promise((ok, mal) => {
    const tx = db.transaction(BD.almacen, modo);
    const req = fn(tx.objectStore(BD.almacen));
    tx.oncomplete = () => ok(req && req.result);
    tx.onerror = () => mal(tx.error);
  });
}

export const encolar = p => conAlmacen('readwrite', s => s.add(Object.assign({ creado: Date.now() }, p)));
export const listarCola = () => conAlmacen('readonly', s => s.getAll());
export const sacarDeCola = id => conAlmacen('readwrite', s => s.delete(id));

export async function refrescarPendientes() {
  try {
    const cola = await listarCola();
    pendientes = (cola || []).length;
  } catch (err) {
    pendientes = 0;
  }
  avisar();
  return pendientes;
}

/** Sube todo lo que espera en la cola. Se llama al arrancar y al volver la red. */
export async function sincronizarCola(silencioso) {
  if (!navigator.onLine) return;
  let cola = [];
  try { cola = (await listarCola()) || []; } catch (err) { return; }
  if (!cola.length) return;

  if (!silencioso) info('Subiendo ' + cola.length + ' repostaje(s) pendiente(s)...');
  let subidos = 0;

  for (const p of cola) {
    try {
      let recibo = p.recibo;
      if (!recibo && p.fotoB64) {
        const sub = await api({ action: 'subir', imagenBase64: p.fotoB64, mimeType: p.fotoMime || 'image/jpeg' });
        if (sub.ok) recibo = { fileId: sub.fileId, url: sub.url };
      }
      const r = await api({ action: 'guardar', datos: Object.assign({}, p.datos, { recibo }) });
      if (!r.ok) throw new Error(r.error);
      await sacarDeCola(p.id);
      subidos++;
    } catch (err) {
      break;      // si falla uno, lo dejamos para el próximo intento
    }
  }

  await refrescarPendientes();
  if (subidos) {
    info('✅ ' + subidos + ' repostaje(s) pendiente(s) subido(s).', 'ok');
    cargarDashboard();
  }
}

/** Vigila la conexión. Lo llama app.js al arrancar. */
export function vigilarConexion() {
  window.addEventListener('online',  () => { refrescarPendientes(); sincronizarCola(); });
  window.addEventListener('offline', refrescarPendientes);
}
