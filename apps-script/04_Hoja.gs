/**
 * RefuelControl · Acceso a la hoja
 *
 * Todo lo que toca «Registro de Repostajes»: localizarla, leerla y
 * responder preguntas sobre ella (último ticket, estaciones,
 * ubicaciones, estado de los depósitos).
 *
 * Parte del backend de RefuelControl. Apps Script mete todos los archivos del
 * proyecto en el mismo ámbito global, así que el prefijo numérico solo sirve
 * para leerlos en orden; las funciones se llaman entre archivos sin importar
 * nada. Despliegue: Implementar > Gestionar implementaciones > Nueva versión.
 */

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
