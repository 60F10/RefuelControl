/**
 * RefuelControl_60F10 — Backend Apps Script  ·  v5
 * Dacia Sandero Stepway ECO-G 120 (bífuel GLP + gasolina)
 *
 * DESPLIEGUE (obligatorio tras cada cambio):
 *   Implementar > Gestionar implementaciones > lápiz > Versión: Nueva versión > Implementar
 *
 * TRAS ACTUALIZAR A v5, una sola vez:
 *   Menú ⛽ RefuelControl > Actualizar esquema
 *   Crea las columnas T..W, marca como llenos los repostajes anteriores, genera la
 *   hoja «Copia de seguridad» y recalcula la hoja entera.
 *
 * MODELO DE CÁLCULO
 *   Se resetean los contadores parciales después de cada repostaje, así que la
 *   lectura de cada contador ES el recorrido de ese tramo.
 *   Un repostaje llena ese depósito entero salvo que se marque lo contrario,
 *   pero no siempre se repostan los dos combustibles. Por eso el consumo de
 *   cada combustible se calcula contra los km acumulados de ESE combustible
 *   desde su último llenado, no contra los del último ticket.
 *   Un repostaje parcial no cierra la ventana: sus litros y sus euros se
 *   arrastran al siguiente llenado de ese mismo combustible.
 *
 * COPIA DE SEGURIDAD
 *   La hoja «Copia de seguridad» guarda TODOS los repostajes que han existido,
 *   con una columna que dice si siguen vivos o se borraron. Se sincroniza sola
 *   en cada recalcularTodo(), así que nunca se pierde una fila por un borrado.
 */

// ============================================================
//  CONFIG
// ============================================================

const PROPS = PropertiesService.getScriptProperties();

const GEMINI_API_KEY     = PROPS.getProperty('GEMINI_API_KEY') || '';
const SHARED_TOKEN       = PROPS.getProperty('SHARED_TOKEN') || '';
const CARPETA_RECIBOS_ID = PROPS.getProperty('CARPETA_RECIBOS_ID') || '';

// true  = reseteas los parciales tras cada repostaje (la lectura es el tramo)
// false = los contadores son acumulativos (el tramo es la diferencia)
const CONTADORES_SE_RESETEAN = true;

const HOJA_DATOS  = 'Registro de Repostajes';
const HOJA_COPIA  = 'Copia de seguridad';
const MODELO      = 'gemini-2.5-flash';
const ZONA        = 'Atlantic/Canary';
const VERSION     = '5.0';

// Capacidad útil de los depósitos, en litros. La de gasolina es la de ficha; la
// de GLP se ajustó a lo que de verdad entra (el máximo repostado fueron 44,02 L).
const DEPOSITO_GLP      = 45;
const DEPOSITO_GASOLINA = 50;

const CABECERAS = [
  'ID', 'Timestamp', 'Estación', 'Tipo Combustible', 'Litros',
  'Precio por Litro (€)', 'Total Invertido (€)', 'KM Totales',
  'KM Recorridos (tramo)', 'Lectura KM GLP (coche)', 'Lectura KM Gasolina (coche)',
  'KM GLP (tramo)', 'KM Gasolina (tramo)', 'Consumo coche (L/100km)',
  'Consumo real (L/100km)', 'Coste por KM real (€/km)', 'Coste por KM coche (€/km)',
  'Enlace Recibo', 'KM de este combustible desde su último repostaje',
  'Depósito lleno', 'Fecha del ticket', 'Latitud', 'Longitud'
];

const C = {
  ID: 0, TS: 1, ESTACION: 2, TIPO: 3, LITROS: 4, PRECIO: 5, TOTAL: 6,
  KM_TOTAL: 7, KM_TRAMO: 8, LEC_GLP: 9, LEC_GAS: 10, KM_GLP: 11, KM_GAS: 12,
  CONS_COCHE: 13, CONS_REAL: 14, COSTE_REAL: 15, COSTE_COCHE: 16, RECIBO: 17,
  KM_CALC: 18, LLENO: 19, FECHA_TICKET: 20, LAT: 21, LON: 22
};

const COL_LLENO = C.LLENO + 1;               // columna T, 1-indexada
const COL_FECHA_TICKET = C.FECHA_TICKET + 1; // columna U, 1-indexada

// La copia de seguridad son las mismas columnas más el estado de la fila
const CABECERAS_COPIA = CABECERAS.concat(['Borrado', 'Fecha de baja']);
const K = { BORRADO: CABECERAS.length, BAJA: CABECERAS.length + 1 };

// ============================================================
//  ENTRADA WEB APP
// ============================================================

function doGet(e) {
  const cb = e && e.parameter ? e.parameter.callback : null;
  try {
    if (!e || e.parameter.token !== SHARED_TOKEN) return jsonOut({ ok: false, error: 'No autorizado' }, cb);
    switch (e.parameter.action) {
      case 'dashboard': return jsonOut(Object.assign({ ok: true }, getDashboardData()), cb);
      case 'export':    return jsonOut(Object.assign({ ok: true }, exportarCSV()), cb);
      case 'ping':      return jsonOut({ ok: true, version: VERSION, drive: diagnosticoDrive() }, cb);
      default:          return jsonOut({ ok: true, status: 'ok' }, cb);
    }
  } catch (err) {
    return jsonOut({ ok: false, error: err.message }, cb);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.token !== SHARED_TOKEN) return jsonOut({ ok: false, error: 'No autorizado' });

    switch (body.action) {
      case 'subir':    return jsonOut(subirRecibo(body.imagenBase64, body.mimeType));
      case 'analizar': return jsonOut(analizarTicket(body));
      case 'guardar':  return jsonOut(guardarRepostaje(body.datos));
      case 'editar':   return jsonOut(editarRepostaje(body.datos));
      case 'borrar':   return jsonOut(borrarRepostaje(body.id));
      default:         return jsonOut({ ok: false, error: 'Acción desconocida: ' + body.action });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

function jsonOut(obj, callback) {
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  PASO 1 — SUBIR LA FOTO A DRIVE (llamada corta y aislada)
// ============================================================

function subirRecibo(base64Image, mimeType) {
  if (!base64Image) return { ok: false, error: 'No llegó la imagen.' };
  try {
    const nombre = 'TMP-' + Utilities.formatDate(new Date(), ZONA, 'yyyyMMdd-HHmmss') + '.jpg';
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Image), mimeType || 'image/jpeg', nombre);
    const file = DriveApp.getFolderById(CARPETA_RECIBOS_ID).createFile(blob);
    return { ok: true, fileId: file.getId(), url: file.getUrl() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ============================================================
//  PASO 2 — ANALIZAR CON GEMINI (acepta fileId o la imagen suelta)
// ============================================================

function analizarTicket(body) {
  if (!GEMINI_API_KEY) return { ok: false, error: 'Falta GEMINI_API_KEY en las propiedades del script.' };

  let base64 = body.imagenBase64 || '';
  let mime = body.mimeType || 'image/jpeg';

  if (!base64 && body.fileId) {
    try {
      const blob = DriveApp.getFileById(body.fileId).getBlob();
      base64 = Utilities.base64Encode(blob.getBytes());
      mime = blob.getContentType();
    } catch (err) {
      return { ok: false, error: 'No pude leer la foto de Drive: ' + err.message };
    }
  }
  if (!base64) return { ok: false, error: 'No hay imagen que analizar.' };

  const prompt =
    'Analiza este recibo de una estación de servicio española. Devuelve SOLO un objeto JSON con esta forma exacta:\n' +
    '{"estacion":"nombre comercial de la gasolinera","municipio":"localidad o vacío",' +
    '"fecha_ticket":"dd/mm/aaaa o vacío",' +
    '"items":[{"tipo":"GLP|Gasolina 95|Gasolina 98","litros":0.00,"precio_litro":0.00,"total":0.00}]}\n' +
    'Normaliza el producto: AUTOGAS, GLP o GAS -> "GLP"; cualquier 98 (DISAMax 98, Efitec 98, Nitro 98) -> "Gasolina 98"; ' +
    'cualquier 95 (Efitec 95, Star 95, sin plomo 95) -> "Gasolina 95".\n' +
    'En "estacion" pon el nombre comercial legible, por ejemplo "E.S. DISA Padre Anchieta". ' +
    'La fecha del ticket es la del repostaje, no la de hoy. ' +
    'Un ticket puede traer uno o dos productos. Usa punto decimal. Sin texto fuera del JSON.';

  const payload = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' }
  };

  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + MODELO + ':generateContent?key=' + GEMINI_API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }
  );

  if (res.getResponseCode() !== 200) {
    return { ok: false, error: 'Gemini (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300) };
  }

  let texto = JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
  texto = texto.replace(/```json/g, '').replace(/```/g, '').trim();

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (err) {
    return { ok: false, error: 'Gemini no devolvió JSON: ' + texto.slice(0, 200) };
  }
  if (Array.isArray(datos)) datos = { estacion: '', items: datos };

  const fecha = aFecha(datos.fecha_ticket);

  return {
    ok: true,
    estacion: datos.estacion || '',
    municipio: datos.municipio || '',
    fechaTicket: fecha ? Utilities.formatDate(fecha, ZONA, 'yyyy-MM-dd') : '',
    items: (datos.items || []).map(normalizarItem),
    estacionesConocidas: listaEstaciones(),
    ubicaciones: ubicacionesConocidas(),
    ultimoRegistro: resumenUltimoTicket()
  };
}

function normalizarItem(it) {
  return {
    tipo: normalizarTipo(it.tipo),
    litros: num(it.litros) || 0,
    precio_litro: num(it.precio_litro) || 0,
    total: num(it.total) || 0,
    lleno: it.lleno === undefined ? true : esLleno(it.lleno),
    consumoCoche: num(it.consumoCoche)
  };
}

function normalizarTipo(t) {
  const s = String(t || '').toUpperCase();
  if (s.indexOf('GLP') >= 0 || s.indexOf('AUTOGAS') >= 0 || s.indexOf('GAS LICUADO') >= 0) return 'GLP';
  if (s.indexOf('98') >= 0) return 'Gasolina 98';
  if (s.indexOf('95') >= 0) return 'Gasolina 95';
  return t || 'Desconocido';
}

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

// ============================================================
//  MOTOR DE CÁLCULO
// ============================================================

/** Recorrido de un combustible en un tramo, a partir de la lectura del coche. */
function tramoDeContador(lecturaActual, lecturaPrevia) {
  if (lecturaActual === null) return null;
  if (CONTADORES_SE_RESETEAN) return lecturaActual;          // la lectura ES el tramo
  if (lecturaPrevia === null) return null;
  return lecturaActual >= lecturaPrevia ? lecturaActual - lecturaPrevia : lecturaActual;
}

/**
 * Recalcula tramos, acumulados por combustible, consumos y costes de toda la hoja,
 * y sincroniza la copia de seguridad.
 *
 * Ventana de cálculo de un combustible: desde su último llenado hasta el siguiente.
 * Un repostaje parcial no la cierra; sus litros y euros se arrastran al llenado
 * que venga después, que es el único que puede dar un consumo honesto.
 *
 * Cuando un ticket cierra la ventana, el consumo y el coste se escriben en la
 * primera fila de ese combustible dentro del ticket, junto con los km de la
 * ventana. Así cada ventana aparece una sola vez y el dashboard puede ponderar
 * sin contar dos veces los mismos kilómetros.
 */
function recalcularTodo() {
  const hoja = getHoja();
  const ultima = hoja.getLastRow();
  if (ultima < 2) return { avisos: [], ordenAvisos: [], ultimo: null };

  const rango = hoja.getRange(2, 1, ultima - 1, CABECERAS.length);
  const filas = rango.getValues();

  // Agrupamos por ticket conservando el orden de aparición
  const orden = [], porId = {};
  filas.forEach((f, i) => {
    const id = f[C.ID];
    if (!id) return;
    if (!porId[id]) { porId[id] = []; orden.push(id); }
    porId[id].push(i);
  });

  let previo = null;          // ticket anterior
  let accGLP = 0, accGas = 0; // km acumulados desde el último llenado de cada combustible
  // El acumulado solo sirve si conocemos TODOS los tramos desde ese llenado.
  // Si en algún tramo falta la lectura, el consumo de ese depósito no es calculable.
  let completoGLP = false, completoGas = false;
  let vistoGLP = false, vistoGas = false;
  // Litros y euros de repostajes parciales pendientes de cerrar ventana
  let arrLitrosGLP = 0, arrEurosGLP = 0, arrLitrosGas = 0, arrEurosGas = 0;
  const avisos = [], ordenAvisos = [];

  orden.forEach(id => {
    const idx = porId[id];
    const ref = filas[idx[0]];

    const kmTotal = num(ref[C.KM_TOTAL]);
    const lecGLP  = num(ref[C.LEC_GLP]);
    const lecGas  = num(ref[C.LEC_GAS]);

    // Tras editar un repostaje antiguo el odómetro puede quedar desordenado, y el
    // motor depende del orden de la hoja. Avisamos en vez de reordenar por sorpresa.
    if (kmTotal !== null && previo && previo.kmTotal !== null && kmTotal < previo.kmTotal) {
      ordenAvisos.push({
        id,
        texto: 'El repostaje ' + id + ' tiene menos KM (' + Math.round(kmTotal) +
               ') que el anterior (' + Math.round(previo.kmTotal) + '). Las filas están desordenadas.'
      });
    }

    const kmTramo  = (kmTotal !== null && previo && previo.kmTotal !== null) ? kmTotal - previo.kmTotal : null;
    const tramoGLP = tramoDeContador(lecGLP, previo ? previo.lecGLP : null);
    const tramoGas = tramoDeContador(lecGas, previo ? previo.lecGas : null);

    // Aviso de coherencia: los km de los dos combustibles deberían cuadrar con el tramo
    if (kmTramo !== null && tramoGLP !== null && tramoGas !== null) {
      const sumado = tramoGLP + tramoGas;
      if (kmTramo > 0 && Math.abs(sumado - kmTramo) > kmTramo * 0.15) {
        avisos.push({
          id,
          texto: 'Los km por combustible (' + Math.round(sumado) + ') no cuadran con el tramo (' +
                 Math.round(kmTramo) + '). ¿Olvidaste resetear algún parcial?'
        });
      }
    }

    if (tramoGLP === null) completoGLP = false; else accGLP += tramoGLP;
    if (tramoGas === null) completoGas = false; else accGas += tramoGas;

    // ¿Qué combustibles trae este ticket y cuáles llenan su depósito?
    const idxGLP = idx.filter(i => esGLP(filas[i][C.TIPO]));
    const idxGas = idx.filter(i => !esGLP(filas[i][C.TIPO]));
    const traeGLP = idxGLP.length > 0;
    const traeGas = idxGas.length > 0;
    const llenaGLP = traeGLP && idxGLP.every(i => esLleno(filas[i][C.LLENO]));
    const llenaGas = traeGas && idxGas.every(i => esLleno(filas[i][C.LLENO]));

    // Los litros y euros del ticket entran en la ventana abierta de su combustible
    idxGLP.forEach(i => { arrLitrosGLP += num(filas[i][C.LITROS]) || 0; arrEurosGLP += num(filas[i][C.TOTAL]) || 0; });
    idxGas.forEach(i => { arrLitrosGas += num(filas[i][C.LITROS]) || 0; arrEurosGas += num(filas[i][C.TOTAL]) || 0; });

    // El consumo solo sale si el depósito estaba lleno al principio de la ventana,
    // se vuelve a llenar ahora y conocemos todos los tramos intermedios.
    const fiableGLP = llenaGLP && vistoGLP && completoGLP && accGLP > 0;
    const fiableGas = llenaGas && vistoGas && completoGas && accGas > 0;

    const cierraGLP = fiableGLP ? idxGLP[0] : -1;
    const cierraGas = fiableGas ? idxGas[0] : -1;

    idx.forEach(i => {
      const f = filas[i];
      const glp = esGLP(f[C.TIPO]);
      const cierra = (glp && i === cierraGLP) || (!glp && i === cierraGas);
      const kmCalc  = cierra ? (glp ? accGLP : accGas) : null;
      const litros  = glp ? arrLitrosGLP : arrLitrosGas;
      const euros   = glp ? arrEurosGLP  : arrEurosGas;
      const precio    = num(f[C.PRECIO]);
      const consCoche = num(f[C.CONS_COCHE]);

      f[C.KM_TRAMO] = vacio(kmTramo);
      f[C.KM_GLP]   = vacio(tramoGLP);
      f[C.KM_GAS]   = vacio(tramoGas);
      f[C.KM_CALC]  = vacio(kmCalc);

      f[C.CONS_REAL]   = vacio(cierra && litros ? redondear((litros / kmCalc) * 100, 2) : null);
      f[C.COSTE_REAL]  = vacio(cierra && euros  ? redondear(euros / kmCalc, 4) : null);
      f[C.COSTE_COCHE] = vacio(consCoche && precio ? redondear((precio * consCoche) / 100, 4) : null);
      if (f[C.LLENO] === '' || f[C.LLENO] === null) f[C.LLENO] = true;
    });

    // Un llenado cierra la ventana de su combustible; un parcial la deja abierta
    if (llenaGLP) { accGLP = 0; completoGLP = true; vistoGLP = true; arrLitrosGLP = 0; arrEurosGLP = 0; }
    if (llenaGas) { accGas = 0; completoGas = true; vistoGas = true; arrLitrosGas = 0; arrEurosGas = 0; }

    previo = { kmTotal, lecGLP, lecGas };
  });

  rango.setValues(filas);
  SpreadsheetApp.flush();

  sincronizarCopia(filas);

  return {
    avisos,
    ordenAvisos,
    ultimo: previo,
    pendientes: {
      kmGLPSinRepostar: accGLP,
      kmGasolinaSinRepostar: accGas,
      litrosGLPArrastrados: arrLitrosGLP,
      litrosGasolinaArrastrados: arrLitrosGas
    }
  };
}

// ============================================================
//  COPIA DE SEGURIDAD
//  Todos los repostajes que han existido, vivos y borrados.
// ============================================================

function getHojaCopia() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(HOJA_COPIA);
  if (!hoja) {
    hoja = libro.insertSheet(HOJA_COPIA);
    hoja.getRange(1, 1, 1, CABECERAS_COPIA.length).setValues([CABECERAS_COPIA])
        .setFontWeight('bold').setBackground('#1E1E1E').setFontColor('#FFFFFF');
    hoja.setFrozenRows(1);
  }
  if (CABECERAS_COPIA.length > hoja.getMaxColumns()) {
    hoja.insertColumnsAfter(hoja.getMaxColumns(), CABECERAS_COPIA.length - hoja.getMaxColumns());
  }
  return hoja;
}

/** Clave de una fila dentro de la copia: un ticket puede traer dos combustibles. */
function claveFila(f) { return String(f[C.ID]) + '|' + String(f[C.TIPO]); }

/**
 * Deja la copia al día: las filas vivas se refrescan con sus valores actuales y
 * se marcan como no borradas; las que ya no están en la hoja principal se marcan
 * como borradas con su fecha de baja, pero no se tocan sus datos.
 */
function sincronizarCopia(filasVivas) {
  const hoja = getHojaCopia();
  const ultima = hoja.getLastRow();
  const previas = ultima >= 2 ? hoja.getRange(2, 1, ultima - 1, CABECERAS_COPIA.length).getValues() : [];

  const indice = {};
  previas.forEach((f, i) => { if (f[C.ID]) indice[claveFila(f)] = i; });

  const vivas = {};
  const nuevas = [];
  const ahora = new Date();

  filasVivas.forEach(f => {
    if (!f[C.ID]) return;
    const clave = claveFila(f);
    vivas[clave] = true;
    const copia = f.slice(0, CABECERAS.length);
    copia[K.BORRADO] = false;
    copia[K.BAJA] = '';
    if (indice[clave] !== undefined) {
      previas[indice[clave]] = copia;
    } else {
      nuevas.push(copia);
    }
  });

  // Lo que estaba y ya no está: se marca la baja una sola vez
  previas.forEach(f => {
    if (!f[C.ID]) return;
    if (vivas[claveFila(f)]) return;
    if (f[K.BORRADO] === true) return;      // ya estaba dada de baja
    f[K.BORRADO] = true;
    f[K.BAJA] = ahora;
  });

  const todas = previas.concat(nuevas);
  if (!todas.length) return;

  if (todas.length + 1 > hoja.getMaxRows()) {
    hoja.insertRowsAfter(hoja.getMaxRows(), todas.length + 1 - hoja.getMaxRows());
  }
  hoja.getRange(2, 1, todas.length, CABECERAS_COPIA.length).setValues(todas);
  hoja.getRange(2, K.BORRADO + 1, todas.length, 1).insertCheckboxes();
  hoja.getRange(2, COL_FECHA_TICKET, todas.length, 1).setNumberFormat('dd/mm/yyyy');
  SpreadsheetApp.flush();
}

// ============================================================
//  LECTURA DE LA HOJA
// ============================================================

function getHoja() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(HOJA_DATOS);
  if (!hoja) {
    for (const s of libro.getSheets()) {
      if (s.getName() === HOJA_COPIA) continue;
      if (s.getRange('A1').getValue() === 'ID') { hoja = s; break; }
    }
  }
  if (!hoja) throw new Error("No encuentro la hoja de datos (A1 debe contener 'ID').");
  asegurarTamano(hoja, 0, CABECERAS.length);
  return hoja;
}

function asegurarTamano(hoja, filasNecesarias, columnasNecesarias) {
  if (columnasNecesarias > hoja.getMaxColumns()) {
    hoja.insertColumnsAfter(hoja.getMaxColumns(), columnasNecesarias - hoja.getMaxColumns());
  }
  if (filasNecesarias > hoja.getMaxRows()) {
    hoja.insertRowsAfter(hoja.getMaxRows(), filasNecesarias - hoja.getMaxRows());
  }
}

function leerFilas() {
  const hoja = getHoja();
  const ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  return hoja.getRange(2, 1, ultima - 1, CABECERAS.length).getValues().filter(r => r[C.ID] !== '');
}

function ultimoTicket() {
  const filas = leerFilas();
  if (!filas.length) return null;
  const f = filas[filas.length - 1];
  return {
    id: f[C.ID],
    kmTotales: num(f[C.KM_TOTAL]),
    lecturaGLP: num(f[C.LEC_GLP]),
    lecturaGas: num(f[C.LEC_GAS]),
    fecha: fechaEfectiva(f)
  };
}

function maximoKmRegistrado() {
  const kms = leerFilas().map(f => num(f[C.KM_TOTAL])).filter(k => k !== null);
  return kms.length ? Math.max.apply(null, kms) : null;
}

function resumenUltimoTicket() {
  const t = ultimoTicket();
  if (!t) return null;
  return {
    kmTotales: t.kmTotales,
    lecturaGLP: t.lecturaGLP,
    lecturaGasolina: t.lecturaGas,
    kmMaximo: maximoKmRegistrado(),
    fecha: t.fecha ? Utilities.formatDate(t.fecha, ZONA, 'yyyy-MM-dd') : ''
  };
}

function listaEstaciones() {
  const set = {};
  leerFilas().forEach(f => { if (f[C.ESTACION]) set[f[C.ESTACION]] = true; });
  return Object.keys(set).sort();
}

/** Coordenadas medias de cada estación, para proponerla por cercanía (roadmap 3.2). */
function ubicacionesConocidas() {
  const mapa = {};
  leerFilas().forEach(f => {
    const lat = num(f[C.LAT]), lon = num(f[C.LON]);
    if (!f[C.ESTACION] || lat === null || lon === null) return;
    const e = f[C.ESTACION];
    if (!mapa[e]) mapa[e] = { estacion: e, lat: 0, lon: 0, n: 0 };
    mapa[e].lat += lat; mapa[e].lon += lon; mapa[e].n++;
  });
  return Object.keys(mapa).map(e => ({
    estacion: e,
    lat: redondear(mapa[e].lat / mapa[e].n, 6),
    lon: redondear(mapa[e].lon / mapa[e].n, 6)
  }));
}

/**
 * Kilómetros y litros pendientes desde el último llenado de cada depósito.
 * Sirve para estimar la autonomía restante (roadmap 3.3) sin recalcular la hoja.
 */
function estadoDepositos() {
  const filas = leerFilas();
  const orden = [], porId = {};
  filas.forEach((f, i) => {
    const id = f[C.ID];
    if (!id) return;
    if (!porId[id]) { porId[id] = []; orden.push(id); }
    porId[id].push(i);
  });

  let accGLP = 0, accGas = 0;
  let completoGLP = true, completoGas = true;
  let ultimoLlenadoGLP = null, ultimoLlenadoGas = null;
  let previo = null;

  orden.forEach(id => {
    const idx = porId[id];
    const ref = filas[idx[0]];
    const tramoGLP = tramoDeContador(num(ref[C.LEC_GLP]), previo ? previo.lecGLP : null);
    const tramoGas = tramoDeContador(num(ref[C.LEC_GAS]), previo ? previo.lecGas : null);

    if (tramoGLP === null) completoGLP = false; else accGLP += tramoGLP;
    if (tramoGas === null) completoGas = false; else accGas += tramoGas;

    const idxGLP = idx.filter(i => esGLP(filas[i][C.TIPO]));
    const idxGas = idx.filter(i => !esGLP(filas[i][C.TIPO]));
    const llenaGLP = idxGLP.length > 0 && idxGLP.every(i => esLleno(filas[i][C.LLENO]));
    const llenaGas = idxGas.length > 0 && idxGas.every(i => esLleno(filas[i][C.LLENO]));

    const fecha = fechaEfectiva(ref);
    if (llenaGLP) { accGLP = 0; completoGLP = true; ultimoLlenadoGLP = fecha; }
    if (llenaGas) { accGas = 0; completoGas = true; ultimoLlenadoGas = fecha; }

    previo = { lecGLP: num(ref[C.LEC_GLP]), lecGas: num(ref[C.LEC_GAS]) };
  });

  const fmt = d => d ? Utilities.formatDate(d, ZONA, 'yyyy-MM-dd') : '';
  return {
    capacidadGLP: DEPOSITO_GLP,
    capacidadGasolina: DEPOSITO_GASOLINA,
    kmDesdeLlenadoGLP: completoGLP ? redondear(accGLP, 1) : null,
    kmDesdeLlenadoGasolina: completoGas ? redondear(accGas, 1) : null,
    ultimoLlenadoGLP: fmt(ultimoLlenadoGLP),
    ultimoLlenadoGasolina: fmt(ultimoLlenadoGas)
  };
}

// ============================================================
//  DASHBOARD
// ============================================================

function getDashboardData() {
  const registros = leerFilas().map(f => {
    const fTicket = aFecha(f[C.FECHA_TICKET]);
    const fReg    = aFecha(f[C.TS]);
    const fEfec   = fTicket || fReg;
    return {
      id: f[C.ID],
      fecha: fEfec ? Utilities.formatDate(fEfec, ZONA, 'yyyy-MM-dd') : '',
      fechaRegistro: fReg ? Utilities.formatDate(fReg, ZONA, 'yyyy-MM-dd') : '',
      fechaDelTicket: !!fTicket,
      estacion: f[C.ESTACION] || 'Sin estación',
      tipo: f[C.TIPO],
      litros: num(f[C.LITROS]),
      precio: num(f[C.PRECIO]),
      total: num(f[C.TOTAL]),
      lleno: esLleno(f[C.LLENO]),
      kmTotales: num(f[C.KM_TOTAL]),
      kmTramo: num(f[C.KM_TRAMO]),
      kmGLP: num(f[C.KM_GLP]),
      kmGas: num(f[C.KM_GAS]),
      kmCalculo: num(f[C.KM_CALC]),
      lecturaGLP: num(f[C.LEC_GLP]),
      lecturaGas: num(f[C.LEC_GAS]),
      consumoCoche: num(f[C.CONS_COCHE]),
      consumoReal: num(f[C.CONS_REAL]),
      costeKmReal: num(f[C.COSTE_REAL]),
      costeKmCoche: num(f[C.COSTE_COCHE]),
      recibo: f[C.RECIBO] || '',
      lat: num(f[C.LAT]),
      lon: num(f[C.LON])
    };
  });

  return {
    registros,
    estaciones: listaEstaciones(),
    ubicaciones: ubicacionesConocidas(),
    depositos: estadoDepositos(),
    version: VERSION,
    actualizado: Utilities.formatDate(new Date(), ZONA, 'dd/MM/yyyy HH:mm')
  };
}

// ============================================================
//  EXPORTACIÓN
//  Devuelve el CSV dentro del JSON: así el proxy de Netlify no
//  necesita ningún tratamiento especial y el navegador se encarga
//  de convertirlo en descarga.
// ============================================================

function exportarCSV() {
  const filas = leerFilas();
  const lineas = [CABECERAS.map(celdaCSV).join(';')];

  filas.forEach(f => {
    lineas.push(f.map((v, i) => {
      if (i === C.TS) {
        const d = aFecha(v);
        return d ? Utilities.formatDate(d, ZONA, 'dd/MM/yyyy HH:mm:ss') : '';
      }
      if (i === C.FECHA_TICKET) {
        const d = aFecha(v);
        return d ? Utilities.formatDate(d, ZONA, 'dd/MM/yyyy') : '';
      }
      if (i === C.LLENO) return esLleno(v) ? 'Sí' : 'No';
      if (typeof v === 'number') return String(v).replace('.', ',');
      return celdaCSV(v);
    }).join(';'));
  });

  return {
    csv: lineas.join('\r\n'),
    nombre: 'RefuelControl_' + Utilities.formatDate(new Date(), ZONA, 'yyyyMMdd') + '.csv',
    filas: filas.length
  };
}

function celdaCSV(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ============================================================
//  MANTENIMIENTO
// ============================================================

function probarDrive() {
  const r = diagnosticoDrive();
  console.log(JSON.stringify(r, null, 2));
  try { SpreadsheetApp.getUi().alert(r.ok ? '✅ Drive OK\n\n' + r.detalle : '❌ Drive KO\n\n' + r.detalle); } catch (e) {}
  return r;
}

function diagnosticoDrive() {
  try {
    if (!CARPETA_RECIBOS_ID) return { ok: false, detalle: 'CARPETA_RECIBOS_ID está vacío en las propiedades del script.' };
    const carpeta = DriveApp.getFolderById(CARPETA_RECIBOS_ID);
    const test = carpeta.createFile(Utilities.newBlob('prueba RefuelControl', 'text/plain', '_test_refuel.txt'));
    test.setTrashed(true);
    return { ok: true, detalle: 'Carpeta: ' + carpeta.getName() + '\nEscritura correcta.' };
  } catch (err) {
    return { ok: false, detalle: err.message };
  }
}

/**
 * Pone al día la cabecera y las columnas nuevas, crea la copia de seguridad y
 * recalcula la hoja. Es idempotente: puedes ejecutarlo tantas veces como quieras.
 */
function actualizarEsquema() {
  const hoja = getHoja();
  hoja.getRange(1, 1, 1, CABECERAS.length).setValues([CABECERAS])
      .setFontWeight('bold').setBackground('#1E1E1E').setFontColor('#FFFFFF');
  hoja.setFrozenRows(1);

  const ultima = hoja.getLastRow();
  if (ultima >= 2) {
    const n = ultima - 1;

    // Todo lo registrado antes de que existiera la columna era un depósito lleno
    const rLleno = hoja.getRange(2, COL_LLENO, n, 1);
    rLleno.setValues(rLleno.getValues().map(v => [esLleno(v[0])]));
    rLleno.insertCheckboxes();

    hoja.getRange(2, COL_FECHA_TICKET, n, 1).setNumberFormat('dd/mm/yyyy');
  }

  getHojaCopia();
  const r = recalcularTodo();

  try {
    SpreadsheetApp.getUi().alert(
      'Esquema actualizado a ' + CABECERAS.length + ' columnas.\n' +
      'Copia de seguridad al día en la hoja «' + HOJA_COPIA + '».\n\n' +
      (r.avisos.length ? 'Avisos:\n' + r.avisos.map(a => '· ' + a.texto).join('\n')
                       : 'Sin avisos de coherencia.')
    );
  } catch (e) {}
  return r;
}

/** Migración del esquema antiguo de 11 columnas. Solo se ejecuta una vez. */
function migrarEsquema() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = getHoja();
  const ui = SpreadsheetApp.getUi();

  if (hoja.getRange(1, 3).getValue() === 'Estación') {
    ui.alert('Esta hoja ya está migrada.\n\nUsa «Actualizar esquema» o «Recalcular todo».');
    return;
  }

  const backup = hoja.copyTo(libro);
  backup.setName('Backup_' + Utilities.formatDate(new Date(), ZONA, 'yyyyMMdd_HHmm'));
  backup.hideSheet();

  const ultima = hoja.getLastRow();
  const viejas = ultima >= 2 ? hoja.getRange(2, 1, ultima - 1, 11).getValues() : [];

  const nuevas = viejas.filter(v => v[0] !== '').map(v => {
    const fila = new Array(CABECERAS.length).fill('');
    fila[C.ID]       = v[0];
    fila[C.TS]       = v[1];
    fila[C.TIPO]     = normalizarTipo(v[3]);
    fila[C.LITROS]   = vacio(num(v[4]));
    fila[C.PRECIO]   = vacio(num(v[5]));
    fila[C.TOTAL]    = vacio(num(v[6]));
    fila[C.KM_TOTAL] = vacio(num(v[2]));
    fila[C.RECIBO]   = v[10] || '';
    fila[C.LLENO]    = true;
    return fila;
  });

  hoja.clear();
  hoja.setName(HOJA_DATOS);
  hoja.getRange(1, 1, 1, CABECERAS.length).setValues([CABECERAS])
      .setFontWeight('bold').setBackground('#1E1E1E').setFontColor('#FFFFFF');
  hoja.setFrozenRows(1);
  if (nuevas.length) {
    hoja.getRange(2, 1, nuevas.length, CABECERAS.length).setValues(nuevas);
    darFormatoFilas(hoja, 2, nuevas.length);
  }

  recalcularTodo();
  ui.alert('Migración completada: ' + nuevas.length + ' filas.\nCopia de seguridad: ' + backup.getName());
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⛽ RefuelControl')
    .addItem('Probar acceso a Drive', 'probarDrive')
    .addItem('Recalcular todo', 'recalcularTodo')
    .addSeparator()
    .addItem('Actualizar esquema', 'actualizarEsquema')
    .addItem('Migrar esquema antiguo', 'migrarEsquema')
    .addToUi();
}
