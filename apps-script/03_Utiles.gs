/**
 * RefuelControl · Utilidades
 *
 * Conversiones de tipo, número y fecha que usa todo lo demás. Sin
 * SpreadsheetApp: son funciones puras.
 *
 * Parte del backend de RefuelControl. Apps Script mete todos los archivos del
 * proyecto en el mismo ámbito global, así que el prefijo numérico solo sirve
 * para leerlos en orden; las funciones se llaman entre archivos sin importar
 * nada. Despliegue: Implementar > Gestionar implementaciones > Nueva versión.
 */

function esGLP(tipo) { return String(tipo).toUpperCase().indexOf('GLP') >= 0; }

/** Una celda vacía significa «lleno»: es lo que se hacía antes de existir la columna. */
function esLleno(v) {
  if (v === '' || v === null || v === undefined) return true;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toUpperCase();
  return !(s === 'FALSE' || s === 'NO' || s === '0' || s === 'PARCIAL');
}

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const x = parseFloat(String(v).replace(',', '.'));
  return isNaN(x) ? null : x;
}

/** Acepta Date, yyyy-mm-dd (input date) y dd/mm/aaaa (lo que devuelve Gemini). */
function aFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let anio = +m[3];
    if (anio < 100) anio += 2000;
    return new Date(anio, +m[2] - 1, +m[1]);
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Fecha con la que se ordena y se agrupa: la del ticket, y si falta la de registro. */
function fechaEfectiva(fila) {
  return aFecha(fila[C.FECHA_TICKET]) || aFecha(fila[C.TS]);
}

function redondear(v, dec) {
  if (v === null || v === undefined || isNaN(v) || !isFinite(v)) return null;
  const f = Math.pow(10, dec);
  return Math.round(v * f) / f;
}

function vacio(v) { return v === null || v === undefined ? '' : v; }
