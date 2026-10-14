/**
 * Herramienta de desarrollo (no se publica): recibe capturas hechas en el navegador con
 * tools/capture-previews.js y las guarda en assets/. Uso: node tools/capture-server.mjs
 * (escucha en http://localhost:8098; POST /save?path=assets/... con el dataURL en el cuerpo).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.end();
  const url = new URL(req.url, 'http://x');
  const file = path.resolve(ROOT, url.searchParams.get('path') || '');
  if (req.method !== 'POST' || !file.startsWith(ASSETS + path.sep) || !/\.(png|jpe?g|webp)$/.test(file)) {
    res.writeHead(400);
    return res.end('bad request');
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const b64 = body.slice(body.indexOf(',') + 1);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log('guardado', path.relative(ROOT, file), Math.round(b64.length * 0.75 / 1024), 'KB');
    res.end('ok');
  });
}).listen(8098, () => console.log('capture-server → http://localhost:8098'));
