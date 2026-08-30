// ==========================================================
//  CÁLCULO — funciones puras
//
//  Entran las filas que devuelve el backend y salen números. No
//  toca el DOM, no llama a la red y no sabe de dónde vienen los
//  datos: el día que detrás haya una base de datos en vez de un
//  Sheet, este archivo no se entera.
//
//  Las medias van ponderadas por kilómetros (roadmap 0.1). Hacer la
//  media aritmética de los €/km de cada repostaje daba el mismo peso a
//  un tramo de 100 km que a uno de 500.
//
//  · Modo real:  el peso es kmCalculo, los km de la ventana que ese
//    repostaje cierra. El backend solo lo escribe en una fila por
//    ventana, así que ningún kilómetro cuenta dos veces.
//  · Modo coche: el peso son los km que el coche midió en ese tramo
//    para ese combustible.
// ==========================================================

import { esGLP, VENTANA_PRECIO } from './config.js';
import { ddmm, dias } from './formato.js';

/** Media de `valor` pesada por `peso`. Devuelve también los km que la sostienen. */
export function mediaPonderada(pares) {
  let numerador = 0, pesos = 0;
  pares.forEach(x => {
    if (x.valor === null || x.valor === undefined || isNaN(x.valor)) return;
    if (!x.peso || x.peso <= 0) return;
    numerador += x.valor * x.peso;
    pesos += x.peso;
  });
  return pesos ? { valor: numerador / pesos, km: pesos } : { valor: null, km: 0 };
}

/**
 * Todos los agregados del dashboard a partir de las filas del backend.
 *
 * @param {Array}  registros  una fila por combustible, como las devuelve ?action=dashboard
 * @param {string} modo       'real' (ventanas medidas) o 'coche' (ordenador de a bordo)
 */
export function agregados(registros, modo) {
  const regs = registros || [];
  const real = modo !== 'coche';

  // Cuántas filas hay de cada combustible dentro del mismo ticket: si un ticket
  // trae dos líneas de GLP, sus km del tramo se reparten y no se cuentan dos veces.
  const hermanas = {};
  regs.forEach(r => {
    const clave = r.id + '|' + (esGLP(r.tipo) ? 'glp' : 'gas');
    hermanas[clave] = (hermanas[clave] || 0) + 1;
  });

  const pesoDe = r => {
    if (real) return r.kmCalculo || 0;
    const kmTicket = esGLP(r.tipo) ? r.kmGLP : r.kmGas;
    if (!kmTicket) return 0;
    return kmTicket / hermanas[r.id + '|' + (esGLP(r.tipo) ? 'glp' : 'gas')];
  };
  const costeDe   = r => real ? r.costeKmReal : r.costeKmCoche;
  const consumoDe = r => real ? r.consumoReal : r.consumoCoche;

  const tickets = {};
  regs.forEach(r => {
    if (!tickets[r.id]) {
      tickets[r.id] = {
        id: r.id, fecha: r.fecha, kmTramo: r.kmTramo,
        kmGLP: r.kmGLP, kmGas: r.kmGas, kmTotales: r.kmTotales
      };
    }
  });
  const listaTickets = Object.values(tickets);
  const suma = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

  const kmGLP = suma(listaTickets, t => t.kmGLP);
  const kmGas = suma(listaTickets, t => t.kmGas);
  const kmTot = suma(listaTickets, t => t.kmTramo);
  const kmMax = Math.max(0, ...regs.map(r => r.kmTotales || 0));

  const porTipo = {};
  regs.forEach(r => {
    const t = r.tipo;
    if (!porTipo[t]) porTipo[t] = { tipo: t, total: 0, litros: 0, precios: [], costes: [], consumos: [] };
    const p = porTipo[t];
    p.total += r.total || 0;
    p.litros += r.litros || 0;
    if (r.precio) p.precios.push(r.precio);
    const peso = pesoDe(r);
    p.costes.push({ valor: costeDe(r), peso });
    p.consumos.push({ valor: consumoDe(r), peso });
  });

  const media = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  Object.values(porTipo).forEach(p => {
    p.precioMedio = media(p.precios);
    const c = mediaPonderada(p.costes);
    const k = mediaPonderada(p.consumos);
    p.costeKm = c.valor;
    p.consumoMedio = k.valor;
    p.kmMedidos = k.km;
  });

  // Por depósito: GLP frente a toda la gasolina
  const paresGLP = { costes: [], consumos: [] }, paresGas = { costes: [], consumos: [] };
  regs.forEach(r => {
    const destino = esGLP(r.tipo) ? paresGLP : paresGas;
    const peso = pesoDe(r);
    destino.costes.push({ valor: costeDe(r), peso });
    destino.consumos.push({ valor: consumoDe(r), peso });
  });

  const cGLP = mediaPonderada(paresGLP.costes),   cGas = mediaPonderada(paresGas.costes);
  const kGLP = mediaPonderada(paresGLP.consumos), kGas = mediaPonderada(paresGas.consumos);

  const costeGLP = cGLP.valor, costeGas = cGas.valor;
  const kmGLPMedidos = cGLP.km, kmGasMedidos = cGas.km;

  const diferencia = (costeGLP !== null && costeGas !== null) ? costeGas - costeGLP : null;
  const ahorroMedido     = diferencia === null ? null : kmGLPMedidos * diferencia;
  const ahorroProyectado = diferencia === null ? null : kmGLP * diferencia;

  // Punto de equilibrio (roadmap 1.1)
  const ultimoPrecio = deposito => {
    const lista = regs.filter(r => (esGLP(r.tipo) === (deposito === 'glp')) && r.precio);
    return lista.length ? lista[lista.length - 1] : null;
  };
  const refGas = ultimoPrecio('gas'), refGLP = ultimoPrecio('glp');
  let equilibrio = null;
  if (kGLP.valor && kGas.valor && refGas) {
    equilibrio = {
      precio: refGas.precio * (kGLP.valor / kGas.valor),
      precioGasolina: refGas.precio,
      tipoGasolina: refGas.tipo,
      precioActualGLP: refGLP ? refGLP.precio : null,
      consumoGLP: kGLP.valor,
      consumoGas: kGas.valor
    };
  }

  return {
    regs, listaTickets, porTipo, kmGLP, kmGas, kmTot, kmMax,
    costeGLP, costeGas, kmGLPMedidos, kmGasMedidos,
    consumoGLP: kGLP.valor, consumoGas: kGas.valor,
    ahorroMedido, ahorroProyectado, equilibrio,
    gastoTotal: suma(regs, r => r.total),
    litrosGLP: suma(regs.filter(r => esGLP(r.tipo)), r => r.litros),
    litrosGas: suma(regs.filter(r => !esGLP(r.tipo)), r => r.litros)
  };
}

// ==========================================================
//  DESVIACIÓN DE PRECIO Y COSTE DE OPORTUNIDAD (roadmap 1.2 y 1.3)
//
//  Comparar precios medios por estación mezclaba fechas: una gasolinera
//  parecía cara solo porque repostaste allí en un pico. Aquí cada
//  repostaje se compara con la media de ese MISMO producto en una
//  ventana de días alrededor de su fecha.
// ==========================================================
export function analisisEstaciones(regs, ventanaDias = VENTANA_PRECIO) {
  const conPrecio = (regs || []).filter(r => r.precio && r.fecha);

  // Referencia de cada repostaje: media del mismo producto en fechas cercanas
  const conDesviacion = conPrecio.map(r => {
    const vecinos = conPrecio.filter(o => o.tipo === r.tipo && dias(o.fecha, r.fecha) <= ventanaDias);
    if (vecinos.length < 2) return Object.assign({}, r, { referencia: null, desviacion: null });
    const referencia = vecinos.reduce((s, o) => s + o.precio, 0) / vecinos.length;
    return Object.assign({}, r, { referencia, desviacion: r.precio - referencia });
  });

  // Por estación y producto
  const mapa = {};
  conDesviacion.forEach(r => {
    const clave = r.estacion + '||' + r.tipo;
    if (!mapa[clave]) {
      mapa[clave] = { estacion: r.estacion, tipo: r.tipo, precios: [], desviaciones: [], litros: 0, visitas: 0 };
    }
    const m = mapa[clave];
    m.precios.push(r.precio);
    m.litros += r.litros || 0;
    m.visitas++;
    if (r.desviacion !== null) m.desviaciones.push(r.desviacion);
  });

  const media = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const lista = Object.values(mapa).map(m => ({
    estacion: m.estacion,
    tipo: m.tipo,
    precioMedio: media(m.precios),
    desviacion: media(m.desviaciones),
    litros: m.litros,
    visitas: m.visitas
  }));

  // La mejor de cada producto, para el coste de oportunidad
  const mejorPorTipo = {};
  lista.forEach(x => {
    if (x.desviacion === null) return;
    if (!mejorPorTipo[x.tipo] || x.desviacion < mejorPorTipo[x.tipo].desviacion) mejorPorTipo[x.tipo] = x;
  });

  // Cuánto habrías ahorrado repostando siempre en la más barata de cada producto
  let oportunidad = 0, litrosComparados = 0;
  let comparables = 0;
  conDesviacion.forEach(r => {
    const mejor = mejorPorTipo[r.tipo];
    if (!mejor || r.desviacion === null || !r.litros) return;
    // Cuántas estaciones distintas tienen ese producto: sin al menos dos, no hay elección
    const cuantas = new Set(lista.filter(x => x.tipo === r.tipo).map(x => x.estacion)).size;
    if (cuantas < 2) return;
    const precioEnLaMejor = r.referencia + mejor.desviacion;
    oportunidad += r.litros * (r.precio - precioEnLaMejor);
    litrosComparados += r.litros;
    comparables++;
  });

  return {
    lista: lista.sort((a, b) => {
      if (a.desviacion === null) return 1;
      if (b.desviacion === null) return -1;
      return a.desviacion - b.desviacion;
    }),
    mejorPorTipo,
    oportunidad: comparables ? oportunidad : null,
    litrosComparados,
    comparables,
    conDesviacion
  };
}

// ==========================================================
//  Series temporales (roadmap 0.4)
//
//  El eje es la lista de tickets, no la de fechas: buscar por fecha y
//  tipo hacía que dos repostajes del mismo combustible el mismo día se
//  pisaran.
// ==========================================================
export function ordenarTickets(regs) {
  const vistos = {}, lista = [];
  (regs || []).forEach((r, i) => {
    if (vistos[r.id]) return;
    vistos[r.id] = true;
    lista.push({ id: r.id, fecha: r.fecha, orden: i });
  });
  return lista.sort((x, y) => (x.fecha === y.fecha ? x.orden - y.orden : (x.fecha < y.fecha ? -1 : 1)));
}

/** Etiquetas del eje y un índice ticket+tipo -> fila, para sacar series. */
export function ejeTickets(a) {
  const tickets = ordenarTickets(a.regs);
  const cuantosPorDia = {};
  tickets.forEach(t => { cuantosPorDia[t.fecha] = (cuantosPorDia[t.fecha] || 0) + 1; });
  const contador = {};
  const etiquetas = tickets.map(t => {
    if (cuantosPorDia[t.fecha] === 1) return ddmm(t.fecha);
    contador[t.fecha] = (contador[t.fecha] || 0) + 1;
    return ddmm(t.fecha) + ' (' + contador[t.fecha] + ')';
  });
  const indice = {};
  a.regs.forEach(r => { indice[r.id + '|' + r.tipo] = r; });
  return { tickets, etiquetas, indice };
}

/** Los datos de una serie temporal por tipo de combustible. */
export function valoresDe(a, eje, tipo, campo) {
  return eje.tickets.map(tk => {
    const r = eje.indice[tk.id + '|' + tipo];
    return r && r[campo] !== null && r[campo] !== undefined ? r[campo] : null;
  });
}
