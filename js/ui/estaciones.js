// ==========================================================
//  MÓDULO · Estaciones (roadmap 1.2 y 1.3)
//
//  El ranking va por desviación respecto a la media de ese mismo
//  producto en fechas cercanas, no por precio medio a secas.
// ==========================================================

import { colorDe } from '../config.js';
import { $ } from '../dom.js';
import { eur, dec, esc, sinES } from '../formato.js';
import { analisisEstaciones, ejeTickets } from '../calculo.js';
import { pintar, leyenda, tarjetas, serieDe, ejes, ejeCategoria, etiquetasBarra } from './graficos.js';

export function pintarEstaciones(a) {
  const e = analisisEstaciones(a.regs);
  const cuantas = new Set(e.lista.map(x => x.estacion)).size;
  $('pistaEstaciones').textContent = cuantas + (cuantas === 1 ? ' estación' : ' estaciones');

  // Coste de oportunidad
  if (e.oportunidad !== null) {
    const positivo = e.oportunidad > 0;
    tarjetas('kpisOportunidad', [{
      ancha: true,
      k: positivo ? 'Podrías haber ahorrado' : 'Has repostado mejor que la media',
      color: positivo ? 'var(--oro)' : 'var(--glp)',
      v: eur(Math.abs(e.oportunidad)),
      s: 'Sobre ' + dec(e.litrosComparados, 0) + ' L en ' + e.comparables + ' repostajes, si siempre hubieras ' +
         'ido a la estación que de verdad sale más barata para cada combustible.'
    }]);
    $('cardOportunidad').style.display = 'block';
  } else {
    $('cardOportunidad').style.display = 'none';
  }

  // Ranking por desviación real
  const conDato = e.lista.filter(x => x.desviacion !== null);
  if (!conDato.length) {
    $('rankEstaciones').innerHTML = '<div class="vacio">Todavía no hay repostajes suficientes para comparar.<br>' +
      'Hacen falta al menos dos del mismo combustible en fechas cercanas.</div>';
  } else {
    $('rankEstaciones').innerHTML = conDato.map((x, i) => {
      // Media décima de céntimo arriba o abajo es ruido, no una estación cara
      const enLaMedia = Math.abs(x.desviacion) < 0.0005;
      const barata = x.desviacion < 0;
      const color = enLaMedia ? 'var(--muted)' : (barata ? 'var(--glp)' : 'var(--rojo)');
      const cifra = enLaMedia ? 'en la media' : (barata ? '' : '+') + dec(x.desviacion, 3);
      return `<div class="rank">
        <div class="pos">${i + 1}</div>
        <div class="nom">${esc(sinES(x.estacion))}
          <small>${esc(x.tipo)} · ${x.visitas} ${x.visitas === 1 ? 'visita' : 'visitas'} · ${dec(x.precioMedio, 3)} €/L de media</small></div>
        <div class="val" style="color:${color};${enLaMedia ? 'font-size:.72rem;font-weight:500' : ''}">${cifra}</div>
      </div>`;
    }).join('');
  }

  // Gráfico de desviación. El eje se hace simétrico alrededor del cero para que
  // las barras negativas tengan sitio y no se coman las etiquetas del otro eje.
  if (conDato.length) {
    $('boxDesviacion').style.height = Math.max(140, conDato.length * 32 + 50) + 'px';
    const tiposPresentes = [...new Set(conDato.map(x => x.tipo))];
    leyenda('lgDesviacion', tiposPresentes.map(t => ({ color: colorDe(t), label: t })));

    const tope = Math.max(0.005, ...conDato.map(x => Math.abs(x.desviacion))) * 1.45;
    const corto = s => (s.length > 15 ? s.slice(0, 14) + '…' : s);

    pintar('chDesviacion', {
      type: 'bar',
      plugins: [etiquetasBarra],
      data: {
        labels: conDato.map(x => corto(sinES(x.estacion)) + ' · ' + x.tipo.replace('Gasolina ', '')),
        datasets: [{
          data: conDato.map(x => x.desviacion),
          backgroundColor: conDato.map(x => colorDe(x.tipo)),
          borderWidth: 0, borderRadius: 4, maxBarThickness: 18
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        layout: { padding: { right: 44, left: 10 } },
        plugins: { legend: { display: false }, etiquetasBarra: { formato: v => (v > 0 ? '+' : '') + dec(v, 3) } },
        scales: {
          x: {
            min: -tope, max: tope,
            ticks: { color: '#9A9A9A', font: { size: 9 }, maxTicksLimit: 5 },
            grid: { color: c => (c.tick && Math.abs(c.tick.value) < 1e-9 ? '#4A4A4A' : '#2A2A2A') }
          },
          y: { ...ejeCategoria, ticks: { color: '#C8C8C8', font: { size: 9 }, autoSkip: false } }
        }
      }
    });
  } else {
    leyenda('lgDesviacion', []);
    $('boxDesviacion').style.height = '80px';
  }

  const eje = ejeTickets(a);
  leyenda('lgPrecio', Object.keys(a.porTipo).map(t => ({ color: colorDe(t), label: t })));
  pintar('chPrecio', {
    type: 'line',
    data: { labels: eje.etiquetas, datasets: serieDe(a, eje, 'precio') },
    options: ejes
  });
}
