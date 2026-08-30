// ==========================================================
//  Service worker
//
//  Si hay una versión nueva publicada, la app se recarga sola en
//  cuanto toma el control. La primera instalación no cuenta.
// ==========================================================

let registro = null;
let recargando = false;
let controlado = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

export function registrarServicio() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => { registro = reg; }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlado) { controlado = true; return; }
    if (recargando) return;
    recargando = true;
    location.reload();
  });
}

export function buscarVersionNueva() {
  if (registro) registro.update().catch(() => {});
}
