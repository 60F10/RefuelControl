// ==========================================================
//  MÓDULO · Repostar
//
//  Los tres pasos del formulario (ticket, datos del coche y revisión) y
//  el guardado, con cola offline si no hay red. Las reglas de validación
//  viven en js/validacion.js y el estado de los depósitos, en
//  ui/depositos.js.
// ==========================================================

import { TIPOS, FOTO, colorDe } from '../config.js';
import { $, $$, info, statusEl, lineaAviso } from '../dom.js';
import { eur, km, dec, esc, ddmm } from '../formato.js';
import { api } from '../api.js';
import { datos, registros, maximoKm, cargarDashboard, apuntarUbicaciones } from '../datos.js';
import { validarRepostaje } from '../validacion.js';
import { encolar, refrescarPendientes, cuantosPendientes, alCambiarPendientes } from '../offline.js';
import { pedirUbicacion, posicionActual, estacionMasCercana } from '../ubicacion.js';

// Estado del formulario. Vive aquí y no lo toca nadie más.
let ANALISIS = null, RECIBO = null;
let fotoB64 = null, fotoMime = null;
let avisosAceptados = false;

const cercana = () => estacionMasCercana(datos().ubicaciones);

// ==========================================================
//  Foto: se reduce en el móvil antes de subirla.
//  Esto además convierte los HEIC del iPhone a JPEG.
// ==========================================================
function procesarFoto(file) {
  if (!file) return;
  info('Preparando la foto...');
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, FOTO.maxLado / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * escala);
      cv.height = Math.round(img.height * escala);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const dataUrl = cv.toDataURL('image/jpeg', FOTO.calidad);
      fotoB64 = dataUrl.split(',')[1];
      fotoMime = 'image/jpeg';
      RECIBO = null;
      $('preview').src = dataUrl;
      $('preview').style.display = 'block';
      $('btnCam').classList.add('ok');
      $('btnGal').classList.add('ok');
      info('Ticket listo (' + Math.round(fotoB64.length * 0.75 / 1024) + ' KB).');
    };
    img.onerror = () => info('No se pudo leer esa imagen. Prueba con otra.', 'aviso');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// ==========================================================
//  Revisión del ticket
// ==========================================================
function pintarRevision(r) {
  const cerca = cercana();
  $('estacion').value = r.estacion || (cerca ? cerca.estacion : '');
  $('fechaTicket').value = r.fechaTicket || '';
  $('listaEstaciones').innerHTML = (r.estacionesConocidas || datos().estaciones || [])
    .map(e => '<option value="' + esc(e) + '">').join('');

  $('items').innerHTML = (r.items || []).map(pintarItem).join('');
  marcarParciales();
  pintarPistaUbicacion();

  $('validacion').innerHTML = '';
  avisosAceptados = false;
  $('btnGuardar').textContent = 'Guardar repostaje';
  $('btnGuardar').classList.remove('alerta');

  $('revision').style.display = 'block';
  $('revision').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function pintarItem(it, i) {
  return `
    <div class="item" data-i="${i}">
      <div class="cab">
        <span class="pill" style="background:${colorDe(it.tipo)}">${esc(it.tipo)}</span>
        <button class="del" data-quitar="${i}">Quitar</button>
      </div>
      <label>Tipo</label>
      <select class="f-tipo">
        ${TIPOS.map(t => `<option value="${t}" ${t === it.tipo ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <div class="grid2">
        <div><label>Litros</label><input type="number" step="0.01" class="f-litros" value="${it.litros || 0}"></div>
        <div><label>€/litro</label><input type="number" step="0.001" class="f-precio" value="${it.precio_litro || 0}"></div>
      </div>
      <label>Total (€)</label>
      <input type="number" step="0.01" class="f-total" value="${it.total || 0}">
      <label class="check">
        <input type="checkbox" class="f-lleno" ${it.lleno === false ? '' : 'checked'}>
        <span>Depósito lleno
          <small>Desmárcalo si echaste una cantidad suelta. Sus litros se sumarán al siguiente llenado en vez de dar un consumo falso.</small>
        </span>
      </label>
    </div>`;
}

/** El borde ámbar recuerda de un vistazo qué depósito quedó a medias. */
function marcarParciales() {
  $$('#items .item').forEach(el => {
    el.classList.toggle('parcial', !el.querySelector('.f-lleno').checked);
  });
}

export function leerItems(raiz) {
  return [...raiz.querySelectorAll('.item')].map(el => ({
    tipo: el.querySelector('.f-tipo').value,
    litros: parseFloat(el.querySelector('.f-litros').value) || 0,
    precio_litro: parseFloat(el.querySelector('.f-precio').value) || 0,
    total: parseFloat(el.querySelector('.f-total').value) || 0,
    lleno: el.querySelector('.f-lleno').checked
  }));
}

/** Si cambias algo, los avisos que ya habías aceptado vuelven a contar. */
function reiniciarAvisos() {
  if (!avisosAceptados) return;
  avisosAceptados = false;
  $('btnGuardar').textContent = 'Guardar repostaje';
  $('btnGuardar').classList.remove('alerta');
}

// ==========================================================
//  Validación previa (roadmap 2.3)
//
//  Quien decide qué está mal es js/validacion.js, que no sabe de
//  pantallas. Aquí solo se recoge lo escrito, se pintan los mensajes y
//  se marcan en rojo los campos que ha señalado.
// ==========================================================
const CLASES = { litros: '.f-litros', precio: '.f-precio', total: '.f-total' };

function validar(items) {
  $$('#mod-repostar input.mal').forEach(el => el.classList.remove('mal'));

  const v = validarRepostaje({
    kmTotales: $('km').value,
    kmMax: maximoKm(),
    lecGLP: $('lecGlp').value,
    lecGas: $('lecGas').value,
    fechaTicket: $('fechaTicket').value,
    items
  });

  const cajas = $$('#items .item');
  v.marcar.forEach(campo => {
    if (!campo.startsWith('item:')) { $(campo).classList.add('mal'); return; }
    const [, i, cual] = campo.split(':');
    const caja = cajas[+i];
    if (caja) caja.querySelector(CLASES[cual]).classList.add('mal');
  });

  return v;
}

function pintarValidacion(v, destino) {
  $(destino || 'validacion').innerHTML =
    v.errores.map(t => lineaAviso('⛔ ' + t)).join('') +
    v.avisos.map(t => lineaAviso('⚠️ ' + t)).join('');
}

// ==========================================================
//  Guardar
// ==========================================================
async function guardar() {
  const items = leerItems($('items'));
  if (!items.length) return info('No queda ningún combustible que guardar.', 'aviso');

  const v = validar(items);
  pintarValidacion(v);

  if (v.errores.length) {
    info('Corrige lo marcado antes de guardar.', 'aviso');
    $('validacion').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (v.avisos.length && !avisosAceptados) {
    avisosAceptados = true;
    $('btnGuardar').textContent = 'Guardar de todas formas';
    $('btnGuardar').classList.add('alerta');
    $('validacion').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const posicion = posicionActual();
  const datosTicket = {
    estacion: $('estacion').value.trim(),
    fechaTicket: $('fechaTicket').value,
    kmTotales: $('km').value,
    lecturaGLP: $('lecGlp').value,
    lecturaGasolina: $('lecGas').value,
    consumoCocheGLP: $('consGlp').value,
    consumoCocheGasolina: $('consGas').value,
    lat: posicion ? posicion.lat : '',
    lon: posicion ? posicion.lon : '',
    items
  };

  $('btnGuardar').disabled = true;

  // Sin conexión no se pierde nada: va a la cola y sube solo
  if (!navigator.onLine) {
    try {
      await encolar({ datos: datosTicket, fotoB64, fotoMime, recibo: RECIBO });
      await refrescarPendientes();
      limpiarFormulario();
      info('📥 Guardado en el móvil. Se subirá solo cuando vuelva la cobertura.', 'oro');
    } catch (err) {
      info('❌ No se pudo guardar en el móvil: ' + err.message, 'aviso');
    } finally {
      $('btnGuardar').disabled = false;
    }
    return;
  }

  info('Guardando en el Sheet...');
  try {
    const r = await api({ action: 'guardar', datos: Object.assign({ recibo: RECIBO }, datosTicket) });
    if (!r.ok) throw new Error(r.error || 'Error desconocido');

    let msg = '<span class="ok">✅ ' + r.idRecibo + ': ' +
      r.items.map(i => i.tipo + ' ' + dec(i.litros) + ' L (' + eur(i.total) + ')' +
                       (i.lleno ? '' : ' · parcial')).join(' + ') + '</span>';
    if (r.avisoDrive) msg += '<br><span class="aviso">⚠️ ' + r.avisoDrive + '</span>';
    (r.avisos || []).forEach(a => { msg += '<br><span class="aviso">⚠️ ' + a.texto + '</span>'; });
    statusEl().innerHTML = msg;

    limpiarFormulario();
    cargarDashboard();
  } catch (err) {
    // Un 401 no es un problema de red: el repostaje no va a la cola, porque
    // subirlo con un código malo fallaría igual. Se pide el código y ya está.
    if (err.noAutorizado) return;   // el `finally` ya reactiva el botón
    // Si el fallo fue de red, no perdemos el repostaje
    try {
      await encolar({ datos: datosTicket, fotoB64, fotoMime, recibo: RECIBO });
      await refrescarPendientes();
      limpiarFormulario();
      info('📥 No hubo respuesta del servidor, así que lo he guardado en el móvil. Se subirá solo.', 'oro');
    } catch (err2) {
      info('❌ ' + err.message, 'aviso');
    }
  } finally {
    $('btnGuardar').disabled = false;
  }
}

function limpiarFormulario() {
  ['km', 'lecGlp', 'lecGas', 'consGlp', 'consGas', 'estacion', 'fechaTicket'].forEach(id => $(id).value = '');
  $('revision').style.display = 'none';
  $('preview').style.display = 'none';
  $('validacion').innerHTML = '';
  $('btnCam').classList.remove('ok');
  $('btnGal').classList.remove('ok');
  $('btnGuardar').textContent = 'Guardar repostaje';
  $('btnGuardar').classList.remove('alerta');
  fotoB64 = null; ANALISIS = null; RECIBO = null; avisosAceptados = false;
}

// ==========================================================
//  Pistas de la cabecera
// ==========================================================
function pintarPistaUbicacion() {
  if (!posicionActual()) { $('hintUbicacion').textContent = ''; return; }
  const cerca = cercana();
  $('hintUbicacion').innerHTML = cerca
    ? '📍 Estás a ' + Math.round(cerca.metros) + ' m de <b>' + esc(cerca.estacion) + '</b>, así que la he puesto por ti.'
    : '📍 Ubicación guardada. No reconozco ninguna estación cerca, pero se apuntará para la próxima.';
}

function pintarPistaConexion() {
  const n = cuantosPendientes();
  const btn = $('barra').children[0];
  if (btn) btn.classList.toggle('pendiente', n > 0);
  $('pistaConexion').textContent = n
    ? n + ' sin subir'
    : (navigator.onLine ? '' : 'sin conexión');
  $('pistaConexion').className = 'pista ' + (n ? 'oro' : '');
}

/** La pista de los KM: qué odómetro y qué fecha tenía el último registro. */
export function pintarPistaKm() {
  const ult = registros().slice(-1)[0];
  if (ult) $('hintKm').textContent = 'Último registro: ' + km(maximoKm()) + ' · ' + ddmm(ult.fecha);
}

// ==========================================================
//  Enganche de los controles
// ==========================================================
export function montarRepostar() {
  $('btnCam').onclick = () => $('inCam').click();
  $('btnGal').onclick = () => $('inGal').click();
  $('inCam').onchange = e => procesarFoto(e.target.files[0]);
  $('inGal').onchange = e => procesarFoto(e.target.files[0]);

  // Analizar: subir la foto y luego pasarla por Gemini. Dos llamadas cortas,
  // para no agotar el tiempo de la función de Netlify.
  $('btnAnalizar').onclick = async () => {
    if (!fotoB64) return info('Falta la foto del ticket.', 'aviso');
    if (!navigator.onLine) return info('Sin conexión no se puede analizar. Usa «Meterlo a mano» y se subirá luego.', 'aviso');

    $('btnAnalizar').disabled = true;
    try {
      pedirUbicacion();
      if (!RECIBO) {
        info('Subiendo la foto a Drive...');
        const sub = await api({ action: 'subir', imagenBase64: fotoB64, mimeType: fotoMime });
        RECIBO = sub.ok ? { fileId: sub.fileId, url: sub.url } : null;
        if (!sub.ok) info('⚠️ La foto no se guardó en Drive: ' + sub.error, 'aviso');
      }

      info('Analizando el ticket con Gemini...');
      const r = RECIBO
        ? await api({ action: 'analizar', fileId: RECIBO.fileId })
        : await api({ action: 'analizar', imagenBase64: fotoB64, mimeType: fotoMime });

      if (!r.ok) throw new Error(r.error || 'Error desconocido');

      ANALISIS = r;
      apuntarUbicaciones(r.ubicaciones);
      info('Ticket analizado. Revisa los datos y guarda.', 'ok');
      pintarRevision(r);
    } catch (err) {
      info('❌ ' + err.message, 'aviso');
    } finally {
      $('btnAnalizar').disabled = false;
    }
  };

  /** Registro a mano: sin ticket legible, sin cobertura, o porque perdiste el recibo. */
  $('btnManual').onclick = () => {
    pedirUbicacion();
    ANALISIS = {
      estacion: '',
      fechaTicket: new Date().toISOString().slice(0, 10),
      items: [{ tipo: 'GLP', litros: 0, precio_litro: 0, total: 0, lleno: true }],
      estacionesConocidas: datos().estaciones || []
    };
    info('Rellena los datos del ticket a mano.');
    pintarRevision(ANALISIS);
  };

  $('items').addEventListener('change', e => {
    if (e.target.classList.contains('f-lleno')) marcarParciales();
    reiniciarAvisos();
  });
  $('items').addEventListener('input', reiniciarAvisos);
  $('items').addEventListener('click', e => {
    const i = e.target.dataset.quitar;
    if (i === undefined) return;
    ANALISIS.items = leerItems($('items'));
    ANALISIS.items.splice(+i, 1);
    if (!ANALISIS.items.length) {
      $('revision').style.display = 'none';
      return info('No queda ningún combustible. Vuelve a analizar el ticket o mételo a mano.', 'aviso');
    }
    $('items').innerHTML = ANALISIS.items.map(pintarItem).join('');
    marcarParciales();
  });

  $('btnAnadirItem').onclick = () => {
    const actuales = leerItems($('items'));
    actuales.push({ tipo: 'Gasolina 98', litros: 0, precio_litro: 0, total: 0, lleno: true });
    $('items').innerHTML = actuales.map((it, i) => pintarItem(it, i)).join('');
    marcarParciales();
  };

  ['km', 'lecGlp', 'lecGas', 'fechaTicket'].forEach(id => $(id).addEventListener('input', reiniciarAvisos));

  $('btnCancelar').onclick = () => {
    $('revision').style.display = 'none';
    ANALISIS = null;
    info('Descartado.');
  };

  $('btnGuardar').onclick = guardar;

  alCambiarPendientes(pintarPistaConexion);
  pintarPistaConexion();
}
