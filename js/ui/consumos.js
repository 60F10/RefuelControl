// ==========================================================
//  MÓDULO · Consumos y costes
// ==========================================================

import { colorDe } from '../config.js';
import { $ } from '../dom.js';
import { eur, km, dec, mesCorto } from '../formato.js';
import { modo } from '../datos.js';
import { ejeTickets } from '../calculo.js';
import { pintar, leyenda, tarjetas, serieDe, ejes, ejeCategoria, ejeValorBarra } from './graficos.js';

export function pintarConsumos(a) {
  const real = modo() === 'real';
  $('pistaModo').textContent = real ? 'cálculo real' : 'datos del coche';

  const lista = [];
  Object.values(a.porTipo).forEach(p => {
    if (!p.consumoMedio) return;
    lista.push({
      k: 'Consumo ' + p.tipo, color: colorDe(p.tipo),
      v: dec(p.consumoMedio) + ' <span style="font-size:.7rem">L/100km</span>',
      s: (p.precioMedio ? dec(p.precioMedio, 3) + ' €/L de media' : '') +
         (p.kmMedidos ? ' · ' + km(p.kmMedidos) : '')
    });
    if (p.costeKm) {
      lista.push({
        k: '€/km ' + p.tipo, color: colorDe(p.tipo),
        v: dec(p.costeKm, 4) + ' €',
        s: dec(p.litros, 1) + ' L repostados · ' + eur(p.total)
      });
    }
  });
  if (!lista.length) {
    lista.push({ ancha: true, k: 'Sin consumos todavía', v: '—',
      s: 'Hacen falta dos llenados del mismo combustible con los parciales puestos.' });
  }
  tarjetas('kpisConsumo', lista);

  const eje = ejeTickets(a);
  const lg = Object.keys(a.porTipo).map(t => ({ color: colorDe(t), label: t }));
  leyenda('lgConsumo', lg);
  leyenda('lgCoste', lg);

  pintar('chConsumo', {
    type: 'line',
    data: { labels: eje.etiquetas, datasets: serieDe(a, eje, real ? 'consumoReal' : 'consumoCoche') },
    options: ejes
  });
  pintar('chCoste', {
    type: 'line',
    data: { labels: eje.etiquetas, datasets: serieDe(a, eje, real ? 'costeKmReal' : 'costeKmCoche') },
    options: ejes
  });

  const meses = [...new Set(a.regs.map(r => r.fecha.slice(0, 7)))].filter(Boolean).sort();
  const tipos = Object.keys(a.porTipo);
  leyenda('lgMes', tipos.map(t => ({ color: colorDe(t), label: t })));
  pintar('chMeses', {
    type: 'bar',
    data: {
      labels: meses.map(mesCorto),
      datasets: tipos.map(t => ({
        label: t,
        data: meses.map(m => a.regs
          .filter(r => r.fecha.slice(0, 7) === m && r.tipo === t)
          .reduce((s, r) => s + (r.total || 0), 0)),
        backgroundColor: colorDe(t), borderWidth: 0, borderRadius: 4, maxBarThickness: 46
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ...ejeCategoria, stacked: true }, y: { ...ejeValorBarra, stacked: true } }
    }
  });
}
