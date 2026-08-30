// ==========================================================
//  MÓDULO · Curiosidades (roadmap nivel 5)
//
//  Récords, proyección del año, CO₂ y comparación con la ficha
//  técnica. Lo medido y lo estimado nunca se mezclan en la misma cifra.
// ==========================================================

import { COCHE, CO2, COLORES } from '../config.js';
import { eur, km, dec, esc, ddmm, sinES, mesCorto } from '../formato.js';
import { pintar, leyenda, tarjetas, ejeCategoria, ejeValorBarra } from './graficos.js';

export function pintarCuriosidades(a) {
  const regs = a.regs;

  // ---- Récords ----
  const records = [];
  const conTotal = regs.filter(r => r.total);
  if (conTotal.length) {
    const caro = conTotal.reduce((x, y) => (y.total > x.total ? y : x));
    const barato = conTotal.reduce((x, y) => (y.total < x.total ? y : x));
    records.push({ k: 'Repostaje más caro', v: eur(caro.total), color: 'var(--rojo)',
      s: esc(caro.tipo) + ' · ' + dec(caro.litros, 2) + ' L · ' + ddmm(caro.fecha) });
    records.push({ k: 'Repostaje más barato', v: eur(barato.total), color: 'var(--glp)',
      s: esc(barato.tipo) + ' · ' + dec(barato.litros, 2) + ' L · ' + ddmm(barato.fecha) });
  }

  const conPrecio = regs.filter(r => r.precio);
  if (conPrecio.length) {
    const caro = conPrecio.reduce((x, y) => (y.precio > x.precio ? y : x));
    const barato = conPrecio.reduce((x, y) => (y.precio < x.precio ? y : x));
    records.push({ k: 'Litro más caro', v: dec(caro.precio, 3) + ' €', color: 'var(--rojo)',
      s: esc(caro.tipo) + ' · ' + esc(sinES(caro.estacion)) + ' · ' + ddmm(caro.fecha) });
    records.push({ k: 'Litro más barato', v: dec(barato.precio, 3) + ' €', color: 'var(--glp)',
      s: esc(barato.tipo) + ' · ' + esc(sinES(barato.estacion)) + ' · ' + ddmm(barato.fecha) });
  }

  const conConsumo = regs.filter(r => r.consumoReal);
  if (conConsumo.length) {
    const mejor = conConsumo.reduce((x, y) => (y.consumoReal < x.consumoReal ? y : x));
    const peor = conConsumo.reduce((x, y) => (y.consumoReal > x.consumoReal ? y : x));
    records.push({ k: 'Mejor consumo', v: dec(mejor.consumoReal) + ' <span style="font-size:.7rem">L/100km</span>',
      color: 'var(--glp)', s: esc(mejor.tipo) + ' · ' + ddmm(mejor.fecha) });
    if (peor.id !== mejor.id || peor.tipo !== mejor.tipo) {
      records.push({ k: 'Peor consumo', v: dec(peor.consumoReal) + ' <span style="font-size:.7rem">L/100km</span>',
        color: 'var(--rojo)', s: esc(peor.tipo) + ' · ' + ddmm(peor.fecha) });
    }
  }

  const conVentana = regs.filter(r => r.kmCalculo);
  if (conVentana.length) {
    const larga = conVentana.reduce((x, y) => (y.kmCalculo > x.kmCalculo ? y : x));
    records.push({ ancha: true, k: 'Depósito que más ha cundido', v: km(larga.kmCalculo), color: 'var(--oro)',
      s: esc(larga.tipo) + ' · ' + dec(larga.litros, 2) + ' L hasta el llenado del ' + ddmm(larga.fecha) });
  }

  if (!records.length) {
    records.push({ ancha: true, k: 'Sin récords todavía', v: '—', s: 'Registra unos cuantos repostajes.' });
  }
  tarjetas('kpisRecords', records);

  // ---- Proyección ----
  const proyeccion = [];
  const anio = new Date().getFullYear();
  const delAnio = regs.filter(r => r.fecha && +r.fecha.slice(0, 4) === anio);
  if (delAnio.length) {
    const gasto = delAnio.reduce((s, r) => s + (r.total || 0), 0);
    const inicio = new Date(anio, 0, 1);
    const transcurridos = Math.max(1, Math.round((Date.now() - inicio) / 86400000));
    const diasAnio = ((anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0) ? 366 : 365;
    proyeccion.push({ k: 'Gasto en ' + anio, v: eur(gasto), s: 'en ' + transcurridos + ' días' });
    proyeccion.push({ k: 'Cierre estimado', v: eur(gasto / transcurridos * diasAnio), color: 'var(--oro)',
      s: dec(gasto / transcurridos * 30.4, 0) + ' € al mes de media' });

    const ticketsAnio = a.listaTickets.filter(t => t.fecha && +t.fecha.slice(0, 4) === anio);
    const kmAnio = ticketsAnio.reduce((s, t) => s + (t.kmTramo || 0), 0);
    if (kmAnio) {
      proyeccion.push({ k: 'KM en ' + anio, v: km(kmAnio), s: dec(kmAnio / transcurridos, 0) + ' km al día' });
      proyeccion.push({ k: 'KM al cierre', v: km(kmAnio / transcurridos * diasAnio), color: 'var(--g98)',
        s: 'a este ritmo' });
    }
  } else {
    proyeccion.push({ ancha: true, k: 'Sin datos de ' + anio, v: '—', s: 'Todavía no hay repostajes de este año.' });
  }

  // ---- CO2 evitado ----
  // Los dos lados de la comparación tienen que salir de los MISMOS kilómetros.
  // Multiplicar los litros de todo el histórico por los km de los tramos medidos
  // mezclaba peras con manzanas y disparaba las emisiones del GLP.
  if (a.kmGLP && (a.consumoGLP || COCHE.homologadoGLP)) {
    const consGLP = a.consumoGLP || COCHE.homologadoGLP;
    const consGas = a.consumoGas || COCHE.homologadoGasolina;
    const estimado = (a.consumoGLP === null ? 'GLP' : '') +
                     (a.consumoGas === null ? (a.consumoGLP === null ? ' y gasolina' : 'gasolina') : '');

    const kgGLP = (a.kmGLP * consGLP / 100) * CO2.glp;
    const kgGasolina = (a.kmGLP * consGas / 100) * CO2.gasolina;
    const evitado = kgGasolina - kgGLP;

    proyeccion.push({
      ancha: true,
      k: evitado > 0 ? 'CO₂ evitado usando GLP' : 'CO₂ de más con GLP',
      color: evitado > 0 ? 'var(--glp)' : 'var(--rojo)',
      v: dec(Math.abs(evitado), 1) + ' <span style="font-size:.7rem">kg</span>',
      s: 'Los ' + km(a.kmGLP) + ' con GLP han soltado unos ' + dec(kgGLP, 1) + ' kg a ' + dec(consGLP) +
         ' L/100km. Con gasolina, a ' + dec(consGas) + ', habrían sido ' + dec(kgGasolina, 1) + ' kg' +
         (estimado ? ' (consumo homologado para ' + estimado + ')' : '') +
         '. Factores: ' + dec(CO2.glp, 2) + ' y ' + dec(CO2.gasolina, 2) + ' kg/L.'
    });
  }
  tarjetas('kpisProyeccion', proyeccion);

  // ---- Frente al homologado ----
  const homologado = [];
  [['GLP', a.consumoGLP, COCHE.homologadoGLP, 'var(--glp)'],
   ['Gasolina', a.consumoGas, COCHE.homologadoGasolina, 'var(--g98)']].forEach(([nombre, real, ficha, color]) => {
    if (!real) {
      homologado.push({ k: nombre, v: '—', s: 'Sin consumo medido todavía. Ficha: ' + dec(ficha) + ' L/100km.' });
      return;
    }
    const pct = (real / ficha - 1) * 100;
    homologado.push({
      k: nombre, color: pct <= 0 ? 'var(--glp)' : (pct > 15 ? 'var(--rojo)' : color),
      v: (pct > 0 ? '+' : '') + dec(pct, 1) + '%',
      s: dec(real) + ' frente a ' + dec(ficha) + ' L/100km de ficha'
    });
  });
  homologado.push({
    ancha: true, k: 'Aviso', v: '<span style="font-size:.8rem;font-weight:500">Cifras WLTP orientativas</span>',
    s: 'El homologado del ECO-G 120 está fijado en el archivo (' + dec(COCHE.homologadoGLP) + ' GLP y ' +
       dec(COCHE.homologadoGasolina) + ' gasolina). Corrígelo con tu ficha técnica delante si no cuadra.'
  });
  tarjetas('kpisHomologado', homologado);

  // ---- Estacionalidad ----
  const porMes = {};
  a.listaTickets.forEach(t => {
    if (!t.fecha || !t.kmTramo) return;
    const m = t.fecha.slice(0, 7);
    porMes[m] = (porMes[m] || 0) + t.kmTramo;
  });
  const meses = Object.keys(porMes).sort();
  const mediaMes = meses.length ? meses.reduce((s, m) => s + porMes[m], 0) / meses.length : 0;
  leyenda('lgEstacional', [
    { color: COLORES['GLP'], label: 'Por encima de la media' },
    { color: '#4A4A4A', label: 'Por debajo' }
  ]);
  pintar('chEstacional', {
    type: 'bar',
    data: {
      labels: meses.map(mesCorto),
      datasets: [{
        data: meses.map(m => porMes[m]),
        backgroundColor: meses.map(m => porMes[m] >= mediaMes ? COLORES['GLP'] : '#4A4A4A'),
        borderWidth: 0, borderRadius: 4, maxBarThickness: 46
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: ejeCategoria, y: ejeValorBarra }
    }
  });
}
