const GEMINI_API_KEY = ''; // <-- Pon tu clave aquí entre las comillas

function procesarTicket(e) {
  try {
    const libro = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Encontrar la pestaña principal dinámicamente buscando la columna "ID"
    let sheetDestino = null;
    const sheets = libro.getSheets();
    for (let s of sheets) {
      if (s.getRange("A1").getValue() === "ID") {
        sheetDestino = s;
        break;
      }
    }
    
    if (!sheetDestino) {
      console.error("No se ha encontrado la pestaña principal. Asegúrate de no borrar la celda A1 que dice 'ID'.");
      return;
    }

    // 2. Extraer datos del objeto del evento
    const km = e.namedValues['KM actuales del coche.'][0];
    const urlsImagen = e.namedValues['Recibo del repostaje.'][0];
    const timestamp = e.namedValues['Marca temporal'][0];
    const idRecibo = "REP-" + new Date().getTime().toString().slice(-6);
    
    const fileId = urlsImagen.split('id=')[1];
    const file = DriveApp.getFileById(fileId);
    const base64Image = Utilities.base64Encode(file.getBlob().getBytes());
    
    // 3. Petición a la API
    const payload = {
      "contents": [{
        "parts": [
          {"text": "Analiza este recibo de gasolinera. Devuelve UNICAMENTE un array JSON válido: [{\"tipo\": \"Gasolina 95\" o \"Gasolina 98\" o \"GLP\", \"litros\": 0.00, \"precio_litro\": 0.00, \"total\": 0.00}]. No añadas texto fuera del JSON."},
          {
            "inline_data": {
              "mime_type": file.getMimeType(),
              "data": base64Image
            }
          }
        ]
      }]
    };
    
    const options = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(payload),
      'muteHttpExceptions': true // <-- Permite capturar el error detallado de la API
    };
    
    // --- CAMBIO DE LA URL AL MODELO LATEST ---
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = UrlFetchApp.fetch(url, options);
    
    // Si la API no devuelve un 200 OK, registramos el mensaje de error real
    if (response.getResponseCode() !== 200) {
      console.error("Error en la API de Google (" + response.getResponseCode() + "): " + response.getContentText());
      return;
    }

    const jsonRes = JSON.parse(response.getContentText());
    
    // 4. Limpieza y parseo de la respuesta
    let textOut = jsonRes.candidates[0].content.parts[0].text;
    textOut = textOut.replace(/```json/g, '').replace(/```/g, '').trim();
    const datosTicket = JSON.parse(textOut);
    
    const ultimaFila = sheetDestino.getLastRow();
    
    // 5. Inserción de filas y fórmulas automáticas
    for (let i = 0; i < datosTicket.length; i++) {
      
      // Calculamos matemáticamente en qué fila estamos escribiendo
      const filaActual = ultimaFila + i + 1;
      const filaAnterior = filaActual - 1;
      
      // Construimos las fórmulas inyectando el número de fila dinámico
      const formulaKM = `=C${filaActual}-C${filaAnterior}`;
      const formulaConsumo = `=SI.ERROR((E${filaActual}/H${filaActual})*100; "")`;
      const formulaCoste = `=SI.ERROR(G${filaActual}/H${filaActual}; "")`;

      sheetDestino.appendRow([
        idRecibo, // Columna A
        timestamp, // Columna B
        km, // Columna C
        datosTicket[i].tipo, // Columna D
        datosTicket[i].litros, // Columna E
        datosTicket[i].precio_litro, // Columna F
        datosTicket[i].total, // Columna G
        formulaKM, // Columna H (¡Fórmula inyectada!)
        formulaConsumo, // Columna I (¡Fórmula inyectada!)
        formulaCoste, // Columna J (¡Fórmula inyectada!)
        urlsImagen // Columna K
      ]);
      console.log(`Guardado automático en fila ${filaActual}: ${datosTicket[i].litros}L`);
    }
    
    console.log("Inserción completada con éxito. Combustibles detectados: " + datosTicket.length);

  } catch (error) {
    console.error("Fallo crítico en la ejecución:");
    console.error(error.stack);
  }
}




function actualizarDashboard() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const hojaDash = libro.getSheetByName("Dashboard");
  
  let hojaDatos = null;
  for (let s of libro.getSheets()) {
    if (s.getRange("A1").getValue() === "ID") {
      hojaDatos = s;
      break;
    }
  }
  
  if (!hojaDatos || !hojaDash) {
    SpreadsheetApp.getUi().alert("Error: No encuentro la pestaña 'Dashboard' o la hoja de datos.");
    return;
  }

  // Limpiar gráficos viejos
  const graficosViejos = hojaDash.getCharts();
  for (let i = 0; i < graficosViejos.length; i++) {
    hojaDash.removeChart(graficosViejos[i]);
  }

  const ultimaFila = hojaDatos.getLastRow();
  if (ultimaFila < 2) {
    SpreadsheetApp.getUi().alert("Aún no hay datos suficientes para graficar.");
    return;
  }

  // Leemos toda la tabla de golpe
  const datosRaw = hojaDatos.getRange(2, 1, ultimaFila - 1, 10).getValues();
  
  // 1. Sacamos qué combustibles existen realmente
  const tiposUnicos = [...new Set(datosRaw.map(r => r[3]).filter(String))];
  
  const fechasMap = new Map();
  const quesitoMap = new Map();

  // 2. Procesamos y limpiamos fila a fila (adiós problemas de texto/número)
  datosRaw.forEach(row => {
    let fecha = row[1];
    if (!fecha) return;
    
    // Agrupamos por tiempo exacto
    let timeKey = (fecha instanceof Date) ? fecha.getTime() : fecha.toString();
    if (!fechasMap.has(timeKey)) {
      fechasMap.set(timeKey, { dateObj: fecha, valores: {} });
    }
    
    let tipo = row[3];
    // Forzamos conversión a número arreglando comas canarias/españolas a puntos JS
    let precio = parseFloat(row[5].toString().replace(',', '.'));
    let total = parseFloat(row[6].toString().replace(',', '.'));
    let costeKM = parseFloat(row[9].toString().replace(',', '.'));
    
    fechasMap.get(timeKey).valores[tipo] = { 
      precio: isNaN(precio) ? null : precio, 
      costeKM: isNaN(costeKM) ? null : costeKM 
    };
    
    // Sumamos el dinero para el quesito
    if (tipo && !isNaN(total)) {
      quesitoMap.set(tipo, (quesitoMap.get(tipo) || 0) + total);
    }
  });

  // 3. Construimos las matrices 2D perfectas para Google Charts
  let tablaPrecios = [["Fecha", ...tiposUnicos]];
  let tablaCostes = [["Fecha", ...tiposUnicos]];
  
  // Ordenamos cronológicamente
  const fechasOrdenadas = Array.from(fechasMap.values()).sort((a, b) => a.dateObj - b.dateObj);

  fechasOrdenadas.forEach(item => {
    let filaPrecio = [item.dateObj];
    let filaCoste = [item.dateObj];
    
    tiposUnicos.forEach(tipo => {
      let datosTipo = item.valores[tipo];
      filaPrecio.push(datosTipo ? datosTipo.precio : null);
      filaCoste.push(datosTipo ? datosTipo.costeKM : null);
    });
    
    tablaPrecios.push(filaPrecio);
    tablaCostes.push(filaCoste);
  });

  let tablaQuesito = [["Tipo", "Total Invertido"]];
  for (let [tipo, total] of quesitoMap.entries()) {
    tablaQuesito.push([tipo, total]);
  }

  // 4. Volcamos los datos limpios en la hoja oculta
  let hojaAux = libro.getSheetByName("Motor_Graficos");
  if (!hojaAux) {
    hojaAux = libro.insertSheet("Motor_Graficos");
    hojaAux.hideSheet(); 
  }
  hojaAux.clear();

  hojaAux.getRange(1, 1, tablaPrecios.length, tablaPrecios[0].length).setValues(tablaPrecios);
  
  const colCosteInicio = tablaPrecios[0].length + 2;
  hojaAux.getRange(1, colCosteInicio, tablaCostes.length, tablaCostes[0].length).setValues(tablaCostes);
  
  const colQuesitoInicio = colCosteInicio + tablaCostes[0].length + 2;
  hojaAux.getRange(1, colQuesitoInicio, tablaQuesito.length, 2).setValues(tablaQuesito);

  SpreadsheetApp.flush();

  // 5. Capturamos rangos y dibujamos (ESTÉTICA INTACTA)
  const rangoPreciosPivot = hojaAux.getRange(1, 1, tablaPrecios.length, tablaPrecios[0].length);
  const rangoCostePivot = hojaAux.getRange(1, colCosteInicio, tablaCostes.length, tablaCostes[0].length);
  const rangoQuesito = hojaAux.getRange(1, colQuesitoInicio, tablaQuesito.length, 2);

  const bgColor = '#1E1E1E'; 
  const textColor = '#FFFFFF'; 
  const gridColor = '#333333'; 

  // 1. Definimos los colores por combustible de forma absoluta
  const colorGas95 = '#28f202'; // Verde
  const colorGas98 = '#00FFFF'; // Azul
  const colorGLP = '#FF5C00';   // Naranja

  // 2. Creamos paletas específicas basadas en el orden de los datos de cada gráfica
  
  // Orden del Quesito (según tu imagen): Gasolina 95, GLP, Gasolina 98
  const paletteQuesito = [colorGas95, colorGLP, colorGas98]; 
  
  // Orden de las Líneas (según sus leyendas): GLP, Gasolina 98, Gasolina 95
  const paletteLineas = [colorGLP, colorGas98, colorGas95]; 

  const chartGasto = hojaDash.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(rangoQuesito)
    .setPosition(3, 2, 0, 0)
    .setOption('title', 'Distribución de Inversión (€) - GLP vs Gasolina')
    .setOption('backgroundColor', bgColor)
    .setOption('titleTextStyle', {color: textColor, fontSize: 16})
    .setOption('legend', {textStyle: {color: textColor}})
    .setOption('colors', paletteQuesito) // <-- Paleta del quesito
    .setOption('pieHole', 0.3)
    .setOption('width', 600)
    .setOption('height', 400)
    .build();

  const chartCosteKM = hojaDash.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(rangoCostePivot)
    .setPosition(3, 9, 0, 0)
    .setOption('title', 'Evolución del Coste por Kilómetro (€/km)')
    .setOption('backgroundColor', bgColor)
    .setOption('titleTextStyle', {color: textColor, fontSize: 16})
    .setOption('legend', {textStyle: {color: textColor}})
    .setOption('colors', paletteLineas) // <-- Paleta de las líneas
    .setOption('hAxis', {textStyle: {color: textColor}, gridlines: {color: gridColor}})
    .setOption('vAxis', {textStyle: {color: textColor}, gridlines: {color: gridColor}})
    .setOption('curveType', 'function')
    .setNumHeaders(1) 
    .setOption('useFirstColumnAsDomain', true)
    .setOption('treatLabelsAsText', false)
    .setOption('interpolateNulls', true)
    .setOption('pointSize', 6) 
    .setOption('width', 600)
    .setOption('height', 400)
    .build();

  const chartPrecio = hojaDash.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(rangoPreciosPivot)
    .setPosition(23, 2, 0, 0)
    .setOption('title', 'Fluctuación del Precio por Litro (€)')
    .setOption('backgroundColor', bgColor)
    .setOption('titleTextStyle', {color: textColor, fontSize: 16})
    .setOption('legend', {textStyle: {color: textColor}})
    .setOption('colors', paletteLineas) // <-- Paleta de las líneas
    .setOption('hAxis', {textStyle: {color: textColor}, gridlines: {color: gridColor}})
    .setOption('vAxis', {textStyle: {color: textColor}, gridlines: {color: gridColor}})
    .setOption('curveType', 'function')
    .setNumHeaders(1) 
    .setOption('useFirstColumnAsDomain', true)
    .setOption('treatLabelsAsText', false)
    .setOption('interpolateNulls', true)
    .setOption('pointSize', 6) 
    .setOption('width', 1265)
    .setOption('height', 400)
    .build();

  hojaDash.insertChart(chartGasto);
  hojaDash.insertChart(chartCosteKM);
  hojaDash.insertChart(chartPrecio);
}

function onEdit(e) {
  // 1. Definimos la celda donde está nuestra casilla de verificación
  const celdaBoton = 'A1'; 
  const nombreHoja = 'Dashboard'; 
  
  // Si e (el evento) no existe, salimos
  if (!e) return; 

  const rangoEditado = e.range;
  const hojaActiva = rangoEditado.getSheet();
  
  // 2. Comprobamos la celda, la hoja y si la casilla se marcó (TRUE)
  if (hojaActiva.getName() === nombreHoja && rangoEditado.getA1Notation() === celdaBoton && e.value === "TRUE") {
    
    // 3. Llamamos a tu función principal (CORREGIDO)
    actualizarDashboard(); 
    
    // 4. Desmarcamos la casilla automáticamente para simular un botón
    rangoEditado.uncheck();
  }
}

/**
 * BACKEND WEB APP - Registro de Repostajes
 * Sustituye el flujo de Google Form por endpoints JSON para la PWA.
 *
 * DESPLIEGUE:
 * Extensiones > Apps Script > Implementar > Nueva implementación
 * Tipo: Aplicación web | Ejecutar como: Yo | Acceso: Cualquiera con el enlace
 */

const SHARED_TOKEN = '';   // pseudo-auth para que no escriba cualquiera con la URL
const CARPETA_RECIBOS_ID = '';        // opcional: ID de carpeta Drive para guardar fotos

// ---------- ENTRADA WEB APP ----------

function doGet(e) {
  if (e.parameter.token !== SHARED_TOKEN) return jsonOut({ error: 'No autorizado' }, e.parameter.callback);

  const data = e.parameter.action === 'dashboard' ? getDashboardData() : { status: 'ok' };
  return jsonOut(data, e.parameter.callback);
}

function doPost(e) {
  try {
    // OJO: el cliente debe mandar Content-Type 'text/plain' para evitar el
    // preflight CORS que Apps Script no sabe responder.
    const body = JSON.parse(e.postData.contents);
    if (body.token !== SHARED_TOKEN) return jsonOut({ error: 'No autorizado' });

    const resultado = registrarRepostaje(body.km, body.imagenBase64, body.mimeType, new Date());
    return jsonOut({ ok: true, registros: resultado });

  } catch (error) {
    return jsonOut({ ok: false, error: error.message });
  }
}

function jsonOut(obj, callback) {
  if (callback) {
    return ContentService.createTextOutput(`${callback}(${JSON.stringify(obj)})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- NÚCLEO COMPARTIDO (lógica de tu procesarTicket original) ----------

function registrarRepostaje(km, base64Image, mimeType, timestamp) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const sheetDestino = encontrarHojaPorCabecera(libro, 'ID');
  if (!sheetDestino) throw new Error("No se encuentra la pestaña con cabecera 'ID'.");

  const idRecibo = "REP-" + new Date().getTime().toString().slice(-6);

  let urlRecibo = '';
  if (base64Image) {
    try {
      const blob = Utilities.newBlob(Utilities.base64Decode(base64Image), mimeType || 'image/jpeg', idRecibo + '.jpg');
      const carpeta = CARPETA_RECIBOS_ID ? DriveApp.getFolderById(CARPETA_RECIBOS_ID) : DriveApp.getRootFolder();
      urlRecibo = carpeta.createFile(blob).getUrl();
    } catch (errDrive) {
      console.error('No se pudo guardar la foto en Drive (revisa permisos): ' + errDrive.message);
      // seguimos sin enlace de foto en vez de bloquear todo el registro
    }
  }

  const payload = {
    contents: [{
      parts: [
        { text: "Analiza este recibo de gasolinera. Devuelve UNICAMENTE un array JSON válido: [{\"tipo\": \"Gasolina 95\" o \"Gasolina 98\" o \"GLP\", \"litros\": 0.00, \"precio_litro\": 0.00, \"total\": 0.00}]. No añadas texto fuera del JSON." },
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Image } }
      ]
    }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = UrlFetchApp.fetch(url, options);

  if (response.getResponseCode() !== 200) {
    throw new Error("Error API Gemini (" + response.getResponseCode() + "): " + response.getContentText());
  }

  let textOut = JSON.parse(response.getContentText()).candidates[0].content.parts[0].text;
  textOut = textOut.replace(/```json/g, '').replace(/```/g, '').trim();
  const datosTicket = JSON.parse(textOut);

  const ultimaFila = sheetDestino.getLastRow();
  const filasInsertadas = [];

  for (let i = 0; i < datosTicket.length; i++) {
    const filaActual = ultimaFila + i + 1;
    const filaAnterior = filaActual - 1;

    sheetDestino.appendRow([
      idRecibo, timestamp, km,
      datosTicket[i].tipo, datosTicket[i].litros, datosTicket[i].precio_litro, datosTicket[i].total,
      `=C${filaActual}-C${filaAnterior}`,
      `=SI.ERROR((E${filaActual}/H${filaActual})*100; "")`,
      `=SI.ERROR(G${filaActual}/H${filaActual}; "")`,
      urlRecibo
    ]);

    filasInsertadas.push({ tipo: datosTicket[i].tipo, litros: datosTicket[i].litros, total: datosTicket[i].total });
  }

  return { idRecibo, items: filasInsertadas };
}

function encontrarHojaPorCabecera(libro, valorA1) {
  for (const s of libro.getSheets()) {
    if (s.getRange("A1").getValue() === valorA1) return s;
  }
  return null;
}

// ---------- DASHBOARD EN JSON (mismo pivotado que actualizarDashboard, sin gráficos de Sheets) ----------

function getDashboardData() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const hojaDatos = encontrarHojaPorCabecera(libro, 'ID');
  if (!hojaDatos) return { error: "No hay hoja de datos" };

  const ultimaFila = hojaDatos.getLastRow();
  if (ultimaFila < 2) return { fechas: [], series: [], quesito: [] };

  const datosRaw = hojaDatos.getRange(2, 1, ultimaFila - 1, 10).getValues();
  const tiposUnicos = [...new Set(datosRaw.map(r => r[3]).filter(String))];

  const fechasMap = new Map();
  const quesitoMap = new Map();

  datosRaw.forEach(row => {
    const fecha = row[1];
    if (!fecha) return;
    const timeKey = (fecha instanceof Date) ? fecha.getTime() : fecha.toString();
    if (!fechasMap.has(timeKey)) fechasMap.set(timeKey, { dateObj: fecha, valores: {} });

    const tipo = row[3];
    const precio = parseFloat(row[5].toString().replace(',', '.'));
    const total = parseFloat(row[6].toString().replace(',', '.'));
    const costeKM = parseFloat(row[9].toString().replace(',', '.'));

    fechasMap.get(timeKey).valores[tipo] = {
      precio: isNaN(precio) ? null : precio,
      costeKM: isNaN(costeKM) ? null : costeKM
    };

    if (tipo && !isNaN(total)) quesitoMap.set(tipo, (quesitoMap.get(tipo) || 0) + total);
  });

  const fechasOrdenadas = Array.from(fechasMap.values()).sort((a, b) => a.dateObj - b.dateObj);

  const series = tiposUnicos.map(tipo => ({
    tipo,
    precios: fechasOrdenadas.map(f => f.valores[tipo] ? f.valores[tipo].precio : null),
    costesKM: fechasOrdenadas.map(f => f.valores[tipo] ? f.valores[tipo].costeKM : null)
  }));

  return {
    fechas: fechasOrdenadas.map(f => Utilities.formatDate(f.dateObj, 'GMT', 'dd/MM/yyyy')),
    series,
    quesito: Array.from(quesitoMap.entries()).map(([tipo, total]) => ({ tipo, total }))
  };
}

// ---------- LEGACY: por si quieres mantener el Form en paralelo ----------

function procesarTicket(e) {
  const km = e.namedValues['KM actuales del coche.'][0];
  const urlsImagen = e.namedValues['Recibo del repostaje.'][0];
  const timestamp = e.namedValues['Marca temporal'][0];
  const fileId = urlsImagen.split('id=')[1];
  const file = DriveApp.getFileById(fileId);
  const base64Image = Utilities.base64Encode(file.getBlob().getBytes());
  registrarRepostaje(km, base64Image, file.getMimeType(), timestamp);
}

// Mantén tal cual tus funciones actualizarDashboard() y onEdit() del script original
// si quieres conservar el dashboard de Sheets como respaldo de escritorio.