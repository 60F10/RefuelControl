// ==========================================================
//  PANTALLA DE BLOQUEO
//
//  La app no se puede usar sin código, pero la seguridad de verdad la
//  pone el proxy: aunque alguien se salte esta pantalla desde la
//  consola, /api/repostaje le responde 401.
//
//  APP_PIN es provisional y muere el día que entre el login de Google
//  (nivel 7 del roadmap). No merece más inversión de la que tiene.
// ==========================================================

import { $ } from './dom.js';
import { esc } from './formato.js';
import { codigo, guardarCodigo, comprobarCodigo, alPerderCodigo } from './api.js';
import { olvidarDatos } from './datos.js';

let bloqueado = true;
let alEntrar = () => {};

export const estaBloqueado = () => bloqueado;

export function bloquear(mensaje) {
  bloqueado = true;
  $('bloqueo').classList.add('on');
  $('estadoBloqueo').innerHTML = mensaje ? '<span class="aviso">' + esc(mensaje) + '</span>' : '';
  $('inCodigo').value = '';
}

export function desbloquear() {
  bloqueado = false;
  $('bloqueo').classList.remove('on');
  $('estadoBloqueo').innerHTML = '';
}

/**
 * Engancha el formulario y decide si la app arranca abierta o bloqueada.
 * `entrar` es lo que hay que hacer en cuanto el código vale.
 */
export function montarBloqueo(entrar) {
  alEntrar = entrar || (() => {});

  // Si el proxy rechaza una petición en mitad de la sesión, vuelve la pantalla.
  alPerderCodigo(mensaje => bloquear(mensaje));

  $('formCodigo').onsubmit = async e => {
    e.preventDefault();
    const valor = $('inCodigo').value.trim();
    if (!valor) return;

    const btn = $('btnEntrar');
    btn.disabled = true;
    $('estadoBloqueo').textContent = 'Comprobando...';

    try {
      const vale = await comprobarCodigo(valor);
      if (!vale) {
        $('estadoBloqueo').innerHTML = '<span class="aviso">Ese código no es.</span>';
        return;
      }
      guardarCodigo(valor);
      desbloquear();
      alEntrar();
    } catch (err) {
      // Sin cobertura no se puede comprobar, pero tampoco hay nada que enseñar:
      // se guarda el código y ya se validará en la primera llamada con red.
      //
      // `err.sinRespuesta` es el mismo caso disfrazado: el móvil se cree
      // conectado —una wifi sin salida, un portal cautivo— y la petición no
      // falla, solo se agota. Antes eso dejaba la app encallada en esta
      // pantalla; ahora entra y trabaja con lo que tenga en la caché.
      if (!navigator.onLine || err.sinRespuesta) {
        guardarCodigo(valor);
        desbloquear();
        alEntrar();
        return;
      }
      $('estadoBloqueo').innerHTML = '<span class="aviso">' + esc(err.message) + '</span>';
    } finally {
      btn.disabled = false;
    }
  };

  $('btnSalir').onclick = () => {
    guardarCodigo('');
    olvidarDatos();
    bloquear('Código olvidado en este dispositivo.');
  };

  if (codigo()) {
    desbloquear();
    alEntrar();
  } else {
    bloquear();
    setTimeout(() => $('inCodigo').focus(), 150);
  }
}
