/**
 * Genera los iconos PNG de la PWA (192, 512, 512 enmascarable y 180 para iOS) rasterizando
 * el logotipo vectorial con supermuestreo. Sin dependencias: codificador PNG con zlib de Node.
 * Uso: node tools/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const inPoly = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Color del logotipo en coordenadas del viewBox 0..64 (null = fondo). */
function sample(x, y, padScale) {
  // contenido escalado hacia el centro (zona segura de iconos enmascarables)
  const cx = 32 + (x - 32) / padScale, cy = 32 + (y - 32) / padScale;
  const arc = (r, w, a0, a1, ox, oy) => {
    const d = Math.hypot(cx - ox, cy - oy);
    const a = Math.atan2(cy - oy, cx - ox);
    return Math.abs(d - r) < w / 2 && a > a0 && a < a1;
  };
  if (inPoly(cx, cy, [[8, 38], [32, 31], [56, 38], [32, 41]])) return hex('#ff8a1f');
  if (inPoly(cx, cy, [[29, 18], [35, 18], [37.5, 48], [26.5, 48]])) return hex('#e9eef4');
  if (inPoly(cx, cy, [[24, 49], [40, 49], [38, 53], [26, 53]])) return hex('#e9eef4');
  if (arc(14, 3, -1.45, 0.1, 38, 22) && cx > 40) return hex('#3ec6ff');
  if (arc(21, 3, -1.45, 0.1, 38, 26) && cx > 42) return hex('#2b8fb8');
  return null;
}

function render(size, { rounded, padScale }) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  const bg = hex('#070b10');
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 64, y = ((py + (sy + 0.5) / ss) / size) * 64;
          // fondo con esquinas redondeadas (o lleno para el icono enmascarable)
          const R = 14, dx = Math.max(R - x, 0, x - (64 - R)), dy = Math.max(R - y, 0, y - (64 - R));
          if (rounded && Math.hypot(dx, dy) > R) continue;
          const c = sample(x, y, padScale) || bg;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = ss * ss, i = (py * size + px) * 4;
      const cov = a / 255;
      buf[i] = cov ? r / cov : 0; buf[i + 1] = cov ? g / cov : 0; buf[i + 2] = cov ? b / cov : 0; buf[i + 3] = a / n;
    }
  }
  return png(size, buf);
}

const jobs = [
  ['icon-192.png', 192, { rounded: true, padScale: 1 }],
  ['icon-512.png', 512, { rounded: true, padScale: 1 }],
  ['icon-maskable-512.png', 512, { rounded: false, padScale: 1.35 }],
  ['apple-touch-icon.png', 180, { rounded: false, padScale: 1.15 }],
];
for (const [name, size, opts] of jobs) fs.writeFileSync(path.join(OUT, name), render(size, opts));
console.log('iconos generados en', OUT);
