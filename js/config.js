// ==========================================================
//  CONFIG — sin secretos.
//
//  La URL del Apps Script y el token viven en la función de
//  Netlify, en variables de entorno. Aquí solo hay constantes
//  que puede leer cualquiera.
// ==========================================================

/** Único punto de entrada al backend. El front no llama a Google directamente. */
export const API = '/api/repostaje';

/** Clave de localStorage donde este dispositivo recuerda el código de acceso. */
export const CLAVE_CODIGO = 'refuelcontrol.codigo';

/**
 * El coche activo.
 *
 * Hoy solo hay uno, pero se trata como «el coche que se está mirando»: si algún
 * día hay varios (nivel 7 del roadmap), esto pasa a venir del backend y lo
 * demás no se entera. Nadie debe clavar estas cifras en línea; se leen de aquí.
 */
export const COCHE = {
  // Capacidad útil de los depósitos, en litros. La de gasolina es la de ficha;
  // la de GLP se ajustó a lo que de verdad entra.
  depositoGLP: 45,
  depositoGasolina: 50,
  // Consumo homologado WLTP combinado del ECO-G 120, L/100km.
  homologadoGLP: 7.4,
  homologadoGasolina: 5.8
};

/** kg de CO2 por litro quemado. Fuente: econologia.net */
export const CO2 = { gasolina: 2.30, glp: 1.70 };

/** Ventana, en días, para comparar el precio de un repostaje con los de su época. */
export const VENTANA_PRECIO = 45;

export const COLORES = { 'GLP': '#28f202', 'Gasolina 98': '#00FFFF', 'Gasolina 95': '#FF5C00' };

export const colorDe = t => COLORES[t] || '#8A8A8A';
export const esGLP = t => String(t).toUpperCase().indexOf('GLP') >= 0;

/** Los tipos que ofrece el desplegable al registrar o editar un repostaje. */
export const TIPOS = ['GLP', 'Gasolina 95', 'Gasolina 98'];

// ----------------------------------------------------------
//  Los seis módulos del carril, en orden
// ----------------------------------------------------------
export const MODULOS = [
  { id: 'mod-repostar',     nombre: 'Repostar',  icono: 'M4 20V7l6-3 6 3v13M4 20h12M9 20v-5h2v5M17 9l3 2v7a1.5 1.5 0 0 1-3 0v-4h-1' },
  { id: 'mod-resumen',      nombre: 'Resumen',   icono: 'M4 19h16M7 16V9m5 7V5m5 11v-4' },
  { id: 'mod-consumos',     nombre: 'Consumos',  icono: 'M4 16l5-5 4 3 6-7M15 7h5v5' },
  { id: 'mod-estaciones',   nombre: 'Estaciones',icono: 'M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z M12 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
  { id: 'mod-historial',    nombre: 'Historial', icono: 'M4 6h16M4 12h16M4 18h10M18.5 16.5v2.2l1.6 1' },
  { id: 'mod-curiosidades', nombre: 'Curioso',   icono: 'M12 3l2.2 5.6L20 9.3l-4 4 1 5.7-5-2.9-5 2.9 1-5.7-4-4 5.8-.7z' }
];

// ----------------------------------------------------------
//  Cola offline (IndexedDB)
// ----------------------------------------------------------
export const BD = { nombre: 'refuelcontrol', version: 1, almacen: 'pendientes' };

// ----------------------------------------------------------
//  Foto del ticket: se reduce en el móvil antes de subirla.
//  Esto además convierte los HEIC del iPhone a JPEG.
// ----------------------------------------------------------
export const FOTO = { maxLado: 1400, calidad: 0.75 };

// ----------------------------------------------------------
//  Tirar hacia abajo para actualizar
// ----------------------------------------------------------
export const PTR = {
  umbral: 62,          // píxeles de tirón que disparan el refresco
  tope: 110,           // hasta dónde sigue el indicador al dedo
  minEntreRefrescos: 30000   // no se recarga dos veces en menos de esto
};

/** Metros por debajo de los cuales se da por buena una estación conocida. */
export const RADIO_ESTACION = 400;
