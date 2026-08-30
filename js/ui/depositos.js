// ==========================================================
//  Depósitos ahora mismo (roadmap 3.3)
//
//  Cuánto queda en cada depósito y cuánta autonomía da, con el consumo
//  medido si lo hay y el homologado del coche activo si todavía no.
// ==========================================================

import { COCHE } from '../config.js';
import { $ } from '../dom.js';
import { km, dec } from '../formato.js';
import { datos, agregadosActuales } from '../datos.js';

export function pintarDepositos() {
  const d = datos().depositos;
  if (!d) { $('cardDepositos').style.display = 'none'; return; }
  const a = agregadosActuales();

  const filas = [
    { nombre: 'GLP',      color: 'var(--glp)', capacidad: d.capacidadGLP,
      recorridos: d.kmDesdeLlenadoGLP,      consumo: a.consumoGLP || COCHE.homologadoGLP,      medido: a.consumoGLP !== null },
    { nombre: 'Gasolina', color: 'var(--g98)', capacidad: d.capacidadGasolina,
      recorridos: d.kmDesdeLlenadoGasolina, consumo: a.consumoGas || COCHE.homologadoGasolina, medido: a.consumoGas !== null }
  ];

  let algo = false;
  $('depositos').innerHTML = filas.map(f => {
    if (f.recorridos === null || !f.consumo) {
      return `<div class="dep"><div class="fila"><span>${f.nombre}</span>
        <span style="color:#6E6E6E">sin datos suficientes</span></div></div>`;
    }
    algo = true;
    const gastados = f.recorridos * f.consumo / 100;
    const quedan = Math.max(0, f.capacidad - gastados);
    const pct = Math.max(0, Math.min(100, (quedan / f.capacidad) * 100));
    const autonomia = quedan * 100 / f.consumo;
    const color = pct < 20 ? 'var(--rojo)' : (pct < 40 ? 'var(--oro)' : f.color);
    return `<div class="dep">
      <div class="fila"><span>${f.nombre} · ${km(f.recorridos)} desde el llenado</span>
        <b style="color:${color}">${dec(quedan, 1)} L</b></div>
      <div class="tanque"><i style="width:${pct}%;background:${color};box-shadow:0 0 8px ${color}"></i></div>
      <div class="fila" style="margin-top:5px;color:#6E6E6E;font-size:.71rem">
        <span>~${km(autonomia)} de autonomía a ${dec(f.consumo)} L/100km${f.medido ? '' : ' (homologado)'}</span>
        <span>${dec(pct, 0)}%</span></div>
    </div>`;
  }).join('');

  $('cardDepositos').style.display = algo ? 'block' : 'none';
}
