// ==========================================================
//  VALIDACIÓN PREVIA (roadmap 2.3) — funciones puras
//
//  Los errores no dejan guardar. Los avisos piden un segundo toque,
//  porque a veces el raro eres tú y no el dato.
//
//  No lee el DOM: recibe lo que hay escrito en pantalla y devuelve qué
//  está mal y qué campos hay que marcar en rojo. Quien pinta traduce
//  esos nombres a elementos.
// ==========================================================

import { COCHE, esGLP } from './config.js';
import { eur, km, dec } from './formato.js';

/**
 * @param {object} e
 *   kmTotales   lo escrito en «KM totales», tal cual (string o número)
 *   kmMax       el odómetro más alto ya registrado, o null
 *   lecGLP      parcial de GLP del ordenador de a bordo
 *   lecGas      parcial de gasolina
 *   fechaTicket fecha del ticket, o cadena vacía
 *   estacion    nombre de la estación, o cadena vacía
 *   items       [{ tipo, litros, precio_litro, total, lleno }]
 *   coche       opcional: el coche activo, por si algún día hay varios
 * @returns {{errores: string[], avisos: string[], marcar: string[]}}
 *   `marcar` lleva 'km', 'lecGlp', 'lecGas' o 'item:<i>:<campo>'.
 */
export function validarRepostaje(e) {
  const errores = [], avisos = [], marcar = [];
  const coche = e.coche || COCHE;

  const kmT = parseFloat(e.kmTotales);
  const kmMax = e.kmMax === undefined ? null : e.kmMax;

  if (e.kmTotales === '' || e.kmTotales === null || e.kmTotales === undefined || isNaN(kmT)) {
    errores.push('Faltan los KM totales del coche.');
    marcar.push('km');
  } else if (kmMax !== null && kmT < kmMax) {
    errores.push('Los KM totales (' + km(kmT) + ') son menores que los del último registro (' + km(kmMax) + ').');
    marcar.push('km');
  } else if (kmMax !== null && kmT === kmMax) {
    avisos.push('Los KM totales son idénticos a los del último registro. ¿Seguro que no te has saltado el odómetro?');
  }

  const lecGlp = parseFloat(e.lecGLP) || 0;
  const lecGas = parseFloat(e.lecGas) || 0;
  const tramo = (kmMax !== null && !isNaN(kmT)) ? kmT - kmMax : null;

  if (tramo !== null && tramo > 0 && (lecGlp || lecGas)) {
    const suma = lecGlp + lecGas;
    if (Math.abs(suma - tramo) > tramo * 0.15) {
      avisos.push('Los parciales suman ' + km(suma) + ' y el tramo recorrido es de ' + km(tramo) +
                  '. ¿Olvidaste resetear alguno?');
      marcar.push('lecGlp', 'lecGas');
    }
  }
  if (tramo !== null && tramo > 0 && !lecGlp && !lecGas) {
    avisos.push('Sin parciales no se puede calcular el consumo real de este tramo.');
  }

  (e.items || []).forEach((it, i) => {
    const capacidad = esGLP(it.tipo) ? coche.depositoGLP : coche.depositoGasolina;
    const campo = c => 'item:' + i + ':' + c;

    if (!it.litros && !it.total) {
      errores.push(it.tipo + ': hay que poner al menos los litros o el total.');
      marcar.push(campo('litros'));
    }
    if (it.total > 0 && (!it.litros || !it.precio_litro)) {
      avisos.push(it.tipo + ': litros o €/litro a cero con un total de ' + eur(it.total) +
                  '. Lo más probable es que Gemini leyera mal el ticket.');
      if (!it.litros) marcar.push(campo('litros'));
      if (!it.precio_litro) marcar.push(campo('precio'));
    }
    if (it.litros && it.precio_litro && it.total) {
      const calculado = it.litros * it.precio_litro;
      if (Math.abs(calculado - it.total) > Math.max(0.15, it.total * 0.02)) {
        avisos.push(it.tipo + ': ' + dec(it.litros) + ' L a ' + dec(it.precio_litro, 3) + ' € dan ' +
                    eur(calculado) + ', pero el total pone ' + eur(it.total) + '.');
        marcar.push(campo('total'));
      }
    }
    // Repostaje corto marcado como lleno: casi seguro que no llenó (roadmap 3.3)
    if (it.lleno && it.litros && it.litros < capacidad * 0.5) {
      avisos.push(it.tipo + ': solo ' + dec(it.litros) + ' L en un depósito de ' + capacidad +
                  ' L. Si no lo llenaste, desmarca «Depósito lleno».');
    }
    if (it.litros > capacidad * 1.1) {
      avisos.push(it.tipo + ': ' + dec(it.litros) + ' L no caben en un depósito de ' + capacidad + ' L.');
      marcar.push(campo('litros'));
    }
  });

  if (!e.fechaTicket) {
    avisos.push('Sin fecha del ticket, los gráficos usarán la fecha de hoy.');
  }

  // Sin estación el repostaje se guarda igual, pero se queda fuera del ranking
  // y del coste de oportunidad, que comparan por estación.
  if (!String(e.estacion || '').trim()) {
    avisos.push('Sin estación, este repostaje no entra en el ranking ni en el coste de oportunidad.');
  }

  return { errores, avisos, marcar };
}
