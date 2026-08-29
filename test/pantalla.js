/**
 * Prueba de humo en navegador. No forma parte de `npm test` porque necesita
 * Playwright; se ejecuta a mano antes de un despliegue:
 *
 *   npm install --no-save playwright chart.js@4.5.0
 *   node test/pantalla.js
 *
 * Levanta la app con una API simulada, la carga en Chromium a tamaño de móvil,
 * recorre los seis módulos comprobando que ninguno da errores de JavaScript, y
 * deja una captura de cada uno en test/capturas/.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const CAPTURAS = path.join(__dirname, 'capturas');

// Los repostajes reales, más unos cuantos inventados para que salgan el punto de
// equilibrio, el ahorro, la desviación por estación y el coste de oportunidad.
const REGISTROS = [
  r('REP-000001', '2026-06-26', 'GLP',         44.02, 0.929, 40.89, { kmTotales: 3049 }),
  r('REP-000001', '2026-06-26', 'Gasolina 98', 41.04, 1.535, 63.00, { kmTotales: 3049 }),
  r('REP-915015', '2026-07-31', 'GLP',         33.71, 0.898, 30.27, { kmTotales: 3803, kmTramo: 754 }),
  r('REP-915015', '2026-07-31', 'Gasolina 98', 33.98, 1.555, 52.84, { kmTotales: 3803, kmTramo: 754 }),
  r('REP-498973', '2026-08-10', 'GLP',         42.95, 0.898, 38.57, { kmTotales: 4279, kmTramo: 476 }),
  r('REP-008768', '2026-08-28', 'GLP',         43.94, 0.898, 39.46, {
    kmTotales: 4907, kmTramo: 628, kmGLP: 433.1, kmGas: 195, lecturaGLP: 433.1, lecturaGas: 195,
    kmCalculo: 433.1, consumoReal: 10.15, costeKmReal: 0.0911, consumoCoche: 9.8, costeKmCoche: 0.088,
    recibo: 'https://drive.google.com/file/d/1tIce4PS6KIzjV51BdFc00A7OdfbTaus8/view'
  }),
  r('REP-100001', '2026-09-15', 'GLP',         40.10, 0.905, 36.29, {
    kmTotales: 5480, kmTramo: 573, kmGLP: 420, kmGas: 153, lecturaGLP: 420, lecturaGas: 153,
    kmCalculo: 420, consumoReal: 9.55, costeKmReal: 0.0864, consumoCoche: 9.4, costeKmCoche: 0.0851,
    recibo: 'https://drive.google.com/file/d/ejemplo/view'
  }),
  r('REP-100001', '2026-09-15', 'Gasolina 98', 21.60, 1.549, 33.46, {
    kmTotales: 5480, kmTramo: 573, kmGLP: 420, kmGas: 153, lecturaGLP: 420, lecturaGas: 153,
    kmCalculo: 348, consumoReal: 6.21, costeKmReal: 0.0961, consumoCoche: 6.1, costeKmCoche: 0.0945,
    recibo: 'https://drive.google.com/file/d/ejemplo/view'
  }),
  // Mismo día que el anterior y parcial: antes se pisaban en las series temporales
  r('REP-100002', '2026-09-15', 'GLP',         12.00, 0.905, 10.86, {
    kmTotales: 5495, kmTramo: 15, kmGLP: 15, kmGas: 0, lleno: false, estacion: 'E.S. Repsol La Laguna'
  }),
  // Otra estación, más cara, para que haya ranking y coste de oportunidad
  r('REP-100003', '2026-10-02', 'GLP',         38.40, 0.949, 36.44, {
    kmTotales: 5980, kmTramo: 485, kmGLP: 400, kmGas: 85, lecturaGLP: 400, lecturaGas: 85,
    kmCalculo: 415, consumoReal: 12.14, costeKmReal: 0.1139, estacion: 'E.S. Repsol La Laguna'
  })
];

function r(id, fecha, tipo, litros, precio, total, extra) {
  return Object.assign({
    id, fecha, fechaRegistro: fecha, fechaDelTicket: true,
    estacion: 'E.S.DISA Padre Anchieta',
    tipo, litros, precio, total, lleno: true,
    kmTotales: null, kmTramo: null, kmGLP: null, kmGas: null, kmCalculo: null,
    lecturaGLP: null, lecturaGas: null, consumoCoche: null, consumoReal: null,
    costeKmReal: null, costeKmCoche: null, recibo: '', lat: null, lon: null
  }, extra || {});
}

const DEPOSITOS = {
  capacidadGLP: 45, capacidadGasolina: 50,
  kmDesdeLlenadoGLP: 180, kmDesdeLlenadoGasolina: 238,
  ultimoLlenadoGLP: '2026-10-02', ultimoLlenadoGasolina: '2026-09-15'
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/repostaje') {
    const accion = url.searchParams.get('action');
    const cuerpo = accion === 'export'
      ? { ok: true, csv: 'ID;Tipo\r\nREP-000001;GLP', nombre: 'prueba.csv', filas: 1 }
      : {
          ok: true, registros: REGISTROS, depositos: DEPOSITOS,
          estaciones: ['E.S.DISA Padre Anchieta', 'E.S. Repsol La Laguna'],
          ubicaciones: [{ estacion: 'E.S.DISA Padre Anchieta', lat: 28.4823, lon: -16.3211 }],
          version: '5.1', actualizado: '29/08/2026 12:00'
        };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(cuerpo));
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const fichero = path.join(RAIZ, rel);
  if (!fichero.startsWith(RAIZ) || !fs.existsSync(fichero)) {
    res.writeHead(404); return res.end('no está');
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(fichero)] || 'text/plain' });
  res.end(fs.readFileSync(fichero));
});

const MODULOS = ['repostar', 'resumen', 'consumos', 'estaciones', 'historial', 'curiosidades'];

(async () => {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  await new Promise(ok => servidor.listen(8765, ok));

  const navegador = await chromium.launch();
  // Contexto de móvil de verdad: con hasTouch las reglas @media (hover:hover)
  // no aplican, que es como se ve en el iPhone y en el Android.
  const contexto = await navegador.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    hasTouch: true, isMobile: true, permissions: [], locale: 'es-ES'
  });
  const pagina = await contexto.newPage();

  const errores = [];
  pagina.on('pageerror', e => errores.push('JS: ' + e.message));
  pagina.on('console', m => { if (m.type() === 'error') errores.push('consola: ' + m.text()); });

  // El contenedor de pruebas no llega al CDN: servimos Chart.js desde node_modules.
  const CHART = path.join(RAIZ, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
  if (!fs.existsSync(CHART)) {
    console.log('\nFalta Chart.js. Ejecuta antes:  npm install --no-save playwright chart.js@4.5.0\n');
    process.exit(1);
  }
  await pagina.route('**/cdnjs.cloudflare.com/**', ruta => ruta.fulfill({
    status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(CHART, 'utf8')
  }));

  await pagina.goto('http://localhost:8765/', { waitUntil: 'networkidle' });

  const fallar = async (motivo) => {
    console.log('\n' + motivo);
    errores.forEach(e => console.log('  ' + e));
    await pagina.screenshot({ path: path.join(CAPTURAS, 'fallo.png'), fullPage: true });
    await navegador.close();
    servidor.close();
    process.exit(1);
  };

  // ---- La barra de módulos existe ----
  const botones = await pagina.$$eval('#barra button', els => els.map(e => e.textContent.trim()));
  if (botones.length !== 6) await fallar('Esperaba 6 módulos en la barra y hay ' + botones.length + '.');
  console.log('\nMódulos: ' + botones.join(' · '));

  // ---- Recorremos módulo a módulo ----
  for (let i = 0; i < MODULOS.length; i++) {
    await pagina.click('#barra button:nth-child(' + (i + 1) + ')');
    await pagina.waitForTimeout(700);

    const activo = await pagina.evaluate(() => {
      const carril = document.getElementById('carril');
      return Math.round(carril.scrollLeft / carril.clientWidth);
    });
    if (activo !== i) await fallar('El módulo ' + MODULOS[i] + ' no quedó centrado (salió el ' + activo + ').');

    const contenido = await pagina.$eval('#mod-' + MODULOS[i], el => el.innerText.replace(/\s+/g, ' ').trim().length);
    if (contenido < 40) await fallar('El módulo ' + MODULOS[i] + ' se ve vacío.');

    await pagina.screenshot({ path: path.join(CAPTURAS, (i + 1) + '-' + MODULOS[i] + '.png') });
  }

  // ---- Lo que tiene que haber en cada uno ----
  const comprobar = async (nombre, selector, minimo) => {
    const n = await pagina.$$eval(selector, els => els.length);
    if (n < minimo) await fallar(nombre + ': esperaba al menos ' + minimo + ' y hay ' + n + '.');
    return n;
  };

  await pagina.click('#barra button:nth-child(2)');
  await pagina.waitForTimeout(500);
  const kpis = await comprobar('KPI del resumen', '#kpis .kpi', 8);

  await pagina.click('#barra button:nth-child(4)');
  await pagina.waitForTimeout(500);
  const rank = await comprobar('Ranking de estaciones', '#rankEstaciones .rank', 2);

  await pagina.click('#barra button:nth-child(5)');
  await pagina.waitForTimeout(500);
  const reps = await comprobar('Repostajes del historial', '#listaRepostajes .rep', 6);
  await comprobar('Enlaces al ticket', '#listaRepostajes a', 1);

  await pagina.click('#barra button:nth-child(6)');
  await pagina.waitForTimeout(500);
  const curios = await comprobar('Curiosidades', '#kpisRecords .kpi', 5);

  // ---- Contenido concreto ----
  const textos = await pagina.evaluate(() => ({
    resumen: document.getElementById('kpis').innerText.replace(/\s+/g, ' '),
    oportunidad: document.getElementById('kpisOportunidad').innerText.replace(/\s+/g, ' '),
    homologado: document.getElementById('kpisHomologado').innerText.replace(/\s+/g, ' '),
    proyeccion: document.getElementById('kpisProyeccion').innerText.replace(/\s+/g, ' '),
    depositos: document.getElementById('depositos').innerText.replace(/\s+/g, ' ')
  }));

  console.log('\nResumen:    ' + textos.resumen.slice(0, 300));
  console.log('\nDepósitos:  ' + textos.depositos.slice(0, 220));
  console.log('\nOportunidad:' + textos.oportunidad.slice(0, 220));
  console.log('\nProyección: ' + textos.proyeccion.slice(0, 300));
  console.log('\nHomologado: ' + textos.homologado.slice(0, 220));

  // Los títulos de las tarjetas van en versalitas por CSS y innerText respeta
  // text-transform, así que se compara sin distinguir mayúsculas.
  const debeAparecer = [
    [textos.resumen, 'punto de equilibrio'],
    [textos.resumen, 'rentabilidad'],
    [textos.resumen, ['ahorro con glp', 'sobrecoste del glp']],
    [textos.oportunidad, '€'],
    [textos.depositos, 'autonomía'],
    [textos.proyeccion, 'co₂'],
    [textos.proyeccion, 'cierre estimado'],
    [textos.homologado, 'l/100km de ficha']
  ];
  for (const [texto, aguja] of debeAparecer) {
    const opciones = Array.isArray(aguja) ? aguja : [aguja];
    if (!opciones.some(o => texto.toLowerCase().indexOf(o) >= 0)) {
      await fallar('No encuentro «' + opciones.join('» ni «') + '» donde debería estar.');
    }
  }

  // ---- El deslizamiento con el dedo también cambia de módulo ----
  await pagina.click('#barra button:nth-child(1)');
  await pagina.waitForTimeout(600);
  await pagina.evaluate(() => {
    const carril = document.getElementById('carril');
    carril.scrollTo({ left: carril.clientWidth * 2, behavior: 'instant' });
  });
  await pagina.waitForTimeout(600);
  const trasSwipe = await pagina.$$eval('#barra button', els => els.findIndex(e => e.classList.contains('on')));
  if (trasSwipe !== 2) await fallar('Al deslizar, la barra no siguió al carril (marcó el ' + trasSwipe + ').');

  // ---- En el móvil no deben verse las flechas de escritorio ----
  const flechaEnMovil = await pagina.$eval('#flechaDer', el => getComputedStyle(el).display);
  if (flechaEnMovil !== 'none') {
    await fallar('Las flechas de escritorio se ven en el móvil (display: ' + flechaEnMovil + ').');
  }

  // ---- Escritorio: ratón, flechas visibles y teclado ----
  const escritorio = await navegador.newContext({ viewport: { width: 1280, height: 860 }, locale: 'es-ES' });
  const pc = await escritorio.newPage();
  pc.on('pageerror', e => errores.push('JS escritorio: ' + e.message));
  pc.on('console', m => { if (m.type() === 'error') errores.push('consola escritorio: ' + m.text()); });
  await pc.route('**/cdnjs.cloudflare.com/**', ruta => ruta.fulfill({
    status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(CHART, 'utf8')
  }));
  await pc.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
  await pc.waitForTimeout(900);

  const flechaEnPC = await pc.$eval('#flechaDer', el => getComputedStyle(el).display);
  if (flechaEnPC === 'none') {
    console.log('\nLas flechas no se ven en escritorio (display: none).');
    await navegador.close(); servidor.close(); process.exit(1);
  }

  await pc.keyboard.press('ArrowRight');
  await pc.waitForTimeout(700);
  let activoPC = await pc.$$eval('#barra button', els => els.findIndex(e => e.classList.contains('on')));
  if (activoPC !== 1) {
    console.log('\nLa flecha del teclado no avanzó de módulo (marcó el ' + activoPC + ').');
    await navegador.close(); servidor.close(); process.exit(1);
  }

  await pc.click('#flechaDer');
  await pc.waitForTimeout(700);
  activoPC = await pc.$$eval('#barra button', els => els.findIndex(e => e.classList.contains('on')));
  if (activoPC !== 2) {
    console.log('\nEl botón de flecha no avanzó de módulo (marcó el ' + activoPC + ').');
    await navegador.close(); servidor.close(); process.exit(1);
  }

  // El contenido no debe estirarse ni quedar debajo de las flechas
  const geometria = await pc.evaluate(() => {
    const card = document.querySelector('#mod-consumos .card');
    const flecha = document.getElementById('flechaDer');
    return { card: card.getBoundingClientRect(), flecha: flecha.getBoundingClientRect() };
  });
  if (geometria.card.width > 570) {
    console.log('\nEl contenido se estira en escritorio (' + Math.round(geometria.card.width) + ' px).');
    await navegador.close(); servidor.close(); process.exit(1);
  }
  if (geometria.card.right > geometria.flecha.left) {
    console.log('\nLa flecha se pone encima del contenido en escritorio.');
    await navegador.close(); servidor.close(); process.exit(1);
  }
  console.log('Escritorio: columna de ' + Math.round(geometria.card.width) + ' px, sin solapes.');

  await pc.screenshot({ path: path.join(CAPTURAS, 'escritorio.png') });

  console.log('\nKPI: ' + kpis + ' · ranking: ' + rank + ' · repostajes: ' + reps + ' · récords: ' + curios);
  console.log('Móvil: deslizamiento correcto y sin flechas de escritorio.');
  console.log('Escritorio: flechas visibles, teclado y clic correctos.');

  await navegador.close();
  servidor.close();

  if (errores.length) {
    console.log('\nErrores en el navegador:');
    errores.forEach(e => console.log('  ' + e));
    process.exit(1);
  }
  console.log('\nSin errores de JavaScript. Capturas en test/capturas/.\n');
})();
