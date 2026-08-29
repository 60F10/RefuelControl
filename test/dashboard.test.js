/**
 * Banco de pruebas del dashboard.
 *
 *   node test/dashboard.test.js
 *
 * Extrae el <script> de index.html y lo ejecuta con un DOM de mentira. Así se
 * comprueban los agregados con los datos que devolvería el backend, sin navegador.
 * Lo visual se prueba aparte, en test/pantalla.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ============================================================
//  DOM mínimo
// ============================================================

function elementoFalso(id) {
  let html = '';
  const el = {
    id: id || '',
    value: '', textContent: '', disabled: false, src: '', href: '', download: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => elementoFalso(),
    querySelectorAll: () => [],
    appendChild() {}, remove() {}, click() {},
    scrollIntoView() {}, scrollTo() {},
    clientWidth: 390, scrollLeft: 0,
    getContext: () => ({ drawImage() {} }),
    toDataURL: () => 'data:image/jpeg;base64,xxx'
  };
  // children se deriva del innerHTML: montarBarra() escribe botones y luego los recorre
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set(v) { html = String(v); }
  });
  Object.defineProperty(el, 'children', {
    get: () => {
      const n = (html.match(/<button/g) || []).length;
      if (!el._hijos || el._hijos.length !== n) {
        el._hijos = Array.from({ length: n }, (_, i) => {
          const h = elementoFalso('hijo-' + i);
          h.dataset = { i: String(i) };
          return h;
        });
      }
      return el._hijos;
    }
  });
  return el;
}

function cargarDashboard() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const bloques = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  const codigo = bloques
    .map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, ''))
    .filter(c => c.indexOf('function agregados') >= 0)[0];
  assert.ok(codigo, 'no encontré el script del dashboard en index.html');

  const elementos = {};
  const contexto = {
    console,
    document: {
      getElementById(id) { return elementos[id] || (elementos[id] = elementoFalso(id)); },
      querySelectorAll: () => [],
      querySelector: () => elementoFalso(),
      createElement: () => elementoFalso(),
      addEventListener() {},
      body: elementoFalso('body')
    },
    navigator: { onLine: true },
    location: { protocol: 'https:', hostname: 'repostajesgofio.netlify.app' },
    fetch: () => Promise.reject(new Error('sin red en las pruebas')),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: function () {},
    Set, Math, Date, JSON, Promise, isNaN, parseFloat, parseInt,
    setTimeout, clearTimeout,
    Chart: Object.assign(function () { return { destroy() {} }; }, { register() {}, getChart: () => null })
  };
  contexto.window = contexto;
  contexto.window.addEventListener = () => {};
  vm.createContext(contexto);
  vm.runInContext(codigo, contexto, { filename: 'index.html' });
  return contexto;
}

/** Ejecuta una expresión dentro del contexto, que es donde viven las let del script. */
const en = (ctx, expr) => vm.runInContext(expr, ctx);

function conDatos(registros, modo, extra) {
  const ctx = cargarDashboard();
  ctx.__datos = Object.assign({ registros, estaciones: [], ubicaciones: [], depositos: null }, extra || {});
  en(ctx, 'DATOS = __datos; MODO = ' + JSON.stringify(modo || 'real') + ';');
  return { ctx, a: en(ctx, 'agregados()') };
}

/** Registro con los mismos campos que devuelve getDashboardData(). */
function reg(o) {
  return Object.assign({
    id: 'X', fecha: '2026-08-01', fechaRegistro: '2026-08-01', fechaDelTicket: true,
    estacion: 'E.S. Prueba', tipo: 'GLP', litros: null, precio: null, total: null, lleno: true,
    kmTotales: null, kmTramo: null, kmGLP: null, kmGas: null, kmCalculo: null,
    lecturaGLP: null, lecturaGas: null, consumoCoche: null, consumoReal: null,
    costeKmReal: null, costeKmCoche: null, recibo: '', lat: null, lon: null
  }, o);
}

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
const cerca = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 0.0005), 'esperaba ' + b + ' y salió ' + a);

// ============================================================
//  Medias ponderadas (roadmap 0.1)
// ============================================================

console.log('\nDashboard — RefuelControl\n');

prueba('El €/km se pondera por kilómetros, no por repostajes', () => {
  const { a } = conDatos([
    reg({ id: 'A', tipo: 'GLP', total: 35, litros: 35, kmCalculo: 500, costeKmReal: 0.07, consumoReal: 7,  kmGLP: 500 }),
    reg({ id: 'B', tipo: 'GLP', total: 10, litros: 10, kmCalculo: 100, costeKmReal: 0.10, consumoReal: 10, kmGLP: 100 })
  ]);
  cerca(a.costeGLP, 0.075);                    // (35 + 10) € / 600 km
  cerca(a.porTipo['GLP'].costeKm, 0.075);
  assert.ok(Math.abs(a.costeGLP - 0.085) > 0.005, 'no debe salir la media aritmética');
});

prueba('El consumo medio se pondera igual', () => {
  const { a } = conDatos([
    reg({ id: 'A', tipo: 'GLP', litros: 35, kmCalculo: 500, consumoReal: 7,  costeKmReal: 0.07 }),
    reg({ id: 'B', tipo: 'GLP', litros: 10, kmCalculo: 100, consumoReal: 10, costeKmReal: 0.10 })
  ]);
  cerca(a.porTipo['GLP'].consumoMedio, 7.5);   // 45 L / 600 km * 100
  cerca(a.porTipo['GLP'].kmMedidos, 600);
});

prueba('Los repostajes sin ventana medida no entran en la media', () => {
  const { a } = conDatos([
    reg({ id: 'A', tipo: 'GLP', total: 40, litros: 44 }),
    reg({ id: 'B', tipo: 'GLP', total: 35, litros: 35, kmCalculo: 500, costeKmReal: 0.07, consumoReal: 7 })
  ]);
  cerca(a.costeGLP, 0.07);
  cerca(a.kmGLPMedidos, 500);
});

prueba('En modo coche el peso son los km del tramo, no los de la ventana', () => {
  const { a } = conDatos([
    reg({ id: 'A', tipo: 'GLP', kmGLP: 400, consumoCoche: 8,  costeKmCoche: 0.072 }),
    reg({ id: 'B', tipo: 'GLP', kmGLP: 100, consumoCoche: 12, costeKmCoche: 0.108 })
  ], 'coche');
  cerca(a.porTipo['GLP'].consumoMedio, 8.8);
  cerca(a.costeGLP, 0.0792);
});

prueba('Un ticket bífuel no cuenta dos veces el mismo tramo', () => {
  const { a } = conDatos([
    reg({ id: 'A', tipo: 'GLP',         kmGLP: 300, kmGas: 100, consumoCoche: 9, costeKmCoche: 0.081 }),
    reg({ id: 'A', tipo: 'Gasolina 98', kmGLP: 300, kmGas: 100, consumoCoche: 6, costeKmCoche: 0.093 })
  ], 'coche');
  cerca(a.porTipo['GLP'].kmMedidos, 300);
  cerca(a.porTipo['Gasolina 98'].kmMedidos, 100);
});

// ============================================================
//  Series temporales (roadmap 0.4)
// ============================================================

prueba('Dos repostajes del mismo combustible el mismo día ya no se pisan', () => {
  const { ctx } = conDatos([
    reg({ id: 'A', fecha: '2026-08-01', tipo: 'GLP', precio: 0.89 }),
    reg({ id: 'B', fecha: '2026-08-01', tipo: 'GLP', precio: 0.95 }),
    reg({ id: 'C', fecha: '2026-08-05', tipo: 'GLP', precio: 0.91 })
  ]);
  const tickets = en(ctx, 'ordenarTickets(DATOS.registros)');
  assert.strictEqual(tickets.length, 3);
  assert.strictEqual(tickets.map(t => t.id).join(','), 'A,B,C');
});

prueba('El eje distingue con un sufijo los tickets del mismo día', () => {
  const { ctx } = conDatos([
    reg({ id: 'A', fecha: '2026-08-01', tipo: 'GLP', precio: 0.89 }),
    reg({ id: 'B', fecha: '2026-08-01', tipo: 'GLP', precio: 0.95 }),
    reg({ id: 'C', fecha: '2026-08-05', tipo: 'GLP', precio: 0.91 })
  ]);
  const eje = en(ctx, 'ejeTickets(agregados())');
  assert.strictEqual(eje.etiquetas.join(' | '), '01/08 (1) | 01/08 (2) | 05/08');
});

prueba('Los tickets se ordenan por la fecha del ticket, no por la de registro', () => {
  const { ctx } = conDatos([
    reg({ id: 'TARDE', fecha: '2026-08-10' }),
    reg({ id: 'PRONTO', fecha: '2026-08-02' })
  ]);
  const tickets = en(ctx, 'ordenarTickets(DATOS.registros)');
  assert.strictEqual(tickets.map(t => t.id).join(','), 'PRONTO,TARDE');
});

// ============================================================
//  Punto de equilibrio y ahorro (roadmap 1.1 y 0.1)
// ============================================================

prueba('El punto de equilibrio sale del cociente de consumos', () => {
  const { a } = conDatos([
    reg({ id: 'A', tipo: 'GLP',         precio: 0.898, litros: 40, kmCalculo: 400, consumoReal: 10, costeKmReal: 0.0898 }),
    reg({ id: 'A', tipo: 'Gasolina 98', precio: 1.555, litros: 24, kmCalculo: 400, consumoReal: 6,  costeKmReal: 0.0933 })
  ]);
  assert.ok(a.equilibrio, 'debería haber punto de equilibrio');
  cerca(a.equilibrio.precio, 1.555 * (10 / 6), 0.001);
  cerca(a.equilibrio.precioActualGLP, 0.898);
});

prueba('Sin consumo de gasolina no hay punto de equilibrio inventado', () => {
  const { a } = conDatos([
    reg({ id: 'A', tipo: 'GLP', precio: 0.898, litros: 40, kmCalculo: 400, consumoReal: 10, costeKmReal: 0.0898 })
  ]);
  assert.strictEqual(a.equilibrio, null);
});

prueba('El ahorro da la cifra medida y la proyectada', () => {
  const { a } = conDatos([
    reg({ id: 'A', tipo: 'GLP',         kmGLP: 1000, kmGas: 300, kmCalculo: 400, total: 36, costeKmReal: 0.09 }),
    reg({ id: 'A', tipo: 'Gasolina 98', kmGLP: 1000, kmGas: 300, kmCalculo: 300, total: 45, costeKmReal: 0.15 })
  ]);
  cerca(a.kmGLPMedidos, 400);
  cerca(a.ahorroMedido, 400 * 0.06, 0.01);
  cerca(a.ahorroProyectado, 1000 * 0.06, 0.01);
});

// ============================================================
//  Desviación de precio y coste de oportunidad (roadmap 1.2 y 1.3)
// ============================================================

function conEstaciones(regs) {
  const { ctx } = conDatos(regs);
  return en(ctx, 'analisisEstaciones(DATOS.registros)');
}

prueba('La desviación compara cada repostaje con los de su época, no con la media global', () => {
  // La cara reposta en un valle de precios y la barata en un pico: con precios
  // medios a secas, la barata parecería la cara.
  const e = conEstaciones([
    reg({ id: '1', fecha: '2026-01-10', tipo: 'GLP', precio: 0.80, litros: 40, estacion: 'Barata' }),
    reg({ id: '2', fecha: '2026-01-12', tipo: 'GLP', precio: 0.90, litros: 40, estacion: 'Cara' }),
    reg({ id: '3', fecha: '2026-06-10', tipo: 'GLP', precio: 1.10, litros: 40, estacion: 'Barata' }),
    reg({ id: '4', fecha: '2026-06-12', tipo: 'GLP', precio: 1.20, litros: 40, estacion: 'Cara' })
  ]);
  const barata = e.lista.filter(x => x.estacion === 'Barata')[0];
  const cara = e.lista.filter(x => x.estacion === 'Cara')[0];
  assert.ok(barata.desviacion < 0, 'la barata sale por debajo de su época');
  assert.ok(cara.desviacion > 0, 'la cara sale por encima');
  assert.strictEqual(e.lista[0].estacion, 'Barata', 'el ranking la pone primera');
  // El precio medio a secas las empataría: las dos rondan 0,95
  cerca(barata.precioMedio, 0.95, 0.001);
  cerca(cara.precioMedio, 1.05, 0.001);
});

prueba('Fuera de la ventana de días no se comparan precios', () => {
  const e = conEstaciones([
    reg({ id: '1', fecha: '2026-01-10', tipo: 'GLP', precio: 0.80, litros: 40, estacion: 'A' }),
    reg({ id: '2', fecha: '2026-12-20', tipo: 'GLP', precio: 1.20, litros: 40, estacion: 'B' })
  ]);
  assert.ok(e.lista.every(x => x.desviacion === null), 'están a un año, no son comparables');
  assert.strictEqual(e.oportunidad, null);
});

prueba('El GLP no se compara con la gasolina', () => {
  const e = conEstaciones([
    reg({ id: '1', fecha: '2026-08-01', tipo: 'GLP',         precio: 0.90, litros: 40, estacion: 'A' }),
    reg({ id: '2', fecha: '2026-08-03', tipo: 'Gasolina 98', precio: 1.55, litros: 40, estacion: 'A' })
  ]);
  // Con un solo repostaje de cada producto no hay con qué comparar
  assert.ok(e.lista.every(x => x.desviacion === null));
});

prueba('El coste de oportunidad mide lo que costó no ir a la más barata', () => {
  const e = conEstaciones([
    reg({ id: '1', fecha: '2026-08-01', tipo: 'GLP', precio: 0.90, litros: 100, estacion: 'Barata' }),
    reg({ id: '2', fecha: '2026-08-05', tipo: 'GLP', precio: 1.00, litros: 100, estacion: 'Cara' })
  ]);
  // Referencia común 0,95. Barata: -0,05. Cara: +0,05.
  // En la barata habrías pagado 0,90 en los dos: ahorro potencial = 100 * 0,10 = 10 €
  assert.ok(e.oportunidad !== null);
  cerca(e.oportunidad, 10, 0.01);
  cerca(e.litrosComparados, 200, 0.01);
});

prueba('Con una sola estación no hay coste de oportunidad', () => {
  const e = conEstaciones([
    reg({ id: '1', fecha: '2026-08-01', tipo: 'GLP', precio: 0.90, litros: 40, estacion: 'Única' }),
    reg({ id: '2', fecha: '2026-08-05', tipo: 'GLP', precio: 1.00, litros: 40, estacion: 'Única' })
  ]);
  assert.strictEqual(e.oportunidad, null, 'sin alternativa no hay nada que elegir');
});

prueba('Repostar siempre en la más barata deja el coste de oportunidad a cero', () => {
  const e = conEstaciones([
    reg({ id: '1', fecha: '2026-08-01', tipo: 'GLP', precio: 0.90, litros: 50, estacion: 'Barata' }),
    reg({ id: '2', fecha: '2026-08-03', tipo: 'GLP', precio: 1.00, litros: 50, estacion: 'Cara' }),
    reg({ id: '3', fecha: '2026-08-05', tipo: 'GLP', precio: 0.90, litros: 50, estacion: 'Barata' })
  ]);
  const mejor = e.mejorPorTipo['GLP'];
  assert.strictEqual(mejor.estacion, 'Barata');
  assert.ok(e.oportunidad > 0, 'la visita a la cara costó dinero');
});

// ============================================================
//  Casos de borde
// ============================================================

prueba('Sin datos no se rompe nada', () => {
  const { a } = conDatos([]);
  assert.strictEqual(a.costeGLP, null);
  assert.strictEqual(a.equilibrio, null);
  assert.strictEqual(a.gastoTotal, 0);
});

prueba('Sin datos el análisis de estaciones tampoco se rompe', () => {
  const e = conEstaciones([]);
  assert.strictEqual(e.lista.length, 0);
  assert.strictEqual(e.oportunidad, null);
});

prueba('Los litros por depósito se suman para el CO2', () => {
  const { a } = conDatos([
    reg({ id: 'A', tipo: 'GLP',         litros: 40, total: 36 }),
    reg({ id: 'A', tipo: 'Gasolina 98', litros: 30, total: 46 }),
    reg({ id: 'B', tipo: 'GLP',         litros: 20, total: 18 })
  ]);
  cerca(a.litrosGLP, 60, 0.01);
  cerca(a.litrosGas, 30, 0.01);
});

// ============================================================
//  Los datos reales de la hoja
// ============================================================

prueba('Con los datos reales de hoy los KPI siguen cuadrando', () => {
  const { a } = conDatos([
    reg({ id: 'REP-000001', fecha: '2026-06-26', tipo: 'GLP',         litros: 44.02, precio: 0.929, total: 40.89, kmTotales: 3049 }),
    reg({ id: 'REP-000001', fecha: '2026-06-26', tipo: 'Gasolina 98', litros: 41.04, precio: 1.535, total: 63.00, kmTotales: 3049 }),
    reg({ id: 'REP-915015', fecha: '2026-07-31', tipo: 'GLP',         litros: 33.71, precio: 0.898, total: 30.27, kmTotales: 3803, kmTramo: 754 }),
    reg({ id: 'REP-915015', fecha: '2026-07-31', tipo: 'Gasolina 98', litros: 33.98, precio: 1.555, total: 52.84, kmTotales: 3803, kmTramo: 754 }),
    reg({ id: 'REP-498973', fecha: '2026-08-10', tipo: 'GLP',         litros: 42.95, precio: 0.898, total: 38.57, kmTotales: 4279, kmTramo: 476 }),
    reg({ id: 'REP-008768', fecha: '2026-08-28', tipo: 'GLP',         litros: 43.94, precio: 0.898, total: 39.46, kmTotales: 4907,
          kmTramo: 628, kmGLP: 433.1, kmGas: 195, kmCalculo: 433.1, consumoReal: 10.15, costeKmReal: 0.0911 })
  ]);
  cerca(a.gastoTotal, 265.03, 0.01);
  cerca(a.kmMax, 4907);
  cerca(a.kmGLP, 433.1, 0.01);
  cerca(a.kmGas, 195);
  cerca(a.costeGLP, 0.0911);
  assert.strictEqual(a.costeGas, null, 'todavía no hay ninguna ventana de gasolina medida');
  assert.strictEqual(a.equilibrio, null);
  assert.strictEqual(a.ahorroMedido, null);
});

console.log('\n' + pasadas + ' pasadas, ' + fallidas + ' fallidas\n');
process.exit(fallidas ? 1 : 0);
