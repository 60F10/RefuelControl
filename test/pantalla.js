/**
 * Prueba de humo en navegador. No forma parte de `npm test` porque necesita
 * Playwright; se ejecuta a mano antes de un despliegue:
 *
 *   node test/pantalla.js
 *
 * Levanta la app con una API simulada, carga index.html en Chromium a tamaño de
 * móvil, y comprueba que no hay errores de JavaScript y que los KPI se pintan.
 * Deja dos capturas en test/capturas/.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const CAPTURAS = path.join(__dirname, 'capturas');

// Los cuatro repostajes reales, más dos inventados con parciales de gasolina
// para ver el punto de equilibrio y el ahorro, que hoy todavía no salen.
const REGISTROS = [
  r('REP-000001', '2026-06-26', 'GLP',         44.02, 0.929, 40.89, { kmTotales: 3049 }),
  r('REP-000001', '2026-06-26', 'Gasolina 98', 41.04, 1.535, 63.00, { kmTotales: 3049 }),
  r('REP-915015', '2026-07-31', 'GLP',         33.71, 0.898, 30.27, { kmTotales: 3803, kmTramo: 754 }),
  r('REP-915015', '2026-07-31', 'Gasolina 98', 33.98, 1.555, 52.84, { kmTotales: 3803, kmTramo: 754 }),
  r('REP-498973', '2026-08-10', 'GLP',         42.95, 0.898, 38.57, { kmTotales: 4279, kmTramo: 476 }),
  r('REP-008768', '2026-08-28', 'GLP',         43.94, 0.898, 39.46, {
    kmTotales: 4907, kmTramo: 628, kmGLP: 433.1, kmGas: 195,
    kmCalculo: 433.1, consumoReal: 10.15, costeKmReal: 0.0911, consumoCoche: 9.8, costeKmCoche: 0.088
  }),
  r('REP-100001', '2026-09-15', 'GLP',         40.10, 0.905, 36.29, {
    kmTotales: 5480, kmTramo: 573, kmGLP: 420, kmGas: 153,
    kmCalculo: 420, consumoReal: 9.55, costeKmReal: 0.0864, consumoCoche: 9.4, costeKmCoche: 0.0851
  }),
  r('REP-100001', '2026-09-15', 'Gasolina 98', 21.60, 1.549, 33.46, {
    kmTotales: 5480, kmTramo: 573, kmGLP: 420, kmGas: 153,
    kmCalculo: 348, consumoReal: 6.21, costeKmReal: 0.0961, consumoCoche: 6.1, costeKmCoche: 0.0945
  }),
  // Mismo día que el anterior: antes se pisaban en las series temporales
  r('REP-100002', '2026-09-15', 'GLP',         12.00, 0.905, 10.86, {
    kmTotales: 5495, kmTramo: 15, kmGLP: 15, kmGas: 0, lleno: false
  })
];

function r(id, fecha, tipo, litros, precio, total, extra) {
  return Object.assign({
    id, fecha, fechaRegistro: fecha, fechaDelTicket: true,
    estacion: id === 'REP-100002' ? 'E.S. Repsol La Laguna' : 'E.S.DISA Padre Anchieta',
    tipo, litros, precio, total, lleno: true,
    kmTotales: null, kmTramo: null, kmGLP: null, kmGas: null, kmCalculo: null,
    lecturaGLP: null, lecturaGas: null, consumoCoche: null, consumoReal: null,
    costeKmReal: null, costeKmCoche: null, recibo: ''
  }, extra || {});
}

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
      : { ok: true, registros: REGISTROS, estaciones: ['E.S.DISA Padre Anchieta'], actualizado: '29/08/2026 12:00' };
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

(async () => {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  await new Promise(ok => servidor.listen(8765, ok));

  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pagina = await contexto.newPage();

  const errores = [];
  pagina.on('pageerror', e => errores.push('JS: ' + e.message));
  pagina.on('console', m => { if (m.type() === 'error') errores.push('consola: ' + m.text()); });

  // El contenedor de pruebas no llega al CDN: servimos Chart.js desde node_modules.
  const CHART = path.join(RAIZ, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
  if (!fs.existsSync(CHART)) {
    console.log('Falta Chart.js. Ejecuta antes:  npm install --no-save chart.js@4.5.0\n');
    process.exit(1);
  }
  await pagina.route('**/cdnjs.cloudflare.com/**', ruta => ruta.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: fs.readFileSync(CHART, 'utf8')
  }));

  await pagina.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
  try {
    await pagina.waitForFunction(() => document.querySelectorAll('#kpis .kpi').length > 0, { timeout: 8000 });
  } catch (err) {
    console.log('\nNo se pintó ningún KPI.');
    errores.forEach(e => console.log('  ' + e));
    await pagina.screenshot({ path: path.join(CAPTURAS, 'fallo.png'), fullPage: true });
    await navegador.close();
    servidor.close();
    process.exit(1);
  }
  await pagina.waitForTimeout(600);

  const kpis = await pagina.$$eval('#kpis .kpi', els => els.map(e => ({
    titulo: e.querySelector('.k').textContent.trim(),
    valor: e.querySelector('.v').textContent.replace(/\s+/g, ' ').trim(),
    pie: (e.querySelector('.s') || {}).textContent ? e.querySelector('.s').textContent.replace(/\s+/g, ' ').trim() : ''
  })));

  // charts es una const del script, así que se consulta por la API de Chart.js
  const graficos = await pagina.evaluate(() =>
    [...document.querySelectorAll('canvas')].filter(c => Chart.getChart(c)).length);
  const etiquetas = await pagina.evaluate(() => Chart.getChart('chCoste').data.labels);
  const puntosCoste = etiquetas.length;
  const seriesConsumo = await pagina.evaluate(() =>
    Chart.getChart('chConsumo').data.datasets.map(d => d.label + ': [' +
      d.data.map(v => v === null ? '·' : v).join(', ') + ']'));

  console.log('\nKPI pintados:\n');
  kpis.forEach(k => console.log('  · ' + k.titulo + ': ' + k.valor + (k.pie ? '\n      ' + k.pie : '')));
  console.log('\nGráficos: ' + graficos + ' · puntos en las series: ' + puntosCoste);
  console.log('Etiquetas del eje: ' + etiquetas.join(' | '));
  console.log('Series de consumo:');
  seriesConsumo.forEach(s => console.log('  ' + s));

  await pagina.screenshot({ path: path.join(CAPTURAS, 'formulario.png') });
  await pagina.screenshot({ path: path.join(CAPTURAS, 'completa.png'), fullPage: true });

  // Modo «datos del coche»
  await pagina.click('#tgCoche');
  await pagina.waitForTimeout(400);
  const kpisCoche = await pagina.$$eval('#kpis .kpi .k', els => els.map(e => e.textContent.trim()));
  console.log('KPI en modo coche: ' + kpisCoche.length);
  await pagina.screenshot({ path: path.join(CAPTURAS, 'modo-coche.png'), fullPage: true });

  await navegador.close();
  servidor.close();

  if (errores.length) {
    console.log('\nErrores en el navegador:');
    errores.forEach(e => console.log('  ' + e));
    process.exit(1);
  }
  console.log('\nSin errores de JavaScript. Capturas en test/capturas/.\n');
})();
