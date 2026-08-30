/**
 * Banco de pruebas de la validación previa (roadmap 2.3).
 *
 *   node test/validacion.test.js
 *
 * `validarRepostaje()` no lee la pantalla: recibe lo que hay escrito y devuelve
 * errores, avisos y qué campos hay que marcar en rojo. Por eso se puede probar
 * caso a caso sin navegador, que era justo lo que no se podía hacer cuando esto
 * vivía dentro de index.html.
 */

const assert = require('assert');

let pasadas = 0, fallidas = 0;
function prueba(nombre, fn) {
  try {
    fn();
    pasadas++;
    console.log('  ok   ' + nombre);
  } catch (err) {
    fallidas++;
    console.log('  FALLA ' + nombre + '\n        ' + err.message);
  }
}

/** Un repostaje correcto: 40 L de GLP a 0,90 €, 600 km de tramo bien repartidos. */
function bueno(cambios) {
  return Object.assign({
    kmTotales: '5000',
    kmMax: 4400,
    lecGLP: '450',
    lecGas: '150',
    fechaTicket: '2026-08-29',
    estacion: 'E.S. Repsol Valle Guerra',
    items: [{ tipo: 'GLP', litros: 40, precio_litro: 0.90, total: 36, lleno: true }]
  }, cambios || {});
}

const contiene = (lista, aguja) =>
  lista.some(t => t.toLowerCase().indexOf(aguja.toLowerCase()) >= 0);

(async () => {
  const { validarRepostaje } = await import('../js/validacion.js');

  console.log('\nValidación previa — RefuelControl\n');

  prueba('Un repostaje correcto pasa sin errores ni avisos', () => {
    const v = validarRepostaje(bueno());
    assert.deepStrictEqual(v.errores, [], 'no debería haber errores: ' + v.errores.join(' | '));
    assert.deepStrictEqual(v.avisos, [], 'no debería haber avisos: ' + v.avisos.join(' | '));
    assert.deepStrictEqual(v.marcar, []);
  });

  prueba('Sin KM totales no se puede guardar', () => {
    const v = validarRepostaje(bueno({ kmTotales: '' }));
    assert.ok(contiene(v.errores, 'faltan los km'));
    assert.ok(v.marcar.indexOf('km') >= 0, 'hay que marcar el campo de los KM');
  });

  prueba('El odómetro no puede ir hacia atrás', () => {
    const v = validarRepostaje(bueno({ kmTotales: '4000' }));
    assert.ok(contiene(v.errores, 'menores que'));
    assert.ok(v.marcar.indexOf('km') >= 0);
  });

  prueba('Repetir el mismo odómetro es aviso, no error', () => {
    const v = validarRepostaje(bueno({ kmTotales: '4400', lecGLP: '', lecGas: '' }));
    assert.deepStrictEqual(v.errores, []);
    assert.ok(contiene(v.avisos, 'idénticos'));
  });

  prueba('Unos parciales que no cuadran con el tramo avisan', () => {
    // 600 km de tramo y parciales que suman 300: se olvidó de resetear uno
    const v = validarRepostaje(bueno({ lecGLP: '300', lecGas: '0' }));
    assert.ok(contiene(v.avisos, 'olvidaste resetear'));
    assert.ok(v.marcar.indexOf('lecGlp') >= 0 && v.marcar.indexOf('lecGas') >= 0);
  });

  prueba('Un 15 % de desvío todavía se acepta', () => {
    const v = validarRepostaje(bueno({ lecGLP: '520', lecGas: '150' }));   // 670 sobre 600
    assert.ok(!contiene(v.avisos, 'olvidaste resetear'), 'ese margen entra dentro de lo normal');
  });

  prueba('Sin parciales avisa de que no habrá consumo real', () => {
    const v = validarRepostaje(bueno({ lecGLP: '', lecGas: '' }));
    assert.ok(contiene(v.avisos, 'sin parciales'));
  });

  prueba('Un combustible sin litros ni total es un error', () => {
    const v = validarRepostaje(bueno({
      items: [{ tipo: 'GLP', litros: 0, precio_litro: 0, total: 0, lleno: true }]
    }));
    assert.ok(contiene(v.errores, 'al menos los litros'));
    assert.ok(v.marcar.indexOf('item:0:litros') >= 0);
  });

  prueba('Un total con los litros a cero huele a lectura mala de Gemini', () => {
    const v = validarRepostaje(bueno({
      items: [{ tipo: 'GLP', litros: 0, precio_litro: 0, total: 36, lleno: true }]
    }));
    assert.ok(contiene(v.avisos, 'gemini'));
    assert.ok(v.marcar.indexOf('item:0:litros') >= 0);
    assert.ok(v.marcar.indexOf('item:0:precio') >= 0);
  });

  prueba('Litros por precio tiene que dar el total', () => {
    const v = validarRepostaje(bueno({
      items: [{ tipo: 'GLP', litros: 40, precio_litro: 0.90, total: 50, lleno: true }]
    }));
    assert.ok(contiene(v.avisos, 'pero el total pone'));
    assert.ok(v.marcar.indexOf('item:0:total') >= 0);
  });

  prueba('Medio depósito marcado como lleno avisa (roadmap 3.3)', () => {
    const v = validarRepostaje(bueno({
      items: [{ tipo: 'GLP', litros: 10, precio_litro: 0.90, total: 9, lleno: true }]
    }));
    assert.ok(contiene(v.avisos, 'si no lo llenaste'));
  });

  prueba('Un repostaje corto marcado como parcial no molesta', () => {
    const v = validarRepostaje(bueno({
      items: [{ tipo: 'GLP', litros: 10, precio_litro: 0.90, total: 9, lleno: false }]
    }));
    assert.ok(!contiene(v.avisos, 'si no lo llenaste'));
  });

  prueba('Lo que no cabe en el depósito se marca', () => {
    const v = validarRepostaje(bueno({
      items: [{ tipo: 'GLP', litros: 60, precio_litro: 0.90, total: 54, lleno: true }]
    }));
    assert.ok(contiene(v.avisos, 'no caben'));
    assert.ok(v.marcar.indexOf('item:0:litros') >= 0);
  });

  prueba('Cada combustible se mide contra su propio depósito', () => {
    // Se avisa por encima de la capacidad más un 10 % de margen: 52 L se pasan
    // de los 45 del GLP (49,5 con margen) pero no de los 50 de gasolina (55).
    const glp = validarRepostaje(bueno({
      items: [{ tipo: 'GLP', litros: 52, precio_litro: 0.90, total: 46.8, lleno: true }]
    }));
    const gasolina = validarRepostaje(bueno({
      items: [{ tipo: 'Gasolina 98', litros: 52, precio_litro: 1.55, total: 80.6, lleno: true }]
    }));
    assert.ok(contiene(glp.avisos, 'no caben'));
    assert.ok(!contiene(gasolina.avisos, 'no caben'));
  });

  prueba('Sin fecha del ticket avisa', () => {
    const v = validarRepostaje(bueno({ fechaTicket: '' }));
    assert.ok(contiene(v.avisos, 'sin fecha del ticket'));
  });

  prueba('Sin estación avisa, pero deja guardar', () => {
    const v = validarRepostaje(bueno({ estacion: '   ' }));
    assert.deepStrictEqual(v.errores, [], 'no es motivo para bloquear el guardado');
    assert.ok(contiene(v.avisos, 'no entra en el ranking'));
  });

  prueba('El coche activo se puede pasar desde fuera', () => {
    // El día que haya varios coches, la validación no tiene que cambiar
    const furgoneta = { depositoGLP: 80, depositoGasolina: 90 };
    const v = validarRepostaje(bueno({
      coche: furgoneta,
      items: [{ tipo: 'GLP', litros: 60, precio_litro: 0.90, total: 54, lleno: true }]
    }));
    assert.ok(!contiene(v.avisos, 'no caben'), '60 L sí caben en un depósito de 80');
  });

  prueba('El primer repostaje, sin histórico, no inventa comparaciones', () => {
    const v = validarRepostaje(bueno({ kmMax: null, lecGLP: '', lecGas: '' }));
    assert.deepStrictEqual(v.errores, []);
    assert.deepStrictEqual(v.avisos, []);
  });

  console.log('\n' + pasadas + ' pasadas, ' + fallidas + ' fallidas\n');
  process.exit(fallidas ? 1 : 0);
})();
