/**
 * RefuelControl_60F10 — Backend Apps Script  ·  v3
 * Dacia Sandero Stepway ECO-G 120 (bífuel GLP + gasolina)
 *
 * DESPLIEGUE (obligatorio tras cada cambio):
 *   Implementar > Gestionar implementaciones > lápiz > Versión: Nueva versión > Implementar
 *
 * MODELO DE CÁLCULO
 *   Se resetean los contadores parciales después de cada repostaje, así que la
 *   lectura de cada contador ES el recorrido de ese tramo.
 *   Un depósito se llena entero cuando se reposta, pero no siempre se repostan
 *   los dos combustibles. Por eso el consumo de cada combustible se calcula
 *   contra los km acumulados de ESE combustible desde su último repostaje,
 *   no contra los del último ticket.
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

const HOJA_DATOS = 'Registro de Repostajes';
const MODELO     = 'gemini-2.5-flash';
const ZONA       = 'Atlantic/Canary';

const CABECERAS = [
  'ID', 'Timestamp', 'Estación', 'Tipo Combustible', 'Litros',
  'Precio por Litro (€)', 'Total Invertido (€)', 'KM Totales',
  'KM Recorridos (tramo)', 'Lectura KM GLP (coche)', 'Lectura KM Gasolina (coche)',
  'KM GLP (tramo)', 'KM Gasolina (tramo)', 'Consumo coche (L/100km)',
  'Consumo real (L/100km)', 'Coste por KM real (€/km)', 'Coste por KM coche (€/km)',
  'Enlace Recibo', 'KM de este combustible desde su último repostaje'
];

const C = {
  ID: 0, TS: 1, ESTACION: 2, TIPO: 3, LITROS: 4, PRECIO: 5, TOTAL: 6,
  KM_TOTAL: 7, KM_TRAMO: 8, LEC_GLP: 9, LEC_GAS: 10, KM_GLP: 11, KM_GAS: 12,
  CONS_COCHE: 13, CONS_REAL: 14, COSTE_REAL: 15, COSTE_COCHE: 16, RECIBO: 17,
  KM_CALC: 18
};

// ============================================================
//  ENTRADA WEB APP
// ============================================================

function doGet(e) {
  const cb = e && e.parameter ? e.parameter.callback : null;
  try {
    if (!e || e.parameter.token !== SHARED_TOKEN) return jsonOut({ ok: false, error: 'No autorizado' }, cb);
    switch (e.parameter.action) {
      case 'dashboard': return jsonOut(Object.assign({ ok: true }, getDashboardData()), cb);
      case 'ping':      return jsonOut({ ok: true, version: '3.0', drive: diagnosticoDrive() }, cb);
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

  return {
    ok: true,
    estacion: datos.estacion || '',
    municipio: datos.municipio || '',
    fechaTicket: datos.fecha_ticket || '',
    items: (datos.items || []).map(normalizarItem),
    estacionesConocidas: listaEstaciones(),
    ultimoRegistro: resumenUltimoTicket()
  };
}

function normalizarItem(it) {
  return {
    tipo: normalizarTipo(it.tipo),
    litros: num(it.litros) || 0,
    precio_litro: num(it.precio_litro) || 0,
    total: num(it.total) || 0
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

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const x = parseFloat(String(v).replace(',', '.'));
  return isNaN(x) ? null : x;
}

function redondear(v, dec) {
  if (v === null || v === undefined || isNaN(v) || !isFinite(v)) return null;
  const f = Math.pow(10, dec);
  return Math.round(v * f) / f;
}

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

  const idRecibo = 'REP-' + new Date().getTime().toString().slice(-6);
  const ahora = new Date();

  // Renombramos la foto con el ID definitivo
  let urlRecibo = (datos.recibo && datos.recibo.url) || '';
  if (datos.recibo && datos.recibo.fileId) {
    try {
      DriveApp.getFileById(datos.recibo.fileId)
        .setName(idRecibo + '_' + Utilities.formatDate(ahora, ZONA, 'yyyy-MM-dd') + '.jpg');
    } catch (err) {
      console.error('No se pudo renombrar el recibo: ' + err.message);
    }
  }

  const filas = items.map(it => {
    const fila = new Array(CABECERAS.length).fill('');
    fila[C.ID]         = idRecibo;
    fila[C.TS]         = ahora;
    fila[C.ESTACION]   = datos.estacion || '';
    fila[C.TIPO]       = it.tipo;
    fila[C.LITROS]     = it.litros;
    fila[C.PRECIO]     = it.precio_litro;
    fila[C.TOTAL]      = it.total;
    fila[C.KM_TOTAL]   = kmTotales;
    fila[C.LEC_GLP]    = vacio(num(datos.lecturaGLP));
    fila[C.LEC_GAS]    = vacio(num(datos.lecturaGasolina));
    fila[C.CONS_COCHE] = vacio(num(esGLP(it.tipo) ? datos.consumoCocheGLP : datos.consumoCocheGasolina));
    fila[C.RECIBO]     = urlRecibo;
    return fila;
  });

  const inicio = hoja.getLastRow() + 1;
  asegurarTamano(hoja, inicio + filas.length - 1, CABECERAS.length);
  hoja.getRange(inicio, 1, filas.length, CABECERAS.length).setValues(filas);
  SpreadsheetApp.flush();

  const resumen = recalcularTodo();

  return {
    ok: true,
    idRecibo,
    avisoDrive: urlRecibo ? '' : 'La foto no se guardó en Drive.',
    avisos: (resumen.avisos || []).filter(a => a.id === idRecibo),
    ultimo: resumen.ultimo,
    items: items.map(i => ({ tipo: i.tipo, litros: i.litros, total: i.total }))
  };
}

function vacio(v) { return v === null || v === undefined ? '' : v; }

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
 * Recalcula tramos, acumulados por combustible, consumos y costes de toda la hoja.
 * Devuelve un resumen con los avisos de coherencia detectados.
 */
function recalcularTodo() {
  const hoja = getHoja();
  const ultima = hoja.getLastRow();
  if (ultima < 2) return { avisos: [], ultimo: null };

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
  let accGLP = 0, accGas = 0; // km acumulados desde el último repostaje de cada combustible
  // El acumulado solo sirve si conocemos TODOS los tramos desde ese repostaje.
  // Si en algún tramo falta la lectura, el consumo de ese depósito no es calculable.
  let completoGLP = false, completoGas = false;
  let vistoGLP = false, vistoGas = false;
  const avisos = [];

  orden.forEach(id => {
    const idx = porId[id];
    const ref = filas[idx[0]];

    const kmTotal   = num(ref[C.KM_TOTAL]);
    const lecGLP    = num(ref[C.LEC_GLP]);
    const lecGas    = num(ref[C.LEC_GAS]);

    const kmTramo   = (kmTotal !== null && previo && previo.kmTotal !== null) ? kmTotal - previo.kmTotal : null;
    const tramoGLP  = tramoDeContador(lecGLP, previo ? previo.lecGLP : null);
    const tramoGas  = tramoDeContador(lecGas, previo ? previo.lecGas : null);

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

    // ¿Qué combustibles trae este ticket?
    const traeGLP = idx.some(i => esGLP(filas[i][C.TIPO]));
    const traeGas = idx.some(i => !esGLP(filas[i][C.TIPO]));

    // El consumo solo sale si el depósito estaba lleno al principio de la ventana
    // (hubo un repostaje previo de ese combustible) y conocemos todos sus tramos.
    const fiableGLP = traeGLP && vistoGLP && completoGLP && accGLP > 0;
    const fiableGas = traeGas && vistoGas && completoGas && accGas > 0;

    idx.forEach(i => {
      const f = filas[i];
      const glp = esGLP(f[C.TIPO]);
      const fiable = glp ? fiableGLP : fiableGas;
      const kmCalc = fiable ? (glp ? accGLP : accGas) : null;
      const litros = num(f[C.LITROS]);
      const total  = num(f[C.TOTAL]);
      const precio = num(f[C.PRECIO]);
      const consCoche = num(f[C.CONS_COCHE]);

      f[C.KM_TRAMO] = vacio(kmTramo);
      f[C.KM_GLP]   = vacio(tramoGLP);
      f[C.KM_GAS]   = vacio(tramoGas);
      f[C.KM_CALC]  = vacio(kmCalc);

      f[C.CONS_REAL]   = vacio(fiable && litros ? redondear((litros / kmCalc) * 100, 2) : null);
      f[C.COSTE_REAL]  = vacio(fiable && total  ? redondear(total / kmCalc, 4) : null);
      f[C.COSTE_COCHE] = vacio(consCoche && precio ? redondear((precio * consCoche) / 100, 4) : null);
    });

    if (traeGLP) { accGLP = 0; completoGLP = true; vistoGLP = true; }
    if (traeGas) { accGas = 0; completoGas = true; vistoGas = true; }

    previo = { kmTotal, lecGLP, lecGas };
  });

  rango.setValues(filas);
  SpreadsheetApp.flush();

  return {
    avisos,
    ultimo: previo,
    pendientes: { kmGLPSinRepostar: accGLP, kmGasolinaSinRepostar: accGas }
  };
}

// ============================================================
//  LECTURA DE LA HOJA
// ============================================================

function getHoja() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(HOJA_DATOS);
  if (!hoja) {
    for (const s of libro.getSheets()) {
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
  return { id: f[C.ID], kmTotales: num(f[C.KM_TOTAL]), lecturaGLP: num(f[C.LEC_GLP]), lecturaGas: num(f[C.LEC_GAS]) };
}

function resumenUltimoTicket() {
  const t = ultimoTicket();
  if (!t) return null;
  return { kmTotales: t.kmTotales, lecturaGLP: t.lecturaGLP, lecturaGasolina: t.lecturaGas };
}

function listaEstaciones() {
  const set = {};
  leerFilas().forEach(f => { if (f[C.ESTACION]) set[f[C.ESTACION]] = true; });
  return Object.keys(set).sort();
}

// ============================================================
//  DASHBOARD
// ============================================================

function getDashboardData() {
  const registros = leerFilas().map(f => {
    const fecha = f[C.TS] instanceof Date ? f[C.TS] : new Date(f[C.TS]);
    return {
      id: f[C.ID],
      fecha: isNaN(fecha.getTime()) ? String(f[C.TS]) : Utilities.formatDate(fecha, ZONA, 'yyyy-MM-dd'),
      estacion: f[C.ESTACION] || 'Sin estación',
      tipo: f[C.TIPO],
      litros: num(f[C.LITROS]),
      precio: num(f[C.PRECIO]),
      total: num(f[C.TOTAL]),
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
      recibo: f[C.RECIBO] || ''
    };
  });

  return {
    registros,
    estaciones: listaEstaciones(),
    actualizado: Utilities.formatDate(new Date(), ZONA, 'dd/MM/yyyy HH:mm')
  };
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

/** Añade la columna S a una hoja que ya tenga el esquema de 18 columnas. */
function actualizarEsquema() {
  const hoja = getHoja();
  hoja.getRange(1, 1, 1, CABECERAS.length).setValues([CABECERAS])
      .setFontWeight('bold').setBackground('#1E1E1E').setFontColor('#FFFFFF');
  hoja.setFrozenRows(1);
  const r = recalcularTodo();
  try {
    SpreadsheetApp.getUi().alert(
      'Esquema actualizado y hoja recalculada.\n\n' +
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
    return fila;
  });

  hoja.clear();
  hoja.setName(HOJA_DATOS);
  hoja.getRange(1, 1, 1, CABECERAS.length).setValues([CABECERAS])
      .setFontWeight('bold').setBackground('#1E1E1E').setFontColor('#FFFFFF');
  hoja.setFrozenRows(1);
  if (nuevas.length) hoja.getRange(2, 1, nuevas.length, CABECERAS.length).setValues(nuevas);

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