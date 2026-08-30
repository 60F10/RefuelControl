/**
 * RefuelControl · Copias de seguridad
 *
 * Dos copias para dos sustos: la hoja «Copia de seguridad», que guarda
 * todas las filas que han existido, y la copia semanal del libro entero
 * en Drive, con rotación de ocho.
 *
 * Parte del backend de RefuelControl. Apps Script mete todos los archivos del
 * proyecto en el mismo ámbito global, así que el prefijo numérico solo sirve
 * para leerlos en orden; las funciones se llaman entre archivos sin importar
 * nada. Despliegue: Implementar > Gestionar implementaciones > Nueva versión.
 */

// ============================================================
//  COPIA DE SEGURIDAD
//  Todos los repostajes que han existido, vivos y borrados.
// ============================================================

function getHojaCopia() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(HOJA_COPIA);
  if (!hoja) hoja = libro.insertSheet(HOJA_COPIA);

  if (CABECERAS_COPIA.length > hoja.getMaxColumns()) {
    hoja.insertColumnsAfter(hoja.getMaxColumns(), CABECERAS_COPIA.length - hoja.getMaxColumns());
  }
  // Si la pestaña la creó una persona a mano, puede estar en blanco: le ponemos
  // la cabecera igual, para no acabar escribiendo datos bajo columnas sin nombre.
  if (hoja.getRange(1, 1).getValue() !== 'ID') {
    hoja.getRange(1, 1, 1, CABECERAS_COPIA.length).setValues([CABECERAS_COPIA])
        .setFontWeight('bold').setBackground('#1E1E1E').setFontColor('#FFFFFF');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

// ============================================================
//  COPIA SEMANAL DEL LIBRO ENTERO
//  La hoja «Copia de seguridad» protege de un borrado desde la
//  app. Esto protege de perder la hoja de cálculo entera.
// ============================================================

/** La carpeta de copias vive al lado del propio libro. Se crea si no existe. */
function carpetaDeCopias() {
  const archivo = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  const padres = archivo.getParents();
  const raiz = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  const existentes = raiz.getFoldersByName(CARPETA_COPIAS);
  return existentes.hasNext() ? existentes.next() : raiz.createFolder(CARPETA_COPIAS);
}

/** Duplica el libro y manda a la papelera las copias que sobran. */
function copiaSeguridadDelLibro() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const carpeta = carpetaDeCopias();
  const nombre = PREFIJO_COPIA + Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd_HHmm');
  const copia = DriveApp.getFileById(libro.getId()).makeCopy(nombre, carpeta);
  const borradas = rotarCopias(carpeta);

  PROPS.setProperty('ULTIMA_COPIA', new Date().toISOString());
  return { ok: true, nombre, url: copia.getUrl(), carpeta: carpeta.getName(), borradas };
}

/** Deja solo las COPIAS_A_CONSERVAR más recientes. Devuelve cuántas ha retirado. */
function rotarCopias(carpeta) {
  const archivos = [];
  const it = carpeta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(PREFIJO_COPIA) === 0) archivos.push(f);
  }
  archivos.sort((a, b) => b.getDateCreated() - a.getDateCreated());

  let borradas = 0;
  archivos.slice(COPIAS_A_CONSERVAR).forEach(f => { f.setTrashed(true); borradas++; });
  return borradas;
}

/** La que ejecuta el disparador. Nunca lanza: si falla, lo deja en el registro. */
function copiaSemanal() {
  try {
    const r = copiaSeguridadDelLibro();
    console.log('Copia creada: ' + r.nombre +
                (r.borradas ? ' · ' + r.borradas + ' antiguas a la papelera' : ''));
    return r;
  } catch (err) {
    console.error('Falló la copia semanal: ' + err.message);
    PROPS.setProperty('ULTIMA_COPIA_ERROR', new Date().toISOString() + ' · ' + err.message);
    return { ok: false, error: err.message };
  }
}

function disparadorDeCopia() {
  const lista = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === DISPARADOR_COPIA);
  return lista.length ? lista[0] : null;
}

function programarCopiaSemanal() {
  const ui = interfaz();
  try {
    if (disparadorDeCopia()) {
      if (ui) ui.alert('La copia semanal ya está programada.\n\n' + resumenCopias());
      return { ok: true, yaEstaba: true };
    }
    ScriptApp.newTrigger(DISPARADOR_COPIA)
      .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(4).create();

    const r = copiaSeguridadDelLibro();   // una primera copia, para no esperar al lunes
    if (ui) {
      ui.alert('Copia semanal programada para los lunes de madrugada.\n\n' +
               'Acabo de hacer la primera: ' + r.nombre + '\n' +
               'Carpeta: ' + r.carpeta + '\n\n' +
               'Se conservan las ' + COPIAS_A_CONSERVAR + ' últimas.');
    }
    return { ok: true, primera: r };
  } catch (err) {
    if (ui) {
      ui.alert('No pude crear el disparador:\n\n' + err.message + '\n\n' +
               'Si es un problema de permisos, añade este scope a appsscript.json:\n' +
               'https://www.googleapis.com/auth/script.scriptapp\n\n' +
               'O créalo a mano en el editor: Activadores → Añadir activador → ' +
               'función «copiaSemanal», origen «Según tiempo», tipo «Temporizador semanal».');
    }
    return { ok: false, error: err.message };
  }
}

function cancelarCopiaSemanal() {
  const ui = interfaz();
  const t = disparadorDeCopia();
  if (!t) {
    if (ui) ui.alert('No había ninguna copia semanal programada.');
    return { ok: true, noHabia: true };
  }
  ScriptApp.deleteTrigger(t);
  if (ui) ui.alert('Copia semanal cancelada.\n\nLas copias ya hechas siguen en Drive.');
  return { ok: true };
}

/** Copia a demanda desde el menú. */
function copiaSeguridadAhora() {
  const ui = interfaz();
  try {
    const r = copiaSeguridadDelLibro();
    if (ui) {
      ui.alert('Copia creada.\n\n' + r.nombre + '\nCarpeta: ' + r.carpeta +
               (r.borradas ? '\n\n' + r.borradas + ' copias antiguas a la papelera.' : ''));
    }
    return r;
  } catch (err) {
    if (ui) ui.alert('No se pudo copiar el libro:\n\n' + err.message);
    return { ok: false, error: err.message };
  }
}

function resumenCopias() {
  const ultima = PROPS.getProperty('ULTIMA_COPIA');
  const error = PROPS.getProperty('ULTIMA_COPIA_ERROR');
  return 'Última copia: ' + (ultima ? new Date(ultima).toLocaleString('es-ES') : 'ninguna todavía') +
         (error ? '\nÚltimo fallo: ' + error : '');
}

/** Estado de las copias, para el ping y para el menú. */
function estadoCopias() {
  const ultima = PROPS.getProperty('ULTIMA_COPIA');
  let programada = null;
  try { programada = !!disparadorDeCopia(); } catch (err) { programada = null; }
  return {
    programada,
    ultima: ultima || '',
    conservadas: COPIAS_A_CONSERVAR,
    ultimoError: PROPS.getProperty('ULTIMA_COPIA_ERROR') || ''
  };
}

/** SpreadsheetApp.getUi() revienta cuando no hay hoja abierta (disparador, web app). */
function interfaz() {
  try { return SpreadsheetApp.getUi(); } catch (err) { return null; }
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
