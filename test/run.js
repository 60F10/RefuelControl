/**
 * Lanza todos los bancos de pruebas.
 *
 *   node test/run.js      (o npm test)
 *
 * Los descubre solos: cualquier archivo `*.test.js` de esta carpeta entra. Antes
 * la lista estaba escrita a mano y bastaba una mayúscula de más en un nombre
 * para que `npm test` reventara en Linux —y siguiera funcionando en Windows, que
 * no distingue mayúsculas—, así que el fallo solo aparecía fuera de casa.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const bancos = fs.readdirSync(__dirname)
  .filter(f => /\.test\.js$/i.test(f))
  .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

if (!bancos.length) {
  console.log('No encontré ningún banco de pruebas en test/.\n');
  process.exit(1);
}

let fallo = false;

bancos.forEach(b => {
  try {
    execFileSync(process.execPath, [path.join(__dirname, b)], { stdio: 'inherit' });
  } catch (err) {
    fallo = true;
  }
});

if (fallo) {
  console.log('Hay pruebas que fallan. No despliegues.\n');
  process.exit(1);
}
console.log('Todo en orden: ' + bancos.length + ' bancos.\n');
