/**
 * Utilidades de composición de escenarios (granjas, casas, zonas de boxes).
 * Sólo generan descriptores; el renderizado y las colisiones se derivan de ellos.
 */
import { DEG } from '../utils/math3d.js';

const HOUSE_COLORS = ['#e8dcc8', '#f1e3c6', '#d9c7a7', '#ece6da', '#c9b79c', '#e6d2b5', '#f4efe6', '#d4b896'];
const ROOF_COLORS = ['#8b3a2b', '#9c4a30', '#6e3b2a', '#5a5f66', '#7b2f22', '#a0522d'];

export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/** Casa con tejado a dos aguas. */
export function addHouse(env, x, z, rot = 0, size = 1) {
  const r = env.rng;
  env.addProp({
    type: 'house', x, z, rot,
    w: (8 + r() * 4) * size, d: (7 + r() * 3) * size, h: (3 + r() * 2.5) * size, roofH: 2.6 * size,
    color: pick(r, HOUSE_COLORS), roofColor: pick(r, ROOF_COLORS), chimney: r() > 0.5,
  });
}

/** Granja: casa, galpón, silo, cercados y arbolado. */
export function addFarm(env, x, z, rot = 0) {
  const r = env.rng;
  const c = Math.cos(rot), s = Math.sin(rot);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  let [hx, hz] = at(0, 0);
  addHouse(env, hx, hz, rot);
  [hx, hz] = at(28, 4);
  env.addProp({ type: 'barn', x: hx, z: hz, rot, w: 16, d: 24, h: 6, roofH: 4, color: pick(r, ['#8e2b20', '#a33a2a', '#6b6f73', '#c5b18c']), roofColor: '#585d63' });
  [hx, hz] = at(40, -12);
  env.addProp({ type: 'silo', x: hx, z: hz, r: 3, h: 13, color: '#c9cdd1' });
  [hx, hz] = at(-14, 10);
  env.addProp({ type: 'tree', variant: 'broadleaf', x: hx, z: hz, scale: 1.2, rot: r() * 6, tint: r() });
  [hx, hz] = at(-10, -12);
  env.addProp({ type: 'tree', variant: 'broadleaf', x: hx, z: hz, scale: 1.0, rot: r() * 6, tint: r() });
  // corral
  const pts = [at(10, 18), at(55, 18), at(55, 50), at(10, 50)];
  for (let i = 0; i < 4; i++) {
    const [a0, b0] = pts[i], [a1, b1] = pts[(i + 1) % 4];
    env.fence(a0, b0, a1, b1, 'rail', 1.2);
  }
  env.thermalSources.push({ x, z });
}

/** Zona de boxes de un club: caseta, mesas, bancos, banderas y vehículos. */
export function addPitArea(env, x, z, heading = 0) {
  const rot = -heading * DEG;
  const c = Math.cos(rot), s = Math.sin(rot);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const r = env.rng;
  let [px, pz] = at(0, 0);
  env.addProp({ type: 'shelter', x: px, z: pz, rot, w: 14, d: 6, h: 2.8, roofH: 0.5, color: '#d6d2c4', roofColor: '#3d6b45' });
  for (let i = -2; i <= 2; i++) {
    [px, pz] = at(i * 5, -7);
    env.addProp({ type: 'table', x: px, z: pz, rot });
  }
  for (let i = -1; i <= 1; i++) {
    [px, pz] = at(i * 6 + 3, 6);
    env.addProp({ type: 'bench', x: px, z: pz, rot });
  }
  [px, pz] = at(-12, -4);
  env.addProp({ type: 'flag', x: px, z: pz, h: 7, color: '#ff6b00' });
  [px, pz] = at(12, -4);
  env.addProp({ type: 'flag', x: px, z: pz, h: 7, color: '#1e88e5' });
  [px, pz] = at(0, -7);
  return r;
}

export function addParking(env, x0, z0, rows, cols, rot = 0) {
  const r = env.rng;
  const colors = ['#c0392b', '#2c3e50', '#bdc3c7', '#ecf0f1', '#2980b9', '#7f8c8d', '#1c2833', '#f39c12', '#145a32'];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (r() < 0.3) continue;
      env.addProp({ type: 'car', x: x0 + j * 3.4, z: z0 + i * 7, rot: rot + (r() < 0.5 ? 0 : Math.PI), color: pick(r, colors) });
    }
  }
}
