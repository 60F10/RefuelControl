// ==========================================================
//  MÓDULO · Resumen
//
//  Los KPI generales, la rentabilidad, el punto de equilibrio del GLP
//  (roadmap 1.1) y el ahorro, más los dos donuts de reparto.
// ==========================================================

import { COLORES, colorDe, esGLP } from '../config.js';
import { $ } from '../dom.js';
import { eur, km, dec } from '../formato.js';
import { datos } from '../datos.js';
import { pintar, leyenda, tarjetas, donut } from './graficos.js';

export function pintarResumen(a) {
  $('pistaActualizado').textContent = datos().actualizado || '';

  const pctGLP = (a.kmGLP + a.kmGas) ? (a.kmGLP / (a.kmGLP + a.kmGas)) * 100 : null;
  const ratio = (a.costeGLP && a.costeGas) ? a.costeGas / a.costeGLP : null;
  const gastoGas = Object.values(a.porTipo).filter(p => !esGLP(p.tipo)).reduce((x, p) => x + p.total, 0);

  const lista = [
    { k: 'Odómetro', v: km(a.kmMax), s: km(a.kmTot) + ' registrados' },
    { k: 'Gasto total', v: eur(a.gastoTotal), s: a.regs.length + ' líneas de repostaje' },
    { k: 'KM con GLP', v: km(a.kmGLP), s: pctGLP === null ? '' : dec(pctGLP, 0) + '% del total' },
    { k: 'KM con gasolina', v: km(a.kmGas), s: pctGLP === null ? '' : dec(100 - pctGLP, 0) + '% del total' },
    { k: '€/km con GLP', v: a.costeGLP ? dec(a.costeGLP, 4) + ' €' : '—',
      s: 'Gasto GLP: ' + eur((a.porTipo['GLP'] || {}).total) + (a.kmGLPMedidos ? ' · medido en ' + km(a.kmGLPMedidos) : '') },
    { k: '€/km con gasolina', v: a.costeGas ? dec(a.costeGas, 4) + ' €' : '—',
      s: 'Gasto gasolina: ' + eur(gastoGas) + (a.kmGasMedidos ? ' · medido en ' + km(a.kmGasMedidos) : '') }
  ];

  if (ratio) {
    const glpGana = ratio >= 1;
    const veces = glpGana ? ratio : 1 / ratio;
    const pct = Math.abs(1 - (glpGana ? a.costeGLP / a.costeGas : a.costeGas / a.costeGLP)) * 100;
    lista.push({
      ancha: true, k: 'Rentabilidad',
      color: glpGana ? 'var(--glp)' : 'var(--g98)',
      v: (glpGana ? 'El GLP' : 'La gasolina') + ' sale ' + dec(veces, 2) + '× más barato por km',
      s: dec(pct, 0) + '% menos de coste por kilómetro que ' + (glpGana ? 'la gasolina' : 'el GLP'),
      extra: (a.kmGLP + a.kmGas) ? `<div class="barra-mix">
          <i style="width:${(a.kmGLP / (a.kmGLP + a.kmGas)) * 100}%;background:var(--glp)"></i>
          <i style="width:${(a.kmGas / (a.kmGLP + a.kmGas)) * 100}%;background:var(--g98)"></i></div>` : ''
    });
  }

  if (a.equilibrio) {
    const e = a.equilibrio;
    const margen = e.precioActualGLP !== null ? e.precio - e.precioActualGLP : null;
    const compensa = margen === null || margen > 0;
    lista.push({
      ancha: true, k: 'Punto de equilibrio del GLP',
      color: compensa ? 'var(--glp)' : 'var(--rojo)',
      v: 'Hasta ' + dec(e.precio, 3) + ' €/L',
      s: 'Con la ' + e.tipoGasolina.toLowerCase() + ' a ' + dec(e.precioGasolina, 3) + ' €/L y consumos de ' +
         dec(e.consumoGLP) + ' frente a ' + dec(e.consumoGas) + ' L/100km. ' +
         (e.precioActualGLP === null ? '' : (compensa
           ? 'Pagas ' + dec(e.precioActualGLP, 3) + ' €/L, así que te sobran ' + dec(margen, 3) + ' € de margen.'
           : 'Pagas ' + dec(e.precioActualGLP, 3) + ' €/L: a este precio ya no compensa.'))
    });
  }

  if (a.ahorroMedido) {
    const positivo = a.ahorroMedido > 0;
    const proyecta = a.ahorroProyectado && Math.round(a.kmGLP) > Math.round(a.kmGLPMedidos);
    lista.push({
      ancha: true, k: positivo ? 'Ahorro con GLP' : 'Sobrecoste del GLP',
      color: positivo ? 'var(--oro)' : 'var(--rojo)',
      v: eur(Math.abs(a.ahorroMedido)),
      s: 'Sobre los ' + km(a.kmGLPMedidos) + ' con consumo medido. ' +
         (proyecta ? 'Al mismo ritmo, los ' + km(a.kmGLP) + ' recorridos con GLP serían ' +
                     eur(Math.abs(a.ahorroProyectado)) + '.' : '')
    });
  }

  tarjetas('kpis', lista);

  const tipos = Object.values(a.porTipo);
  leyenda('lgInversion', tipos.map(t => ({ color: colorDe(t.tipo), label: t.tipo + ' · ' + eur(t.total) })));
  pintar('chInversion', {
    type: 'doughnut',
    data: {
      labels: tipos.map(t => t.tipo),
      datasets: [{ data: tipos.map(t => t.total), backgroundColor: tipos.map(t => colorDe(t.tipo)), borderWidth: 0 }]
    },
    options: donut
  });

  const datosKm = [
    { label: 'GLP', valor: a.kmGLP, color: COLORES['GLP'] },
    { label: 'Gasolina', valor: a.kmGas, color: COLORES['Gasolina 98'] }
  ].filter(d => d.valor > 0);
  leyenda('lgKm', datosKm.map(d => ({ color: d.color, label: d.label + ' · ' + km(d.valor) })));
  pintar('chKm', {
    type: 'doughnut',
    data: {
      labels: datosKm.map(d => d.label),
      datasets: [{ data: datosKm.map(d => d.valor), backgroundColor: datosKm.map(d => d.color), borderWidth: 0 }]
    },
    options: donut
  });
}
