// ==========================================================
//  UBICACIÓN (roadmap 3.2)
//
//  El permiso lo guarda el navegador. Con maximumAge reutilizamos la
//  última posición y no se vuelve a molestar al usuario.
// ==========================================================

import { RADIO_ESTACION } from './config.js';

let posicion = null;

export const posicionActual = () => posicion;

export async function pedirUbicacion(forzar) {
  if (!navigator.geolocation) return null;
  try {
    if (navigator.permissions && !forzar) {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      if (p.state === 'denied') return null;
    }
  } catch (err) { /* Safari viejo no tiene permissions.query */ }

  return new Promise(ok => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        posicion = { lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy };
        ok(posicion);
      },
      () => ok(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 }
    );
  });
}

/** Distancia en metros entre dos coordenadas. Pura. */
export function distancia(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * La estación conocida más cercana a la posición actual, si está a tiro.
 * Recibe la lista para no depender de dónde vengan los datos.
 */
export function estacionMasCercana(ubicaciones) {
  if (!posicion) return null;
  let mejor = null;
  (ubicaciones || []).forEach(u => {
    const d = distancia(posicion, u);
    if (!mejor || d < mejor.metros) mejor = { estacion: u.estacion, metros: d };
  });
  return mejor && mejor.metros < RADIO_ESTACION ? mejor : null;
}
