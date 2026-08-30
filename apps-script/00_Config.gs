/**
 * RefuelControl_60F10 — Backend Apps Script  ·  v5
 * Dacia Sandero Stepway ECO-G 120 (bífuel GLP + gasolina)
 *
 * EL PROYECTO SON DIEZ ARCHIVOS, uno por responsabilidad:
 *   00_Config     constantes, claves y el esquema de las 23 columnas
 *   01_WebApp     doGet, doPost y la subida de la foto a Drive
 *   02_Gemini     lectura del ticket con la IA
 *   03_Utiles     conversiones de tipo, número y fecha
 *   04_Hoja       acceso y lectura de «Registro de Repostajes»
 *   05_Escritura  guardar, editar y borrar
 *   06_Motor      el cálculo tanque a tanque
 *   07_Dashboard  lo que lee la PWA y la exportación a CSV
 *   08_Copias     las dos copias de seguridad
 *   09_Menu       menú de la hoja y mantenimiento
 * Apps Script mete todos los archivos en el mismo ámbito global: el prefijo
 * numérico solo sirve para leerlos en orden.
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
 * DOS COPIAS DE SEGURIDAD, PARA DOS SUSTOS DISTINTOS
 *   1. La hoja «Copia de seguridad» guarda TODAS las filas que han existido, con
 *      una columna que dice si siguen vivas o se borraron. Se sincroniza sola en
 *      cada recalcularTodo(), así que un borrado desde la app nunca pierde datos.
 *   2. La copia semanal duplica el LIBRO ENTERO en una carpeta de Drive y conserva
 *      las 8 últimas. Esa protege de perder la hoja de cálculo completa.
 *      Se programa desde el menú ⛽ RefuelControl > Programar copia semanal.
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
const VERSION     = '5.1';

// Copia semanal del libro entero
const CARPETA_COPIAS     = 'RefuelControl · Copias de seguridad';
const COPIAS_A_CONSERVAR = 8;                  // unas ocho semanas de historial
const DISPARADOR_COPIA   = 'copiaSemanal';     // nombre de la función que dispara
const PREFIJO_COPIA      = 'RefuelControl_';

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
