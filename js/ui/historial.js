// ==========================================================
//  MÓDULO · Historial (roadmap 2.1, 2.4 y 4.3)
//
//  La lista de repostajes, el editor en línea, el borrado con red de
//  seguridad y la exportación a CSV.
// ==========================================================

import { TIPOS, colorDe } from '../config.js';
import { $ } from '../dom.js';
import { eur, km, dec, esc, fechaLarga } from '../formato.js';
import { api, apiGet } from '../api.js';
import { registros, cargarDashboard, quitarTicket } from '../datos.js';
import { ordenarTickets } from '../calculo.js';
import { prepararFoto, subirFoto } from '../foto.js';

let editando = null;           // id del repostaje abierto en el historial
let reciboNuevo = null;        // ticket subido en esta edición, si se ha añadido uno

const estado = (html, clase) => {
  $('estadoHistorial').innerHTML = clase ? '<span class="' + clase + '">' + html + '</span>' : html;
};

export function pintarHistorial(a) {
  $('pistaHistorial').textContent = a.regs.length + ' líneas';

  const tickets = ordenarTickets(a.regs).reverse();   // lo último, arriba
  if (!tickets.length) {
    $('listaRepostajes').innerHTML = '<div class="vacio">Todavía no hay repostajes.<br>Registra el primero desde el módulo de la izquierda.</div>';
    return;
  }

  $('listaRepostajes').innerHTML = tickets.map(t => {
    const filas = a.regs.filter(r => r.id === t.id);
    const ref = filas[0];
    const total = filas.reduce((s, r) => s + (r.total || 0), 0);
    const recibo = filas.map(r => r.recibo).filter(Boolean)[0];

    const tags = filas.map(r => `<span class="tag" style="border-color:${colorDe(r.tipo)}">
      <b style="color:${colorDe(r.tipo)}">${esc(r.tipo)}</b> ${dec(r.litros, 2)} L · ${eur(r.total)}${r.lleno ? '' : ' · parcial'}</span>`).join('');

    const consumos = filas.filter(r => r.consumoReal).map(r =>
      `<span class="tag">${esc(r.tipo)}: ${dec(r.consumoReal)} L/100km</span>`).join('');

    return `<div class="rep" id="rep-${esc(t.id)}">
      <div class="top">
        <div>
          <div class="fecha">${fechaLarga(ref.fecha)}${ref.fechaDelTicket ? '' : ' <span style="color:#6E6E6E;font-weight:400">(fecha de registro)</span>'}</div>
          <div class="est">${esc(ref.estacion)} · ${km(ref.kmTotales)}</div>
        </div>
        <div class="imp">${eur(total)}</div>
      </div>
      <div class="comb">${tags}${consumos}</div>
      <div class="acciones">
        ${recibo ? `<a href="${esc(recibo)}" target="_blank" rel="noopener">Ver ticket</a>`
                 : `<button disabled style="opacity:.4">Sin ticket</button>`}
        <button data-editar="${esc(t.id)}">Editar</button>
        <button class="peligro" data-borrar="${esc(t.id)}">Borrar</button>
      </div>
      <div class="editor" id="editor-${esc(t.id)}" style="display:none"></div>
    </div>`;
  }).join('');
}

// ==========================================================
//  Editor en línea
// ==========================================================
function abrirEditor(id) {
  const caja = $('editor-' + id);
  const tarjeta = $('rep-' + id);
  if (!caja) return;

  if (editando === id) {          // segundo toque: se cierra
    caja.style.display = 'none';
    tarjeta.classList.remove('abierto');
    editando = null;
    return;
  }
  if (editando) {
    const previa = $('editor-' + editando);
    if (previa) { previa.style.display = 'none'; $('rep-' + editando).classList.remove('abierto'); }
  }
  editando = id;
  reciboNuevo = null;

  const filas = registros().filter(r => r.id === id);
  const ref = filas[0];
  const tieneTicket = filas.some(r => r.recibo);

  caja.innerHTML = `
    <div class="grid2">
      <div><label>Fecha del ticket</label><input type="date" class="e-fecha" value="${esc(ref.fechaDelTicket ? ref.fecha : '')}"></div>
      <div><label>Estación</label><input type="text" class="e-estacion" list="listaEstaciones" value="${esc(ref.estacion)}"></div>
    </div>
    <div class="grid2">
      <div><label>KM totales</label><input type="number" class="e-km" value="${ref.kmTotales === null ? '' : ref.kmTotales}"></div>
      <div><label>Parcial GLP</label><input type="number" class="e-lecGlp" value="${ref.lecturaGLP === null ? '' : ref.lecturaGLP}"></div>
    </div>
    <div class="grid2">
      <div><label>Parcial gasolina</label><input type="number" class="e-lecGas" value="${ref.lecturaGas === null ? '' : ref.lecturaGas}"></div>
      <div></div>
    </div>
    <div class="e-items">${filas.map((r, i) => `
      <div class="item" data-i="${i}">
        <div class="cab">
          <span class="pill" style="background:${colorDe(r.tipo)}">${esc(r.tipo)}</span>
        </div>
        <label>Tipo</label>
        <select class="f-tipo">
          ${TIPOS.map(t => `<option value="${t}" ${t === r.tipo ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <div class="grid2">
          <div><label>Litros</label><input type="number" step="0.01" class="f-litros" value="${r.litros === null ? '' : r.litros}"></div>
          <div><label>€/litro</label><input type="number" step="0.001" class="f-precio" value="${r.precio === null ? '' : r.precio}"></div>
        </div>
        <div class="grid2">
          <div><label>Total (€)</label><input type="number" step="0.01" class="f-total" value="${r.total === null ? '' : r.total}"></div>
          <div><label>Consumo coche</label><input type="number" step="0.1" class="f-cons" value="${r.consumoCoche === null ? '' : r.consumoCoche}"></div>
        </div>
        <label class="check">
          <input type="checkbox" class="f-lleno" ${r.lleno ? 'checked' : ''}>
          <span>Depósito lleno</span>
        </label>
      </div>`).join('')}</div>
    <label>Ticket</label>
    <input type="file" class="e-foto" accept="image/*" hidden>
    <button class="btn btn-ghost e-adjuntar">${tieneTicket ? 'Cambiar la foto del ticket' : 'Añadir la foto del ticket'}</button>
    <img class="e-preview" alt="Ticket" style="display:none">
    <div class="e-estadoFoto hint" style="margin-top:-4px"></div>
    <div class="e-aviso"></div>
    <button class="btn btn-primary e-guardar">Guardar cambios</button>`;

  caja.style.display = 'block';
  tarjeta.classList.add('abierto');
  caja.querySelector('.e-guardar').onclick = () => guardarEdicion(id, caja);
  montarAdjuntar(caja);
  caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Adjuntar el ticket después (roadmap: se echaba en falta).
 *
 * Si el día del repostaje no pudiste subir la foto —sin cobertura, la cámara
 * que no la entrega, o simplemente se te pasó—, aquí se añade. La foto se sube
 * a Drive en cuanto la eliges, pero no queda enganchada al repostaje hasta que
 * pulsas «Guardar cambios»: el backend ya sabe conservar el recibo anterior si
 * no le mandas uno nuevo.
 */
function montarAdjuntar(caja) {
  const entrada = caja.querySelector('.e-foto');
  const preview = caja.querySelector('.e-preview');
  const estadoFoto = caja.querySelector('.e-estadoFoto');

  caja.querySelector('.e-adjuntar').onclick = () => entrada.click();

  entrada.onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) {
      estadoFoto.innerHTML = '<span class="aviso">No llegó ninguna foto. Prueba otra vez.</span>';
      return;
    }

    estadoFoto.textContent = 'Preparando la foto...';
    let foto;
    try {
      foto = await prepararFoto(file);
    } catch (err) {
      estadoFoto.innerHTML = '<span class="aviso">' + esc(err.message) + '</span>';
      return;
    }

    preview.src = foto.dataUrl;
    preview.style.display = 'block';

    if (!navigator.onLine) {
      estadoFoto.innerHTML = '<span class="aviso">Sin conexión no se puede subir el ticket. Inténtalo con cobertura.</span>';
      return;
    }

    estadoFoto.textContent = 'Subiendo el ticket a Drive...';
    try {
      const recibo = await subirFoto(foto.b64, foto.mime);
      if (recibo.error) throw new Error(recibo.error);
      reciboNuevo = recibo;
      estadoFoto.innerHTML = '<span class="ok">Ticket subido. Pulsa «Guardar cambios» para dejarlo asociado.</span>';
    } catch (err) {
      estadoFoto.innerHTML = '<span class="aviso">No se pudo subir: ' + esc(err.message) + '</span>';
    }
  };
}

async function guardarEdicion(id, caja) {
  const items = [...caja.querySelectorAll('.item')].map(el => ({
    tipo: el.querySelector('.f-tipo').value,
    litros: parseFloat(el.querySelector('.f-litros').value) || 0,
    precio_litro: parseFloat(el.querySelector('.f-precio').value) || 0,
    total: parseFloat(el.querySelector('.f-total').value) || 0,
    consumoCoche: el.querySelector('.f-cons').value === '' ? null : parseFloat(el.querySelector('.f-cons').value),
    lleno: el.querySelector('.f-lleno').checked
  }));

  const kmTotales = caja.querySelector('.e-km').value;
  if (!kmTotales) {
    caja.querySelector('.e-aviso').innerHTML =
      '<div class="aviso" style="font-size:.79rem;margin-bottom:8px">⛔ Faltan los KM totales.</div>';
    return;
  }

  const btn = caja.querySelector('.e-guardar');
  btn.disabled = true;
  $('estadoHistorial').textContent = 'Guardando cambios...';

  try {
    const r = await api({
      action: 'editar',
      datos: {
        id,
        estacion: caja.querySelector('.e-estacion').value.trim(),
        fechaTicket: caja.querySelector('.e-fecha').value,
        kmTotales,
        lecturaGLP: caja.querySelector('.e-lecGlp').value,
        lecturaGasolina: caja.querySelector('.e-lecGas').value,
        // Sin recibo nuevo, el backend conserva el que ya tuviera
        recibo: reciboNuevo,
        items
      }
    });
    if (!r.ok) throw new Error(r.error || 'Error desconocido');

    let msg = '✅ ' + id + ' actualizado.';
    (r.avisos || []).concat(r.ordenAvisos || []).forEach(a => { msg += ' ⚠️ ' + a.texto; });
    estado(esc(msg), 'ok');
    editando = null;
    reciboNuevo = null;
    await cargarDashboard();
  } catch (err) {
    if (err.noAutorizado) return;
    // Igual que en el borrado: la edición puede haber entrado aunque la espera
    // se agotara, así que se recarga para que la pantalla diga la verdad.
    $('estadoHistorial').textContent = 'Sin respuesta. Recargando para ver cómo quedó...';
    const recargado = await cargarDashboard();
    estado(recargado
      ? '⚠️ No hubo respuesta al guardar (' + esc(err.message) + '). La lista está recargada: comprueba si el cambio entró.'
      : '❌ ' + esc(err.message), 'aviso');
  } finally {
    btn.disabled = false;
  }
}

// ==========================================================
//  Borrado a prueba de esperas
//
//  Un borrado dispara `recalcularTodo()` en el Apps Script, que con la
//  hoja llena puede pasarse de los 10 s que aguanta la función de
//  Netlify. Antes eso dejaba la app con el repostaje en pantalla aunque
//  en el Sheet ya no estuviera. Ahora se quita de la lista en cuanto el
//  servidor dice que sí, y si la llamada se cae se comprueba releyendo
//  el dashboard, que es quien manda.
// ==========================================================
function confirmarBorrado(id) {
  const filas = registros().filter(r => r.id === id);
  const total = filas.reduce((s, r) => s + (r.total || 0), 0);
  $('modalTitulo').textContent = '¿Borrar este repostaje?';
  $('modalTexto').innerHTML = esc(fechaLarga(filas[0].fecha)) + ' · ' + esc(filas[0].estacion) + ' · ' + eur(total) +
    '.<br><br>Se quitará de la hoja principal, pero seguirá en «Copia de seguridad» marcado como borrado, ' +
    'así que se puede recuperar. Todos los consumos se recalculan después.';
  $('modal').classList.add('on');
  $('modalSi').onclick = () => { $('modal').classList.remove('on'); borrar(id); };
}

async function borrar(id) {
  $('estadoHistorial').textContent = 'Borrando ' + id + '...';
  editando = null;

  try {
    const r = await api({ action: 'borrar', id });
    if (!r.ok) throw new Error(r.error || 'Error desconocido');

    quitarTicket(id);                       // la lista se actualiza ya, sin esperar
    let msg = '🗑️ ' + id + ' borrado (' + r.filasBorradas + ' ' + (r.filasBorradas === 1 ? 'fila' : 'filas') + '). ' + r.nota;
    (r.ordenAvisos || []).forEach(a => { msg += ' ⚠️ ' + a.texto; });
    estado(esc(msg), 'ok');

    await cargarDashboard();                // y se recalculan los consumos
  } catch (err) {
    if (err.noAutorizado) return;

    // Puede que el borrado sí llegara y lo que se agotó fuera la espera.
    $('estadoHistorial').textContent = 'Sin respuesta. Comprobando si se borró...';
    const recargado = await cargarDashboard();
    const sigue = registros().some(r => r.id === id);

    estado(recargado && !sigue
      ? '🗑️ ' + esc(id) + ' borrado. Tardó más de la cuenta, pero se hizo.'
      : '❌ ' + esc(err.message), recargado && !sigue ? 'ok' : 'aviso');
  }
}

// ==========================================================
//  Exportar a CSV (roadmap 4.3)
//  El backend devuelve el texto dentro del JSON; el navegador lo
//  convierte en descarga. El BOM es para que Excel respete los acentos.
// ==========================================================
async function exportar() {
  const btn = $('btnExport');
  btn.disabled = true;
  $('estadoHistorial').textContent = 'Generando el CSV...';
  try {
    const d = await apiGet('action=export');
    if (!d.ok) throw new Error(d.error || 'sin respuesta');

    const blob = new Blob(['﻿' + d.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = d.nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    estado(d.filas + ' filas exportadas a ' + esc(d.nombre) + '.', 'ok');
  } catch (err) {
    estado('No se pudo exportar: ' + esc(err.message), 'aviso');
  } finally {
    btn.disabled = false;
  }
}

export function montarHistorial() {
  $('listaRepostajes').addEventListener('click', e => {
    const idEditar = e.target.dataset.editar;
    const idBorrar = e.target.dataset.borrar;
    if (idEditar) abrirEditor(idEditar);
    if (idBorrar) confirmarBorrado(idBorrar);
  });

  // La etiqueta de color del editor sigue al desplegable, igual que en el alta
  $('listaRepostajes').addEventListener('change', e => {
    if (!e.target.classList.contains('f-tipo')) return;
    const caja = e.target.closest('.item');
    const etiqueta = caja && caja.querySelector('.pill');
    if (!etiqueta) return;
    etiqueta.textContent = e.target.value;
    etiqueta.style.background = colorDe(e.target.value);
  });

  $('modalNo').onclick = () => $('modal').classList.remove('on');
  $('modal').onclick = e => { if (e.target === $('modal')) $('modal').classList.remove('on'); };

  $('btnRefresh').onclick = () => cargarDashboard();
  $('btnExport').onclick = exportar;
}
