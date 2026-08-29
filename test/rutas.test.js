/**
 * Comprobación de rutas.
 *
 *   node test/rutas.test.js
 *
 * Los iconos se declaran en tres sitios distintos (index.html, manifest.json y
 * sw.js) y es fácil mover un archivo y dejarse uno. El de sw.js es el peor:
 * cache.addAll() es atómico, así que un solo 404 tumba la instalación del
 * service worker entera y la app se queda sin offline sin decir nada.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const existe = ruta => fs.existsSync(path.join(RAIZ, ruta.replace(/^\.\//, '')));

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

console.log('\nRutas de archivos — RefuelControl\n');

prueba('Los iconos del manifiesto de la PWA existen', () => {
  const manifiesto = JSON.parse(leer('manifest.json'));
  assert.ok(manifiesto.icons.length, 'el manifiesto no declara iconos');
  manifiesto.icons.forEach(i => {
    assert.ok(existe(i.src), 'no encuentro ' + i.src + ' declarado en manifest.json');
  });
});

prueba('El apple-touch-icon de index.html existe', () => {
  const html = leer('index.html');
  const m = html.match(/rel="apple-touch-icon"\s+href="([^"]+)"/);
  assert.ok(m, 'index.html no declara apple-touch-icon');
  assert.ok(existe(m[1]), 'no encuentro ' + m[1] + ' declarado en index.html');
});

prueba('Todo lo que el service worker precachea existe', () => {
  const sw = leer('sw.js');
  const bloque = sw.match(/const ESTATICOS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(bloque, 'no encuentro la lista ESTATICOS en sw.js');

  const rutas = (bloque[1].match(/'[^']+'/g) || []).map(s => s.replace(/'/g, ''));
  assert.ok(rutas.length >= 3, 'la lista ESTATICOS parece incompleta');

  rutas.forEach(r => {
    if (r === './') return;                       // la raíz la sirve el hosting
    assert.ok(existe(r), 'no encuentro ' + r + ', y un 404 aquí deja la app sin offline');
  });
});

prueba('Los tres sitios apuntan a los mismos iconos', () => {
  const manifiesto = JSON.parse(leer('manifest.json'));
  const sw = leer('sw.js');
  const html = leer('index.html');

  const enManifiesto = new Set(manifiesto.icons.map(i => i.src.replace(/^\.\//, '')));
  enManifiesto.forEach(icono => {
    assert.ok(sw.indexOf(icono) >= 0, icono + ' está en manifest.json pero no en sw.js');
  });

  const m = html.match(/rel="apple-touch-icon"\s+href="([^"]+)"/);
  assert.ok(enManifiesto.has(m[1].replace(/^\.\//, '')),
    'el apple-touch-icon (' + m[1] + ') no coincide con ninguno del manifiesto');
});

prueba('Las capturas que enseña el README existen', () => {
  const readme = leer('README.md');
  const rutas = new Set();
  (readme.match(/!\[[^\]]*\]\(([^)]+\.png)\)/g) || []).forEach(m => {
    rutas.add(m.match(/\(([^)]+)\)/)[1]);
  });
  (readme.match(/<img\s+src="([^"]+\.png)"/g) || []).forEach(m => {
    rutas.add(m.match(/src="([^"]+)"/)[1]);
  });
  assert.ok(rutas.size, 'el README no enseña ninguna captura');
  rutas.forEach(r => {
    if (/^https?:/.test(r)) return;
    assert.ok(existe(r), 'el README enlaza ' + r + ', que no está en el repo');
  });
});

console.log('\n' + pasadas + ' pasadas, ' + fallidas + ' fallidas\n');
process.exit(fallidas ? 1 : 0);
