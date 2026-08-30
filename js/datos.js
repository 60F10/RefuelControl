// ==========================================================
//  DATOS — de dónde salen las cifras que se pintan
//
//  Guarda la última respuesta del backend y la reparte. Quien pinta
//  no llama a la red: pide los datos aquí y se suscribe a los cambios.
// ==========================================================

import { apiGet } from './api.js';
import { info } from './dom.js';
import { agregados } from './calculo.js';

const VACIO = { registros: [], estaciones: [], ubicaciones: [], depositos: null };

let DATOS = VACIO;
let MODO = 'real';                 // 'real' (ventanas medidas) o 'coche'
let ultimaCarga = 0;               // cuándo se trajeron los datos por última vez
let promesaCarga = null;           // recarga en curso

const suscriptores = [];

/** Se llama cada vez que los datos cambian: al recargar y al quitar un ticket. */
export function alCambiarDatos(fn) { suscriptores.push(fn); }
const avisar = () => suscriptores.forEach(fn => fn());

export const datos = () => DATOS;
export const registros = () => DATOS.registros || [];
export const modo = () => MODO;
export const cuandoSeCargo = () => ultimaCarga;

export function setModo(m) { MODO = m; }

export function olvidarDatos() {
  DATOS = VACIO;
  ultimaCarga = 0;
}

/** Los agregados del modo activo. Aquí se decide el modo; el cálculo no lo sabe. */
export const agregadosActuales = () => agregados(registros(), MODO);

/** El odómetro más alto registrado, que es el suelo de los KM de un repostaje nuevo. */
export function maximoKm() {
  const kms = registros().map(r => r.kmTotales).filter(k => k);
  return kms.length ? Math.max.apply(null, kms) : null;
}

/**
 * Las recargas se ponen en fila en vez de solaparse. Engancharse a la que ya
 * está en marcha sería más rápido, pero después de un borrado devolvería la
 * respuesta que salió ANTES de borrar: justo el dato viejo que se quería evitar.
 */
export function cargarDashboard() {
  const anterior = promesaCarga || Promise.resolve();
  const mia = anterior.catch(() => {}).then(() => traerDashboard());
  promesaCarga = mia;
  mia.catch(() => {}).then(() => { if (promesaCarga === mia) promesaCarga = null; });
  return mia;
}

async function traerDashboard() {
  try {
    const data = await apiGet('action=dashboard');
    if (!data.ok) { info('Dashboard: ' + (data.error || 'sin respuesta'), 'aviso'); return false; }
    DATOS = data;
    ultimaCarga = Date.now();
    avisar();
    return true;
  } catch (err) {
    if (!err.noAutorizado) info('No se pudo cargar el dashboard: ' + err.message, 'aviso');
    return false;
  }
}

/** Borrado optimista: la tarjeta desaparece en cuanto el servidor dice que sí. */
export function quitarTicket(id) {
  DATOS = Object.assign({}, DATOS, { registros: registros().filter(r => r.id !== id) });
  avisar();
}

/** Estaciones nuevas que llegan con el análisis de un ticket. */
export function apuntarUbicaciones(ubicaciones) {
  if (!ubicaciones) return;
  DATOS = Object.assign({}, DATOS, { ubicaciones });
}
