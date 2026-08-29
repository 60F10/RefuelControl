/**
 * Lanza los dos bancos de pruebas.
 *
 *   node test/run.js      (o npm test)
 */

const { execFileSync } = require('child_process');
const path = require('path');

const bancos = ['motor.test.js', 'dashboard.test.js'];
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
console.log('Todo en orden.\n');
