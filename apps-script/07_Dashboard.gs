/**
 * RefuelControl · Dashboard y exportación
 *
 * Lo que lee la PWA: una fila por combustible con sus derivados, más el
 * CSV de las 23 columnas dentro del propio JSON.
 *
 * Parte del backend de RefuelControl. Apps Script mete todos los archivos del
 * proyecto en el mismo ámbito global, así que el prefijo numérico solo sirve
 * para leerlos en orden; las funciones se llaman entre archivos sin importar
 * nada. Despliegue: Implementar > Gestionar implementaciones > Nueva versión.
 */

// ============================================================
//  DASHBOARD
// ============================================================

function getDashboardData() {
  const registros = leerFilas().map(f => {
    const fTicket = aFecha(f[C.FECHA_TICKET]);
    const fReg    = aFecha(f[C.TS]);
    const fEfec   = fTicket || fReg;
    return {
      id: f[C.ID],
      fecha: fEfec ? Utilities.formatDate(fEfec, ZONA, 'yyyy-MM-dd') : '',
      fechaRegistro: fReg ? Utilities.formatDate(fReg, ZONA, 'yyyy-MM-dd') : '',
      fechaDelTicket: !!fTicket,
      estacion: f[C.ESTACION] || 'Sin estación',
      tipo: f[C.TIPO],
      litros: num(f[C.LITROS]),
      precio: num(f[C.PRECIO]),
      total: num(f[C.TOTAL]),
      lleno: esLleno(f[C.LLENO]),
      kmTotales: num(f[C.KM_TOTAL]),
      kmTramo: num(f[C.KM_TRAMO]),
      kmGLP: num(f[C.KM_GLP]),
      kmGas: num(f[C.KM_GAS]),
      kmCalculo: num(f[C.KM_CALC]),
      lecturaGLP: num(f[C.LEC_GLP]),
      lecturaGas: num(f[C.LEC_GAS]),
      consumoCoche: num(f[C.CONS_COCHE]),
      consumoReal: num(f[C.CONS_REAL]),
      costeKmReal: num(f[C.COSTE_REAL]),
      costeKmCoche: num(f[C.COSTE_COCHE]),
      recibo: f[C.RECIBO] || '',
      lat: num(f[C.LAT]),
      lon: num(f[C.LON])
    };
  });

  return {
    registros,
    estaciones: listaEstaciones(),
    ubicaciones: ubicacionesConocidas(),
    depositos: estadoDepositos(),
    version: VERSION,
    actualizado: Utilities.formatDate(new Date(), ZONA, 'dd/MM/yyyy HH:mm')
  };
}

// ============================================================
//  EXPORTACIÓN
//  Devuelve el CSV dentro del JSON: así el proxy de Netlify no
//  necesita ningún tratamiento especial y el navegador se encarga
//  de convertirlo en descarga.
// ============================================================

function exportarCSV() {
  const filas = leerFilas();
  const lineas = [CABECERAS.map(celdaCSV).join(';')];

  filas.forEach(f => {
    lineas.push(f.map((v, i) => {
      if (i === C.TS) {
        const d = aFecha(v);
        return d ? Utilities.formatDate(d, ZONA, 'dd/MM/yyyy HH:mm:ss') : '';
      }
      if (i === C.FECHA_TICKET) {
        const d = aFecha(v);
        return d ? Utilities.formatDate(d, ZONA, 'dd/MM/yyyy') : '';
      }
      if (i === C.LLENO) return esLleno(v) ? 'Sí' : 'No';
      if (typeof v === 'number') return String(v).replace('.', ',');
      return celdaCSV(v);
    }).join(';'));
  });

  return {
    csv: lineas.join('\r\n'),
    nombre: 'RefuelControl_' + Utilities.formatDate(new Date(), ZONA, 'yyyyMMdd') + '.csv',
    filas: filas.length
  };
}

function celdaCSV(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
