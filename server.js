/**
 * Servidor sin dependencias para RC FLIGHT SIMULATOR: archivos estáticos + API de la mejora
 * «Render realista» (canje de códigos de un solo uso y pagos con Stripe; ver server/premium.js).
 * Uso: node server.js [puerto]   (por defecto 8080)  →  http://localhost:8080
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPremiumApi } from './server/premium.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
// no se publican: dependencias, pruebas, código del servidor ni la base de licencias
const BLOCKED = ['node_modules', 'tests', '.git', 'server', 'data'];
const premium = createPremiumApi(ROOT);

http.createServer(async (req, res) => {
  if (await premium(req, res)) return;
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('..') || BLOCKED.some((b) => rel.split(path.sep)[0] === b)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => console.log(`RC FLIGHT SIMULATOR → http://localhost:${PORT}`));
