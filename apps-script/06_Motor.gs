/**
 * RefuelControl · Motor de cálculo
 *
 * El método tanque a tanque: ventanas por combustible, arrastre de los
 * repostajes parciales y consumo vacío cuando falta un parcial. Es la
 * pieza valiosa del proyecto; no la simplifiques.
 *
 * Parte del backend de RefuelControl. Apps Script mete todos los archivos del
 * proyecto en el mismo ámbito global, así que el prefijo numérico solo sirve
 * para leerlos en orden; las funciones se llaman entre archivos sin importar
 * nada. Despliegue: Implementar > Gestionar implementaciones > Nueva versión.
 */

// ============================================================
//  MOTOR DE CÁLCULO
// ============================================================

/** Recorrido de un combustible en un tramo, a partir de la lectura del coche. */
function tramoDeContador(lecturaActual, lecturaPrevia) {
  if (lecturaActual === null) return null;
  if (CONTADORES_SE_RESETEAN) return lecturaActual;          // la lectura ES el tramo
  if (lecturaPrevia === null) return null;
  return lecturaActual >= lecturaPrevia ? lecturaActual - lecturaPrevia : lecturaActual;
}

/**
 * Recalcula tramos, acumulados por combustible, consumos y costes de toda la hoja,
 * y sincroniza la copia de seguridad.
 *
 * Ventana de cálculo de un combustible: desde su último llenado hasta el siguiente.
 * Un repostaje parcial no la cierra; sus litros y euros se arrastran al llenado
 * que venga después, que es el único que puede dar un consumo honesto.
 *
 * Cuando un ticket cierra la ventana, el consumo y el coste se escriben en la
 * primera fila de ese combustible dentro del ticket, junto con los km de la
 * ventana. Así cada ventana aparece una sola vez y el dashboard puede ponderar
 * sin contar dos veces los mismos kilómetros.
 */
function recalcularTodo() {
  const hoja = getHoja();
  const ultima = hoja.getLastRow();
  if (ultima < 2) return { avisos: [], ordenAvisos: [], ultimo: null };

  const rango = hoja.getRange(2, 1, ultima - 1, CABECERAS.length);
  const filas = rango.getValues();

  // Agrupamos por ticket conservando el orden de aparición
  const orden = [], porId = {};
  filas.forEach((f, i) => {
    const id = f[C.ID];
    if (!id) return;
    if (!porId[id]) { porId[id] = []; orden.push(id); }
    porId[id].push(i);
  });

  let previo = null;          // ticket anterior
  let accGLP = 0, accGas = 0; // km acumulados desde el último llenado de cada combustible
  // El acumulado solo sirve si conocemos TODOS los tramos desde ese llenado.
  // Si en algún tramo falta la lectura, el consumo de ese depósito no es calculable.
  let completoGLP = false, completoGas = false;
  let vistoGLP = false, vistoGas = false;
  // Litros y euros de repostajes parciales pendientes de cerrar ventana
  let arrLitrosGLP = 0, arrEurosGLP = 0, arrLitrosGas = 0, arrEurosGas = 0;
  const avisos = [], ordenAvisos = [];

  orden.forEach(id => {
    const idx = porId[id];
    const ref = filas[idx[0]];

    const kmTotal = num(ref[C.KM_TOTAL]);
    const lecGLP  = num(ref[C.LEC_GLP]);
    const lecGas  = num(ref[C.LEC_GAS]);

    // Tras editar un repostaje antiguo el odómetro puede quedar desordenado, y el
    // motor depende del orden de la hoja. Avisamos en vez de reordenar por sorpresa.
    if (kmTotal !== null && previo && previo.kmTotal !== null && kmTotal < previo.kmTotal) {
      ordenAvisos.push({
        id,
        texto: 'El repostaje ' + id + ' tiene menos KM (' + Math.round(kmTotal) +
               ') que el anterior (' + Math.round(previo.kmTotal) + '). Las filas están desordenadas.'
      });
    }

    const kmTramo  = (kmTotal !== null && previo && previo.kmTotal !== null) ? kmTotal - previo.kmTotal : null;
    const tramoGLP = tramoDeContador(lecGLP, previo ? previo.lecGLP : null);
    const tramoGas = tramoDeContador(lecGas, previo ? previo.lecGas : null);

    // Aviso de coherencia: los km de los dos combustibles deberían cuadrar con el tramo
    if (kmTramo !== null && tramoGLP !== null && tramoGas !== null) {
      const sumado = tramoGLP + tramoGas;
      if (kmTramo > 0 && Math.abs(sumado - kmTramo) > kmTramo * 0.15) {
        avisos.push({
          id,
          texto: 'Los km por combustible (' + Math.round(sumado) + ') no cuadran con el tramo (' +
                 Math.round(kmTramo) + '). ¿Olvidaste resetear algún parcial?'
        });
      }
    }

    if (tramoGLP === null) completoGLP = false; else accGLP += tramoGLP;
    if (tramoGas === null) completoGas = false; else accGas += tramoGas;

    // ¿Qué combustibles trae este ticket y cuáles llenan su depósito?
    const idxGLP = idx.filter(i => esGLP(filas[i][C.TIPO]));
    const idxGas = idx.filter(i => !esGLP(filas[i][C.TIPO]));
    const traeGLP = idxGLP.length > 0;
    const traeGas = idxGas.length > 0;
    const llenaGLP = traeGLP && idxGLP.every(i => esLleno(filas[i][C.LLENO]));
    const llenaGas = traeGas && idxGas.every(i => esLleno(filas[i][C.LLENO]));

    // Los litros y euros del ticket entran en la ventana abierta de su combustible
    idxGLP.forEach(i => { arrLitrosGLP += num(filas[i][C.LITROS]) || 0; arrEurosGLP += num(filas[i][C.TOTAL]) || 0; });
    idxGas.forEach(i => { arrLitrosGas += num(filas[i][C.LITROS]) || 0; arrEurosGas += num(filas[i][C.TOTAL]) || 0; });

    // El consumo solo sale si el depósito estaba lleno al principio de la ventana,
    // se vuelve a llenar ahora y conocemos todos los tramos intermedios.
    const fiableGLP = llenaGLP && vistoGLP && completoGLP && accGLP > 0;
    const fiableGas = llenaGas && vistoGas && completoGas && accGas > 0;

    const cierraGLP = fiableGLP ? idxGLP[0] : -1;
    const cierraGas = fiableGas ? idxGas[0] : -1;

    idx.forEach(i => {
      const f = filas[i];
      const glp = esGLP(f[C.TIPO]);
      const cierra = (glp && i === cierraGLP) || (!glp && i === cierraGas);
      const kmCalc  = cierra ? (glp ? accGLP : accGas) : null;
      const litros  = glp ? arrLitrosGLP : arrLitrosGas;
      const euros   = glp ? arrEurosGLP  : arrEurosGas;
      const precio    = num(f[C.PRECIO]);
      const consCoche = num(f[C.CONS_COCHE]);

      f[C.KM_TRAMO] = vacio(kmTramo);
      f[C.KM_GLP]   = vacio(tramoGLP);
      f[C.KM_GAS]   = vacio(tramoGas);
      f[C.KM_CALC]  = vacio(kmCalc);

      f[C.CONS_REAL]   = vacio(cierra && litros ? redondear((litros / kmCalc) * 100, 2) : null);
      f[C.COSTE_REAL]  = vacio(cierra && euros  ? redondear(euros / kmCalc, 4) : null);
      f[C.COSTE_COCHE] = vacio(consCoche && precio ? redondear((precio * consCoche) / 100, 4) : null);
      if (f[C.LLENO] === '' || f[C.LLENO] === null) f[C.LLENO] = true;
    });

    // Un llenado cierra la ventana de su combustible; un parcial la deja abierta
    if (llenaGLP) { accGLP = 0; completoGLP = true; vistoGLP = true; arrLitrosGLP = 0; arrEurosGLP = 0; }
    if (llenaGas) { accGas = 0; completoGas = true; vistoGas = true; arrLitrosGas = 0; arrEurosGas = 0; }

    previo = { kmTotal, lecGLP, lecGas };
  });

  rango.setValues(filas);
  SpreadsheetApp.flush();

  sincronizarCopia(filas);

  return {
    avisos,
    ordenAvisos,
    ultimo: previo,
    pendientes: {
      kmGLPSinRepostar: accGLP,
      kmGasolinaSinRepostar: accGas,
      litrosGLPArrastrados: arrLitrosGLP,
      litrosGasolinaArrastrados: arrLitrosGas
    }
  };
}
