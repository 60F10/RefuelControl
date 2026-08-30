// ==========================================================
//  REFRESCO
//
//  Tres caminos hacia los mismos datos: tirar hacia abajo en cualquier
//  módulo, volver a la app después de tenerla en segundo plano, y el
//  botón de siempre. Antes solo existía el botón, así que había que
//  cerrar y abrir la PWA para ver un cambio.
// ==========================================================

import { PTR } from './config.js';
import { $, $$ } from './dom.js';
import { codigo } from './api.js';
import { cargarDashboard, cuandoSeCargo } from './datos.js';
import { refrescarPendientes, sincronizarCola } from './offline.js';
import { estaBloqueado } from './bloqueo.js';
import { buscarVersionNueva } from './servicio.js';

let refrescando = false;

function moverPtr(dist, animado) {
  const ptr = $('ptr');
  ptr.classList.toggle('suelto', !!animado);
  if (dist <= 0) {
    ptr.style.opacity = 0;
    ptr.style.transform = 'translateY(-46px)';
    return;
  }
  const p = Math.min(1, dist / PTR.umbral);
  ptr.style.opacity = Math.min(1, p * 1.25);
  ptr.style.transform = 'translateY(' + Math.min(dist, PTR.tope) + 'px) rotate(' + (p * 270) + 'deg)';
}

export async function refrescarAhora() {
  if (refrescando) return;
  refrescando = true;

  const ptr = $('ptr');
  ptr.classList.add('suelto', 'girando');
  ptr.style.opacity = 1;
  ptr.style.transform = 'translateY(52px)';

  await refrescarPendientes();
  const ok = await cargarDashboard();
  if (ok) sincronizarCola(true);

  setTimeout(() => {
    ptr.classList.remove('girando');
    refrescando = false;
    moverPtr(0, true);
  }, 320);
}

/** Al volver a la app: datos frescos sin cerrarla y abrirla. */
export function refrescarSiToca(forzar) {
  if (estaBloqueado() || !codigo()) return;
  if (!forzar && Date.now() - cuandoSeCargo() < PTR.minEntreRefrescos) return;
  refrescarPendientes();
  cargarDashboard().then(ok => { if (ok) sincronizarCola(true); });
}

/**
 * El gesto se decide en el primer movimiento: si el dedo va de lado manda el
 * carril horizontal y no lo tocamos; solo si baja estando arriba del todo se
 * captura el gesto con preventDefault (de ahí el listener sin `passive`).
 */
export function montarRefresco() {
  $$('.modulo').forEach(mod => {
    let y0 = 0, x0 = 0, sigo = false, decidido = false, dist = 0;

    mod.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || refrescando || estaBloqueado()) { sigo = false; return; }
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      sigo = mod.scrollTop <= 0;
      decidido = false;
      dist = 0;
    }, { passive: true });

    mod.addEventListener('touchmove', e => {
      if (!sigo) return;
      const dy = e.touches[0].clientY - y0;
      const dx = e.touches[0].clientX - x0;

      if (!decidido) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        decidido = true;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) * 0.7) { sigo = false; moverPtr(0); return; }
      }
      if (dy <= 0) { dist = 0; moverPtr(0); return; }

      dist = dy * 0.45;            // resistencia: el indicador va más lento que el dedo
      moverPtr(dist);
      e.preventDefault();
    }, { passive: false });

    const soltar = () => {
      if (!sigo) return;
      sigo = false;
      if (dist >= PTR.umbral) refrescarAhora();
      else moverPtr(0, true);
      dist = 0;
    };
    mod.addEventListener('touchend', soltar, { passive: true });
    mod.addEventListener('touchcancel', soltar, { passive: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refrescarSiToca();
    buscarVersionNueva();
  });
  window.addEventListener('pageshow', e => { if (e.persisted) refrescarSiToca(true); });
  window.addEventListener('focus', () => refrescarSiToca());
}
