/**
 * RefuelControl · Guardar, editar y borrar
 *
 * Escribe solo los datos de entrada y deja que el motor rellene todo lo
 * derivado. La edición conserva la posición de las filas, que es el
 * orden cronológico del que vive el cálculo.
 *
 * Parte del backend de RefuelControl. Apps Script mete todos los archivos del
 * proyecto en el mismo ámbito global, así que el prefijo numérico solo sirve
 * para leerlos en orden; las funciones se llaman entre archivos sin importar
 * nada. Despliegue: Implementar > Gestionar implementaciones > Nueva versión.
 */

// ============================================================
//  PASO 3 — GUARDAR
//  Escribe solo los datos de entrada y deja que recalcularTodo()
//  rellene todo lo derivado. Una única fuente de verdad.
// ============================================================

function guardarRepostaje(datos) {
  const hoja = getHoja();

  const items = (datos.items || []).map(normalizarItem).filter(i => i.litros > 0 || i.total > 0);
  if (!items.length) return { ok: false, error: 'No hay ningún combustible que guardar.' };

  const kmTotales = num(datos.kmTotales);
  if (kmTotales === null) return { ok: false, error: 'Faltan los KM totales.' };

  // Validación dura: el odómetro no retrocede
  const kmMaximo = maximoKmRegistrado();
  if (kmMaximo !== null && kmTotales < kmMaximo) {
    return {
      ok: false,
      error: 'Los KM totales (' + kmTotales + ') son menores que los del último registro (' +
             kmMaximo + '). Revisa el odómetro antes de guardar.'
    };
  }

  const idRecibo = 'REP-' + new Date().getTime().toString().slice(-6);
  const ahora = new Date();
  const fechaTicket = aFecha(datos.fechaTicket);

  // Renombramos la foto con el ID definitivo
  let urlRecibo = (datos.recibo && datos.recibo.url) || '';
  if (datos.recibo && datos.recibo.fileId) {
    try {
      DriveApp.getFileById(datos.recibo.fileId)
        .setName(idRecibo + '_' + Utilities.formatDate(fechaTicket || ahora, ZONA, 'yyyy-MM-dd') + '.jpg');
    } catch (err) {
      console.error('No se pudo renombrar el recibo: ' + err.message);
    }
  }

  const filas = items.map(it => filaDeItem(it, {
    id: idRecibo, ts: ahora, datos, fechaTicket, urlRecibo
  }));

  const inicio = hoja.getLastRow() + 1;
  asegurarTamano(hoja, inicio + filas.length - 1, CABECERAS.length);
  hoja.getRange(inicio, 1, filas.length, CABECERAS.length).setValues(filas);
  darFormatoFilas(hoja, inicio, filas.length);
  SpreadsheetApp.flush();

  const resumen = recalcularTodo();

  return {
    ok: true,
    idRecibo,
    avisoDrive: urlRecibo ? '' : 'La foto no se guardó en Drive.',
    avisos: (resumen.avisos || []).filter(a => a.id === idRecibo),
    ultimo: resumen.ultimo,
    items: items.map(i => ({ tipo: i.tipo, litros: i.litros, total: i.total, lleno: i.lleno }))
  };
}

/** Construye una fila completa a partir de un combustible del ticket. */
function filaDeItem(it, ctx) {
  const fila = new Array(CABECERAS.length).fill('');
  fila[C.ID]           = ctx.id;
  fila[C.TS]           = ctx.ts;
  fila[C.ESTACION]     = ctx.datos.estacion || '';
  fila[C.TIPO]         = it.tipo;
  fila[C.LITROS]       = it.litros;
  fila[C.PRECIO]       = it.precio_litro;
  fila[C.TOTAL]        = it.total;
  fila[C.KM_TOTAL]     = num(ctx.datos.kmTotales);
  fila[C.LEC_GLP]      = vacio(num(ctx.datos.lecturaGLP));
  fila[C.LEC_GAS]      = vacio(num(ctx.datos.lecturaGasolina));
  fila[C.CONS_COCHE]   = vacio(it.consumoCoche !== null && it.consumoCoche !== undefined
    ? it.consumoCoche
    : num(esGLP(it.tipo) ? ctx.datos.consumoCocheGLP : ctx.datos.consumoCocheGasolina));
  fila[C.RECIBO]       = ctx.urlRecibo || '';
  fila[C.LLENO]        = it.lleno;
  fila[C.FECHA_TICKET] = ctx.fechaTicket || '';
  fila[C.LAT]          = vacio(num(ctx.datos.lat));
  fila[C.LON]          = vacio(num(ctx.datos.lon));
  return fila;
}

function darFormatoFilas(hoja, inicio, cuantas) {
  hoja.getRange(inicio, COL_LLENO, cuantas, 1).insertCheckboxes();
  hoja.getRange(inicio, COL_FECHA_TICKET, cuantas, 1).setNumberFormat('dd/mm/yyyy');
}

// ============================================================
//  EDITAR Y BORRAR (roadmap 2.1)
//  La copia de seguridad se sincroniza sola en recalcularTodo(),
//  así que aquí no hay que acordarse de respaldar nada.
// ============================================================

function editarRepostaje(datos) {
  const hoja = getHoja();
  const id = String(datos && datos.id || '').trim();
  if (!id) return { ok: false, error: 'Falta el ID del repostaje.' };

  const filasHoja = leerFilas();
  const originales = filasHoja.filter(f => f[C.ID] === id);
  if (!originales.length) return { ok: false, error: 'No encuentro el repostaje ' + id + '.' };

  const items = (datos.items || []).map(normalizarItem).filter(i => i.litros > 0 || i.total > 0);
  if (!items.length) return { ok: false, error: 'Un repostaje necesita al menos un combustible. Si quieres quitarlo entero, bórralo.' };

  const kmTotales = num(datos.kmTotales);
  if (kmTotales === null) return { ok: false, error: 'Faltan los KM totales.' };

  const ref = originales[0];
  const nuevas = items.map(it => filaDeItem(it, {
    id,
    ts: ref[C.TS] || new Date(),
    datos,
    fechaTicket: aFecha(datos.fechaTicket),
    // Si no mandan recibo nuevo, se conserva el que ya tenía
    urlRecibo: datos.recibo && datos.recibo.url ? datos.recibo.url : ref[C.RECIBO]
  }));

  reemplazarFilasTicket(hoja, id, nuevas);
  SpreadsheetApp.flush();

  const resumen = recalcularTodo();
  return {
    ok: true,
    id,
    avisos: (resumen.avisos || []).filter(a => a.id === id),
    ordenAvisos: resumen.ordenAvisos || []
  };
}

function borrarRepostaje(id) {
  const hoja = getHoja();
  id = String(id || '').trim();
  if (!id) return { ok: false, error: 'Falta el ID del repostaje.' };

  const ultima = hoja.getLastRow();
  if (ultima < 2) return { ok: false, error: 'La hoja está vacía.' };

  const ids = hoja.getRange(2, 1, ultima - 1, 1).getValues();
  const aBorrar = [];
  ids.forEach((f, i) => { if (f[0] === id) aBorrar.push(i + 2); });
  if (!aBorrar.length) return { ok: false, error: 'No encuentro el repostaje ' + id + '.' };

  // De abajo arriba, para que los índices no se muevan al ir borrando
  aBorrar.reverse().forEach(fila => hoja.deleteRow(fila));
  SpreadsheetApp.flush();

  const resumen = recalcularTodo();
  return {
    ok: true,
    id,
    filasBorradas: aBorrar.length,
    nota: 'Las filas siguen en la hoja «' + HOJA_COPIA + '», marcadas como borradas.',
    ordenAvisos: resumen.ordenAvisos || []
  };
}

/**
 * Sustituye las filas de un ticket conservando su posición en la hoja, que es
 * lo que define el orden cronológico del motor de cálculo. Ajusta el número de
 * filas si el ticket pasa de uno a dos combustibles o al revés.
 */
function reemplazarFilasTicket(hoja, id, nuevas) {
  const ultima = hoja.getLastRow();
  const ids = hoja.getRange(2, 1, ultima - 1, 1).getValues();
  const posiciones = [];
  ids.forEach((f, i) => { if (f[0] === id) posiciones.push(i + 2); });
  if (!posiciones.length) throw new Error('No encuentro el repostaje ' + id + '.');

  const primera = posiciones[0];
  const cuantasHay = posiciones.length;
  const cuantasQuiero = nuevas.length;

  if (cuantasQuiero < cuantasHay) {
    // Sobran filas: se borran las últimas del ticket, de abajo arriba
    posiciones.slice(cuantasQuiero).reverse().forEach(fila => hoja.deleteRow(fila));
  } else if (cuantasQuiero > cuantasHay) {
    hoja.insertRowsAfter(posiciones[cuantasHay - 1], cuantasQuiero - cuantasHay);
  }

  asegurarTamano(hoja, primera + cuantasQuiero - 1, CABECERAS.length);
  hoja.getRange(primera, 1, cuantasQuiero, CABECERAS.length).setValues(nuevas);
  darFormatoFilas(hoja, primera, cuantasQuiero);
}
