/**
 * Generador de modelos 3D originales de aeronaves a partir del spec físico.
 *
 * - Fuselaje por solevado (loft) de secciones superelípticas con perfil propio de cada tipo.
 * - Alas y empenajes por solevado de perfiles NACA a lo largo de la MISMA geometría que usa la
 *   física (SurfaceGeometry), con las superficies de control como piezas articuladas en su
 *   línea de bisagra (alerones, flaps, profundidad, timón, cola en V, spoilers).
 * - Hélice con disco difuminado según las RPM, tren de aterrizaje con dirección, giro de
 *   ruedas y retracción, cabina, detalles y luces de navegación.
 * - Daños visuales (ala desprendida, hélice rota, tren colapsado) y piezas para escombros.
 * El grupo raíz tiene su origen en el CG y usa los ejes del cuerpo (+X morro, +Y arriba, +Z derecha).
 */
import * as THREE from 'three';
import { stationAt, spanDirAt, chordAt } from '../aircraft/SurfaceGeometry.js';
import { CHANNEL_AXIS } from '../aircraft/AeroModel.js';
import { liveryTexture, propDisc, softDot } from './TextureFactory.js';
import { DEG, clamp, smoothstep, lerp } from '../utils/math3d.js';

const AIRFOIL_THICKNESS = {
  clarkY: [0.12, 0.035], semiSym: [0.12, 0.02], symmetric: [0.12, 0], symThick: [0.15, 0], flatPlate: [0.02, 0],
  thermal: [0.09, 0.045], f3j: [0.085, 0.035], slope: [0.08, 0.015], scaleGlider: [0.11, 0.035], jet: [0.07, 0.005],
  warbird: [0.13, 0.02], stol: [0.15, 0.04], racer: [0.09, 0.01],
};

/** Perfil NACA de 4 cifras (puntos en cuerdas unitarias) restringido a [c0, c1]. */
function airfoilRing(t, m, c0, c1, n = 10) {
  const p = 0.4;
  const yt = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x) => (m === 0 ? 0 : x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x));
  const xs = [];
  for (let i = 0; i <= n; i++) {
    const s = c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos((i / n) * Math.PI));
    xs.push(s);
  }
  const ring = [];
  for (let i = n; i >= 0; i--) ring.push([xs[i], yc(xs[i]) + yt(xs[i]), xs[i]]); // superior: BS → BA
  for (let i = 1; i <= n; i++) ring.push([xs[i], yc(xs[i]) - yt(xs[i]), xs[i]]); // inferior: BA → BS
  return ring;
}

/**
 * Garantiza que una malla cerrada tenga las caras hacia fuera: si su volumen con signo
 * (respecto a su centro) es negativo, invierte el orden de todos los triángulos.
 * Evita superficies "transparentes" por culling de caras traseras.
 */
export function orientOutward(geo) {
  const p = geo.attributes.position, idx = geo.index.array;
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), x = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]).sub(c);
    b.fromBufferAttribute(p, idx[i + 1]).sub(c);
    d.fromBufferAttribute(p, idx[i + 2]).sub(c);
    vol += a.dot(x.crossVectors(b, d));
  }
  if (vol < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geo.index.needsUpdate = true;
  }
  return geo;
}

/** Camber en la cuerda x (para situar la bisagra). */
function camberAt(m, x) {
  const p = 0.4;
  if (m === 0) return 0;
  return x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
}

export class AircraftModel {
  /**
   * @param {object} spec    spec completo
   * @param {object} livery  { primary, secondary, accent, pattern, finish, registration, propColor, wheelColor }
   * @param {object} opts    { quality: 0..4, shadows: bool }
   */
  constructor(spec, livery, opts = {}) {
    this.spec = spec;
    this.livery = { ...spec.paint, ...livery };
    this.opts = opts;
    this.root = new THREE.Group();
    this.root.name = `aircraft-${spec.id}`;
    this.controls = [];
    this.spoilers = [];
    this.wheels = [];
    this.gearGroups = [];
    this.navLights = [];
    this.detachable = { wingL: [], wingR: [], hTail: [], vTail: [], prop: [] };
    this.disposables = [];
    this.cgX = spec.cgX;
    const [t, m] = AIRFOIL_THICKNESS[spec.airfoilKey] || [0.12, 0.02];
    this.thick = t;
    this.camber = m;
    this.buildMaterials();
    this.buildFuselage();
    for (const s of spec.surfaces) if (s.kind !== 'fuse') this.buildSurface(s);
    this.buildCanopy();
    this.buildPropulsion();
    this.buildGear();
    this.buildFeatures();
    this.buildLights();
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = opts.shadows !== false && !o.userData.noShadow;
        o.receiveShadow = false;
      }
    });
    this.wheelSpin = 0;
  }

  B(x, y, z) { return new THREE.Vector3(this.cgX - x, y, z); }

  buildMaterials() {
    const L = this.livery;
    const finish = { gloss: [0.32, 0.05], matte: [0.78, 0.0], metallic: [0.28, 0.65] }[L.finish] || [0.4, 0.05];
    const mk = (map, color = '#ffffff') => {
      const mat = new THREE.MeshStandardMaterial({ map, color, roughness: finish[0], metalness: finish[1] });
      this.disposables.push(mat);
      return mat;
    };
    const roundel = this.spec.id === 'spitfire' ? ['#1b2a5c', '#f2f2f2', '#b22222'] : this.spec.id === 'p51' ? ['#1e3a8a', '#f5f5f5'] : null;
    const cabin = this.spec.canopy === 'cabin';
    this.mats = {
      fuselage: mk(liveryTexture('fuselage', L, { cabin })),
      wingR: mk(liveryTexture('wing', L, { registration: true, roundel })),
      wingL: mk(liveryTexture('wing', L, { registration: true, mirror: true, roundel })),
      tail: mk(liveryTexture('tail', L, { number: this.spec.category === 'aerobatic' ? '7' : null })),
      accent: mk(null, L.accent),
      secondary: mk(null, L.secondary),
      dark: new THREE.MeshStandardMaterial({ color: '#1c1f24', roughness: 0.6, metalness: 0.2 }),
      metal: new THREE.MeshStandardMaterial({ color: '#a9b0b8', roughness: 0.3, metalness: 0.85 }),
      tire: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 }),
      hub: new THREE.MeshStandardMaterial({ color: L.wheelColor || '#d8d8d8', roughness: 0.4, metalness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: '#1a2a3a', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.78 }),
      prop: new THREE.MeshStandardMaterial({ color: L.propColor || '#1a1a1a', roughness: 0.5, side: THREE.DoubleSide }),
      spinner: new THREE.MeshStandardMaterial({ color: L.spinnerColor || L.accent, roughness: 0.3, metalness: 0.3 }),
      skin: new THREE.MeshStandardMaterial({ color: '#e0b48c', roughness: 0.8 }),
      helmet: new THREE.MeshStandardMaterial({ color: L.accent, roughness: 0.4 }),
      glow: new THREE.MeshBasicMaterial({ color: '#ff8a3c', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    for (const k of ['dark', 'metal', 'tire', 'hub', 'glass', 'prop', 'spinner', 'skin', 'helmet', 'glow']) this.disposables.push(this.mats[k]);
    this.baseColors = new Map();
  }

  addMesh(geo, mat, parent = this.root) {
    const mesh = new THREE.Mesh(geo, mat);
    parent.add(mesh);
    this.disposables.push(geo);
    return mesh;
  }

  /* ─────────────────────────────── Fuselaje ─────────────────────────────── */

  fuseProfile(t) {
    const shape = this.spec.fuseShape;
    const s = smoothstep;
    let w, top, bot, yc = 0, n;
    switch (shape) {
      case 'cabin':
        w = t < 0.1 ? lerp(0.62, 1, s(0, 0.1, t)) : t < 0.42 ? 1 : lerp(1, 0.16, s(0.42, 1, t));
        top = t < 0.1 ? lerp(0.62, 0.9, s(0, 0.1, t)) : t < 0.16 ? lerp(0.9, 1.22, s(0.1, 0.16, t)) : t < 0.38 ? 1.22 : lerp(1.22, 0.3, s(0.38, 1, t));
        bot = t < 0.1 ? lerp(0.7, 1, s(0, 0.1, t)) : t < 0.48 ? 1 : lerp(1, 0.2, s(0.48, 1, t));
        yc = t > 0.48 ? lerp(0, 0.45, s(0.48, 1, t)) : 0;
        n = 3.4;
        break;
      case 'round':
        w = t < 0.18 ? lerp(this.spec.features.includes('radialCowl') ? 0.92 : 0.6, 1, s(0, 0.18, t)) : t < 0.38 ? 1 : lerp(1, 0.14, s(0.38, 1, t));
        top = w * (t > 0.2 && t < 0.45 ? 1.05 : 1);
        bot = w;
        yc = t > 0.45 ? lerp(0, 0.3, s(0.45, 1, t)) : 0;
        n = 2.1;
        break;
      case 'jet':
        w = t < 0.32 ? Math.sqrt(s(0, 0.32, t)) * 0.98 + 0.02 : t < 0.78 ? 1 : lerp(1, 0.55, s(0.78, 1, t));
        top = w;
        bot = w * 0.95;
        n = 2.25;
        break;
      case 'pod':
        w = t < 0.14 ? lerp(0.35, 1, Math.sqrt(s(0, 0.14, t))) : t < 0.3 ? 1 : t < 0.5 ? lerp(1, 0.36, s(0.3, 0.5, t)) : lerp(0.36, 0.2, s(0.5, 1, t));
        top = w; bot = w;
        yc = t > 0.4 ? lerp(0, 0.25, s(0.4, 1, t)) : 0;
        n = 2;
        break;
      case 'racer':
        w = t < 0.25 ? lerp(0.35, 1, Math.sqrt(s(0, 0.25, t))) : t < 0.42 ? 1 : lerp(1, 0.12, s(0.42, 1, t));
        top = w; bot = w * 0.9;
        n = 2.2;
        break;
      case 'slim':
      default:
        w = t < 0.18 ? lerp(0.62, 1, s(0, 0.18, t)) : t < 0.38 ? 1 : lerp(1, 0.14, s(0.38, 1, t));
        top = t < 0.2 ? lerp(0.75, 1, s(0, 0.2, t)) : t < 0.42 ? 1 : lerp(1, 0.35, s(0.42, 1, t));
        bot = t < 0.18 ? lerp(0.8, 1, s(0, 0.18, t)) : t < 0.45 ? 1 : lerp(1, 0.25, s(0.45, 1, t));
        yc = t > 0.45 ? lerp(0, 0.3, s(0.45, 1, t)) : 0;
        n = 2.6;
        break;
    }
    return { w, top, bot, yc, n };
  }

  buildFuselage() {
    const spec = this.spec;
    const L = spec.length, W = spec.fuseW / 2, H = spec.fuseH / 2;
    if (spec.fuseShape === 'profile') return this.buildProfileFuselage();
    const NS = 34, NR = 26;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= NS; i++) {
      const t = i / NS;
      const pr = this.fuseProfile(t);
      const x = this.cgX - t * L;
      for (let j = 0; j <= NR; j++) {
        const v = j / NR;
        const phi = 2 * Math.PI * v - Math.PI / 2;
        const c = Math.cos(phi), sn = Math.sin(phi);
        const e = 2 / pr.n;
        const z = W * pr.w * Math.sign(c) * Math.abs(c) ** e;
        const yy = (sn >= 0 ? H * pr.top : H * pr.bot) * Math.sign(sn) * Math.abs(sn) ** e + pr.yc * H;
        pos.push(x, yy, z);
        uv.push(t, v);
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NR; j++) {
        const a = i * (NR + 1) + j, b = a + NR + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    // tapas de morro y cola (abanico al centro de cada anillo): el fuselaje queda cerrado
    for (const i of [0, NS]) {
      const t = i / NS;
      const pr = this.fuseProfile(t);
      const center = pos.length / 3;
      pos.push(this.cgX - t * L, pr.yc * H, 0);
      uv.push(t, 0.5);
      for (let j = 0; j < NR; j++) idx.push(center, i * (NR + 1) + j, i * (NR + 1) + j + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    orientOutward(geo);
    geo.computeVertexNormals();
    const mesh = this.addMesh(geo, this.mats.fuselage);
    mesh.name = 'fuselage';
    this.fuseMesh = mesh;
  }

  buildProfileFuselage() {
    const spec = this.spec;
    const L = spec.length, H = spec.fuseH, W = Math.max(0.006, spec.fuseW);
    const shape = new THREE.Shape();
    // contorno lateral (x hacia atrás → −X del cuerpo)
    const pts = [[0, -0.12], [0.02, 0.12], [0.3, 0.32], [0.42, 0.34], [0.52, 0.18], [0.92, 0.12], [1, 0.5], [1, -0.08], [0.6, -0.12], [0.3, -0.38], [0.12, -0.32]];
    pts.forEach(([u, v], i) => {
      const x = this.cgX - u * L, y = v * H;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
    geo.translate(0, 0, -W / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (this.cgX - p.getX(i)) / L, 0.25 + (p.getY(i) / H) * 0.25);
    const mesh = this.addMesh(geo, this.mats.fuselage);
    mesh.name = 'fuselage';
    this.fuseMesh = mesh;
    // bancada del motor
    const mount = this.addMesh(new THREE.BoxGeometry(0.06, 0.045, 0.045), this.mats.dark);
    mount.position.set(this.cgX - 0.02, 0, 0);
  }

  /* ─────────────────────────── Superficies sustentadoras ─────────────────────────── */

  surfaceMaterial(surf) {
    if (surf.kind === 'wing') return surf.side > 0 ? this.mats.wingR : this.mats.wingL;
    return this.mats.tail;
  }

  /** Solevado de un tramo de superficie entre [e0, e1] de envergadura y [c0, c1] de cuerda. */
  loft(surf, e0, e1, c0, c1, origin = null) {
    const t = surf.kind === 'wing' ? this.thick : Math.min(0.1, this.thick);
    const m = surf.kind === 'wing' ? this.camber : 0;
    const thick = this.spec.airfoilKey === 'flatPlate' ? 0.025 : (surf.sfg ? 0.02 : t);
    const ring0 = airfoilRing(thick, m, c0, c1, 9);
    const nSt = Math.max(2, Math.ceil((e1 - e0) * (surf.shape === 'elliptical' || surf.roundTip ? 16 : 8)) + 1);
    const R = ring0.length;
    const pos = [], uv = [], idx = [];
    for (let s = 0; s < nSt; s++) {
      let eta = e0 + ((e1 - e0) * s) / (nSt - 1);
      const st = stationAt(surf, eta);
      let chord = st.chord;
      let leX = st.le[0];
      // puntas redondeadas: la cuerda se reduce cerca de la punta
      if (surf.roundTip && eta > 0.9) {
        const k = Math.sqrt(Math.max(0.05, 1 - ((eta - 0.9) / 0.1) ** 2));
        leX += chord * (1 - k) * 0.5;
        chord *= k;
      }
      const sd = spanDirAt(surf, eta);
      // normal "arriba" del perfil: n0 = (s × x̂)·side = (0, s.z, −s.y)·side → (0, cosΓ, −side·sinΓ)
      const n0 = [0, sd[2] * surf.side, -sd[1] * surf.side];
      const tw = st.twist * DEG;
      const ct = Math.cos(tw), stw = Math.sin(tw);
      for (let k = 0; k < R; k++) {
        const [cx, cy, u] = ring0[k];
        const dx = (cx - 0.25) * chord, dy = cy * chord;
        const xr = dx * ct + dy * stw;
        const yr = -dx * stw + dy * ct;
        const X = leX + 0.25 * chord + xr;
        const Y = st.le[1] + yr * n0[1];
        const Z = st.le[2] + yr * n0[2];
        let bx = this.cgX - X, by = Y, bz = Z;
        if (origin) { bx -= origin.x; by -= origin.y; bz -= origin.z; }
        pos.push(bx, by, bz);
        uv.push(u, eta);
      }
    }
    for (let s = 0; s < nSt - 1; s++) {
      for (let k = 0; k < R; k++) {
        const a = s * R + k, b = s * R + ((k + 1) % R);
        const c = a + R, d = b + R;
        if (surf.side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
    }
    // tapas de los extremos
    const capRing = (s, flip) => {
      const base = pos.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < R; k++) { cx += pos[(s * R + k) * 3]; cy += pos[(s * R + k) * 3 + 1]; cz += pos[(s * R + k) * 3 + 2]; }
      pos.push(cx / R, cy / R, cz / R);
      uv.push(0.5, s === 0 ? e0 : e1);
      for (let k = 0; k < R; k++) {
        const a = s * R + k, b = s * R + ((k + 1) % R);
        if (flip) idx.push(base, b, a); else idx.push(base, a, b);
      }
    };
    capRing(0, surf.side > 0);
    capRing(nSt - 1, surf.side < 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    orientOutward(geo);
    geo.computeVertexNormals();
    return geo;
  }

  /** Punto de la línea de bisagra en η (cuerpo). */
  hingePoint(surf, eta, hc) {
    const st = stationAt(surf, eta);
    const sd = spanDirAt(surf, eta);
    const n0 = [0, sd[2] * surf.side, -sd[1] * surf.side];
    const tw = st.twist * DEG;
    const dx = (hc - 0.25) * st.chord, dy = camberAt(surf.kind === 'wing' ? this.camber : 0, hc) * st.chord;
    const xr = dx * Math.cos(tw) + dy * Math.sin(tw);
    const yr = -dx * Math.sin(tw) + dy * Math.cos(tw);
    const X = st.le[0] + 0.25 * st.chord + xr;
    return new THREE.Vector3(this.cgX - X, st.le[1] + yr * n0[1], st.le[2] + yr * n0[2]);
  }

  buildSurface(surf) {
    const mat = this.surfaceMaterial(surf);
    const controls = (surf.controls || []).filter((c) => c.type !== 'spoiler');
    const stab = controls.find((c) => c.type === 'stabilator');
    // grupo raíz de la superficie (los estabilizadores integrales giran enteros)
    let parent = this.root;
    let stabInfo = null;
    if (stab) {
      const piv = this.hingePoint(surf, 0, 0.3);
      const g = new THREE.Group();
      g.position.copy(piv);
      this.root.add(g);
      parent = g;
      stabInfo = { origin: piv };
      this.registerControl(surf, stab, g, piv, this.hingePoint(surf, 1, 0.3));
    }
    const bps = new Set([0, 1]);
    for (const c of controls) if (c.type !== 'stabilator') { bps.add(c.from ?? 0); bps.add(c.to ?? 1); }
    const detachEta = surf.kind === 'wing' ? 0.55 : null;
    if (detachEta) bps.add(detachEta);
    const sorted = [...bps].sort((a, b) => a - b);
    const groupFor = (eta) => {
      if (surf.kind === 'wing' && eta >= (detachEta ?? 2)) return surf.side > 0 ? 'wingR' : 'wingL';
      if (surf.kind === 'hTail') return 'hTail';
      if (surf.kind === 'vTail') return surf.sfg ? null : 'vTail';
      return null;
    };
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (b - a < 1e-4) continue;
      const mid = (a + b) / 2;
      const ctl = controls.find((c) => c.type !== 'stabilator' && mid >= (c.from ?? 0) && mid <= (c.to ?? 1));
      const aft = ctl ? 1 - ctl.chord : 1;
      const geo = this.loft(surf, a, b, 0, aft, stabInfo ? stabInfo.origin : null);
      const mesh = this.addMesh(geo, mat, parent);
      const grp = groupFor(mid);
      if (grp) this.detachable[grp].push(mesh);
    }
    for (const c of controls) {
      if (c.type === 'stabilator') continue;
      const hc = 1 - c.chord;
      const p0 = this.hingePoint(surf, c.from ?? 0, hc), p1 = this.hingePoint(surf, c.to ?? 1, hc);
      const pivot = new THREE.Group();
      pivot.position.copy(stabInfo ? p0.clone().sub(stabInfo.origin) : p0);
      parent.add(pivot);
      const geo = this.loft(surf, c.from ?? 0, c.to ?? 1, hc, 1, p0);
      const ctlMat = c.type === 'flap' ? mat : mat;
      const mesh = this.addMesh(geo, ctlMat, pivot);
      const grp = groupFor(((c.from ?? 0) + (c.to ?? 1)) / 2);
      if (grp) this.detachable[grp].push(mesh);
      this.registerControl(surf, c, pivot, p0, p1);
    }
    // spoilers / aerofrenos: placa sobre el extradós que se levanta
    const sp = (surf.controls || []).find((c) => c.type === 'spoiler');
    if (sp) {
      const e0 = sp.from, e1 = sp.to;
      const a = this.hingePoint(surf, e0, 0.45), b = this.hingePoint(surf, e1, 0.45);
      const chord = chordAt(surf, (e0 + e1) / 2);
      const len = a.distanceTo(b);
      const pivot = new THREE.Group();
      pivot.position.copy(a).add(new THREE.Vector3(0, this.thick * chord * 0.55, 0));
      const dir = b.clone().sub(a).normalize();
      pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.root.add(pivot);
      const plate = this.addMesh(new THREE.BoxGeometry(chord * 0.14, 0.004, len), this.mats.metal, pivot);
      plate.position.set(-chord * 0.07, 0, len / 2);
      this.spoilers.push({ pivot, dir });
    }
  }

  registerControl(surf, c, pivot, p0, p1) {
    // eje de giro tal que +δ lleve el borde de salida hacia −n (sustentación positiva)
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const sd = spanDirAt(surf, ((c.from ?? 0) + (c.to ?? 1)) / 2);
    const n = new THREE.Vector3(0, sd[2] * surf.side, -sd[1] * surf.side);
    const dTE = new THREE.Vector3(-1, 0, 0);
    const want = new THREE.Vector3().crossVectors(dTE, n.clone().negate());
    let axis = p1.clone().sub(p0);
    if (axis.lengthSq() < 1e-8) axis = want.clone();
    axis.normalize();
    if (axis.dot(want) < 0) axis.negate();
    // ganancias por canal (misma lógica que la física)
    const gains = {};
    for (const ch of c.channels || []) {
      if (ch === 'flap') gains.flap = 1;
      else if (ch === 'crowFlap') gains.airbrake = 1;
      else if (ch === 'crowAileron') gains.airbrake = (gains.airbrake || 0) - 0.45;
      else {
        const ax = CHANNEL_AXIS[ch];
        const m = new THREE.Vector3().crossVectors(mid, n);
        const d = m.x * ax[0] + m.y * ax[1] + m.z * ax[2];
        if (Math.abs(d) > 1e-3) gains[ch] = Math.sign(d);
      }
    }
    this.controls.push({ pivot, axis, max: (c.max || 20) * DEG, gains, type: c.type });
  }

  /* ─────────────────────────────── Cabina ─────────────────────────────── */

  buildCanopy() {
    const spec = this.spec;
    const L = spec.length, W = spec.fuseW / 2, H = spec.fuseH / 2;
    const style = spec.canopy;
    const pilot = (x, y, s = 1) => {
      const head = this.addMesh(new THREE.SphereGeometry(Math.min(W, H) * 0.42 * s, 10, 8), this.mats.helmet);
      head.position.set(x, y, 0);
      const body = this.addMesh(new THREE.SphereGeometry(Math.min(W, H) * 0.55 * s, 10, 8), this.mats.dark);
      body.scale.set(1, 0.7, 1.1);
      body.position.set(x - 0.01, y - Math.min(W, H) * 0.5 * s, 0);
    };
    if (style === 'bubble' || style === 'tandem' || style === 'glider') {
      const t0 = style === 'glider' ? 0.06 : spec.fuseShape === 'jet' ? 0.2 : 0.3;
      const len = (style === 'glider' ? 0.22 : style === 'tandem' ? 0.24 : 0.16) * L;
      const xc = t0 * L + len / 2;
      const pr = this.fuseProfile(xc / L);
      const geo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const can = this.addMesh(geo, this.mats.glass);
      can.scale.set(len / 2, H * (style === 'glider' ? 0.75 : 0.85), W * pr.w * 0.78);
      can.position.set(this.cgX - xc, H * pr.top * 0.82 + pr.yc * H, 0);
      can.userData.noShadow = true;
      if (style !== 'glider' || spec.span > 3) pilot(this.cgX - xc, H * pr.top * 0.95 + pr.yc * H, 0.85);
      if (style === 'tandem') pilot(this.cgX - xc - len * 0.3, H * pr.top * 0.95, 0.85);
    } else if (style === 'open') {
      const ws = this.addMesh(new THREE.PlaneGeometry(W * 1.4, H * 0.5), this.mats.glass);
      ws.position.set(this.cgX - 0.42 * L, H * 1.05, 0);
      ws.rotation.y = Math.PI / 2;
      ws.rotation.z = -0.4;
      pilot(this.cgX - 0.47 * L, H * 1.05, 0.9);
    } else if (style === 'cabin') {
      pilot(this.cgX - 0.24 * L, H * 0.95, 0.8);
    }
  }

  /* ─────────────────────────────── Propulsión ─────────────────────────────── */

  buildPropulsion() {
    const spec = this.spec, p = spec.prop;
    const H = spec.fuseH / 2, W = spec.fuseW / 2;
    this.propGroup = null;
    if (p.hasProp) {
      const R = p.dia / 2;
      const g = new THREE.Group();
      g.position.set(this.cgX - p.x + 0.01, p.y, 0);
      this.root.add(g);
      this.propGroup = g;
      const spinR = Math.min(W, H) * (spec.features.includes('radialCowl') ? 0.55 : 0.78) + 0.004;
      const spinPts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        spinPts.push(new THREE.Vector2(spinR * Math.sqrt(1 - t * t) + 0.001, t * spinR * 1.6));
      }
      const spinGeo = new THREE.LatheGeometry(spinPts, 18);
      spinGeo.rotateZ(-Math.PI / 2);
      const spinner = this.addMesh(spinGeo, this.mats.spinner, g);
      spinner.position.x = 0;
      // palas con torsión
      this.blades = new THREE.Group();
      g.add(this.blades);
      for (let b = 0; b < p.blades; b++) {
        const blade = this.makeBlade(R, spinR, spec.features.includes('foldingProp'));
        blade.rotation.x = (b / p.blades) * Math.PI * 2;
        this.blades.add(blade);
        this.detachable.prop.push(blade);
      }
      const disc = this.addMesh(new THREE.CircleGeometry(R, 32), new THREE.MeshBasicMaterial({ map: propDisc(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }), g);
      disc.rotation.y = Math.PI / 2;
      disc.position.x = 0.005;
      disc.userData.noShadow = true;
      this.disposables.push(disc.material);
      this.propDiscMesh = disc;
    } else if (p.type === 'turbine' || p.type === 'edf') {
      const L = spec.length;
      const pr = this.fuseProfile(1);
      const r = Math.min(W * pr.w, H * pr.top) * 0.9;
      const nozzle = this.addMesh(new THREE.CylinderGeometry(r * 0.85, r, 0.08 * L * 0.5, 18, 1, true), this.mats.metal);
      nozzle.rotation.z = Math.PI / 2;
      nozzle.position.set(this.cgX - L - 0.02 * L, pr.yc * H, 0);
      nozzle.material.side = THREE.DoubleSide;
      const inner = this.addMesh(new THREE.CircleGeometry(r * 0.8, 16), this.mats.dark);
      inner.rotation.y = -Math.PI / 2;
      inner.position.set(this.cgX - L + 0.01, pr.yc * H, 0);
      if (p.type === 'turbine') {
        const glow = this.addMesh(new THREE.ConeGeometry(r * 0.75, r * 4, 14, 1, true), this.mats.glow);
        glow.rotation.z = Math.PI / 2;
        glow.position.set(this.cgX - L - r * 2.1, pr.yc * H, 0);
        glow.userData.noShadow = true;
        this.exhaustGlow = glow;
      }
    }
  }

  makeBlade(R, hubR, folding) {
    const g = new THREE.Group();
    const n = 8;
    const pos = [], idx = [];
    const chordMax = R * 0.16;
    for (let i = 0; i <= n; i++) {
      const r = hubR * 0.6 + (R - hubR * 0.6) * (i / n);
      const t = i / n;
      const chord = chordMax * (0.55 + 0.75 * Math.sin(Math.min(1, t * 1.15) * Math.PI) * (1 - 0.6 * t)) + 0.004;
      const pitch = Math.atan2(0.15, (2 * Math.PI * r) / Math.max(R * 2, 0.1)) * 1.4 + 6 * DEG;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      // punto delantero y trasero de la sección (eje x = avance, eje z = tangencial)
      pos.push(sp * chord * 0.5, r, -cp * chord * 0.5);
      pos.push(-sp * chord * 0.5, r, cp * chord * 0.5);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = this.addMesh(geo, this.mats.prop, g);
    mesh.userData.folding = folding;
    g.userData.foldable = folding;
    return g;
  }

  /* ─────────────────────────────── Tren ─────────────────────────────── */

  buildGear() {
    const spec = this.spec;
    const H = spec.fuseH / 2, W = spec.fuseW / 2;
    for (const gp of spec.gearPoints) {
      const contact = this.B(gp.x, gp.y, gp.z);
      if (gp.kind === 'skid') {
        if (gp.role === 'main') {
          const sk = this.addMesh(new THREE.BoxGeometry(spec.length * 0.12, 0.01, Math.max(0.02, W * 0.4)), this.mats.dark);
          sk.position.copy(contact).add(new THREE.Vector3(0, 0.005, 0));
        }
        continue;
      }
      const r = gp.radius || 0.03;
      const attach = new THREE.Vector3(contact.x, gp.role === 'tail' ? contact.y + r + 0.02 : -H * 0.6, gp.role === 'main' ? Math.sign(gp.z) * Math.min(Math.abs(gp.z), W * 0.8) : 0);
      if (spec.wingPos === 'low' && gp.role === 'main') attach.set(contact.x, -H * 0.4, gp.z * 0.85);
      if (spec.gearType === 'mono') attach.set(contact.x, -H * 0.8, 0);
      const pivot = new THREE.Group();
      pivot.position.copy(attach);
      this.root.add(pivot);
      const steer = new THREE.Group();
      pivot.add(steer);
      const hub = contact.clone().add(new THREE.Vector3(0, r, 0)).sub(attach);
      // pata
      const legLen = hub.length();
      if (legLen > 0.01 && spec.gearType !== 'mono') {
        const leg = this.addMesh(new THREE.CylinderGeometry(0.006 + r * 0.08, 0.006 + r * 0.1, legLen, 6), this.mats.metal, steer);
        leg.position.copy(hub).multiplyScalar(0.5);
        leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hub.clone().normalize());
      }
      // rueda
      const wheel = new THREE.Group();
      wheel.position.copy(hub);
      steer.add(wheel);
      const tire = this.addMesh(new THREE.TorusGeometry(r * 0.72, r * 0.3, 8, 18), this.mats.tire, wheel);
      const rim = this.addMesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, r * 0.5, 12), this.mats.hub, wheel);
      rim.rotation.x = Math.PI / 2;
      void tire;
      if (spec.pants && gp.role !== 'tail') {
        const pant = this.addMesh(new THREE.SphereGeometry(1, 14, 10), this.mats.fuselage, steer);
        pant.scale.set(r * 1.9, r * 1.05, r * 0.65);
        pant.position.copy(hub).add(new THREE.Vector3(-r * 0.3, r * 0.15, 0));
      }
      this.wheels.push({ wheel, radius: r, id: gp.id });
      this.gearGroups.push({ pivot, steer, role: gp.role, side: Math.sign(gp.z), retract: gp.retract, steerDeg: gp.steer || 0 });
    }
  }

  /* ─────────────────────────────── Detalles ─────────────────────────────── */

  buildFeatures() {
    const spec = this.spec;
    const f = spec.features;
    const L = spec.length, W = spec.fuseW / 2, H = spec.fuseH / 2;
    const wing = spec.surfaces.find((s) => s.kind === 'wing' && s.side > 0);
    const cyl = (r1, r2, len, mat) => {
      const m = this.addMesh(new THREE.CylinderGeometry(r1, r2, len, 10), mat);
      return m;
    };
    if (f.includes('wingStruts') && wing) {
      for (const side of [1, -1]) {
        const tip = this.hingePoint({ ...wing, side, root: { ...wing.root, z: 0 } }, 0.6, 0.3);
        tip.z = side * Math.abs(tip.z);
        tip.y -= this.thick * 0.3;
        const base = new THREE.Vector3(this.cgX - (wing.root.x + wing.rootChord * 0.3), -H * 0.85, side * W * 0.9);
        const d = tip.clone().sub(base);
        const s = cyl(0.006, 0.006, d.length(), this.mats.metal);
        s.position.copy(base).addScaledVector(d, 0.5);
        s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      }
    }
    if (f.includes('cabaneStruts') && spec.biplane) {
      const up = spec.surfaces.find((s) => s.id === 'wingR'), lo = spec.surfaces.find((s) => s.id === 'wingR2');
      for (const side of [1, -1]) {
        for (const eta of [0.82]) {
          const a = this.hingePoint({ ...up, side }, eta, 0.35), b = this.hingePoint({ ...lo, side }, eta * 0.97, 0.35);
          a.z = side * Math.abs(a.z); b.z = side * Math.abs(b.z);
          const d = a.clone().sub(b);
          const s = cyl(0.008, 0.008, d.length(), this.mats.accent);
          s.position.copy(b).addScaledVector(d, 0.5);
          s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        }
        const cab = cyl(0.006, 0.006, up.root.y - H, this.mats.metal);
        cab.position.set(this.cgX - up.root.x - up.rootChord * 0.4, (up.root.y + H) / 2, side * W * 0.7);
      }
    }
    if (f.includes('radialCowl')) {
      const ring = this.addMesh(new THREE.TorusGeometry(Math.min(W, H) * 0.92, Math.min(W, H) * 0.12, 8, 24), this.mats.accent);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(this.cgX - 0.01, 0, 0);
      const face = this.addMesh(new THREE.CircleGeometry(Math.min(W, H) * 0.88, 20), this.mats.dark);
      face.rotation.y = Math.PI / 2;
      face.position.set(this.cgX - 0.005, 0, 0);
    }
    if (f.includes('tipTanks') && wing) {
      for (const side of [1, -1]) {
        const p = this.hingePoint({ ...wing, side }, 1, 0.3);
        p.z = side * Math.abs(p.z);
        const tank = this.addMesh(new THREE.CapsuleGeometry(wing.tipChord * 0.17, wing.tipChord * 1.2, 4, 10), this.mats.secondary);
        tank.rotation.z = Math.PI / 2;
        tank.position.copy(p).add(new THREE.Vector3(wing.tipChord * 0.15, 0, 0));
        this.detachable[side > 0 ? 'wingR' : 'wingL'].push(tank);
      }
    }
    if (f.includes('sideIntakes')) {
      for (const side of [1, -1]) {
        const it = this.addMesh(new THREE.CylinderGeometry(H * 0.42, H * 0.5, L * 0.22, 12, 1, false, 0, Math.PI), this.mats.fuselage);
        it.rotation.z = Math.PI / 2;
        it.rotation.x = side > 0 ? 0 : Math.PI;
        it.position.set(this.cgX - L * 0.36, -H * 0.05, side * W * 0.92);
        const hole = this.addMesh(new THREE.CircleGeometry(H * 0.38, 12, 0, Math.PI), this.mats.dark);
        hole.rotation.y = Math.PI / 2;
        hole.rotation.x = side > 0 ? 0 : Math.PI;
        hole.position.set(this.cgX - L * 0.25 + 0.002, -H * 0.05, side * W * 0.92);
      }
    }
    if (f.includes('ventralIntake')) {
      const it = this.addMesh(new THREE.BoxGeometry(L * 0.22, H * 0.55, W * 1.1), this.mats.fuselage);
      it.position.set(this.cgX - L * 0.38, -H * 1.05, 0);
      const hole = this.addMesh(new THREE.PlaneGeometry(W * 1.0, H * 0.45), this.mats.dark);
      hole.rotation.y = Math.PI / 2;
      hole.position.set(this.cgX - L * 0.27 + 0.003, -H * 1.05, 0);
    }
    if (f.includes('lex') && wing) {
      for (const side of [1, -1]) {
        const shape = new THREE.Shape();
        const x0 = this.cgX - wing.root.x, x1 = this.cgX - L * 0.18;
        shape.moveTo(x0, 0); shape.lineTo(x1, 0); shape.lineTo(x0, side * W * 1.7); shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(Math.PI / 2);
        const m = this.addMesh(geo, this.mats.fuselage);
        m.position.y = wing.root.y + 0.003;
        m.material.side = THREE.DoubleSide;
      }
    }
    if (f.includes('bellyScoop')) {
      const sc = this.addMesh(new THREE.SphereGeometry(1, 14, 10), this.mats.fuselage);
      sc.scale.set(L * 0.13, H * 0.45, W * 0.6);
      sc.position.set(this.cgX - L * 0.52, -H * 1.0, 0);
    }
    if (f.includes('exhaustStacks')) {
      for (const side of [1, -1]) for (let i = 0; i < 6; i++) {
        const st = this.addMesh(new THREE.BoxGeometry(0.012, 0.01, 0.012), this.mats.dark);
        st.position.set(this.cgX - L * (0.06 + i * 0.022), H * 0.35, side * W * 0.95);
      }
    }
    if (f.includes('radiators') && wing) {
      for (const side of [1, -1]) {
        const p = this.hingePoint({ ...wing, side }, 0.22, 0.4);
        p.z = side * Math.abs(p.z);
        const rad = this.addMesh(new THREE.BoxGeometry(wing.rootChord * 0.4, 0.035, 0.07), this.mats.fuselage);
        rad.position.copy(p).add(new THREE.Vector3(0, -0.03, 0));
      }
    }
    if (f.includes('muffler')) {
      const mf = cyl(0.014, 0.014, L * 0.08, this.mats.metal);
      mf.rotation.z = Math.PI / 2;
      mf.position.set(this.cgX - L * 0.07, -H * 0.2, W * 1.15);
    }
    if (f.includes('tunedPipe')) {
      const tp = this.addMesh(new THREE.CapsuleGeometry(0.018, L * 0.22, 4, 10), this.mats.metal);
      tp.rotation.z = Math.PI / 2;
      tp.position.set(this.cgX - L * 0.25, -H * 1.1, 0);
    }
    if (f.includes('cylinderHead')) {
      const ch = this.addMesh(new THREE.BoxGeometry(0.04, 0.05, 0.05), this.mats.metal);
      ch.position.set(this.cgX - L * 0.05, H * 0.6, W * 0.9);
    }
  }

  buildLights() {
    const tips = this.spec.surfaces.filter((s) => s.kind === 'wing' && !s.lower);
    const mk = (color, pos, size) => {
      const mat = new THREE.SpriteMaterial({ map: softDot(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.0 });
      this.disposables.push(mat);
      const sp = new THREE.Sprite(mat);
      sp.scale.setScalar(size);
      sp.position.copy(pos);
      this.root.add(sp);
      this.navLights.push(sp);
      return sp;
    };
    const s = Math.max(0.12, this.spec.span * 0.09);
    for (const w of tips) {
      const p = this.hingePoint(w, 1, 0.3);
      mk(w.side > 0 ? '60,255,90' : '255,50,40', p, s).userData.side = w.side;
    }
    mk('255,255,255', this.B(this.spec.length, 0.02, 0), s).userData.strobe = true;
  }

  /* ─────────────────────────────── Actualización ─────────────────────────────── */

  /**
   * @param {object} st { defl, propAngle, rpmFrac, gearPos, damage, throttle, wheelSpeed, time, night, destroyed }
   */
  update(st, dt) {
    const d = st.defl;
    for (const c of this.controls) {
      let v = 0;
      const g = c.gains;
      if (g.aileron) v += g.aileron * d.aileron;
      if (g.elevator) v += g.elevator * d.elevator;
      if (g.rudder) v += g.rudder * d.rudder;
      if (g.flap) v += g.flap * d.flap;
      if (g.airbrake) v += g.airbrake * d.airbrake;
      const ang = clamp(v, -1.2, 1.2) * c.max;
      c.pivot.quaternion.setFromAxisAngle(c.axis, ang);
    }
    for (const sp of this.spoilers) {
      sp.pivot.children[0].rotation.x = 0;
      sp.pivot.children[0].rotation.z = d.airbrake * 1.1;
    }
    // hélice: giro y disco difuminado
    if (this.propGroup) {
      const rpm = st.rpm || 0;
      this.propGroup.rotation.x = -(st.propAngle || 0);
      const blur = smoothstep(900, 3500, rpm);
      if (this.propDiscMesh) this.propDiscMesh.material.opacity = blur * 0.85 * (st.damage ? 0.3 + 0.7 * st.damage.prop : 1);
      const hideBlades = blur > 0.85;
      for (const b of this.blades.children) {
        b.visible = !hideBlades;
        if (b.userData.foldable) b.children[0].rotation.z = rpm < 600 ? -1.35 : 0;
      }
    }
    if (this.exhaustGlow) {
      this.mats.glow.opacity = clamp(st.rpmFrac - 0.3, 0, 1) * 0.55;
      this.exhaustGlow.scale.set(1, 0.6 + st.rpmFrac * 0.8, 1);
    }
    // tren: dirección, giro de ruedas y retracción
    this.wheelSpin += (st.wheelSpeed || 0) * dt;
    for (const w of this.wheels) w.wheel.rotation.z = -this.wheelSpin / w.radius;
    const gearCollapsed = st.damage && st.damage.gear < 0.35;
    for (const g of this.gearGroups) {
      if (g.steerDeg) g.steer.rotation.y = d.rudder * g.steerDeg * DEG * -1;
      let fold = g.retract ? (1 - st.gearPos) : 0;
      if (gearCollapsed) fold = Math.max(fold, 0.75);
      if (g.role === 'main') g.pivot.rotation.x = g.side * fold * Math.PI * 0.5;
      else g.pivot.rotation.z = fold * Math.PI * 0.5;
      g.pivot.visible = !(g.retract && st.gearPos < 0.03);
    }
    // daños: piezas desprendidas y hélice rota
    if (st.damage) {
      const dm = st.damage;
      for (const m of this.detachable.wingL) m.visible = !dm.lostWingL;
      for (const m of this.detachable.wingR) m.visible = !dm.lostWingR;
      if (this.blades) {
        const broken = dm.prop < 0.2;
        this.blades.children.forEach((b, i) => { b.scale.y = broken ? (i % 2 ? 0.35 : 0.55) : dm.prop < 0.6 ? 0.85 : 1; });
      }
    }
    // luces de navegación (visibles sobre todo de noche)
    const lightOp = st.night ? 1 : 0.12;
    for (const l of this.navLights) {
      if (l.userData.strobe) l.material.opacity = (Math.sin(st.time * 9) > 0.92 ? 1 : 0) * lightOp;
      else l.material.opacity = lightOp * 0.9;
    }
  }

  /** Mallas que se desprenden como escombros cuando la aeronave se destruye. */
  debrisParts() {
    return [...this.detachable.wingL, ...this.detachable.wingR, ...this.detachable.prop].filter((m) => m.visible);
  }

  dispose() {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
  }
}
