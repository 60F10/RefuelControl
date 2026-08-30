// ==========================================================
//  RefuelControl · arranque
//
//  Este archivo no calcula nada ni pinta nada: monta las piezas y
//  decide quién dibuja cada módulo. Todo lo demás vive en su archivo.
// ==========================================================

import { $$ } from './dom.js';
import { setModo, modo, agregadosActuales, cargarDashboard, alCambiarDatos } from './datos.js';
import { montarNavegacion, olvidarPintados, repintarActual } from './navegacion.js';
import { refrescarPendientes, sincronizarCola, vigilarConexion } from './offline.js';
import { pedirUbicacion } from './ubicacion.js';
import { montarBloqueo } from './bloqueo.js';
import { montarRefresco } from './refresco.js';
import { registrarServicio } from './servicio.js';

import { montarRepostar, pintarPistaKm } from './ui/repostar.js';
import { pintarDepositos } from './ui/depositos.js';
import { pintarResumen } from './ui/resumen.js';
import { pintarConsumos } from './ui/consumos.js';
import { pintarEstaciones } from './ui/estaciones.js';
import { montarHistorial, pintarHistorial } from './ui/historial.js';
import { pintarCuriosidades } from './ui/curiosidades.js';

/** Quién dibuja cada módulo. La navegación llama a esto al entrar por primera vez. */
function pintarModulo(id) {
  const a = agregadosActuales();
  switch (id) {
    case 'mod-repostar':     pintarDepositos(); break;
    case 'mod-resumen':      pintarResumen(a); break;
    case 'mod-consumos':     pintarConsumos(a); break;
    case 'mod-estaciones':   pintarEstaciones(a); break;
    case 'mod-historial':    pintarHistorial(a); break;
    case 'mod-curiosidades': pintarCuriosidades(a); break;
  }
}

/** El interruptor entre el cálculo real y los datos del ordenador de a bordo. */
function cambiarModo(m) {
  setModo(m);
  $$('.tgReal').forEach(b => b.classList.toggle('on', m === 'real'));
  $$('.tgCoche').forEach(b => b.classList.toggle('on', m === 'coche'));
  olvidarPintados('mod-resumen', 'mod-consumos');
  repintarActual();
}

function arrancarDatos() {
  refrescarPendientes();
  cargarDashboard().then(ok => { if (ok) sincronizarCola(true); });
  pedirUbicacion();
}

// ----------------------------------------------------------
//  Montaje
// ----------------------------------------------------------
montarNavegacion(pintarModulo);
montarRepostar();
montarHistorial();
montarRefresco();
registrarServicio();
vigilarConexion();

$$('.tgReal').forEach(b => b.onclick = () => cambiarModo('real'));
$$('.tgCoche').forEach(b => b.onclick = () => cambiarModo('coche'));

// Datos nuevos: se tiran los gráficos ya dibujados y se repinta lo que se ve.
alCambiarDatos(() => {
  pintarPistaKm();
  olvidarPintados();
  repintarActual();
});

// La pantalla de bloqueo decide si la app arranca abierta y, cuando el código
// vale, es quien pide los datos.
montarBloqueo(arrancarDatos);

// Deja el modo activo marcado en los dos interruptores desde el primer momento.
cambiarModo(modo());
