/**
 * Proxy entre la PWA y el Apps Script.
 *
 * La URL del Apps Script y los dos secretos viven aquí, en variables de entorno
 * de Netlify, así que nunca llegan al navegador ni al repositorio.
 *
 * Variables de entorno necesarias (Netlify > Site configuration > Environment variables):
 *   GOOGLE_SCRIPT_URL  -> https://script.google.com/macros/s/AKfy.../exec
 *   SHARED_TOKEN       -> el mismo valor que en las propiedades del Apps Script
 *   APP_PIN            -> el código de acceso que se teclea en la app
 *
 * El código de acceso viaja en la cabecera `X-Codigo` de cada petición. Sin él
 * la función responde 401 y ni siquiera llama al Apps Script, así que el
 * endpoint deja de estar abierto a cualquiera que dé con la URL.
 */

const crypto = require('crypto');

const URL_SCRIPT = process.env.GOOGLE_SCRIPT_URL;
const TOKEN = process.env.SHARED_TOKEN;
const CODIGO = process.env.APP_PIN;

const respuesta = (status, obj) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  },
  body: JSON.stringify(obj)
});

/** Comparación en tiempo constante: dos códigos distintos tardan lo mismo. */
function mismoCodigo(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const esperar = ms => new Promise(ok => setTimeout(ok, ms));

/**
 * Netlify mata la función a los 10 s y lo que devuelve entonces no es nuestro
 * JSON, así que la app se quedaba con un «no devolvió JSON» que no explicaba
 * nada. Con un reloj propio un segundo por debajo, el corte lo damos nosotros y
 * sale por la puerta buena, con un mensaje que dice qué pasó y cuánto tardó.
 */
const ESPERA_SCRIPT = 9000;

async function pedirAlScript(url, opciones) {
  const corta = new AbortController();
  const reloj = setTimeout(() => corta.abort(), ESPERA_SCRIPT);
  const arranque = Date.now();
  try {
    const r = await fetch(url, Object.assign({ signal: corta.signal }, opciones));
    return { texto: await r.text(), status: r.status, ms: Date.now() - arranque };
  } finally {
    clearTimeout(reloj);
  }
}

exports.handler = async (event) => {
  if (!URL_SCRIPT || !TOKEN) {
    return respuesta(500, {
      ok: false,
      error: 'Faltan las variables de entorno GOOGLE_SCRIPT_URL o SHARED_TOKEN en Netlify.'
    });
  }

  // Sin APP_PIN se cierra la puerta en vez de dejarla abierta.
  if (!CODIGO) {
    return respuesta(500, {
      ok: false,
      error: 'Falta la variable de entorno APP_PIN en Netlify. Hasta que exista, la app no responde.'
    });
  }

  // ---------- Código de acceso ----------
  const cabeceras = event.headers || {};
  const recibido = cabeceras['x-codigo'] || cabeceras['X-Codigo'] || '';

  if (!recibido || !mismoCodigo(recibido, CODIGO)) {
    await esperar(700);      // frena los intentos a lo bruto
    return respuesta(401, { ok: false, error: 'Código incorrecto.', noAutorizado: true });
  }

  try {
    // Comprobación desde la pantalla de bloqueo: confirma el código sin tocar
    // el Apps Script ni gastar cuota.
    if (event.httpMethod === 'GET' &&
        event.queryStringParameters &&
        event.queryStringParameters.action === 'comprobar') {
      return respuesta(200, { ok: true, comprobado: true });
    }

    // ---------- Lectura del dashboard ----------
    if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.queryStringParameters || {});
      params.delete('callback');            // ya no hace falta JSONP: mismo origen
      params.set('token', TOKEN);
      // Anticaché: Google sirve las respuestas GET de un web app desde su propia
      // caché, así que sin esto un borrado podía tardar en verse en la app.
      params.set('_', Date.now() + '-' + Math.random().toString(36).slice(2));

      const r = await pedirAlScript(URL_SCRIPT + '?' + params.toString(), {
        redirect: 'follow',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      return devolver(r, event.queryStringParameters.action || 'dashboard');
    }

    // ---------- Escritura ----------
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      body.token = TOKEN;

      const r = await pedirAlScript(URL_SCRIPT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // evita el preflight en Apps Script
        body: JSON.stringify(body),
        redirect: 'follow'
      });
      return devolver(r, body.action || 'POST');
    }

    return respuesta(405, { ok: false, error: 'Método no permitido' });

  } catch (err) {
    if (err && err.name === 'AbortError') {
      return respuesta(504, {
        ok: false,
        error: 'El Apps Script tardó más de ' + (ESPERA_SCRIPT / 1000) + ' s y se cortó la llamada. ' +
               'Puede que siga trabajando por su cuenta: comprueba el resultado antes de repetir.',
        seCorto: true
      });
    }
    return respuesta(502, { ok: false, error: 'Proxy: ' + err.message });
  }
};

/**
 * Apps Script devuelve JSON, pero ante un error suyo devuelve HTML: la página
 * de inicio de sesión, un «se ha producido un error» o un aviso de cuota. Ese
 * texto es justo lo que hace falta para saber qué pasa, así que viaja hasta la
 * app en `detalle` en vez de quedarse aquí.
 */
function devolver(r, accion) {
  try {
    const datos = JSON.parse(r.texto);
    datos.ms = r.ms;
    return respuesta(200, datos);
  } catch (err) {
    return respuesta(502, {
      ok: false,
      error: 'El Apps Script no devolvió JSON en «' + accion + '» (HTTP ' + r.status +
             ', ' + Math.round(r.ms / 1000) + ' s). ¿Publicaste una versión nueva de la implementación?',
      detalle: r.texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
      ms: r.ms
    });
  }
}