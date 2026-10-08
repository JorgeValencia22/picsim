/**
 * Árboles realistas de bajo peso.
 *
 * Cada copa se construye con «tarjetas» de follaje (planos con textura de hojas con transparencia)
 * repartidas por el volumen de la copa. Las normales de las tarjetas apuntan hacia fuera del
 * centro de la copa, de modo que la luz la sombrea como un volumen redondo y no como planos; el
 * color de vértice oscurece el interior y la parte baja (oclusión ambiental). Las texturas (hojas,
 * agujas de pino, hojas de palmera y corteza) se dibujan por código en un atlas: no se descarga
 * nada. Un árbol cercano tiene ~30–60 triángulos; el lejano, ~10.
 */
import * as THREE from 'three';
import { TREE_DIMS } from '../environments/EnvironmentBase.js';
import { makeRng } from '../utils/math3d.js';

// regiones del atlas (coordenadas del lienzo normalizadas: x→derecha, y→abajo)
const REG = {
  broad: [0, 0, 0.5, 0.5],
  conifer: [0.5, 0, 0.75, 0.5],
  cypress: [0.75, 0, 1, 0.5],
  fine: [0, 0.5, 0.5, 1],
  pine: [0.5, 0.5, 1, 0.75],
  palm: [0.5, 0.75, 0.875, 1],
  bark: [0.875, 0.75, 1, 1],
};

let atlasCache = null;

/** Atlas de follaje dibujado por código (se genera una vez). */
export function foliageAtlas(quality = 1) {
  if (atlasCache && atlasCache.q === quality) return atlasCache.tex;
  const S = quality >= 0.75 ? 1024 : 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = makeRng(4242);
  const R = (k) => { const [x0, y0, x1, y1] = REG[k]; return { x: x0 * S, y: y0 * S, w: (x1 - x0) * S, h: (y1 - y0) * S }; };

  // racimo de hojas: más denso en el centro, borde irregular, luz desde arriba
  const cluster = (k, { hue, sat, light, count, size, elong = 1.6, spread = 0.46 }) => {
    const r = R(k);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.min(r.w, r.h) * spread;
    g.save();
    g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    // ramitas
    g.strokeStyle = 'rgba(70,52,35,0.9)';
    g.lineWidth = Math.max(1, S / 300);
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2, l = rad * (0.4 + rng() * 0.5);
      g.beginPath(); g.moveTo(cx, cy + rad * 0.3); g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l * 0.8); g.stroke();
    }
    for (let pass = 0; pass < 2; pass++) {
      const n = pass === 0 ? count * 0.55 : count;
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const d = Math.pow(rng(), pass === 0 ? 0.9 : 0.6) * rad * (0.75 + 0.25 * Math.sin(a * 5 + rng()));
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.92;
        const ty = (y - (cy - rad)) / (2 * rad); // 0 arriba → 1 abajo
        const depth = 1 - d / rad;
        const L = light + (pass === 0 ? -9 : 0) + (0.5 - ty) * 16 - depth * 6 + (rng() - 0.5) * 10;
        g.fillStyle = `hsl(${hue + (rng() - 0.5) * 14}, ${sat + (rng() - 0.5) * 12}%, ${Math.max(6, L)}%)`;
        const s = size * (0.7 + rng() * 0.6) * (S / 512);
        g.save();
        g.translate(x, y);
        g.rotate(rng() * Math.PI * 2);
        g.beginPath();
        g.ellipse(0, 0, s * elong, s, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    g.restore();
  };

  // rama de pino: eje central con agujas en abanico
  const pineBranch = () => {
    const r = R('pine');
    g.save();
    g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    const sub = 3;
    for (let b = 0; b < sub; b++) {
      const y0 = r.y + r.h * (0.25 + b * 0.25);
      const x0 = r.x + r.w * 0.04, x1 = r.x + r.w * 0.96;
      g.strokeStyle = 'rgb(64,48,34)';
      g.lineWidth = Math.max(1, S / 260);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0 + r.h * 0.05); g.stroke();
      for (let i = 0; i < 260; i++) {
        const t = rng();
        const x = x0 + (x1 - x0) * t, y = y0 + r.h * 0.05 * t;
        const len = r.h * (0.1 + 0.08 * (1 - Math.abs(t - 0.45))) * (0.7 + rng() * 0.5);
        const a = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.9) + 0.25;
        const L = 16 + rng() * 14 - (rng() < 0.3 ? 6 : 0);
        g.strokeStyle = `hsl(${128 + rng() * 22}, ${32 + rng() * 14}%, ${L}%)`;
        g.lineWidth = Math.max(1, S / 420);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len); g.stroke();
      }
    }
    g.restore();
  };

  // silueta completa de conífera (abeto/pino) o ciprés, rama a rama: para tarjetas cruzadas
  const conifer = (k, { narrow = false } = {}) => {
    const r = R(k);
    g.save();
    g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    const cx = r.x + r.w / 2;
    // tronco central
    g.strokeStyle = 'rgb(70,52,36)';
    g.lineWidth = Math.max(2, r.w * 0.025);
    g.beginPath(); g.moveTo(cx, r.y + r.h * 0.02); g.lineTo(cx, r.y + r.h); g.stroke();
    const layers = narrow ? 70 : 46;
    for (let L = 0; L < layers; L++) {
      const t = (L + rng() * 0.6) / layers; // 0 arriba → 1 abajo
      const y = r.y + r.h * (0.02 + t * 0.95);
      const half = narrow ? r.w * 0.46 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) ** 0.8 : r.w * 0.48 * Math.min(1, t * 1.08 + 0.03);
      for (const sgn of [-1, 1]) {
        const len = half * (0.75 + rng() * 0.3);
        const droop = narrow ? r.h * 0.004 : r.h * (0.012 + 0.03 * t);
        // ramas: arco que cae hacia la punta, cubierto de agujas
        const steps = Math.max(4, Math.round(len / (S * 0.006)));
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const x = cx + sgn * len * u, yy = y + droop * u * u;
          const nl = r.w * (narrow ? 0.05 : 0.07) * (1 - u * 0.5);
          const light = 14 + (1 - t) * 10 + u * 6 + rng() * 9 - (rng() < 0.25 ? 6 : 0);
          g.strokeStyle = `hsl(${narrow ? 120 + rng() * 14 : 128 + rng() * 20}, ${30 + rng() * 14}%, ${light}%)`;
          g.lineWidth = Math.max(1, S / 512);
          for (let j = 0; j < 3; j++) {
            const a = (rng() - 0.5) * 2.4 + (sgn > 0 ? 0 : Math.PI);
            g.beginPath(); g.moveTo(x, yy); g.lineTo(x + Math.cos(a) * nl * 0.6, yy + Math.abs(Math.sin(a)) * nl + nl * 0.15); g.stroke();
          }
        }
      }
    }
    g.restore();
  };

  // hoja de palmera: nervio central y foliolos diagonales
  const palmFrond = () => {
    const r = R('palm');
    g.save();
    g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    const yc = r.y + r.h / 2;
    g.strokeStyle = 'rgb(120,110,60)';
    g.lineWidth = Math.max(1, S / 220);
    g.beginPath(); g.moveTo(r.x + 2, yc); g.lineTo(r.x + r.w - 2, yc); g.stroke();
    for (let i = 0; i < 70; i++) {
      const t = i / 70;
      const x = r.x + r.w * (0.04 + t * 0.92);
      const len = r.h * 0.46 * Math.sin(Math.PI * (0.15 + t * 0.8));
      for (const sgn of [-1, 1]) {
        g.strokeStyle = `hsl(${88 + rng() * 18}, ${38 + rng() * 10}%, ${22 + rng() * 14}%)`;
        g.lineWidth = Math.max(1.5, S / 200);
        g.beginPath(); g.moveTo(x, yc); g.lineTo(x + len * 0.55, yc + sgn * len); g.stroke();
      }
    }
    g.restore();
  };

  // corteza: vetas verticales y nudos
  const bark = () => {
    const r = R('bark');
    g.fillStyle = 'rgb(86,70,56)';
    g.fillRect(r.x, r.y, r.w, r.h);
    for (let i = 0; i < 500; i++) {
      const x = r.x + rng() * r.w, y = r.y + rng() * r.h, l = r.h * (0.02 + rng() * 0.08);
      const v = 40 + rng() * 60;
      g.strokeStyle = `rgba(${v + 10},${v},${v * 0.8},0.6)`;
      g.lineWidth = 1 + rng() * 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 3, y + l); g.stroke();
    }
  };

  cluster('broad', { hue: 92, sat: 40, light: 27, count: 2600, size: 2.6, elong: 1.7, spread: 0.47 });
  cluster('fine', { hue: 100, sat: 38, light: 30, count: 3200, size: 2.0, elong: 1.5, spread: 0.47 });
  conifer('conifer');
  conifer('cypress', { narrow: true });
  pineBranch();
  palmFrond();
  bark();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasCache = { q: quality, tex };
  return tex;
}

/* ───────────────────────────── geometría ───────────────────────────── */

class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  uvOf(k, u, v) {
    const [x0, y0, x1, y1] = REG[k];
    // el lienzo tiene y hacia abajo; la textura usa flipY → v = 1 − y
    return [x0 + (x1 - x0) * u, 1 - (y0 + (y1 - y0) * (1 - v))];
  }
  /** Tarjeta: centro c, ejes r (ancho) y u (alto); normales mezcladas con la dirección «hacia fuera». */
  card(k, c, r, u, crownC, ao = 1, uvBox = [0, 0, 1, 1]) {
    const base = this.count;
    const n = new THREE.Vector3().crossVectors(r, u).normalize();
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    for (const [a, b] of corners) {
      const p = new THREE.Vector3().copy(c).addScaledVector(r, a).addScaledVector(u, b);
      this.pos.push(p.x, p.y, p.z);
      const out = crownC ? p.clone().sub(crownC).normalize() : n.clone();
      const nn = out.multiplyScalar(0.8).addScaledVector(n, 0.2 * Math.sign(n.dot(out) || 1)).normalize();
      this.nor.push(nn.x, nn.y, nn.z);
      const [uu, vv] = this.uvOf(k, uvBox[0] + (uvBox[2] - uvBox[0]) * (a + 0.5), uvBox[1] + (uvBox[3] - uvBox[1]) * (b + 0.5));
      this.uv.push(uu, vv);
      // oclusión: más oscuro abajo y hacia el interior de la copa
      let shade = ao;
      if (crownC) {
        const rel = p.y - crownC.y;
        shade *= 0.62 + 0.38 * THREE.MathUtils.clamp(0.5 + rel * 0.25, 0, 1);
      }
      this.col.push(shade, shade, shade);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Tronco cónico con textura de corteza. */
  trunk(r0, r1, y0, y1, seg = 5, k = 'bark') {
    const base = this.count;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (const [y, r, v] of [[y0, r0, 0], [y1, r1, 1]]) {
        this.pos.push(ca * r, y, sa * r);
        this.nor.push(ca, 0.15, sa);
        const [uu, vv] = this.uvOf(k, i / seg, v);
        this.uv.push(uu, vv);
        const sh = y === y0 ? 0.55 : 0.85;
        this.col.push(sh, sh, sh);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Base ortonormal de una tarjeta que mira en la dirección dir con un giro roll. */
function basis(dir, roll, w, h) {
  const n = dir.clone().normalize();
  const tmp = Math.abs(n.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  const r = new THREE.Vector3().crossVectors(tmp, n).normalize();
  const u = new THREE.Vector3().crossVectors(n, r).normalize();
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const r2 = r.clone().multiplyScalar(cr).addScaledVector(u, sr).multiplyScalar(w);
  const u2 = u.clone().multiplyScalar(cr).addScaledVector(r, -sr).multiplyScalar(h);
  return [r2, u2];
}

/** Copa redonda de tarjetas (frondosos, arbustos, chopos con ry alargado). */
function crown(b, k, center, rx, ry, cards, seed, cardScale = 1.05) {
  const rng = makeRng(seed);
  // núcleo: tres tarjetas grandes cruzadas que dan densidad desde cualquier ángulo
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    const [r, u] = basis(V(Math.cos(a), 0.15, Math.sin(a)), 0, rx * 1.9, ry * 1.9);
    b.card(k, center, r, u, center, 0.78);
  }
  // capa exterior: tarjetas repartidas por la superficie, mirando hacia fuera
  for (let i = 0; i < cards; i++) {
    // distribución de Fibonacci sobre la esfera (uniforme y sin agrupamientos)
    const t = (i + 0.5) / cards;
    const phi = Math.acos(1 - 2 * t * 0.92), th = i * 2.39996 + rng() * 0.4;
    const d = V(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
    const p = V(center.x + d.x * rx * 0.56, center.y + d.y * ry * 0.56, center.z + d.z * rx * 0.56);
    const s = (0.85 + rng() * 0.35) * cardScale;
    const [r, u] = basis(d.clone().add(V((rng() - 0.5) * 0.6, 0.2, (rng() - 0.5) * 0.6)), rng() * Math.PI * 2, rx * s, ry * s * (rx < ry ? 0.9 : 1));
    b.card(k, p, r, u, center, 1);
  }
}

/**
 * Geometría de árbol. detail 1 = cercano, 0 = lejano (pocas tarjetas).
 * Usa las mismas dimensiones (TREE_DIMS) que las colisiones.
 */
export function foliageTreeGeometry(variant, detail = 1) {
  const d = TREE_DIMS[variant] || TREE_DIMS.broadleaf;
  const b = new Builder();
  const hi = detail >= 1;
  switch (variant) {
    case 'pine':
    case 'cypress':
    case 'poplar': {
      // el álamo (chopo) es columnar como el ciprés pero más ancho y claro
      const cyp = variant !== 'pine';
      b.trunk(d.trunkR, d.trunkR * 0.3, -0.2, d.height * 0.6, hi ? 5 : 3);
      const y0 = Math.max(0.3, d.crownY0 - (cyp ? 0.2 : 0.8)), H = d.height - y0;
      const W = variant === 'poplar' ? d.crownR * 2.7 : cyp ? d.crownR * 2.3 : d.crownR * 2.2;
      const cards = hi ? 3 : 2;
      for (let i = 0; i < cards; i++) {
        const a = (i / cards) * Math.PI + 0.3;
        const horiz = V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(W);
        b.card(cyp ? 'cypress' : 'conifer', V(0, y0 + H / 2, 0), horiz, V(0, H, 0), V(0, y0 + H * 0.45, 0), 1);
      }
      if (hi && !cyp) {
        // ramas horizontales que dan volumen visto desde arriba
        for (let t = 0; t < 3; t++) {
          const f = 0.15 + t * 0.25, y = y0 + H * f * 0.9;
          const rad = d.crownR * (1 - f) * 1.1;
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + t;
            const dir = V(Math.cos(a), 0, Math.sin(a));
            b.card('pine', V(dir.x * rad * 0.5, y, dir.z * rad * 0.5), dir.clone().multiplyScalar(rad).add(V(0, -rad * 0.3, 0)), V(-dir.z, 0, dir.x).multiplyScalar(rad * 0.7), V(0, y + rad, 0), 0.85);
          }
        }
      }
      break;
    }
    case 'palm': {
      // tronco algo curvado en dos tramos
      b.trunk(d.trunkR * 1.15, d.trunkR * 0.95, -0.2, d.trunkH * 0.55, 5);
      const top = V(0, d.trunkH, 0);
      b.trunk(d.trunkR * 0.95, d.trunkR * 0.8, d.trunkH * 0.55, d.trunkH, 5);
      const fronds = hi ? 9 : 5;
      for (let i = 0; i < fronds; i++) {
        const a = (i / fronds) * Math.PI * 2;
        const dir = V(Math.cos(a), 0, Math.sin(a));
        const L = d.crownR * 1.5;
        // dos tramos: sube y luego cae
        const inner = dir.clone().multiplyScalar(L * 0.5).add(V(0, L * 0.18, 0));
        const outer = dir.clone().multiplyScalar(L * 0.42).add(V(0, -L * 0.5, 0));
        const side = V(-dir.z, 0, dir.x).multiplyScalar(L * 0.42);
        b.card('palm', top.clone().addScaledVector(inner, 0.5), inner, side, top, 0.95, [0, 0, 0.5, 1]);
        b.card('palm', top.clone().add(inner).addScaledVector(outer, 0.5), outer, side, top, 0.9, [0.5, 0, 1, 1]);
      }
      break;
    }
    case 'bush':
      crown(b, 'fine', V(0, d.crownR * 0.65, 0), d.crownR * 1.05, d.crownR * 0.75, hi ? 9 : 4, 77, 1.1);
      break;
    case 'broadleaf':
    default: {
      b.trunk(d.trunkR, d.trunkR * 0.55, -0.2, d.crownY0 + d.crownR * 0.6, hi ? 6 : 4);
      // ramas principales que salen del tronco hacia la copa
      const c = V(0, d.crownY0 + d.crownR * 0.95, 0);
      crown(b, 'broad', c, d.crownR * 1.05, d.crownR * 0.95, hi ? 18 : 7, 11, 0.95);
      break;
    }
  }
  return b.build();
}

/** Material del follaje: recorte por transparencia, doble cara con normales coherentes y viento. */
export function foliageMaterial(atlas, swayUniforms, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: atlas, vertexColors: true, roughness: 0.92, metalness: 0,
    alphaTest: 0.42, side: THREE.DoubleSide, alphaToCoverage: !!opts.alphaToCoverage,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swayUniforms.uTime;
    shader.uniforms.uWind = swayUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
        #else
          float ph = 0.0;
        #endif
        float hk = max(0.0, transformed.y - 1.5) * 0.014;
        float sw = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 3.7 + ph * 1.7) * 0.25;
        // aleteo fino de las hojas además del balanceo del árbol
        float flick = sin(uTime * 7.0 + position.x * 3.1 + position.z * 2.3 + ph) * 0.04 * hk * 40.0;
        transformed.x += (uWind.x * (0.6 + 0.4 * sw)) * hk + flick * 0.02;
        transformed.z += (uWind.y * (0.6 + 0.4 * sw)) * hk;
        transformed.y += flick * 0.015;`);
    // las dos caras usan la misma normal (la de la copa): sin caras oscuras al ver la tarjeta por detrás
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );\n  nonPerturbedNormal = normal;')
      // luz que atraviesa las hojas (translucidez): la copa no queda negra a contraluz
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.08;');
  };
  return mat;
}
