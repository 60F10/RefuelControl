// ==========================================================
//  API — la única puerta al backend
//
//  El front habla solo con /api/repostaje. La función de Netlify le
//  añade la URL del Apps Script y el token, que no están en el repo.
//  Ninguna otra parte de la app debe hacer fetch a Google.
// ==========================================================

import { API, CLAVE_CODIGO } from './config.js';

// El código de acceso viaja en la cabecera `X-Codigo` de cada petición: quien no
// lo lleve recibe un 401 de la función de Netlify y no llega a ver ni un dato.
// El valor bueno vive en la variable de entorno APP_PIN, nunca aquí.
let CODIGO = '';
try { CODIGO = localStorage.getItem(CLAVE_CODIGO) || ''; } catch (err) { CODIGO = ''; }

export const codigo = () => CODIGO;

export function guardarCodigo(valor) {
  CODIGO = valor;
  try {
    if (valor) localStorage.setItem(CLAVE_CODIGO, valor);
    else localStorage.removeItem(CLAVE_CODIGO);
  } catch (err) { /* Safari en privado: se usará solo durante esta sesión */ }
}

// Quién quiere enterarse de que el código dejó de valer. Con un aviso en vez de
// llamar directamente a la pantalla de bloqueo se evita que api y bloqueo se
// importen el uno al otro.
let avisarNoAutorizado = () => {};
export function alPerderCodigo(fn) { avisarNoAutorizado = fn; }

// Cuánto se espera a la API antes de darla por muerta. Sin esto, una wifi que no
// navega deja la petición colgada para siempre: el `fetch` no falla, así que la
// app se queda «pescando» y ni el indicador de refresco se cierra.
const ESPERA_LECTURA = 12000;
const ESPERA_ESCRITURA = 25000;   // guardar dispara un recálculo, tarda más

/** AbortSignal.timeout() no está en todos los Safari; esto sí. */
function conReloj(ms) {
  const corta = new AbortController();
  const reloj = setTimeout(() => corta.abort(), ms);
  return { signal: corta.signal, listo: () => clearTimeout(reloj) };
}

/** Distingue «la red tardó demasiado» de cualquier otro fallo. */
function errorDeEspera(err, ms) {
  if (err && err.name === 'AbortError') {
    const e = new Error('El servidor no contestó en ' + Math.round(ms / 1000) + ' s. ' +
                        'Puede que estés conectado a una red sin salida a internet.');
    e.sinRespuesta = true;
    return e;
  }
  return err;
}

/** La API siempre responde JSON. Si llega otra cosa, explicamos por qué. */
export async function leerJSON(res) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch (err) {
    if (location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      throw new Error('Estás abriendo la app en local. /api solo existe cuando está publicada en Netlify, ' +
                      'así que el dashboard no puede cargar desde aquí.');
    }
    throw new Error('La API no devolvió JSON (HTTP ' + res.status + '): ' + txt.slice(0, 120));
  }
}

/**
 * Un 401 del proxy significa que el código de acceso no vale. Se distingue del
 * resto de errores para no meter el repostaje en la cola offline por error: el
 * servidor está perfectamente, lo que falla es la llave.
 */
export function errorDeCodigo(mensaje) {
  const err = new Error(mensaje || 'El código de acceso no vale.');
  err.noAutorizado = true;
  return err;
}

async function responder(res) {
  if (res.status === 401) {
    avisarNoAutorizado('El código ya no vale. Vuelve a meterlo.');
    throw errorDeCodigo();
  }
  return leerJSON(res);
}

/** Lectura. El sufijo `_` es anticaché: sin él Google puede servir datos viejos. */
export async function apiGet(consulta) {
  const reloj = conReloj(ESPERA_LECTURA);
  try {
    const res = await fetch(API + '?' + consulta + '&_=' + Date.now(), {
      cache: 'no-store',
      signal: reloj.signal,
      headers: { 'X-Codigo': CODIGO, 'Cache-Control': 'no-cache' }
    });
    return await responder(res);
  } catch (err) {
    throw errorDeEspera(err, ESPERA_LECTURA);
  } finally {
    reloj.listo();
  }
}

/** Escritura. */
export async function api(payload) {
  const reloj = conReloj(ESPERA_ESCRITURA);
  try {
    const res = await fetch(API, {
      method: 'POST',
      signal: reloj.signal,
      headers: { 'Content-Type': 'application/json', 'X-Codigo': CODIGO },
      body: JSON.stringify(payload)
    });
    return await responder(res);
  } catch (err) {
    throw errorDeEspera(err, ESPERA_ESCRITURA);
  } finally {
    reloj.listo();
  }
}

/**
 * Comprueba un código sin guardarlo todavía. Devuelve true si vale, false si el
 * proxy lo rechaza; lanza si no hubo forma de preguntar.
 */
export async function comprobarCodigo(valor) {
  const reloj = conReloj(ESPERA_LECTURA);
  try {
    const res = await fetch(API + '?action=comprobar&_=' + Date.now(), {
      cache: 'no-store',
      signal: reloj.signal,
      headers: { 'X-Codigo': valor }
    });
    if (res.status === 401) return false;
    const d = await leerJSON(res);
    if (!d.ok) throw new Error(d.error || 'sin respuesta');
    return true;
  } catch (err) {
    throw errorDeEspera(err, ESPERA_LECTURA);
  } finally {
    reloj.listo();
  }
}
