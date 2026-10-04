/**
 * Texturas procedurales generadas con Canvas 2D (sin archivos externos):
 * detalle de terreno, pistas, decoraciones de las aeronaves, nubes, partículas, etc.
 * Todas se cachean y se liberan con dispose().
 */
import * as THREE from 'three';
import { SimplexNoise } from '../utils/noise.js';
import { makeRng } from '../utils/math3d.js';

const cache = new Map();
let quality = 1; // 0.5 (bajo) .. 1 (normal) .. 2 (ultra)

export function setTextureQuality(q) {
  quality = q;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(w));
  c.height = Math.max(4, Math.round(h));
  return c;
}

function toTexture(c, { repeat = false, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose?.();
  cache.clear();
}

/** Textura de detalle en escala de grises (multiplica el color de vértice del terreno). */
export function terrainDetail() {
  return cached(`terrainDetail-${quality}`, () => {
    const size = Math.round(256 * quality);
    const c = canvas(size, size);
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const n = new SimplexNoise(5);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // ruido periódico (toroidal) para que la textura sea repetible sin costuras
        const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
        const nx = Math.cos(a) * 1.6, ny = Math.sin(a) * 1.6, nz = Math.cos(b) * 1.6, nw = Math.sin(b) * 1.6;
        const v = 0.5 * n.noise3(nx + nz * 0.7, ny, nw) + 0.3 * n.noise3(nx * 3 + 11, ny * 3, nz * 3 + nw) + 0.2 * n.noise3(nx * 8, ny * 8 + 5, nw * 8);
        const grain = (Math.random() - 0.5) * 0.12;
        const val = Math.max(0, Math.min(255, 200 + (v + grain) * 70));
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTexture(c, { repeat: true, srgb: false, aniso: 8 });
  });
}

/** Franjas de césped cortado para pistas de hierba. */
export function mownStripes() {
  return cached('mown', () => {
    const c = canvas(64, 256);
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#cfdcb6' : '#bccb9f';
      g.fillRect(0, i * 32, 64, 32);
    }
    return toTexture(c, { repeat: true });
  });
}

/** Asfalto con marcas de pista (números y eje). length/width en metros. */
export function runwayAsphalt(name = '09/27') {
  return cached(`asphalt-${name}`, () => {
    const W = 128, H = 1024;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#4a4c50';
    g.fillRect(0, 0, W, H);
    const r = makeRng(3);
    for (let i = 0; i < 3500; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0.05)`;
      g.fillRect(r() * W, r() * H, 2, 2);
    }
    g.fillStyle = '#f2f2f2';
    for (let y = 120; y < H - 120; y += 60) g.fillRect(W / 2 - 2, y, 4, 30);
    g.fillRect(4, 0, 3, H);
    g.fillRect(W - 7, 0, 3, H);
    for (let i = 0; i < 6; i++) {
      g.fillRect(10 + i * 19, 12, 10, 50);
      g.fillRect(10 + i * 19, H - 62, 10, 50);
    }
    const [a, b] = name.split('/');
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.save(); g.translate(W / 2, H - 80); g.fillText(a || '', 0, 0); g.restore();
    g.save(); g.translate(W / 2, 80); g.rotate(Math.PI); g.fillText(b || '', 0, 0); g.restore();
    return toTexture(c, { aniso: 8 });
  });
}

/** Textura circular suave (partículas, brillos de luces). */
export function softDot(color = '255,255,255') {
  return cached(`dot-${color}`, () => {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, `rgba(${color},1)`);
    grd.addColorStop(0.4, `rgba(${color},0.5)`);
    grd.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return toTexture(c);
  });
}

/** Nube: varios lóbulos difusos (sprites agrupados). */
export function cloudPuff(seed = 1) {
  return cached(`cloud-${seed}`, () => {
    const s = 256;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const r = makeRng(seed);
    for (let i = 0; i < 26; i++) {
      const x = s * (0.2 + r() * 0.6), y = s * (0.35 + r() * 0.35);
      const rad = s * (0.1 + r() * 0.2);
      const grd = g.createRadialGradient(x, y - rad * 0.2, 0, x, y, rad);
      const shade = 235 + Math.floor(r() * 20);
      grd.addColorStop(0, `rgba(${shade},${shade},${shade + 2},0.55)`);
      grd.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    // base ligeramente sombreada
    const grd = g.createLinearGradient(0, s * 0.3, 0, s * 0.8);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(1, 'rgba(150,160,175,0.25)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    return toTexture(c);
  });
}

/** Disco de hélice difuminado. */
export function propDisc() {
  return cached('propDisc', () => {
    const s = 128;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, s * 0.08, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(30,30,30,0.0)');
    grd.addColorStop(0.3, 'rgba(40,40,40,0.35)');
    grd.addColorStop(0.85, 'rgba(60,60,60,0.25)');
    grd.addColorStop(0.95, 'rgba(240,240,240,0.35)');
    grd.addColorStop(1, 'rgba(60,60,60,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    return toTexture(c);
  });
}

/** Tela de manga de viento con franjas. */
export function windsockStripes() {
  return cached('windsock', () => {
    const c = canvas(128, 16);
    const g = c.getContext('2d');
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#ff5a1f';
      g.fillRect(i * 25.6, 0, 25.6, 16);
    }
    return toTexture(c);
  });
}

/** Fachada de casa con ventanas y puerta. */
export function facade(color = '#e8dcc8', seed = 1) {
  return cached(`facade-${color}-${seed}`, () => {
    const c = canvas(128, 64);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 64);
    const r = makeRng(seed);
    for (let i = 0; i < 2000; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.04})`;
      g.fillRect(r() * 128, r() * 64, 2, 2);
    }
    g.fillStyle = '#3b4a5a';
    for (let i = 0; i < 3; i++) {
      g.fillRect(14 + i * 40, 18, 16, 16);
      g.fillStyle = '#ffffff';
      g.fillRect(14 + i * 40 + 7, 18, 2, 16);
      g.fillStyle = '#3b4a5a';
    }
    g.fillStyle = '#5d4037';
    g.fillRect(56, 38, 14, 26);
    return toTexture(c);
  });
}

/* ─────────────────────────────── Decoraciones ─────────────────────────────── */

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

/**
 * Textura de decoración de una pieza de la aeronave.
 * Mapeo UV: fuselaje u = posición longitudinal (0 morro → 1 cola), v = ángulo (0..1 alrededor,
 *   0.25 = lateral derecho, 0.5 = parte superior...). Alas: u = cuerda (0 BA → 1 BS), v = envergadura (0 raíz → 1 punta).
 */
export function liveryTexture(part, livery, opts = {}) {
  const key = `liv-${part}-${JSON.stringify(livery)}-${JSON.stringify(opts)}-${quality}`;
  return cached(key, () => {
    const W = Math.round(512 * Math.min(quality, 1.5)), H = Math.round(256 * Math.min(quality, 1.5));
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const { primary, secondary, accent, pattern } = livery;
    const base = part === 'fuselage' ? primary : part === 'wing' ? (livery.wingColor || primary) : (livery.tailColor || primary);
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    // canvas: x = u, y = v
    const U = (u) => u * W, V = (v) => v * H;

    if (part === 'fuselage') {
      switch (pattern) {
        case 'stripe':
        case 'checker':
        case 'sunburst':
        case 'zigzag':
          g.fillStyle = secondary;
          g.fillRect(0, V(0.2), W, V(0.07)); g.fillRect(0, V(0.73), W, V(0.07));
          g.fillStyle = accent;
          g.fillRect(0, V(0.27), W, V(0.025)); g.fillRect(0, V(0.705), W, V(0.025));
          if (pattern === 'checker') {
            const n = 12;
            for (let i = 0; i < n * 2; i++) for (let j = 0; j < 8; j++) {
              if ((i + j) % 2) continue;
              g.fillStyle = secondary;
              g.fillRect(U(i * 0.012), V(j / 8), U(0.012), V(1 / 8));
            }
          }
          if (pattern === 'zigzag') {
            g.fillStyle = accent;
            g.beginPath();
            for (let i = 0; i <= 20; i++) g.lineTo(U(i / 20), V(i % 2 ? 0.1 : 0.32));
            g.lineTo(W, V(0.1)); g.lineTo(0, V(0.1));
            g.fill();
          }
          break;
        case 'lightning':
          g.fillStyle = secondary;
          g.beginPath();
          g.moveTo(U(0.08), V(0.18)); g.lineTo(U(0.95), V(0.22)); g.lineTo(U(0.95), V(0.26)); g.lineTo(U(0.5), V(0.26)); g.lineTo(U(0.45), V(0.3)); g.lineTo(U(0.08), V(0.26));
          g.fill();
          g.beginPath();
          g.moveTo(U(0.08), V(0.82)); g.lineTo(U(0.95), V(0.78)); g.lineTo(U(0.95), V(0.74)); g.lineTo(U(0.5), V(0.74)); g.lineTo(U(0.45), V(0.7)); g.lineTo(U(0.08), V(0.74));
          g.fill();
          break;
        case 'swoosh':
          g.fillStyle = secondary;
          for (const s of [1, -1]) {
            g.beginPath();
            const v0 = s > 0 ? 0.25 : 0.75;
            g.moveTo(0, V(v0));
            g.bezierCurveTo(U(0.3), V(v0 - s * 0.12), U(0.6), V(v0 + s * 0.1), W, V(v0 - s * 0.05));
            g.lineTo(W, V(v0 + s * 0.05));
            g.bezierCurveTo(U(0.6), V(v0 + s * 0.18), U(0.3), V(v0 - s * 0.02), 0, V(v0 + s * 0.06));
            g.fill();
          }
          break;
        case 'lowvis': {
          // gris de baja visibilidad: lomo algo más oscuro con transición suave
          const grd = g.createLinearGradient(0, 0, 0, H);
          grd.addColorStop(0, base); grd.addColorStop(0.35, base); grd.addColorStop(0.5, secondary); grd.addColorStop(0.65, base); grd.addColorStop(1, base);
          g.fillStyle = grd; g.fillRect(0, 0, W, H);
          g.fillStyle = shade(base, 0.85); g.fillRect(0, 0, U(0.06), H);
          break;
        }
        case 'camo':
          camo(g, W, H, base, secondary, opts.seed || 3);
          g.fillStyle = shade(base, 1.25);
          g.fillRect(0, V(0.88), W, V(0.12));
          g.fillRect(0, 0, W, V(0.12));
          break;
        case 'invasion':
          for (let i = 0; i < 5; i++) {
            g.fillStyle = i % 2 ? '#111111' : '#f5f5f5';
            g.fillRect(U(0.7 + i * 0.03), 0, U(0.03), H);
          }
          g.fillStyle = accent;
          g.fillRect(0, 0, U(0.12), H);
          break;
        case 'arrow':
          g.fillStyle = secondary;
          g.beginPath();
          g.moveTo(0, V(0.15)); g.lineTo(U(0.6), V(0.24)); g.lineTo(U(1), V(0.24)); g.lineTo(U(1), V(0.3)); g.lineTo(U(0.6), V(0.3)); g.lineTo(0, V(0.32));
          g.fill();
          g.beginPath();
          g.moveTo(0, V(0.85)); g.lineTo(U(0.6), V(0.76)); g.lineTo(U(1), V(0.76)); g.lineTo(U(1), V(0.7)); g.lineTo(U(0.6), V(0.7)); g.lineTo(0, V(0.68));
          g.fill();
          g.fillStyle = accent;
          g.fillRect(0, V(0.47), U(0.15), V(0.06));
          break;
        case 'tips':
        default:
          g.fillStyle = secondary;
          g.fillRect(0, 0, U(0.12), H);
          g.fillStyle = accent;
          g.fillRect(U(0.12), V(0.22), U(0.6), V(0.035));
          g.fillRect(U(0.12), V(0.745), U(0.6), V(0.035));
          break;
      }
      // ventanas de cabina / matrícula
      if (opts.cabin) {
        g.fillStyle = '#1d2a36';
        for (const s of [1, -1]) {
          const vc = s > 0 ? 0.36 : 0.64;
          g.beginPath();
          g.moveTo(U(0.13), V(vc - 0.05 * s)); g.lineTo(U(0.36), V(vc - 0.05 * s)); g.lineTo(U(0.38), V(vc + 0.06 * s)); g.lineTo(U(0.15), V(vc + 0.06 * s));
          g.fill();
          g.fillStyle = base;
          g.fillRect(U(0.245), V(vc - 0.07), U(0.012), V(0.14));
          g.fillStyle = '#1d2a36';
        }
        g.fillRect(U(0.11), V(0.44), U(0.045), V(0.12));
      }
      if (livery.registration) {
        g.fillStyle = livery.regColor || accent;
        g.font = `bold ${Math.round(H * 0.07)}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.save(); g.translate(U(0.62), V(0.345)); g.scale(1, 1); g.fillText(livery.registration, 0, 0); g.restore();
        g.save(); g.translate(U(0.62), V(0.655)); g.scale(-1, 1); g.fillText(livery.registration, 0, 0); g.restore();
      }
    } else if (part === 'wing') {
      switch (pattern) {
        case 'sunburst': {
          g.fillStyle = secondary;
          for (let i = 0; i < 7; i++) {
            if (i % 2) continue;
            g.beginPath();
            g.moveTo(U(0.5), V(0));
            g.lineTo(U(0.05 + (i / 7) * 0.9), V(1));
            g.lineTo(U(0.05 + ((i + 1) / 7) * 0.9), V(1));
            g.fill();
          }
          break;
        }
        case 'checker':
          for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) {
            if ((i + j) % 2) continue;
            g.fillStyle = secondary;
            g.fillRect(U(i / 8), V(0.82 + j * 0.06), U(1 / 8), V(0.06));
          }
          break;
        case 'stripe':
        case 'swoosh':
        case 'lightning':
          g.fillStyle = secondary;
          g.fillRect(0, V(0.62), W, V(0.1));
          g.fillStyle = accent;
          g.fillRect(0, V(0.74), W, V(0.04));
          break;
        case 'lowvis':
          g.fillStyle = shade(base, 0.92); g.fillRect(0, 0, U(0.12), H);
          break;
        case 'camo':
          camo(g, W, H, base, secondary, (opts.seed || 3) + 7);
          break;
        case 'invasion':
          for (let i = 0; i < 5; i++) {
            g.fillStyle = i % 2 ? '#111111' : '#f5f5f5';
            g.fillRect(0, V(0.32 + i * 0.045), W, V(0.045));
          }
          break;
        case 'arrow':
          g.fillStyle = secondary;
          g.beginPath();
          g.moveTo(0, V(0.1)); g.lineTo(W, V(0.6)); g.lineTo(W, V(0.75)); g.lineTo(0, V(0.25));
          g.fill();
          break;
        case 'zigzag':
          g.fillStyle = secondary;
          g.beginPath();
          g.moveTo(0, V(0.5));
          for (let i = 0; i <= 8; i++) g.lineTo(U(i / 8), V(i % 2 ? 0.6 : 0.75));
          g.lineTo(W, V(1)); g.lineTo(0, V(1));
          g.fill();
          break;
        case 'tips':
        default:
          g.fillStyle = secondary;
          g.fillRect(0, V(0.84), W, V(0.16));
          g.fillStyle = accent;
          g.fillRect(0, V(0.8), W, V(0.03));
          break;
      }
      if (livery.registration && opts.registration) {
        g.fillStyle = livery.regColor || accent;
        g.font = `bold ${Math.round(W * 0.22)}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.save(); g.translate(U(0.45), V(0.5)); g.rotate(Math.PI / 2); g.scale(opts.mirror ? -1 : 1, 1); g.fillText(livery.registration, 0, 0); g.restore();
      }
      if (opts.roundel) roundel(g, U(0.45), V(0.7), Math.min(W, H) * 0.16, opts.roundel);
    } else {
      // empenaje
      g.fillStyle = secondary;
      if (pattern === 'camo') camo(g, W, H, base, secondary, 11);
      else if (pattern === 'invasion' || pattern === 'lowvis') { /* sin franjas en el empenaje */ }
      else {
        g.fillRect(0, V(0.62), W, V(0.18));
        g.fillStyle = accent;
        g.fillRect(0, V(0.82), W, V(0.08));
      }
      if (opts.number) {
        g.fillStyle = accent;
        g.font = `bold ${Math.round(H * 0.35)}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.save(); g.translate(U(0.4), V(0.35)); g.rotate(Math.PI / 2); g.fillText(opts.number, 0, 0); g.restore();
      }
    }
    panelLines(g, W, H, part, pattern === 'lowvis' ? 2 : 1);
    const tex = toTexture(c, { aniso: 4 });
    return tex;
  });
}

/** Líneas de paneles y remaches sutiles (dan escala y detalle sin geometría extra). */
function panelLines(g, W, H, part, density = 1) {
  g.save();
  g.globalAlpha = 0.16;
  g.strokeStyle = '#000000';
  g.lineWidth = Math.max(1, W / 512);
  if (part === 'fuselage') {
    const us = density > 1 ? [0.1, 0.18, 0.27, 0.36, 0.45, 0.55, 0.65, 0.76, 0.87] : [0.12, 0.3, 0.5, 0.72];
    for (const u of us) { g.beginPath(); g.moveTo(u * W, 0); g.lineTo(u * W, H); g.stroke(); }
    for (const v of [0.15, 0.85]) { g.beginPath(); g.moveTo(0, v * H); g.lineTo(W, v * H); g.stroke(); }
  } else {
    const n = density > 1 ? 8 : 5;
    for (let i = 1; i < n; i++) { const v = i / n; g.beginPath(); g.moveTo(0, v * H); g.lineTo(W, v * H); g.stroke(); }
    g.beginPath(); g.moveTo(0.18 * W, 0); g.lineTo(0.18 * W, H); g.stroke();
  }
  g.restore();
}

function camo(g, W, H, base, secondary, seed) {
  const r = makeRng(seed);
  const cols = [secondary, shade(base, 0.8), shade(secondary, 1.15)];
  for (let i = 0; i < 26; i++) {
    g.fillStyle = cols[i % cols.length];
    g.beginPath();
    const cx = r() * W, cy = r() * H, rad = 20 + r() * 60;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const rr = rad * (0.6 + r() * 0.6);
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.6);
    }
    g.fill();
  }
}

function roundel(g, x, y, r, colors) {
  colors.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, r * (1 - i / colors.length), 0, Math.PI * 2);
    g.fill();
  });
}
