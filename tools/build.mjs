/**
 * Compila la versión publicable en dist/ (sitio estático, sin dependencias de Node):
 * copia index.html, src/, styles/, vendor/three y los archivos de la PWA si existen.
 * Uso: node tools/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ITEMS = ['index.html', 'src', 'styles', 'vendor', 'assets', 'manifest.webmanifest', 'sw.js', 'icons'];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
let files = 0;
const copy = (src, dst) => {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dst, f));
  } else { fs.copyFileSync(src, dst); files++; }
};
for (const item of ITEMS) {
  const p = path.join(ROOT, item);
  if (fs.existsSync(p)) copy(p, path.join(DIST, item));
}
console.log(`dist/ listo: ${files} archivos`);
