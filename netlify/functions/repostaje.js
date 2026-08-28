/**
 * Proxy entre la PWA y el Apps Script.
 *
 * La URL del Apps Script y el token viven aquí, en variables de entorno de
 * Netlify, así que nunca llegan al navegador ni al repositorio.
 *
 * Variables de entorno necesarias (Netlify > Site configuration > Environment variables):
 *   GOOGLE_SCRIPT_URL  -> https://script.google.com/macros/s/AKfy.../exec
 *   SHARED_TOKEN       -> el mismo valor que en las propiedades del Apps Script
 */

const URL_SCRIPT = process.env.GOOGLE_SCRIPT_URL;
const TOKEN = process.env.SHARED_TOKEN;

const respuesta = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj)
});

exports.handler = async (event) => {
  if (!URL_SCRIPT || !TOKEN) {
    return respuesta(500, {
      ok: false,
      error: 'Faltan las variables de entorno GOOGLE_SCRIPT_URL o SHARED_TOKEN en Netlify.'
    });
  }

  try {
    // ---------- Lectura del dashboard ----------
    if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.queryStringParameters || {});
      params.delete('callback');            // ya no hace falta JSONP: mismo origen
      params.set('token', TOKEN);

      const r = await fetch(URL_SCRIPT + '?' + params.toString(), { redirect: 'follow' });
      return devolver(await r.text());
    }

    // ---------- Escritura ----------
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      body.token = TOKEN;

      const r = await fetch(URL_SCRIPT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // evita el preflight en Apps Script
        body: JSON.stringify(body),
        redirect: 'follow'
      });
      return devolver(await r.text());
    }

    return respuesta(405, { ok: false, error: 'Método no permitido' });

  } catch (err) {
    return respuesta(502, { ok: false, error: 'Proxy: ' + err.message });
  }
};

/** Apps Script devuelve JSON, pero ante un error suyo devuelve HTML. Lo distinguimos. */
function devolver(texto) {
  try {
    return respuesta(200, JSON.parse(texto));
  } catch (err) {
    return respuesta(502, {
      ok: false,
      error: 'El Apps Script no devolvió JSON. ¿Publicaste una versión nueva de la implementación?',
      detalle: texto.slice(0, 300)
    });
  }
}