/**
 * Banco de pruebas del motor de cálculo.
 *
 *   node test/motor.test.js
 *
 * Carga Script.Repostaje.gs tal cual, con un libro simulado en memoria y unos
 * stubs mínimos de los servicios de Apps Script. Así se prueba el código que se
 * despliega, no una copia que se queda desfasada.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const RUTA_GS = path.join(__dirname, '..', 'Script.Repostaje.gs');

// ============================================================
//  Libro simulado
// ============================================================

function crearHoja(nombre, filas, columnas) {
  const datos = filas.map(f => {
    const fila = f.slice();
    while (fila.length < columnas) fila.push('');
    return fila;
  });

  const hoja = {
    _nombre: nombre,
    _datos: datos,
    getName: () => hoja._nombre,
    setName(n) { hoja._nombre = n; return hoja; },
    getLastRow() {
      for (let i = datos.length - 1; i >= 0; i--) {
        if (datos[i].some(v => v !== '' && v !== null && v !== undefined)) return i + 1;
      }
      return 0;
    },
    getMaxRows: () => datos.length,
    getMaxColumns: () => (datos[0] ? datos[0].length : 0),
    setFrozenRows: () => hoja,
    hideSheet: () => hoja,
    clear() { datos.length = 0; return hoja; },
    copyTo() { return crearHoja('copia', datos.map(f => f.slice()), columnas); },
    insertColumnsAfter(desde, cuantas) {
      datos.forEach(f => { for (let i = 0; i < cuantas; i++) f.push(''); });
      return hoja;
    },
    insertRowsAfter(desde, cuantas) {
      const ancho = datos[0] ? datos[0].length : columnas;
      for (let i = 0; i < cuantas; i++) datos.splice(desde + i, 0, new Array(ancho).fill(''));
      return hoja;
    },
    deleteRow(fila) { datos.splice(fila - 1, 1); return hoja; },
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

function crearLibro(hojaPrincipal) {
  const hojas = [hojaPrincipal];
  return {
    hojas,
    getSheetByName: n => hojas.filter(h => h.getName() === n)[0] || null,
    getSheets: () => hojas,
    insertSheet(n) {
      const h = crearHoja(n, [], 30);
      hojas.push(h);
      return h;
    }
  };
}

function cargarBackend(libro) {
  const codigo = fs.readFileSync(RUTA_GS, 'utf8');
  const contexto = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => libro,
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
  'Depósito lleno', 'Fecha del ticket', 'Latitud', 'Longitud'
];

const I = {
  ID: 0, TS: 1, ESTACION: 2, TIPO: 3, LITROS: 4, PRECIO: 5, TOTAL: 6,
  KM_TOTAL: 7, KM_TRAMO: 8, LEC_GLP: 9, LEC_GAS: 10, KM_GLP: 11, KM_GAS: 12,
  CONS_COCHE: 13, CONS_REAL: 14, COSTE_REAL: 15, COSTE_COCHE: 16, RECIBO: 17,
  KM_CALC: 18, LLENO: 19, FECHA_TICKET: 20, LAT: 21, LON: 22
};
const BORRADO = CAB.length, BAJA = CAB.length + 1;

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
  f[I.LAT]          = o.lat === undefined ? '' : o.lat;
  f[I.LON]          = o.lon === undefined ? '' : o.lon;
  return f;
}

function montar(filas) {
  const hoja = crearHoja('Registro de Repostajes', [CAB].concat(filas), CAB.length);
  const libro = crearLibro(hoja);
  const backend = cargarBackend(libro);
  return { hoja, libro, backend, datos: () => hoja._datos.slice(1) };
}

function recalcular(filas) {
  const m = montar(filas);
  const resumen = m.backend.recalcularTodo();
  return Object.assign(m, { resumen, filas: m.datos() });
}

function copiaDe(m) {
  const h = m.libro.getSheetByName('Copia de seguridad');
  return h ? h._datos.slice(1).filter(f => f[I.ID]) : [];
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
/** Los valores vienen del sandbox: instanceof Date no funciona entre realms. */
const esFecha = v => !!v && typeof v.getTime === 'function' && !isNaN(v.getTime());

// ============================================================
//  Motor de cálculo
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
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP',         litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'A', tipo: 'Gasolina 98', litros: 40, total: 62, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP',         litros: 35, total: 31, km: 1410, lecGLP: 350, lecGas: 60 }),
    fila({ id: 'C', tipo: 'GLP',         litros: 30, total: 27, km: 1790, lecGLP: 300, lecGas: 80 }),
    fila({ id: 'C', tipo: 'Gasolina 98', litros: 10, total: 16, km: 1790, lecGLP: 300, lecGas: 80 })
  ]);
  cerca(r.filas[2][I.KM_CALC], 350);
  cerca(r.filas[3][I.KM_CALC], 300);
  cerca(r.filas[4][I.KM_CALC], 140);          // 60 + 80, viene llena desde A
  cerca(r.filas[4][I.CONS_REAL], 7.14);
});

prueba('Un parcial no cierra la ventana: sus litros pasan al siguiente llenado', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 10, total: 9,  km: 1200, lecGLP: 200, lecGas: 0, lleno: false }),
    fila({ id: 'C', tipo: 'GLP', litros: 30, total: 27, km: 1500, lecGLP: 300, lecGas: 0 })
  ]);
  assert.strictEqual(r.filas[1][I.CONS_REAL], '', 'el parcial no debe dar consumo');
  cerca(r.filas[2][I.KM_CALC], 500);
  cerca(r.filas[2][I.CONS_REAL], 8);          // (10 + 30) L / 500 km * 100
  cerca(r.filas[2][I.COSTE_REAL], 0.072);
});

prueba('Sin el interruptor, un repostaje corto falseaba el consumo', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 10, total: 9,  km: 1200, lecGLP: 200, lecGas: 0 }),
    fila({ id: 'C', tipo: 'GLP', litros: 30, total: 27, km: 1500, lecGLP: 300, lecGas: 0 })
  ]);
  cerca(r.filas[1][I.CONS_REAL], 5);
  cerca(r.filas[2][I.CONS_REAL], 10);
});

prueba('Un tramo sin parcial deja ese repostaje vacío, pero el llenado reabre la cuenta', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0, lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 20, total: 18, km: 1300 }),
    fila({ id: 'C', tipo: 'GLP', litros: 30, total: 27, km: 1600, lecGLP: 300, lecGas: 0 })
  ]);
  assert.strictEqual(r.filas[1][I.CONS_REAL], '');
  cerca(r.filas[2][I.CONS_REAL], 10, 0.01);
});

prueba('Si el tramo desconocido cae dentro de una ventana abierta, no hay consumo', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0, lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 10, total: 9,  km: 1300, lleno: false }),
    fila({ id: 'C', tipo: 'GLP', litros: 30, total: 27, km: 1600, lecGLP: 300, lecGas: 0 })
  ]);
  assert.strictEqual(r.filas[1][I.CONS_REAL], '');
  assert.strictEqual(r.filas[2][I.CONS_REAL], '');
});

prueba('El aviso de coherencia salta cuando los parciales no cuadran', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500, lecGLP: 200, lecGas: 50 })
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
  cerca(kmVentanas.reduce((a, b) => a + b, 0), 750);
});

prueba('El coste por km del coche sale del precio y del consumo del ordenador', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, precio: 0.9, total: 36, km: 1000, consCoche: 10 })
  ]);
  cerca(r.filas[0][I.COSTE_COCHE], 0.09);
});

prueba('Un odómetro desordenado se avisa, no se reordena por sorpresa', () => {
  const r = recalcular([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 2000 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500 })
  ]);
  assert.strictEqual(r.resumen.ordenAvisos.length, 1);
  assert.ok(/desordenadas/.test(r.resumen.ordenAvisos[0].texto));
});

// ============================================================
//  Fechas y esquema
// ============================================================

prueba('La fecha del ticket manda sobre el timestamp', () => {
  const m = montar([fila({
    id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000,
    ts: new Date(2026, 7, 29, 10, 0, 0), fechaTicket: '27/08/2026'
  })]);
  const d = m.backend.getDashboardData();
  assert.strictEqual(d.registros[0].fecha, '2026-08-27');
  assert.strictEqual(d.registros[0].fechaRegistro, '2026-08-29');
  assert.strictEqual(d.registros[0].fechaDelTicket, true);
});

prueba('Sin fecha de ticket se usa la de registro como respaldo', () => {
  const m = montar([fila({
    id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, ts: new Date(2026, 7, 29, 10, 0, 0)
  })]);
  const d = m.backend.getDashboardData();
  assert.strictEqual(d.registros[0].fecha, '2026-08-29');
  assert.strictEqual(d.registros[0].fechaDelTicket, false);
});

prueba('aFecha entiende los tres formatos que llegan', () => {
  const b = montar([]).backend;
  assert.strictEqual(b.aFecha('2026-08-27').getDate(), 27);
  assert.strictEqual(b.aFecha('27/08/2026').getMonth(), 7);
  assert.strictEqual(b.aFecha('27-08-26').getFullYear(), 2026);
  assert.strictEqual(b.aFecha(''), null);
  assert.strictEqual(b.aFecha('lo que sea'), null);
});

prueba('Una celda vacía en «Depósito lleno» cuenta como lleno', () => {
  const b = montar([]).backend;
  assert.strictEqual(b.esLleno(''), true);
  assert.strictEqual(b.esLleno(true), true);
  assert.strictEqual(b.esLleno(false), false);
  assert.strictEqual(b.esLleno('FALSE'), false);
  assert.strictEqual(b.esLleno('No'), false);
});

prueba('El CSV lleva las 23 columnas, punto y coma y coma decimal', () => {
  const m = montar([fila({ id: 'A', tipo: 'GLP', litros: 43.94, precio: 0.898, total: 39.46, km: 4907 })]);
  const csv = m.backend.exportarCSV();
  const lineas = csv.csv.split('\r\n');
  assert.strictEqual(lineas[0].split(';').length, 23);
  assert.ok(lineas[1].indexOf('43,94') >= 0, 'los decimales van con coma');
  assert.ok(/;Sí;/.test(lineas[1]), 'el depósito lleno se exporta legible');
  assert.strictEqual(csv.filas, 1);
});

prueba('El odómetro no puede retroceder al guardar', () => {
  const m = montar([fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 4907 })]);
  const r = m.backend.guardarRepostaje({ kmTotales: 4800, items: [{ tipo: 'GLP', litros: 30, total: 27 }] });
  assert.strictEqual(r.ok, false);
  assert.ok(/menores que/.test(r.error));
});

// ============================================================
//  Editar y borrar (roadmap 2.1)
// ============================================================

prueba('Editar cambia los valores y recalcula', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP', litros: 40, precio: 0.9, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, precio: 0.9, total: 36, km: 1500, lecGLP: 500, lecGas: 0 })
  ]);
  const r = m.backend.editarRepostaje({
    id: 'B', kmTotales: 1500, lecturaGLP: 500, lecturaGasolina: 0,
    items: [{ tipo: 'GLP', litros: 50, precio_litro: 0.9, total: 45, lleno: true }]
  });
  assert.strictEqual(r.ok, true);
  const d = m.datos();
  cerca(d[1][I.LITROS], 50);
  cerca(d[1][I.CONS_REAL], 10);              // 50 L / 500 km, recalculado solo
});

prueba('Editar conserva la posición de la fila, que es el orden cronológico', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500 }),
    fila({ id: 'C', tipo: 'GLP', litros: 40, total: 36, km: 2000 })
  ]);
  m.backend.editarRepostaje({
    id: 'B', kmTotales: 1500, items: [{ tipo: 'GLP', litros: 41, total: 37, lleno: true }]
  });
  assert.strictEqual(m.datos().map(f => f[I.ID]).join(','), 'A,B,C');
});

prueba('Editar puede pasar un ticket de uno a dos combustibles', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500 })
  ]);
  m.backend.editarRepostaje({
    id: 'A', kmTotales: 1000,
    items: [
      { tipo: 'GLP', litros: 40, total: 36, lleno: true },
      { tipo: 'Gasolina 98', litros: 30, total: 46, lleno: true }
    ]
  });
  const d = m.datos();
  assert.strictEqual(d.length, 3);
  assert.strictEqual(d.map(f => f[I.ID]).join(','), 'A,A,B');
  assert.strictEqual(d[1][I.TIPO], 'Gasolina 98');
});

prueba('Editar puede pasar un ticket de dos combustibles a uno', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP',         litros: 40, total: 36, km: 1000 }),
    fila({ id: 'A', tipo: 'Gasolina 98', litros: 30, total: 46, km: 1000 }),
    fila({ id: 'B', tipo: 'GLP',         litros: 40, total: 36, km: 1500 })
  ]);
  m.backend.editarRepostaje({
    id: 'A', kmTotales: 1000, items: [{ tipo: 'GLP', litros: 40, total: 36, lleno: true }]
  });
  const d = m.datos();
  assert.strictEqual(d.length, 2);
  assert.strictEqual(d.map(f => f[I.ID]).join(','), 'A,B');
});

prueba('Editar sin combustibles se rechaza', () => {
  const m = montar([fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000 })]);
  const r = m.backend.editarRepostaje({ id: 'A', kmTotales: 1000, items: [] });
  assert.strictEqual(r.ok, false);
  assert.ok(/al menos un combustible/.test(r.error));
});

prueba('Editar un ID que no existe se rechaza', () => {
  const m = montar([fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000 })]);
  const r = m.backend.editarRepostaje({ id: 'Z', kmTotales: 1, items: [{ tipo: 'GLP', litros: 1, total: 1 }] });
  assert.strictEqual(r.ok, false);
  assert.ok(/No encuentro/.test(r.error));
});

prueba('Borrar quita las dos filas de un ticket bífuel y recalcula', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP',         litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP',         litros: 40, total: 36, km: 1500, lecGLP: 500, lecGas: 0 }),
    fila({ id: 'B', tipo: 'Gasolina 98', litros: 30, total: 46, km: 1500, lecGLP: 500, lecGas: 0 }),
    fila({ id: 'C', tipo: 'GLP',         litros: 40, total: 36, km: 2000, lecGLP: 500, lecGas: 0 })
  ]);
  const r = m.backend.borrarRepostaje('B');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.filasBorradas, 2);
  assert.strictEqual(m.datos().map(f => f[I.ID]).join(','), 'A,C');
});

prueba('Borrar un ID que no existe se rechaza', () => {
  const m = montar([fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000 })]);
  const r = m.backend.borrarRepostaje('Z');
  assert.strictEqual(r.ok, false);
});

// ============================================================
//  Copia de seguridad
// ============================================================

prueba('La copia recoge todas las filas vivas', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP',         litros: 40, total: 36, km: 1000 }),
    fila({ id: 'A', tipo: 'Gasolina 98', litros: 30, total: 46, km: 1000 })
  ]);
  m.backend.recalcularTodo();
  const c = copiaDe(m);
  assert.strictEqual(c.length, 2);
  assert.ok(c.every(f => f[BORRADO] === false), 'ninguna está marcada como borrada');
});

prueba('Lo borrado sigue en la copia, marcado y con fecha de baja', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500 })
  ]);
  m.backend.recalcularTodo();
  m.backend.borrarRepostaje('B');

  const c = copiaDe(m);
  assert.strictEqual(c.length, 2, 'la copia conserva las dos, viva y borrada');
  const borrada = c.filter(f => f[I.ID] === 'B')[0];
  assert.strictEqual(borrada[BORRADO], true);
  // Los objetos vienen del sandbox, así que instanceof no vale entre realms
  assert.ok(esFecha(borrada[BAJA]), 'lleva fecha de baja');
  cerca(borrada[I.LITROS], 40, 0.001);
  assert.strictEqual(c.filter(f => f[I.ID] === 'A')[0][BORRADO], false);
});

prueba('Editar actualiza la fila de la copia sin duplicarla', () => {
  const m = montar([fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000 })]);
  m.backend.recalcularTodo();
  m.backend.editarRepostaje({
    id: 'A', kmTotales: 1000, items: [{ tipo: 'GLP', litros: 42, total: 38, lleno: true }]
  });
  const c = copiaDe(m);
  assert.strictEqual(c.length, 1);
  cerca(c[0][I.LITROS], 42, 0.001);
  assert.strictEqual(c[0][BORRADO], false);
});

prueba('Un repostaje borrado y vuelto a crear no pierde el registro del borrado', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500 })
  ]);
  m.backend.recalcularTodo();
  m.backend.borrarRepostaje('B');
  m.backend.guardarRepostaje({ kmTotales: 1600, items: [{ tipo: 'GLP', litros: 38, total: 34 }] });

  const c = copiaDe(m);
  assert.strictEqual(c.length, 3, 'A viva, B borrada y la nueva');
  assert.strictEqual(c.filter(f => f[BORRADO] === true).length, 1);
});

prueba('Recalcular dos veces no reabre ni duplica nada en la copia', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500 })
  ]);
  m.backend.recalcularTodo();
  m.backend.borrarRepostaje('B');
  const antes = copiaDe(m).filter(f => f[I.ID] === 'B')[0][BAJA];
  m.backend.recalcularTodo();
  m.backend.recalcularTodo();
  const c = copiaDe(m);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c.filter(f => f[I.ID] === 'B')[0][BAJA].getTime(), antes.getTime(),
    'la fecha de baja no se reescribe en cada recálculo');
});

// ============================================================
//  Estado de los depósitos (roadmap 3.3)
// ============================================================

prueba('Los km desde el último llenado se cuentan por depósito', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP',         litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'A', tipo: 'Gasolina 98', litros: 40, total: 62, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP',         litros: 35, total: 31, km: 1410, lecGLP: 350, lecGas: 60 }),
    fila({ id: 'C', tipo: 'GLP',         litros: 30, total: 27, km: 1790, lecGLP: 300, lecGas: 80 })
  ]);
  const e = m.backend.estadoDepositos();
  cerca(e.kmDesdeLlenadoGLP, 0);         // acaba de llenar GLP en C
  cerca(e.kmDesdeLlenadoGasolina, 140);  // 60 + 80 desde el llenado de A
  assert.strictEqual(e.capacidadGLP, 45);
  assert.strictEqual(e.capacidadGasolina, 50);
});

prueba('Un repostaje parcial no reinicia la cuenta del depósito', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0,   lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 10, total: 9,  km: 1200, lecGLP: 200, lecGas: 0, lleno: false })
  ]);
  const e = m.backend.estadoDepositos();
  cerca(e.kmDesdeLlenadoGLP, 200);
});

prueba('Si falta un parcial, los km desde el llenado se dejan vacíos', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, lecGLP: 0, lecGas: 0 }),
    fila({ id: 'B', tipo: 'GLP', litros: 10, total: 9,  km: 1200, lleno: false })
  ]);
  const e = m.backend.estadoDepositos();
  assert.strictEqual(e.kmDesdeLlenadoGLP, null);
});

// ============================================================
//  Coordenadas (roadmap 3.2)
// ============================================================

prueba('Las coordenadas se guardan y se agregan por estación', () => {
  const m = montar([
    fila({ id: 'A', tipo: 'GLP', litros: 40, total: 36, km: 1000, estacion: 'E.S. Anchieta', lat: 28.4823, lon: -16.3211 }),
    fila({ id: 'B', tipo: 'GLP', litros: 40, total: 36, km: 1500, estacion: 'E.S. Anchieta', lat: 28.4825, lon: -16.3213 }),
    fila({ id: 'C', tipo: 'GLP', litros: 40, total: 36, km: 2000, estacion: 'E.S. Sin coordenadas' })
  ]);
  const u = m.backend.ubicacionesConocidas();
  assert.strictEqual(u.length, 1, 'solo las estaciones con coordenadas');
  cerca(u[0].lat, 28.4824, 0.0001);
  cerca(u[0].lon, -16.3212, 0.0001);
});

prueba('Guardar acepta latitud y longitud', () => {
  const m = montar([]);
  const r = m.backend.guardarRepostaje({
    kmTotales: 1000, estacion: 'E.S. Nueva', lat: 28.5, lon: -16.3,
    items: [{ tipo: 'GLP', litros: 40, total: 36 }]
  });
  assert.strictEqual(r.ok, true);
  const d = m.datos();
  cerca(d[0][I.LAT], 28.5, 0.0001);
  cerca(d[0][I.LON], -16.3, 0.0001);
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

  assert.strictEqual(r.filas[0][I.CONS_REAL], '');
  assert.strictEqual(r.filas[2][I.CONS_REAL], '');
  assert.strictEqual(r.filas[4][I.CONS_REAL], '');
  cerca(r.filas[5][I.KM_CALC], 433.1);
  cerca(r.filas[5][I.CONS_REAL], 10.15);
  cerca(r.filas[5][I.COSTE_REAL], 0.0911);
});

console.log('\n' + pasadas + ' pasadas, ' + fallidas + ' fallidas\n');
process.exit(fallidas ? 1 : 0);
