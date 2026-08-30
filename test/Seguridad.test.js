/**
 * Comprobaciones del código de acceso y del anticaché.
 *
 *   node test/seguridad.test.js
 *
 * Carga la función de Netlify de verdad y le mete peticiones simuladas, sin
 * levantar nada ni salir a la red: el `fetch` global se sustituye por uno de
 * mentira que apunta lo que se le pidió.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const RAIZ = path.join(__dirname, '..');
const RUTA_FUNCION = path.join(RAIZ, 'netlify', 'functions', 'repostaje.js');

let pasadas = 0, fallidas = 0;
function prueba(nombre, fn) {
  try {
    fn();
    pasadas++;
    console.log('  ok   ' + nombre);
  } catch (err) {
    fallidas++;
    console.log('  FALLA ' + nombre + '\n        ' + err.message);
  }
}

/** Carga la función con unas variables de entorno concretas y el fetch simulado. */
function cargarFuncion(entorno) {
  Object.assign(process.env, {
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/PRUEBA/exec',
    SHARED_TOKEN: 'token-de-prueba',
    APP_PIN: 'codigo-de-prueba'
  }, entorno || {});

  const llamadas = [];
  global.fetch = async (url, opciones) => {
    llamadas.push({ url: String(url), opciones: opciones || {} });
    return { text: async () => JSON.stringify({ ok: true, registros: [] }) };
  };

  delete require.cache[require.resolve(RUTA_FUNCION)];
  const modulo = require(RUTA_FUNCION);
  return { handler: modulo.handler, llamadas };
}

const conCodigo = codigo => ({ 'x-codigo': codigo });

console.log('\nCódigo de acceso y anticaché — RefuelControl\n');

(async () => {
  // ---------- Sin código no se pasa ----------
  {
    const { handler, llamadas } = cargarFuncion();
    const r = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { action: 'dashboard' } });
    prueba('Sin cabecera X-Codigo responde 401', () => {
      assert.strictEqual(r.statusCode, 401);
      assert.strictEqual(JSON.parse(r.body).noAutorizado, true);
    });
    prueba('Sin código no se llega a llamar al Apps Script', () => {
      assert.strictEqual(llamadas.length, 0, 'el proxy llamó a Google sin código');
    });
  }

  // ---------- Con un código que no es ----------
  {
    const { handler, llamadas } = cargarFuncion();
    const r = await handler({
      httpMethod: 'GET', headers: conCodigo('otro-codigo'),
      queryStringParameters: { action: 'dashboard' }
    });
    prueba('Un código equivocado responde 401', () => assert.strictEqual(r.statusCode, 401));
    prueba('Un código equivocado tampoco llama al Apps Script', () => assert.strictEqual(llamadas.length, 0));
  }

  // ---------- Escritura sin código ----------
  {
    const { handler, llamadas } = cargarFuncion();
    const r = await handler({
      httpMethod: 'POST', headers: {},
      body: JSON.stringify({ action: 'borrar', id: 'REP-000001' })
    });
    prueba('Un borrado sin código responde 401', () => assert.strictEqual(r.statusCode, 401));
    prueba('Un borrado sin código no llega al Sheet', () => assert.strictEqual(llamadas.length, 0));
  }

  // ---------- Con el código bueno ----------
  {
    const { handler, llamadas } = cargarFuncion();
    const r = await handler({
      httpMethod: 'GET', headers: conCodigo('codigo-de-prueba'),
      queryStringParameters: { action: 'dashboard' }
    });
    prueba('Con el código bueno responde 200', () => assert.strictEqual(r.statusCode, 200));
    prueba('El token se añade en el proxy, no en el navegador', () => {
      assert.ok(llamadas[0].url.indexOf('token=token-de-prueba') > 0, 'falta el token');
    });
    prueba('Cada lectura lleva su anticaché', () => {
      assert.ok(/[?&]_=/.test(llamadas[0].url), 'falta el parámetro anticaché');
    });
    prueba('El código de acceso no se reenvía a Google', () => {
      assert.ok(llamadas[0].url.indexOf('codigo-de-prueba') < 0, 'el código viajó al Apps Script');
    });
    prueba('La respuesta se sirve sin caché', () => {
      assert.ok(/no-store/.test(r.headers['Cache-Control']));
    });
  }

  // ---------- Comprobar el código no gasta cuota ----------
  {
    const { handler, llamadas } = cargarFuncion();
    const r = await handler({
      httpMethod: 'GET', headers: conCodigo('codigo-de-prueba'),
      queryStringParameters: { action: 'comprobar' }
    });
    prueba('«comprobar» valida el código sin tocar el Apps Script', () => {
      assert.strictEqual(r.statusCode, 200);
      assert.strictEqual(JSON.parse(r.body).comprobado, true);
      assert.strictEqual(llamadas.length, 0);
    });
  }

  // ---------- Sin APP_PIN configurado se cierra, no se abre ----------
  {
    const { handler, llamadas } = cargarFuncion({ APP_PIN: '' });
    const r = await handler({
      httpMethod: 'GET', headers: conCodigo('lo-que-sea'),
      queryStringParameters: { action: 'dashboard' }
    });
    prueba('Sin APP_PIN la función no deja pasar a nadie', () => {
      assert.strictEqual(r.statusCode, 500);
      assert.ok(/APP_PIN/.test(JSON.parse(r.body).error));
      assert.strictEqual(llamadas.length, 0);
    });
  }

  // ---------- El front ----------
  // Cada comprobación mira el archivo al que le toca. Con la app partida en
  // módulos ya no hay que rastrear un index.html de dos mil líneas.
  const leerJs = ruta => fs.readFileSync(path.join(RAIZ, ruta), 'utf8');
  const api = leerJs('js/api.js');
  const refresco = leerJs('js/refresco.js');
  const historial = leerJs('js/ui/historial.js');
  const datos = leerJs('js/datos.js');

  prueba('El front manda el código en cada llamada', () => {
    const envios = api.match(/'X-Codigo':/g) || [];
    assert.ok(envios.length >= 2, 'esperaba la cabecera en la lectura y en la escritura');
  });

  prueba('El front no lleva ningún código escrito', () => {
    assert.ok(!/APP_PIN\s*=\s*['"][^'"]+['"]/.test(api), 'hay un código metido en el front');
    assert.ok(/localStorage\.getItem\(CLAVE_CODIGO\)/.test(api), 'el código debería salir del almacenamiento local');
  });

  prueba('Un 401 bloquea la app en vez de encolar el repostaje', () => {
    assert.ok(/res\.status === 401/.test(api), 'el front no distingue el 401');
    assert.ok(/err\.noAutorizado/.test(leerJs('js/ui/repostar.js')), 'el 401 no se trata aparte del fallo de red');
  });

  prueba('Las lecturas del dashboard llevan anticaché', () => {
    assert.ok(/API \+ '\?' \+ consulta \+ '&_=' \+ Date\.now\(\)/.test(api), 'apiGet sin anticaché');
  });

  prueba('El borrado quita el repostaje de la pantalla sin esperar', () => {
    assert.ok(/export function quitarTicket/.test(datos), 'falta el borrado optimista');
    assert.ok(/quitarTicket\(id\)/.test(historial), 'borrar() no lo usa');
  });

  prueba('Volver a la app refresca los datos', () => {
    assert.ok(/visibilitychange/.test(refresco), 'no se refresca al volver a la app');
    assert.ok(/pageshow/.test(refresco), 'no se refresca al volver del bfcache de iOS');
  });

  prueba('El gesto de tirar hacia abajo está enganchado', () => {
    assert.ok(/touchmove/.test(refresco) && /PTR\.umbral/.test(refresco), 'falta el pull-to-refresh');
  });

  prueba('Solo api.js habla con la red, y solo con /api/repostaje', () => {
    const modulos = [];
    const recorrer = dir => fs.readdirSync(path.join(RAIZ, dir)).forEach(f => {
      const rel = dir + '/' + f;
      if (fs.statSync(path.join(RAIZ, rel)).isDirectory()) return recorrer(rel);
      if (f.endsWith('.js')) modulos.push(rel);
    });
    recorrer('js');

    modulos.forEach(m => {
      const codigo = fs.readFileSync(path.join(RAIZ, m), 'utf8');
      assert.ok(!/script\.google\.com|googleapis\.com/.test(codigo),
        m + ' llama a Google directamente: el front solo debe hablar con /api/repostaje');
      if (m === 'js/api.js') return;
      assert.ok(!/\bfetch\s*\(/.test(codigo),
        m + ' hace fetch por su cuenta; la red vive en js/api.js');
    });
  });

  console.log('\n' + pasadas + ' pasadas, ' + fallidas + ' fallidas\n');
  process.exit(fallidas ? 1 : 0);
})();