// ==========================================================
//  MÓDULOS Y NAVEGACIÓN
//
//  El carril es un scroll horizontal con scroll-snap, así que el
//  deslizamiento del dedo lo resuelve el navegador. La barra de abajo
//  y las flechas del teclado hacen lo mismo con scrollTo.
//
//  Aquí vive también el registro de qué módulos ya se pintaron:
//  arrancar dibujando doce gráficos es lento, así que cada uno espera
//  a que se entre en él.
// ==========================================================

import { MODULOS } from './config.js';
import { $ } from './dom.js';

let moduloActual = 0;
const pintados = {};
let pintar = () => {};

export const moduloActivo = () => MODULOS[moduloActual];
export const indiceActivo = () => moduloActual;

function montarBarra() {
  $('barra').innerHTML = MODULOS.map((m, i) => `
    <button data-i="${i}" class="${i === 0 ? 'on' : ''}">
      <span class="punto"></span>
      <svg viewBox="0 0 24 24"><path d="${m.icono}"/></svg>
      ${m.nombre}
    </button>`).join('');
  [...$('barra').children].forEach(b => { b.onclick = () => irA(+b.dataset.i); });
}

export function irA(i) {
  i = Math.max(0, Math.min(MODULOS.length - 1, i));
  const carril = $('carril');
  carril.scrollTo({ left: i * carril.clientWidth, behavior: 'smooth' });
  marcarModulo(i);
}

export function marcarModulo(i) {
  if (i === moduloActual && pintados[MODULOS[i].id]) return;
  moduloActual = i;
  [...$('barra').children].forEach((b, j) => b.classList.toggle('on', j === i));
  $('flechaIzq').style.visibility = i === 0 ? 'hidden' : 'visible';
  $('flechaDer').style.visibility = i === MODULOS.length - 1 ? 'hidden' : 'visible';
  pintarSiHaceFalta(MODULOS[i].id);
}

function pintarSiHaceFalta(id) {
  if (pintados[id]) return;
  pintar(id);
  pintados[id] = true;
}

/** Marca uno o varios módulos como no pintados. Sin argumentos, todos. */
export function olvidarPintados(...ids) {
  if (!ids.length) Object.keys(pintados).forEach(k => delete pintados[k]);
  else ids.forEach(id => delete pintados[id]);
}

/** Vuelve a dibujar el módulo que se está viendo. */
export function repintarActual() {
  pintarSiHaceFalta(MODULOS[moduloActual].id);
}

/** `fnPintar(id)` dibuja el contenido de un módulo. La llama la navegación. */
export function montarNavegacion(fnPintar) {
  pintar = fnPintar;
  montarBarra();

  // El scroll manda: al soltar el dedo se recalcula qué módulo quedó delante
  let tmrScroll = null;
  $('carril').addEventListener('scroll', () => {
    clearTimeout(tmrScroll);
    tmrScroll = setTimeout(() => {
      const carril = $('carril');
      const i = Math.round(carril.scrollLeft / carril.clientWidth);
      if (i !== moduloActual) marcarModulo(i);
    }, 90);
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName || '').toUpperCase())) return;
    if (e.key === 'ArrowRight') irA(moduloActual + 1);
    if (e.key === 'ArrowLeft')  irA(moduloActual - 1);
  });
  $('flechaIzq').onclick = () => irA(moduloActual - 1);
  $('flechaDer').onclick = () => irA(moduloActual + 1);

  // Al girar el móvil cambia el ancho del carril y hay que recolocarse
  window.addEventListener('resize', () => {
    const carril = $('carril');
    carril.scrollLeft = moduloActual * carril.clientWidth;
  });

  marcarModulo(0);
}
