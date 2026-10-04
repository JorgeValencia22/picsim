/**
 * Geometrías low-poly con color de vértice para los objetos del escenario y utilidades de
 * fusión (merge) de geometrías para reducir llamadas de dibujo.
 */
import * as THREE from 'three';
import { TREE_DIMS } from '../environments/EnvironmentBase.js';

const _c = new THREE.Color();

/** Asigna un color uniforme como atributo de vértice (convertido a no indexado). */
export function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  _c.set(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/** Fusiona geometrías (posición, normal, color) aplicando sus matrices. */
export function mergeColored(parts) {
  let total = 0;
  for (const p of parts) total += p.geo.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let off = 0;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { geo, matrix } of parts) {
    const P = geo.attributes.position, N = geo.attributes.normal, C = geo.attributes.color;
    nm.getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      pos[(off + i) * 3] = v.x; pos[(off + i) * 3 + 1] = v.y; pos[(off + i) * 3 + 2] = v.z;
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      nor[(off + i) * 3] = v.x; nor[(off + i) * 3 + 1] = v.y; nor[(off + i) * 3 + 2] = v.z;
      col[(off + i) * 3] = C.getX(i); col[(off + i) * 3 + 1] = C.getY(i); col[(off + i) * 3 + 2] = C.getZ(i);
    }
    off += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const M = (x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
};

function box(w, h, d, color, x = 0, y = 0, z = 0, ry = 0) {
  return { geo: colored(new THREE.BoxGeometry(w, h, d), color), matrix: M(x, y, z, ry) };
}

function cyl(r1, r2, h, color, x = 0, y = 0, z = 0, seg = 8, rx = 0, rz = 0) {
  return { geo: colored(new THREE.CylinderGeometry(r1, r2, h, seg), color), matrix: M(x, y, z, 0, 1, 1, 1, rx, rz) };
}

function gableRoof(w, d, h, color, y, overhang = 0.4) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2 - overhang, 0); s.lineTo(0, h); s.lineTo(d / 2 + overhang, 0); s.lineTo(-d / 2 - overhang, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: w + overhang * 2, bevelEnabled: false });
  geo.translate(0, 0, -(w + overhang * 2) / 2);
  geo.rotateY(Math.PI / 2);
  return { geo: colored(geo, color), matrix: M(0, y, 0) };
}

function archRoof(w, d, h, color, y) {
  const geo = new THREE.CylinderGeometry(1, 1, d, 14, 1, true, -Math.PI / 2, Math.PI);
  geo.rotateX(Math.PI / 2);
  geo.rotateZ(Math.PI / 2);
  geo.scale(1, 1, 1);
  const g = colored(geo, color);
  return { geo: g, matrix: M(0, y, 0, 0, w / 2, h, 1) };
}

/** Lista de piezas (en coordenadas locales del objeto) para un descriptor. */
export function propParts(p) {
  const parts = [];
  const win = '#2b3a48';
  switch (p.type) {
    case 'house': {
      parts.push(box(p.w, p.h, p.d, p.color, 0, p.h / 2, 0));
      parts.push(gableRoof(p.w, p.d, p.roofH, p.roofColor, p.h));
      // ventanas y puerta (frente y fondo)
      for (const side of [1, -1]) {
        for (let i = -1; i <= 1; i++) {
          if (i === 0 && side > 0) parts.push(box(1.0, 2.1, 0.08, '#5d4037', 0, 1.05, side * (p.d / 2 + 0.03)));
          else parts.push(box(1.1, 1.1, 0.08, win, i * p.w * 0.3, p.h * 0.58, side * (p.d / 2 + 0.03)));
        }
      }
      for (const side of [1, -1]) parts.push(box(0.08, 1.1, 1.1, win, side * (p.w / 2 + 0.03), p.h * 0.58, 0));
      if (p.chimney) parts.push(box(0.7, 2, 0.7, '#7b5e57', p.w * 0.25, p.h + p.roofH * 0.6, p.d * 0.15));
      break;
    }
    case 'shed':
      parts.push(box(p.w, p.h, p.d, p.color, 0, p.h / 2, 0));
      parts.push(gableRoof(p.w, p.d, p.roofH, p.roofColor, p.h));
      parts.push(box(1.6, 2.2, 0.08, '#3e2723', 0, 1.1, p.d / 2 + 0.03));
      break;
    case 'barn':
    case 'hangar': {
      parts.push(box(p.w, p.h, p.d, p.color, 0, p.h / 2, 0));
      parts.push(archRoof(p.w, p.d + 0.6, p.roofH, p.roofColor, p.h));
      const door = p.type === 'hangar' ? [p.w * 0.85, p.h * 0.92] : [p.w * 0.4, p.h * 0.7];
      parts.push(box(door[0], door[1], 0.1, p.type === 'hangar' ? '#455a64' : '#5d4037', 0, door[1] / 2, p.d / 2 + 0.05));
      break;
    }
    case 'shelter': {
      for (const [x, z] of [[-p.w / 2, -p.d / 2], [p.w / 2, -p.d / 2], [-p.w / 2, p.d / 2], [p.w / 2, p.d / 2]]) parts.push(cyl(0.08, 0.08, p.h, '#6d4c41', x, p.h / 2, z));
      parts.push(box(p.w + 0.6, 0.12, p.d + 0.8, p.roofColor, 0, p.h + 0.15, 0));
      parts.push(box(p.w, p.h * 0.8, 0.1, p.color, 0, p.h * 0.4, p.d / 2));
      parts.push(box(p.w * 0.9, 0.06, 1.0, '#a1887f', 0, 0.9, p.d / 2 - 0.6));
      break;
    }
    case 'booth':
      parts.push(box(p.w, p.h, p.d, p.color, 0, p.h / 2, 0));
      parts.push(box(p.w * 0.9, p.h * 0.35, 0.06, win, 0, p.h * 0.65, -p.d / 2 - 0.03));
      parts.push(box(p.w + 0.8, 0.15, p.d + 0.8, p.roofColor, 0, p.h + 0.1, 0));
      break;
    case 'stand':
      for (let i = 0; i < 5; i++) parts.push(box(p.w, 0.45, p.d / 5, i % 2 ? p.color : '#78909c', 0, 0.25 + i * 0.45, -p.d / 2 + (i + 0.5) * (p.d / 5)));
      parts.push(box(p.w, 0.12, p.d + 1, '#37474f', 0, p.h + 1.5, 0));
      for (const x of [-p.w / 2, p.w / 2]) parts.push(cyl(0.12, 0.12, p.h + 1.5, '#37474f', x, (p.h + 1.5) / 2, p.d / 2));
      break;
    case 'container':
      parts.push(box(p.w, p.h, p.d, p.color, 0, p.h / 2, 0));
      break;
    case 'silo':
      parts.push(cyl(p.r, p.r, p.h, p.color, 0, p.h / 2, 0, 14));
      parts.push({ geo: colored(new THREE.SphereGeometry(p.r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#b0bec5'), matrix: M(0, p.h, 0) });
      break;
    case 'church': {
      parts.push(box(p.w, p.h, p.d, p.color, 0, p.h / 2, 0));
      // tejado con la cumbrera a lo largo de la nave (eje Z)
      parts.push({ geo: gableRoof(p.d, p.w, p.roofH, p.roofColor, 0, 0.3).geo, matrix: M(0, p.h, 0, Math.PI / 2) });
      const tz = -(p.d / 2 + 2.5);
      parts.push(box(5, p.towerH, 5, p.color, 0, p.towerH / 2, tz));
      parts.push({ geo: colored(new THREE.ConeGeometry(3.8, 6, 4), p.roofColor), matrix: M(0, p.towerH + 3, tz, Math.PI / 4) });
      parts.push(box(0.25, 2.2, 0.25, '#424242', 0, p.towerH + 7, tz));
      parts.push(box(1.2, 0.25, 0.25, '#424242', 0, p.towerH + 7.4, tz));
      for (let i = -2; i <= 2; i++) parts.push(box(0.08, 2.2, 1.0, win, p.w / 2 + 0.03, p.h * 0.55, i * p.d * 0.18));
      break;
    }
    case 'tower':
      if (p.lighthouse) {
        for (let i = 0; i < 6; i++) parts.push(cyl(2.2 - i * 0.15, 2.3 - i * 0.15, p.h / 6, i % 2 ? '#c62828' : '#fafafa', 0, (i + 0.5) * (p.h / 6), 0, 14));
        parts.push(cyl(1.4, 1.4, 2.2, '#ffe082', 0, p.h + 1.1, 0, 10));
        parts.push({ geo: colored(new THREE.ConeGeometry(1.8, 1.8, 10), '#37474f'), matrix: M(0, p.h + 3.1, 0) });
      } else if (p.waterTower) {
        for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) parts.push(cyl(0.2, 0.2, p.h, '#78909c', x, p.h / 2, z));
        parts.push(cyl(4, 4, 5, p.color, 0, p.h + 2.5, 0, 16));
        parts.push({ geo: colored(new THREE.ConeGeometry(4.2, 2, 16), '#607d8b'), matrix: M(0, p.h + 6, 0) });
      } else parts.push(cyl(1.5, 2, p.h, p.color || '#bdbdbd', 0, p.h / 2, 0, 10));
      break;
    case 'table':
      parts.push(box(1.8, 0.05, 0.8, '#eceff1', 0, 0.75, 0));
      for (const [x, z] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) parts.push(cyl(0.025, 0.025, 0.75, '#616161', x, 0.375, z, 5));
      break;
    case 'bench':
      parts.push(box(1.8, 0.06, 0.4, '#8d6e63', 0, 0.45, 0));
      parts.push(box(1.8, 0.4, 0.05, '#8d6e63', 0, 0.75, -0.18));
      for (const x of [-0.8, 0.8]) parts.push(box(0.06, 0.45, 0.4, '#4e342e', x, 0.225, 0));
      break;
    case 'car': {
      parts.push(box(4.2, 0.8, 1.8, p.color, 0, 0.7, 0));
      parts.push(box(2.3, 0.65, 1.62, p.color, -0.2, 1.42, 0));
      parts.push(box(2.32, 0.5, 1.64, '#26323b', -0.2, 1.45, 0));
      for (const [x, z] of [[-1.35, -0.85], [1.35, -0.85], [-1.35, 0.85], [1.35, 0.85]]) parts.push(cyl(0.34, 0.34, 0.24, '#151515', x, 0.34, z, 10, Math.PI / 2));
      break;
    }
    case 'pole':
      parts.push(cyl(0.05, 0.06, p.h, p.color || '#eeeeee', 0, p.h / 2, 0, 6));
      break;
    case 'lamp':
      parts.push(cyl(0.08, 0.1, p.h, '#546e7a', 0, p.h / 2, 0, 6));
      break;
    case 'marker': {
      const n = 8;
      for (let i = 0; i < n; i++) parts.push(cyl(0.18, 0.18, p.h / n, i % 2 ? '#ffffff' : p.color, 0, (i + 0.5) * (p.h / n), 0, 8));
      parts.push(box(1.6, 1.0, 0.05, p.color, 0, p.h + 0.5, 0));
      break;
    }
    case 'groundMarker':
      parts.push(box(6, 0.05, 1.2, p.color, 0, 0.03, 0));
      parts.push(box(1.2, 0.05, 6, p.color, 0, 0.03, 0));
      break;
    case 'rock': {
      const geo = new THREE.DodecahedronGeometry(p.r, 0);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const f = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898 + p.x) * 43758.5453 % 1);
        pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.7, pos.getZ(i) * f);
      }
      geo.computeVertexNormals();
      parts.push({ geo: colored(geo, '#7d7770'), matrix: M(0, p.r * 0.25, 0, p.x) });
      break;
    }
    case 'fence': {
      const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(len / 3));
      const col = p.kind === 'mesh' ? '#9e9e9e' : p.kind === 'wire' ? '#795548' : '#8d6e63';
      for (let i = 0; i <= n; i++) parts.push(cyl(0.05, 0.05, p.height, col, -len / 2 + (i / n) * len, p.height / 2, 0, 5));
      if (p.kind === 'rail') { parts.push(box(len, 0.08, 0.06, '#a1887f', 0, p.height * 0.9, 0)); parts.push(box(len, 0.08, 0.06, '#a1887f', 0, p.height * 0.5, 0)); }
      else if (p.kind === 'mesh') parts.push(box(len, p.height * 0.9, 0.02, '#b0bec5', 0, p.height * 0.5, 0));
      else { parts.push(box(len, 0.015, 0.015, '#9e9e9e', 0, p.height * 0.85, 0)); parts.push(box(len, 0.015, 0.015, '#9e9e9e', 0, p.height * 0.5, 0)); }
      break;
    }
    case 'flag':
    case 'windsock':
      parts.push(cyl(0.05, 0.07, p.h, '#e0e0e0', 0, p.h / 2, 0, 6));
      break;
    default:
      break;
  }
  return parts.filter(Boolean);
}

/** Geometría de árbol con color de vértice. detail: 1 (alto) o 0 (bajo). */
export function treeGeometry(variant, detail = 1) {
  const d = TREE_DIMS[variant] || TREE_DIMS.broadleaf;
  const parts = [];
  const seg = detail ? 7 : 4;
  const trunkCol = '#5b4636';
  switch (variant) {
    case 'pine':
      parts.push(cyl(d.trunkR * 0.7, d.trunkR, d.trunkH + 1, trunkCol, 0, (d.trunkH + 1) / 2, 0, 5));
      for (let i = 0; i < (detail ? 3 : 1); i++) {
        const h = (d.height - d.crownY0) / (detail ? 2.2 : 1);
        const r = d.crownR * (1 - i * 0.25);
        parts.push({ geo: colored(new THREE.ConeGeometry(r, h, seg), i % 2 ? '#2f5a2e' : '#284f2a'), matrix: M(0, d.crownY0 + h / 2 + i * h * 0.55, 0) });
      }
      break;
    case 'cypress':
      parts.push(cyl(d.trunkR * 0.7, d.trunkR, d.trunkH + 0.5, trunkCol, 0, (d.trunkH + 0.5) / 2, 0, 5));
      parts.push({ geo: colored(new THREE.SphereGeometry(1, seg, detail ? 6 : 4), '#2d4a2b'), matrix: M(0, (d.height + d.crownY0) / 2, 0, 0, d.crownR, (d.height - d.crownY0) / 2, d.crownR) });
      break;
    case 'poplar':
      parts.push(cyl(d.trunkR * 0.6, d.trunkR, d.trunkH + 2, trunkCol, 0, (d.trunkH + 2) / 2, 0, 5));
      parts.push({ geo: colored(new THREE.SphereGeometry(1, seg, detail ? 7 : 4), '#4d7a35'), matrix: M(0, (d.height + d.crownY0) / 2, 0, 0, d.crownR, (d.height - d.crownY0) / 2, d.crownR) });
      break;
    case 'palm': {
      parts.push(cyl(d.trunkR * 0.8, d.trunkR * 1.2, d.trunkH, '#8d7a5b', 0, d.trunkH / 2, 0, 6));
      const leaves = detail ? 7 : 4;
      for (let i = 0; i < leaves; i++) {
        const a = (i / leaves) * Math.PI * 2;
        parts.push({ geo: colored(new THREE.BoxGeometry(3.2, 0.08, 0.7), '#4f7d2f'), matrix: M(Math.cos(a) * 1.4, d.trunkH + 0.2, Math.sin(a) * 1.4, -a, 1, 1, 1, 0, -0.35) });
      }
      break;
    }
    case 'bush':
      parts.push({ geo: colored(new THREE.IcosahedronGeometry(d.crownR, detail ? 1 : 0), '#4a6d2c'), matrix: M(0, d.crownR * 0.7, 0, 0, 1, 0.75, 1) });
      break;
    case 'broadleaf':
    default:
      parts.push(cyl(d.trunkR * 0.7, d.trunkR, d.trunkH + 1, trunkCol, 0, (d.trunkH + 1) / 2, 0, 5));
      if (detail) {
        parts.push({ geo: colored(new THREE.IcosahedronGeometry(d.crownR, 1), '#456f2b'), matrix: M(0, d.crownY0 + d.crownR * 0.9, 0) });
        parts.push({ geo: colored(new THREE.IcosahedronGeometry(d.crownR * 0.7, 1), '#3e6627'), matrix: M(d.crownR * 0.5, d.crownY0 + d.crownR * 1.4, 0.4) });
        parts.push({ geo: colored(new THREE.IcosahedronGeometry(d.crownR * 0.65, 0), '#4b7a30'), matrix: M(-d.crownR * 0.45, d.crownY0 + d.crownR * 1.3, -0.5) });
      } else parts.push({ geo: colored(new THREE.IcosahedronGeometry(d.crownR * 1.1, 0), '#456f2b'), matrix: M(0, d.crownY0 + d.crownR, 0) });
      break;
  }
  const g = mergeColored(parts);
  for (const p of parts) p.geo.dispose();
  return g;
}

/** Figura humana sencilla (dos partes de color: ropa superior y pantalón; cabeza aparte). */
export function personGeometry() {
  const upper = mergeColored([
    box(0.42, 0.6, 0.24, '#ffffff', 0, 1.2, 0),
    box(0.11, 0.55, 0.11, '#ffffff', -0.27, 1.2, 0),
    box(0.11, 0.55, 0.11, '#ffffff', 0.27, 1.2, 0),
  ]);
  const lower = mergeColored([
    box(0.16, 0.85, 0.16, '#ffffff', -0.1, 0.45, 0),
    box(0.16, 0.85, 0.16, '#ffffff', 0.1, 0.45, 0),
  ]);
  const head = mergeColored([
    { geo: colored(new THREE.SphereGeometry(0.12, 8, 6), '#e0b48c'), matrix: M(0, 1.64, 0) },
    box(0.05, 0.08, 0.05, '#e0b48c', 0, 1.52, 0),
  ]);
  return { upper, lower, head };
}
