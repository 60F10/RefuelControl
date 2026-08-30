/**
 * RefuelControl · Lectura del ticket con Gemini
 *
 * Manda la foto al modelo y normaliza lo que devuelve. Nada de lo que
 * sale de aquí se guarda sin pasar antes por la pantalla de revisión.
 *
 * Parte del backend de RefuelControl. Apps Script mete todos los archivos del
 * proyecto en el mismo ámbito global, así que el prefijo numérico solo sirve
 * para leerlos en orden; las funciones se llaman entre archivos sin importar
 * nada. Despliegue: Implementar > Gestionar implementaciones > Nueva versión.
 */

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
