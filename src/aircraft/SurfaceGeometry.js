/**
 * Geometría compartida de superficies sustentadoras (alas, estabilizadores, derivas).
 * La usan tanto el modelo aerodinámico (para discretizar paneles) como el generador de
 * mallas 3D, de forma que lo que se ve es exactamente lo que vuela.
 *
 * Coordenadas "de taller": x hacia atrás desde el morro, y arriba, z hacia la derecha.
 */
import { DEG } from '../utils/math3d.js';

/** Cuerda en la estación η (0 = raíz, 1 = punta). */
export function chordAt(surf, eta) {
  const { rootChord: cr, tipChord: ct } = surf;
  if (surf.shape === 'elliptical') {
    const e = Math.sqrt(Math.max(0, 1 - eta * eta));
    return Math.max(ct, cr * e);
  }
  return cr + (ct - cr) * eta;
}

/** Dirección de envergadura (unitaria) del tramo que contiene η. */
export function spanDirAt(surf, eta, out = [0, 0, 0]) {
  let g = surf.dihedral;
  if (surf.polyhedral && eta > surf.polyhedral.at) g += surf.polyhedral.angle;
  const r = g * DEG;
  out[0] = 0;
  out[1] = Math.sin(r);
  out[2] = surf.side * Math.cos(r);
  return out;
}

/** Distancia vertical/lateral de la línea de envergadura en η (con poliedro). */
function spanOffset(surf, eta, out) {
  const d = eta * surf.span;
  const g1 = surf.dihedral * DEG;
  if (!surf.polyhedral || eta <= surf.polyhedral.at) {
    out[1] = Math.sin(g1) * d;
    out[2] = surf.side * Math.cos(g1) * d;
    return out;
  }
  const d1 = surf.polyhedral.at * surf.span;
  const g2 = (surf.dihedral + surf.polyhedral.angle) * DEG;
  out[1] = Math.sin(g1) * d1 + Math.sin(g2) * (d - d1);
  out[2] = surf.side * (Math.cos(g1) * d1 + Math.cos(g2) * (d - d1));
  return out;
}

/**
 * Estación de la superficie en η: borde de ataque (coords de taller), cuerda y torsión.
 * @returns {{le:number[], chord:number, twist:number}}
 */
export function stationAt(surf, eta) {
  const chord = chordAt(surf, eta);
  const off = spanOffset(surf, eta, [0, 0, 0]);
  let leX;
  if (surf.shape === 'elliptical') {
    // línea del 25% de cuerda recta (ala elíptica clásica)
    leX = surf.root.x + 0.25 * surf.rootChord - 0.25 * chord + eta * surf.span * Math.tan((surf.sweep || 0) * DEG);
  } else {
    leX = surf.root.x + eta * surf.span * Math.tan((surf.sweep || 0) * DEG);
  }
  return {
    le: [leX, surf.root.y + off[1], surf.root.z + off[2]],
    chord,
    twist: (surf.incidence || 0) - (surf.washout || 0) * eta,
  };
}

/** Área de un tramo [eta0, eta1] de la superficie (integración de Simpson). */
export function segmentArea(surf, eta0, eta1) {
  const cm = chordAt(surf, (eta0 + eta1) / 2);
  return ((chordAt(surf, eta0) + 4 * cm + chordAt(surf, eta1)) / 6) * (eta1 - eta0) * surf.span;
}

/** Área total de una superficie (una mitad si es simétrica). */
export function surfaceArea(surf) {
  let a = 0;
  const n = 16;
  for (let i = 0; i < n; i++) a += segmentArea(surf, i / n, (i + 1) / n);
  return a;
}

/** Cuerda media aerodinámica y posición x de su borde de ataque (para una semiala). */
export function meanAeroChord(surf) {
  const n = 40;
  let a = 0, c2 = 0, xle = 0;
  for (let i = 0; i < n; i++) {
    const eta = (i + 0.5) / n;
    const st = stationAt(surf, eta);
    const dA = st.chord * (surf.span / n);
    a += dA;
    c2 += st.chord * dA;
    xle += st.le[0] * dA;
  }
  return { mac: c2 / a, macLeX: xle / a, area: a };
}

/** Fracción del tramo [eta0, eta1] cubierta por un control definido en [from, to]. */
export function coverage(eta0, eta1, from, to) {
  const lo = Math.max(eta0, from), hi = Math.min(eta1, to);
  return hi > lo ? (hi - lo) / (eta1 - eta0) : 0;
}
