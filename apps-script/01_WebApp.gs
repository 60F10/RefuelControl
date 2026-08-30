/**
 * RefuelControl · Web app
 *
 * Las dos puertas de entrada (doGet y doPost), la respuesta JSON y
 * la subida de la foto a Drive. Las acciones van separadas para que
 * ninguna llamada agote el límite de 10 s de la función de Netlify.
 *
 * Parte del backend de RefuelControl. Apps Script mete todos los archivos del
 * proyecto en el mismo ámbito global, así que el prefijo numérico solo sirve
 * para leerlos en orden; las funciones se llaman entre archivos sin importar
 * nada. Despliegue: Implementar > Gestionar implementaciones > Nueva versión.
 */

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
      case 'ping':      return jsonOut({ ok: true, version: VERSION, drive: diagnosticoDrive(), copias: estadoCopias() }, cb);
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
