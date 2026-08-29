/**
 * Banco de pruebas del motor de cálculo.
 *
 *   node test/motor.test.js
 *
 * Carga Script.Repostaje.gs tal cual, con un Sheet simulado en memoria y unos
 * stubs mínimos de los servicios de Apps Script. Así se prueba el código que se
 * despliega, no una copia que se queda desfasada.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const RUTA_GS = path.join(__dirname, '..', 'Script.Repostaje.gs');

// ============================================================
//  Sheet simulado
// ============================================================

function crearHoja(filas, columnas) {
  const datos = filas.map(f => {
    const fila = f.slice();
    while (fila.length < columnas) fila.push('');
    return fila;
  });

  const hoja = {
    _datos: datos,
    getName: () => 'Registro de Repostajes',
    setName() { return hoja; },
    getLastRow: () => datos.length,
    getMaxRows: () => datos.length,
    getMaxColumns: () => (datos[0] ? datos[0].length : 0),
    setFrozenRows: () => hoja,
    insertColumnsAfter(desde, cuantas) {
      datos.forEach(f => { for (let i = 0; i < cuantas; i++) f.push(''); });
      return hoja;
    },
    insertRowsAfter(desde, cuantas) {
      const ancho = datos[0] ? datos[0].length : 0;
      for (let i = 0; i < cuantas; i++) datos.push(new Array(ancho).fill(''));
      return hoja;
    },
    getRange(fila, col, nFilas, nCols) {
      nFilas = nFilas || 1;
      nCols = nCols || 1;
      const rango = {
        getValue: () => (datos[fila - 1] || [])[col - 1],
        getValues() {
          const out = [];
          for (let r = 0; r < nFilas; r++) {
            const origen = datos[fila - 1 + r] || [];
            const linea = [];
            for (let c = 0; c < nCols; c++) linea.push(origen[col - 1 + c] === undefined ? '' : origen[col - 1 + c]);
            out.push(linea);
          }
          return out;
        },
        setValues(v) {
          for (let r = 0; r < nFilas; r++) {
            if (!datos[fila - 1 + r]) datos[fila - 1 + r] = [];
            for (let c = 0; c < nCols; c++) datos[fila - 1 + r][col - 1 + c] = v[r][c];
          }
          return rango;
        },
        setFontWeight: () => rango,
        setBackground: () => rango,
        setFontColor: () => rango,
        setNumberFormat: () => rango,
        insertCheckboxes() {
          for (let r = 0; r < nFilas; r++) {
            for (let c = 0; c < nCols; c++) {
              const actual = datos[fila - 1 + r][col - 1 + c];
              datos[fila - 1 + r][col - 1 + c] = actual === true || actual === 'TRUE' || actual === 'Sí';
            }
          }
          return rango;
        }
      };
      return rango;
    }
  };
  return hoja;
}

function cargarBackend(hoja) {
  const codigo = fs.readFileSync(RUTA_GS, 'utf8');
  const contexto = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => hoja, getSheets: () => [hoja] }),
      flush() {},
      getUi() { throw new Error('sin interfaz'); }
    },
    DriveApp: {},
    UrlFetchApp: {},
    ContentService: { MimeType: {}, createTextOutput: t => t },
    Utilities: {
      formatDate(fecha, zona, patron) {
        const p = n => String(n).padStart(2, '0');
        return patron
          .replace('yyyy', fecha.getFullYear())
          .replace('MM', p(fecha.getMonth() + 1))
          .replace('dd', p(fecha.getDate()))
          .replace('HH', p(fecha.getHours()))
          .replace('mm', p(fecha.getMinutes()))
          .replace('ss', p(fecha.getSeconds()));
      }
    }
  };
  vm.createContext(contexto);
  vm.runInContext(codigo, contexto, { filename: 'Script.Repostaje.gs' });
  return contexto;
}

// ============================================================
//  Utilidades del banco de pruebas
// ============================================================

const CAB = [
  'ID', 'Timestamp', 'Estación', 'Tipo Combustible', 'Litros',
  'Precio por Litro (€)', 'Total Invertido (€)', 'KM Totales',
  'KM Recorridos (tramo)', 'Lectura KM GLP (coche)', 'Lectura KM Gasolina (coche)',
  'KM GLP (tramo)', 'KM Gasolina (tramo)', 'Consumo coche (L/100km)',
  'Consumo real (L/100km)', 'Coste por KM real (€/km)', 'Coste por KM coche (€/km)',
  'Enlace Recibo', 'KM de este combustible desde su último repostaje',
  'Depósito lleno', 'Fecha del ticket'
];

const I = {
  ID: 0, TS: 1, ESTACION: 2, TIPO: 3, LITROS: 4, PRECIO: 5, TOTAL: 6,
  KM_TOTAL: 7, KM_TRAMO: 8, LEC_GLP: 9, LEC_GAS: 10, KM_GLP: 11, KM_GAS: 12,
  CONS_COCHE: 13, CONS_REAL: 14, COSTE_REAL: 15, COSTE_COCHE: 16, RECIBO: 17,
  KM_CALC: 18, LLENO: 19, FECHA_TICKET: 20
};

/** Construye una fila a partir de un objeto corto, para que las pruebas se lean. */
function fila(o) {
  const f = new Array(CAB.length).fill('');
  f[I.ID]       = o.id;
  f[I.TS]       = o.ts || new Date(2026, 0, 1);
  f[I.ESTACION] = o.estacion || 'E.S. Prueba';
  f[I.TIPO]     = o.tipo;
  f[I.LITROS]   = o.litros === undefined ? '' : o.litros;
  f[I.PRECIO]   = o.precio === undefined ? '' : o.precio;
  f[I.TOTAL]    = o.total === undefined ? '' : o.total;
  f[I.KM_TOTAL] = o.km === undefined ? '' : o.km;
  f[I.LEC_GLP]  = o.lecGLP === undefined ? '' : o.lecGLP;
  f[I.LEC_GAS]  = o.lecGas === undefined ? '' : o.lecGas;
  f[I.CONS_COCHE]   = o.consCoche === undefined ? '' : o.consCoche;
  f[I.LLENO]        = o.lleno === undefined ? true : o.lleno;
  f[I.FECHA_TICKET] = o.fechaTicket || '';
  return f;
}

function recalcular(filas) {
  const hoja = crearHoja([CAB].concat(filas), CAB.length);
  const backend = cargarBackend(hoja);
  const resumen = backend.recalcularTodo();
  return { hoja, backend, resumen, filas: hoja._datos.slice(1) };
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
const cerca = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 0.005), 'esperaba ' + b + ' y salió ' + a);

// ============================================================
//  Pruebas
// ============================================================

console.log('\nMotor de cálculo — RefuelControl\n');

prueba('El primer repostaje de un combustible nunca da consumo', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, precio: 0.9, total: 36, km: 1000, lecGLP: 300, lecGas: 100 })
  ]);
  assert.strictEqual(r.filas[0][I.CONS_REAL], '');
  assert.strictEqual(r.filas[0][I.KM_CALC], '');
});

prueba('Ventana simple: dos llenados seguidos del mismo combustible', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, precio: 0.9, total: 36, km: 1000, lecGLP: 0, lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, precio: 0.9, total: 36, km: 1500, lecGLP: 500, lecGas: 0 })
  ]);
  cerca(r.filas[1][I.KM_CALC], 500);
  cerca(r.filas[1][I.CONS_REAL], 8);        // 40 L / 500 km * 100
  cerca(r.filas[1][I.COSTE_REAL], 0.072);   // 36 € / 500 km
});

prueba('La gasolina acumula km de los tramos en los que no se repostó', () => {
  // Llena los dos. Luego solo GLP. Luego los dos.
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP',         litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'A', tipo: 'Gasolina 98', litros: 40, total: 62, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP',         litros: 35, total: 31, km: 1410, lecGLP: 350, lecGas: 60 }),
    fila({ id: 'C', tipo: 'GLP',         litros: 30, total: 27, km: 1790, lecGLP: 300, lecGas: 80 }),
    fila({ id: 'C', tipo: 'Gasolina 98', litros: 10, total: 16, km: 1790, lecGLP: 300, lecGas: 80 })
  ]);
  cerca(r.filas[2][I.KM_CALC], 350);          // GLP del ticket B
  cerca(r.filas[3][I.KM_CALC], 300);          // GLP del ticket C
  cerca(r.filas[4][I.KM_CALC], 140);          // gasolina: 60 + 80, viene llena desde A
  cerca(r.filas[4][I.CONS_REAL], 7.14);       // 10 L / 140 km * 100
});

prueba('Un parcial no cierra la ventana: sus litros pasan al siguiente llenado', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 10, total: 9,  km: 1200, lecGLP: 200, lecGas: 0, lleno: false }),
    fila({ id: 'C', tipo: 'GLP', litros: 30, total: 27, km: 1500, lecGLP: 300, lecGas: 0 })
  ]);
  assert.strictEqual(r.filas[1][I.CONS_REAL], '', 'el parcial no debe dar consumo');
  assert.strictEqual(r.filas[1][I.KM_CALC], '');
  cerca(r.filas[2][I.KM_CALC], 500);          // 200 + 300
  cerca(r.filas[2][I.CONS_REAL], 8);          // (10 + 30) L / 500 km * 100
  cerca(r.filas[2][I.COSTE_REAL], 0.072);     // (9 + 27) € / 500 km
});

prueba('Sin el interruptor, un repostaje corto falseaba el consumo', () => {
  // El mismo caso de arriba pero marcando el parcial como lleno: sale disparatado.
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 10, total: 9,  km: 1200, lecGLP: 200, lecGas: 0 }),
    fila({ id: 'C', tipo: 'GLP', litros: 30, total: 27, km: 1500, lecGLP: 300, lecGas: 0 })
  ]);
  cerca(r.filas[1][I.CONS_REAL], 5);          // 10 L / 200 km — falso, el depósito no se llenó
  cerca(r.filas[2][I.CONS_REAL], 10);         // 30 L / 300 km — también falso
});

prueba('Un tramo sin parcial deja ese repostaje vacío, pero el llenado reabre la cuenta', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0, lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 20, total: 18, km: 1300 }),                       // sin parciales
    fila({ id: 'C', tipo: 'GLP', litros: 30, total: 27, km: 1600, lecGLP: 300, lecGas: 0 })
  ]);
  assert.strictEqual(r.filas[1][I.CONS_REAL], '', 'no se sabe cuántos km hizo hasta B');
  cerca(r.filas[2][I.CONS_REAL], 10, 0.01);   // en B llenó, así que la ventana B->C sí vale
});

prueba('Si el tramo desconocido cae dentro de una ventana abierta, no hay consumo', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0, lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 10, total: 9,  km: 1300, lleno: false }),          // parcial y sin parciales
    fila({ id: 'C', tipo: 'GLP', litros: 30, total: 27, km: 1600, lecGLP: 300, lecGas: 0 })
  ]);
  assert.strictEqual(r.filas[1][I.CONS_REAL], '');
  assert.strictEqual(r.filas[2][I.CONS_REAL], '', 'faltan los km del tramo A->B, que forman parte de la ventana');
});

prueba('El aviso de coherencia salta cuando los parciales no cuadran', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500, lecGLP: 200, lecGas: 50 })  // 250 frente a 500
  ]);
  assert.strictEqual(r.resumen.avisos.length, 1);
  assert.ok(/no cuadran/.test(r.resumen.avisos[0].texto));
});

prueba('Cada ventana se escribe una sola vez, sin duplicar kilómetros', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500, lecGLP: 500, lecGas: 0 }),
    fila({ id: 'C', tipo: 'GLP', litros: 20, total: 18, km: 1750, lecGLP: 250, lecGas: 0 })
  ]);
  const kmVentanas = r.filas.map(f => f[I.KM_CALC]).filter(v => v !== '');
  cerca(kmVentanas.reduce((a, b) => a + b, 0), 750);   // 500 + 250, ni un km contado dos veces
});

prueba('El coste por km del coche sale del precio y del consumo del ordenador', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, precio: 0.9, total: 36, km: 1000, consCoche: 10 })
  ]);
  cerca(r.filas[0][I.COSTE_COCHE], 0.09);     // 0,9 €/L * 10 L/100km / 100
});

prueba('La fecha del ticket manda sobre el timestamp', () => {
  const hoja = crearHoja([CAB, fila({
    id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000,
    ts: new Date(2026, 7, 29, 10, 0, 0), fechaTicket: '27/08/2026'
  })], CAB.length);
  const backend = cargarBackend(hoja);
  const d = backend.getDashboardData();
  assert.strictEqual(d.registros[0].fecha, '2026-08-27');
  assert.strictEqual(d.registros[0].fechaRegistro, '2026-08-29');
  assert.strictEqual(d.registros[0].fechaDelTicket, true);
});

prueba('Sin fecha de ticket se usa la de registro como respaldo', () => {
  const hoja = crearHoja([CAB, fila({
    id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, ts: new Date(2026, 7, 29, 10, 0, 0)
  })], CAB.length);
  const backend = cargarBackend(hoja);
  const d = backend.getDashboardData();
  assert.strictEqual(d.registros[0].fecha, '2026-08-29');
  assert.strictEqual(d.registros[0].fechaDelTicket, false);
});

prueba('aFecha entiende los tres formatos que llegan', () => {
  const backend = cargarBackend(crearHoja([CAB], CAB.length));
  assert.strictEqual(backend.aFecha('2026-08-27').getDate(), 27);
  assert.strictEqual(backend.aFecha('27/08/2026').getMonth(), 7);
  assert.strictEqual(backend.aFecha('27-08-26').getFullYear(), 2026);
  assert.strictEqual(backend.aFecha(''), null);
  assert.strictEqual(backend.aFecha('lo que sea'), null);
});

prueba('Una celda vacía en «Depósito lleno» cuenta como lleno', () => {
  const backend = cargarBackend(crearHoja([CAB], CAB.length));
  assert.strictEqual(backend.esLleno(''), true);
  assert.strictEqual(backend.esLleno(true), true);
  assert.strictEqual(backend.esLleno(false), false);
  assert.strictEqual(backend.esLleno('FALSE'), false);
  assert.strictEqual(backend.esLleno('No'), false);
});

prueba('El CSV lleva las 21 columnas, punto y coma y coma decimal', () => {
  const hoja = crearHoja([CAB, fila({
    id: 'A', tipo: 'GLP', litros: 43.94, precio: 0.898, total: 39.46, km: 4907
  })], CAB.length);
  const backend = cargarBackend(hoja);
  const csv = backend.exportarCSV();
  const lineas = csv.csv.split('\r\n');
  assert.strictEqual(lineas[0].split(';').length, 21);
  assert.ok(lineas[1].indexOf('43,94') >= 0, 'los decimales van con coma');
  assert.ok(/;Sí;/.test(lineas[1]), 'el depósito lleno se exporta legible');
  assert.strictEqual(csv.filas, 1);
});

prueba('El odómetro no puede retroceder', () => {
  const hoja = crearHoja([CAB, fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 4907 })], CAB.length);
  const backend = cargarBackend(hoja);
  const r = backend.guardarRepostaje({ kmTotales: 4800, items: [{ tipo: 'GLP', litros: 30, total: 27 }] });
  assert.strictEqual(r.ok, false);
  assert.ok(/menores que/.test(r.error));
});

// ============================================================
//  Los datos reales de la hoja, tal y como están hoy
// ============================================================

prueba('Los cuatro repostajes reales dan el mismo resultado que en la hoja', () => {
  const r = recalcular([
    fila({ id: 'REP-000001', tipo: 'GLP',         litros: 44.02, precio: 0.929, total: 40.89, km: 3049 }),
    fila({ id: 'REP-000001', tipo: 'Gasolina 98', litros: 41.04, precio: 1.535, total: 63.00, km: 3049 }),
    fila({ id: 'REP-915015', tipo: 'GLP',         litros: 33.71, precio: 0.898, total: 30.27, km: 3803 }),
    fila({ id: 'REP-915015', tipo: 'Gasolina 98', litros: 33.98, precio: 1.555, total: 52.84, km: 3803 }),
    fila({ id: 'REP-498973', tipo: 'GLP',         litros: 42.95, precio: 0.898, total: 38.57, km: 4279 }),
    fila({ id: 'REP-008768', tipo: 'GLP',         litros: 43.94, precio: 0.898, total: 39.46, km: 4907,
           lecGLP: 433.1, lecGas: 195 })
  ]);

  // Solo el último tiene parciales, así que es el único con consumo real
  assert.strictEqual(r.filas[0][I.CONS_REAL], '');
  assert.strictEqual(r.filas[2][I.CONS_REAL], '');
  assert.strictEqual(r.filas[4][I.CONS_REAL], '');
  cerca(r.filas[5][I.KM_CALC], 433.1);
  cerca(r.filas[5][I.CONS_REAL], 10.15);
  cerca(r.filas[5][I.COSTE_REAL], 0.0911);
});

console.log('\n' + pasadas + ' pasadas, ' + fallidas + ' fallidas\n');
process.exit(fallidas ? 1 : 0);
