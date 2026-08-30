// ==========================================================
//  FORMATO — funciones puras
//
//  Nada de DOM ni de red: entra un número o una fecha y sale un
//  texto. Por eso se puede probar sin navegador.
// ==========================================================

const nulo = v => v === null || v === undefined || isNaN(v);

/** 12.3 -> «12,30 €» */
export const eur = v => nulo(v)
  ? '—'
  : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

/** 1234.7 -> «1.235 km» */
export const km = v => nulo(v) ? '—' : Math.round(v).toLocaleString('es-ES') + ' km';

/** Decimales con coma española. */
export const dec = (v, d = 2) => nulo(v)
  ? '—'
  : v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

/** «2026-08-29» -> «29/08» */
export const ddmm = f => f ? f.split('-').reverse().slice(0, 2).join('/') : '';

/** «2026-08-29» -> «29 ago 2026» */
export const fechaLarga = f => {
  if (!f) return '';
  const [a, m, d] = f.split('-');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return d + ' ' + meses[+m - 1] + ' ' + a;
};

/** Días de diferencia entre dos fechas ISO, en valor absoluto. */
export const dias = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

/** Escapa lo que se mete en innerHTML. Los nombres de estación vienen de un ticket. */
export const esc = s => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Quita el «E.S.» de delante del nombre de una estación, que no aporta nada. */
export const sinES = s => String(s || '').replace(/^E\.?\s?S\.?\s*/i, '');

/** «2026-08» -> «08/26», que es lo que cabe en el eje de un gráfico. */
export const mesCorto = m => {
  const p = String(m).split('-');
  return p[1] + '/' + p[0].slice(2);
};
