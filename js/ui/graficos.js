// ==========================================================
//  GRÁFICOS — Chart.js y las piezas que comparten los módulos
//
//  Aquí están el glow de neón, los ejes con los colores de la app y
//  las tres funciones que pintan tarjetas y leyendas. Chart.js llega
//  por CDN como global: no se importa.
// ==========================================================

import { colorDe } from '../config.js';
import { esc } from '../formato.js';
import { valoresDe } from '../calculo.js';
import { $ } from '../dom.js';

// ----------------------------------------------------------
//  Glow neón
// ----------------------------------------------------------
Chart.register({
  id: 'neonGlow',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    const a = chart.chartArea;
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      ctx.save();
      // Recortamos al área del gráfico: sin esto el redibujado se come los ejes
      if (a) { ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip(); }
      ctx.shadowBlur = 12;
      if (meta.type === 'line' && meta.dataset) {
        ctx.shadowColor = ds.borderColor;
        meta.dataset.draw(ctx);
      } else if (meta.data) {
        meta.data.forEach(el => { ctx.shadowColor = el.options.backgroundColor; el.draw(ctx); });
      }
      ctx.restore();
    });
  }
});

/** Escribe el valor al final de cada barra horizontal. Se pasa gráfico a gráfico. */
export const etiquetasBarra = {
  id: 'etiquetasBarra',
  afterDatasetsDraw(chart, args, opts) {
    const ctx = chart.ctx;
    ctx.save();
    ctx.fillStyle = '#E8E8E8';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    chart.getDatasetMeta(0).data.forEach((el, i) => {
      const v = chart.data.datasets[0].data[i];
      if (v === null || v === undefined) return;
      const texto = (opts.formato || (x => x))(v);
      ctx.textAlign = v < 0 ? 'right' : 'left';
      ctx.fillText(texto, el.x + (v < 0 ? -6 : 6), el.y);
    });
    ctx.restore();
  }
};

// ----------------------------------------------------------
//  Utilidades de pintado
// ----------------------------------------------------------
const charts = {};

export function pintar(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), cfg);
}

export function leyenda(el, items) {
  $(el).innerHTML = items.map(i =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${i.color};box-shadow:0 0 6px ${i.color}"></span>${esc(i.label)}</span>`).join('');
}

export function tarjetas(destino, lista) {
  $(destino).innerHTML = lista.map(t =>
    `<div class="kpi${t.ancha ? ' wide' : ''}"><div class="k">${esc(t.k)}</div>` +
    `<div class="v"${t.color ? ' style="color:' + t.color + '"' : ''}>${t.v}</div>` +
    `<div class="s">${t.s || ''}</div>${t.extra || ''}</div>`).join('');
}

// ----------------------------------------------------------
//  Ejes y opciones comunes
// ----------------------------------------------------------
export const ejes = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#9A9A9A', maxRotation: 0, autoSkip: true }, grid: { color: '#2A2A2A' } },
    y: { ticks: { color: '#9A9A9A' }, grid: { color: '#2A2A2A' }, grace: '12%' }
  }
};
export const ejeValorBarra = { beginAtZero: true, ticks: { color: '#9A9A9A' }, grid: { color: '#2A2A2A' } };
export const ejeCategoria  = { ticks: { color: '#9A9A9A', maxRotation: 0, autoSkip: false }, grid: { display: false } };
export const donut = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };

/** Una serie por tipo de combustible, con su color y sus huecos. */
export function serieDe(a, eje, campo) {
  return Object.keys(a.porTipo).map(t => ({
    label: t,
    data: valoresDe(a, eje, t, campo),
    borderColor: colorDe(t), backgroundColor: colorDe(t),
    borderWidth: 2, pointRadius: 3, tension: .3, spanGaps: true
  }));
}
