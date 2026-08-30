/**
 * RefuelControl · Menú y mantenimiento
 *
 * El menú ⛽ RefuelControl de la hoja, la actualización del esquema y los
 * diagnósticos de Drive. Nada de esto lo llama la PWA.
 *
 * Parte del backend de RefuelControl. Apps Script mete todos los archivos del
 * proyecto en el mismo ámbito global, así que el prefijo numérico solo sirve
 * para leerlos en orden; las funciones se llaman entre archivos sin importar
 * nada. Despliegue: Implementar > Gestionar implementaciones > Nueva versión.
 */

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
    .addSubMenu(SpreadsheetApp.getUi().createMenu('Copias de seguridad')
      .addItem('Copiar el libro ahora', 'copiaSeguridadAhora')
      .addItem('Programar copia semanal', 'programarCopiaSemanal')
      .addItem('Cancelar copia semanal', 'cancelarCopiaSemanal')
      .addItem('Ver estado', 'verEstadoCopias'))
    .addSeparator()
    .addItem('Actualizar esquema', 'actualizarEsquema')
    .addItem('Migrar esquema antiguo', 'migrarEsquema')
    .addToUi();
}

function verEstadoCopias() {
  const e = estadoCopias();
  const ui = interfaz();
  const texto =
    'Copia semanal: ' + (e.programada === null ? 'no lo puedo comprobar'
                        : e.programada ? 'programada (lunes de madrugada)' : 'sin programar') + '\n' +
    'Última copia: ' + (e.ultima ? new Date(e.ultima).toLocaleString('es-ES') : 'ninguna todavía') + '\n' +
    'Se conservan las ' + e.conservadas + ' últimas, en «' + CARPETA_COPIAS + '».' +
    (e.ultimoError ? '\n\nÚltimo fallo: ' + e.ultimoError : '');
  if (ui) ui.alert(texto); else console.log(texto);
  return e;
}
