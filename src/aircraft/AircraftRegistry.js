/**
 * Registro de aeronaves: completa la geometría a partir de la base de datos, calcula el punto
 * neutro, el CG, la inercia, los puntos de contacto y las prestaciones estimadas con el MISMO
 * modelo aerodinámico de la simulación. También gestiona aeronaves personalizadas del editor.
 *
 * Arquitectura ampliable: para añadir helicópteros o multirrotores bastaría con registrar una
 * nueva categoría con su propio constructor de spec y clase de física (ver README).
 */
import { AIRCRAFT_DATA, AIRFOILS } from '../data/aircraftData.js';
import { meanAeroChord, surfaceArea, stationAt } from './SurfaceGeometry.js';
import { buildAeroModel, computeNeutralPoint, evaluateAero, makeAeroOut } from './AeroModel.js';
import { Propulsion } from './Propulsion.js';
import { AircraftPhysics } from './AircraftPhysics.js';
import { Autopilot } from './Autopilot.js';
import { Vec3, DEG, clamp } from '../utils/math3d.js';

const G = 9.80665;
/** Régimen de crucero de referencia para la ficha técnica. */
const CRUISE_THROTTLE = 0.7;

const CATEGORY_DEFAULTS = {
  trainer: { kRoll: 0.17, kPitch: 0.2, stallWidth: 4, wingX: 0.25, downThrust: 2, rightThrust: 1.5 },
  aerobatic: { kRoll: 0.15, kPitch: 0.19, stallWidth: 2.5, wingX: 0.25, downThrust: 0, rightThrust: 2 },
  glider: { kRoll: 0.21, kPitch: 0.2, stallWidth: 3, wingX: 0.27, downThrust: 1, rightThrust: 0 },
  jet: { kRoll: 0.13, kPitch: 0.22, stallWidth: 3.5, wingX: 0.37, downThrust: 0, rightThrust: 0 },
  classic: { kRoll: 0.16, kPitch: 0.2, stallWidth: 3, wingX: 0.25, downThrust: 1.5, rightThrust: 1.5 },
};

const FUSE_DRAG = { cabin: 0.3, slim: 0.2, round: 0.18, jet: 0.12, pod: 0.1, racer: 0.1, profile: 0.9 };
const FUSE_PLATE = { cabin: 0.6, slim: 0.55, round: 0.5, jet: 0.5, pod: 0.45, racer: 0.5, profile: 1.0 };

/** Límites del editor de aeronaves (mínimo, máximo) para cada modificador. */
export const EDITOR_LIMITS = {
  massScale: [0.6, 1.8],
  cgShift: [-0.15, 0.2], // fracción de la CMA (+ = CG hacia atrás)
  chordScale: [0.75, 1.3],
  powerScale: [0.4, 1.8],
  throwScale: [0.5, 1.5],
  flapMax: [0, 60],
  dragScale: [0.7, 1.6],
  inertiaScale: [0.6, 1.6],
  servoScale: [0.5, 2],
};

/**
 * Construye el spec completo de una aeronave.
 * @param {object} entry  entrada de AIRCRAFT_DATA
 * @param {object} mods   modificadores del editor (opcional)
 */
export function buildFullSpec(entry, mods = {}) {
  const d = structuredClone(entry);
  const cat = CATEGORY_DEFAULTS[d.category] || CATEGORY_DEFAULTS.trainer;
  const m = { massScale: 1, cgShift: 0, chordScale: 1, powerScale: 1, throwScale: 1, dragScale: 1, inertiaScale: 1, servoScale: 1, ...mods };

  const airfoilKey = m.airfoil && AIRFOILS[m.airfoil] ? m.airfoil : d.airfoil;
  const airfoil = { ...AIRFOILS[airfoilKey] };
  const mass = d.mass * m.massScale;
  const L = d.length, W = d.fuseW, H = d.fuseH;
  const span = d.span;
  const root = d.root * m.chordScale, tip = d.tip * m.chordScale;
  const dragScale = (d.dragScale || 1) * m.dragScale;
  const tw = m.throwScale;

  // ── posición vertical del ala
  // ala alta: apoyada sobre el techo de la cabina (el perfil 'cabin' sube a 1,22·H en la zona del ala)
  const wingY = { high: H * (d.fuseShape === 'cabin' ? 1.2 : 0.5), shoulder: H * 0.32, mid: 0, low: -H * 0.4 }[d.wingPos] ?? 0;
  const wingX = (d.wingX ?? cat.wingX) * L;

  const surfaces = [];
  const stallWidth = cat.stallWidth;
  const hasAil = !!d.ailerons, hasFlap = !!d.flaps, hasSpoiler = !!d.spoilers;
  const crow = !!d.crow && hasFlap;

  function wingControls(isLower = false) {
    const c = [];
    if (hasAil) c.push({ type: 'aileron', channels: crow ? ['aileron', 'crowAileron'] : ['aileron'], from: d.ailerons.from, to: d.ailerons.to, chord: d.ailerons.chord, max: d.ailerons.max * tw });
    if (hasFlap && !isLower) {
      const fm = m.flapMax ?? d.flaps.max;
      c.push({ type: 'flap', channels: crow ? ['flap', 'crowFlap'] : ['flap'], from: d.flaps.from, to: d.flaps.to, chord: d.flaps.chord, max: fm });
    }
    if (hasSpoiler && !isLower) c.push({ type: 'spoiler', from: d.spoilers.from, to: d.spoilers.to });
    return c;
  }

  const wingBase = {
    kind: 'wing', rootChord: root, tipChord: tip, shape: d.wingShape === 'elliptical' ? 'elliptical' : 'trapezoid',
    sweep: d.sweep || 0, incidence: d.category === 'glider' ? 1.5 : (d.category === 'aerobatic' ? 0 : 1), washout: d.washout || 0,
    airfoil, stallWidth, plate: 0.9, oswald: 0.8, roundTip: !!d.wingTipRound,
  };
  if (d.biplane) {
    const bp = d.biplane;
    const upperY = H * 0.5 + bp.gap * 0.35;
    const lowerY = upperY - bp.gap;
    const lowerSpan = span * bp.lowerSpan;
    for (const side of [1, -1]) {
      surfaces.push({ ...wingBase, id: side > 0 ? 'wingR' : 'wingL', group: side > 0 ? 'wingR' : 'wingL', side, root: { x: wingX, y: upperY, z: 0 }, span: span / 2, dihedral: bp.upperDihedral ?? 0, panels: 3, controls: wingControls(), oswald: 0.72 });
      surfaces.push({ ...wingBase, id: side > 0 ? 'wingR2' : 'wingL2', group: side > 0 ? 'wingR' : 'wingL', side, root: { x: wingX + bp.stagger, y: lowerY, z: 0 }, span: lowerSpan / 2, dihedral: bp.lowerDihedral ?? 0, sweep: 0, panels: 3, controls: wingControls(true), oswald: 0.72, lower: true });
    }
  } else {
    for (const side of [1, -1]) {
      surfaces.push({
        ...wingBase, id: side > 0 ? 'wingR' : 'wingL', group: side > 0 ? 'wingR' : 'wingL', side,
        root: { x: wingX, y: wingY, z: 0 }, span: span / 2, dihedral: d.dihedral || 0, polyhedral: d.polyhedral || null,
        panels: 4, controls: wingControls(),
      });
    }
  }
  const wings = surfaces.filter((s) => s.kind === 'wing');
  const wingArea = wings.reduce((a, s) => a + surfaceArea(s), 0);
  const mainWing = wings[0];
  const { mac, macLeX } = meanAeroChord(mainWing);
  const ar = d.biplane ? (span * span) / (wingArea / 2) : (span * span) / wingArea;
  for (const w of wings) w.ar = d.biplane ? ar * 0.85 : ar;
  const wingAcX = d.biplane ? macLeX + d.biplane.stagger * 0.5 + 0.25 * mac : macLeX + 0.25 * mac;

  // ── dimensionado de cola por coeficientes de volumen
  const t = d.tail;
  const tailType = t.type || 'conventional';
  const sweepH = t.sweepH ?? (d.category === 'jet' ? 30 : 8);
  const sweepV = t.sweepV ?? (d.category === 'jet' ? 40 : 28);
  const elevChord = tailType === 'allmoving' ? 1 : (t.elevChord ?? 0.38);
  const rudChord = t.rudChord ?? 0.42;
  const arH = tailType === 'allmoving' ? 3.6 : 4.2, lamH = 0.62;
  const arV = 1.5, lamV = 0.55;

  let Sh = 0.2 * wingArea, Sv = 0.08 * wingArea, chr = 0, cvr = 0, spanH = 0, hV = 0;
  for (let it = 0; it < 4; it++) {
    spanH = Math.sqrt(Sh * arH);
    chr = (2 * Sh) / (spanH * (1 + lamH));
    hV = Math.sqrt(Sv * arV);
    cvr = (2 * Sv) / (hV * (1 + lamV));
    const xh = L - chr * 0.95 + 0.25 * chr * 0.85;
    const xv = L - cvr * 0.98 + 0.3 * cvr;
    const lt = Math.max(0.2 * L, xh - wingAcX);
    const lv = Math.max(0.2 * L, xv - wingAcX);
    Sh = (t.vh * wingArea * mac) / lt;
    Sv = (t.vv * wingArea * span) / lv;
  }
  const tailAirfoil = { cl0: 0, clMax: 1.05, clMin: -1.05, cd0: 0.011 };
  const elevMax = t.elevMax * tw * (tailType === 'allmoving' ? 0.65 : 1);
  const rudMax = t.rudMax * tw;
  const tailBase = { airfoil: tailAirfoil, stallWidth: 3, plate: 0.9, oswald: 0.7, efficiency: 0.92, shape: 'trapezoid', roundTip: !!t.rounded };

  const finRootX = L - cvr * 0.98;
  if (tailType === 'V') {
    const angle = t.vAngle ?? 35;
    const sEach = (Sh + Sv) / 2 * 1.05;
    const spanV = Math.sqrt(sEach * 2 * 4) / 2;
    const cr = (2 * sEach) / (spanV * (1 + lamH));
    for (const side of [1, -1]) {
      surfaces.push({ ...tailBase, kind: 'hTail', id: side > 0 ? 'vtailR' : 'vtailL', group: 'hTail', side, root: { x: L - cr * 0.98, y: H * 0.15, z: 0 }, span: spanV, rootChord: cr, tipChord: cr * lamH, sweep: sweepH + 8, dihedral: angle, incidence: 0, panels: 2, ar: 4, controls: [{ type: 'ruddervator', channels: ['elevator', 'rudder'], from: 0.05, to: 0.95, chord: elevChord, max: Math.max(elevMax, rudMax) }] });
    }
  } else {
    // deriva(s)
    if (tailType === 'twin') {
      const cant = t.cant ?? 20;
      for (const side of [1, -1]) {
        const s2 = Sv * 0.58;
        const h2 = Math.sqrt(s2 * arV);
        const c2 = (2 * s2) / (h2 * (1 + lamV));
        surfaces.push({ ...tailBase, kind: 'vTail', id: side > 0 ? 'finR' : 'finL', group: 'vTail', side, root: { x: L - c2 * 1.25, y: H * 0.35, z: side * W * 0.38 }, span: h2, rootChord: c2, tipChord: c2 * lamV, sweep: sweepV, dihedral: 90 - cant, incidence: 0, panels: 2, ar: arV * 1.6, controls: [{ type: 'rudder', channels: ['rudder'], from: 0.05, to: 0.9, chord: rudChord, max: rudMax }] });
      }
    } else {
      surfaces.push({ ...tailBase, kind: 'vTail', id: 'fin', group: 'vTail', side: 1, root: { x: finRootX, y: H * 0.3, z: 0 }, span: hV, rootChord: cvr, tipChord: cvr * lamV, sweep: sweepV, dihedral: 90, incidence: 0, panels: 2, ar: arV * 1.7, controls: [{ type: 'rudder', channels: ['rudder'], from: 0.0, to: 0.95, chord: rudChord, max: rudMax }], tTail: tailType === 'T' });
    }
    // estabilizador horizontal
    let hx = L - chr * 0.95, hy = d.category === 'jet' ? 0 : H * 0.12;
    if (tailType === 'T') {
      const finTip = stationAt(surfaces[surfaces.length - 1], 1);
      hx = finTip.le[0] + finTip.chord * 0.1;
      hy = finTip.le[1];
    }
    if (tailType === 'twin') hx = L - chr * 0.85;
    const ctl = tailType === 'allmoving'
      ? { type: 'stabilator', channels: ['elevator'], from: 0, to: 1, chord: 1, max: elevMax }
      : { type: 'elevator', channels: ['elevator'], from: 0.04, to: 0.96, chord: elevChord, max: elevMax };
    for (const side of [1, -1]) {
      surfaces.push({ ...tailBase, kind: 'hTail', id: side > 0 ? 'stabR' : 'stabL', group: 'hTail', side, root: { x: hx, y: hy, z: 0 }, span: spanH / 2, rootChord: chr, tipChord: chr * lamH, sweep: sweepH, dihedral: d.category === 'jet' && tailType === 'allmoving' ? -6 : 0, incidence: 0, panels: 2, ar: arH, controls: [ctl] });
    }
  }

  // placas de deriva en las puntas (aviones 3D de perfil): aumentan la fuerza lateral
  if ((d.features || []).includes('sideForcePlates')) {
    for (const side of [1, -1]) {
      surfaces.push({ kind: 'vTail', id: side > 0 ? 'sfgR' : 'sfgL', group: side > 0 ? 'wingR' : 'wingL', side: 1, root: { x: wingX + root * 0.1, y: -0.06, z: side * span / 2 }, span: 0.12, rootChord: tip * 0.8, tipChord: tip * 0.8, sweep: 0, dihedral: 90, incidence: 0, panels: 1, ar: 0.6, airfoil: { cl0: 0, clMax: 0.8, clMin: -0.8, cd0: 0.015 }, stallWidth: 5, plate: 1, oswald: 0.6, shape: 'trapezoid', controls: [], sfg: true });
    }
  }

  // ── fuselaje: placas laterales delantera/trasera y placa superior (fuerza lateral, knife-edge,
  //    amortiguamiento en guiñada y resistencia de flujo cruzado)
  const plate = FUSE_PLATE[d.fuseShape] ?? 0.55;
  const fuseAirfoil = { cl0: 0, clMax: d.fuseShape === 'profile' ? 0.9 : 0.5, clMin: d.fuseShape === 'profile' ? -0.9 : -0.5, cd0: 0 };
  const sideH = d.fuseShape === 'profile' ? H : H * 0.9;
  surfaces.push({ kind: 'fuse', id: 'fuseF', group: 'fuselage', side: 1, root: { x: 0.02 * L, y: -sideH / 2, z: 0 }, span: sideH, rootChord: 0.45 * L, tipChord: 0.45 * L, sweep: 0, dihedral: 90, incidence: 0, panels: 1, ar: Math.max(0.15, (2 * sideH) / (0.45 * L)), airfoil: fuseAirfoil, stallWidth: 8, plate, oswald: 0.5, shape: 'trapezoid', controls: [], washable: true });
  surfaces.push({ kind: 'fuse', id: 'fuseR', group: 'fuselage', side: 1, root: { x: 0.47 * L, y: -sideH * 0.38, z: 0 }, span: sideH * 0.75, rootChord: 0.5 * L, tipChord: 0.5 * L, sweep: 0, dihedral: 90, incidence: 0, panels: 1, ar: Math.max(0.15, (2 * sideH * 0.75) / (0.5 * L)), airfoil: fuseAirfoil, stallWidth: 8, plate, oswald: 0.5, shape: 'trapezoid', controls: [], washable: true });
  const topW = Math.max(W, 0.04);
  surfaces.push({ kind: 'fuse', id: 'fuseT', group: 'fuselage', side: 1, root: { x: 0.1 * L, y: 0, z: -topW / 2 }, span: topW, rootChord: 0.75 * L, tipChord: 0.75 * L, sweep: 0, dihedral: 0, incidence: 0, panels: 1, ar: Math.max(0.1, (2 * topW) / (0.75 * L)), airfoil: { cl0: 0, clMax: 0.4, clMin: -0.4, cd0: 0 }, stallWidth: 8, plate: plate * 0.8, oswald: 0.5, shape: 'trapezoid', controls: [] });

  const features = d.features || [];
  const frontal = d.fuseShape === 'profile' ? 0.012 * H + 0.15 * W * H : (['cabin', 'slim'].includes(d.fuseShape) ? 0.82 * W * H : (Math.PI / 4) * W * H);
  let fuseCd = FUSE_DRAG[d.fuseShape] ?? 0.2;
  if (features.includes('radialCowl')) fuseCd += 0.08;
  if (features.includes('wingStruts')) fuseCd += 0.05;
  if (features.includes('cabaneStruts')) fuseCd += 0.12;
  if (features.includes('tipTanks')) fuseCd += 0.04;
  if (d.canopy === 'open') fuseCd += 0.05;

  // ── propulsión
  const pr = { ...d.prop };
  const isJet = pr.type === 'turbine' || pr.type === 'edf';
  pr.hasProp = ['electric', 'glow2', 'glow4', 'gas'].includes(pr.type);
  if (pr.type !== 'none') {
    pr.thrust *= m.powerScale;
    pr.power = (pr.power || 0) * m.powerScale;
  }
  pr.idle = pr.idle ?? (pr.type === 'turbine' ? 0.3 : 0);
  pr.spool = pr.spool ?? 0.15;
  pr.x = isJet ? L * 0.97 : -0.02;
  pr.y = 0;
  pr.dia = pr.dia || 0;
  pr.blades = pr.blades || 2;
  pr.downThrust = pr.hasProp ? cat.downThrust : 0;
  pr.rightThrust = pr.hasProp ? cat.rightThrust : 0;

  // ── tren: resistencia
  const g = d.gear;
  const scale = span / 1.4;
  let gearCda = 0;
  if (g.type === 'tricycle' || g.type === 'taildragger') {
    const nW = g.type === 'tricycle' ? 3 : 2.3;
    gearCda = nW * g.wheel * g.wheel * 0.55 * (g.pants ? 0.6 : 1) + 3 * 0.006 * scale * 0.15;
    if (features.includes('tundraTires')) gearCda *= 1.3;
  } else if (g.type === 'mono') gearCda = g.wheel * g.wheel * 0.4;

  const full = {
    id: d.id, baseId: d.baseId || d.id, name: d.name, category: d.category, desc: d.desc,
    difficulty: d.difficulty, aerobatic: d.aerobatic, channels: d.channels, launch: d.launch, paint: d.paint,
    features, canopy: d.canopy, fuseShape: d.fuseShape, wingPos: d.wingPos, wingShape: d.wingShape || 'trapezoid',
    custom: !!d.custom, mods: m,
    mass, airfoil, airfoilKey, length: L, fuseW: W, fuseH: H,
    span, wingArea, mac, ar, wingAcX, tailType,
    surfaces, prop: pr,
    fuselageAero: { frontalArea: frontal, cd: fuseCd * dragScale },
    gearDrag: { cda: gearCda * dragScale, x: wingX + root * 0.3, y: -H * 0.5 - 0.06 * scale },
    servo: (d.servo || 300) * m.servoScale,
    hasAilerons: hasAil, hasFlaps: hasFlap, hasSpoilers: hasSpoiler || crow, crow,
    retract: !!g.retract, gearType: g.type, wheelDia: g.wheel || 0, pants: !!g.pants,
    biplane: d.biplane || null, dragScale,
  };
  for (const s of surfaces) if (s.kind === 'wing' || s.kind === 'hTail' || s.kind === 'vTail') s.cdScale = dragScale;

  // ── punto neutro y CG
  const npX = computeNeutralPoint(full);
  const margin = d.staticMargin ?? 0.1;
  full.npX = npX;
  full.cgX = npX - margin * mac + m.cgShift * mac;
  full.cgY = 0;
  full.staticMargin = (npX - full.cgX) / mac;

  // ── tren de aterrizaje y puntos de contacto
  buildContacts(full, d, g);

  // ── inercia aproximada (radios de giro por categoría)
  const k = m.inertiaScale;
  const Ixx = mass * (cat.kRoll * span) ** 2 * k;
  const Izz = mass * (cat.kPitch * L) ** 2 * k;
  full.inertia = { xx: Ixx, yy: (Ixx + Izz) * 0.92, zz: Izz };

  full.perf = estimatePerformance(full);
  // decalaje: incidencia de cola que trima la aeronave a su velocidad de crucero de diseño
  full.trimSpeed = full.prop.type === 'none'
    ? Math.max(full.perf.bestLDSpeed * 1.1, full.perf.stallSpeed * 1.35)
    : Math.max(full.perf.stallSpeed * 1.6, Math.min(full.perf.cruiseSpeed * 0.8, full.perf.stallSpeed * 3));
  full.tailIncidence = trimTail(full, full.trimSpeed);
  full.perf = estimatePerformance(full);
  // límite estructural de carga (g) según el tipo de construcción
  full.gLimit = d.gLimit ?? (d.category === 'trainer' ? (mass < 1.5 ? 12 : 9) : d.category === 'aerobatic' ? 16 : d.category === 'glider' ? (span > 4 ? 8 : 12) : d.category === 'jet' ? 15 : (d.biplane ? 15 : 12));
  // trimado de fábrica: alerón y timón que compensan el par motor a régimen de crucero
  full.trim = computeTorqueTrim(full);
  return full;
}

/**
 * Simula vuelo recto a crucero y promedia las órdenes de alerón y timón necesarias para
 * anular el par de reacción de la hélice y el remolino de la estela (lo que un aeromodelista
 * ajusta con el motor desviado y los trims de la emisora).
 */
function computeTorqueTrim(full) {
  const zero = { aileron: 0, elevator: 0, rudder: 0 };
  if (!full.prop.hasProp) return zero;
  const world = {
    heightAt: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), surfaceAt: () => ({ rolling: 0.05, grip: 0.8, friction: 0.5, rough: 0 }),
    waterLevelAt: () => null, sampleWind: (pp, o) => o.set(0, 0, 0), density: () => 1.225, collision: null, temperature: 15,
  };
  const ac = new AircraftPhysics(full, { fidelity: 'realistic', damage: false });
  const V = Math.max(full.perf.cruiseSpeed * 0.9, full.perf.stallSpeed * 1.5);
  ac.resetTo(world, { x: 0, z: 0, y: 300, heading: 0, speed: V });
  const ap = new Autopilot(full);
  const dt = 1 / 240;
  let sa = 0, sr = 0, n = 0;
  for (let i = 0; i < 240 * 9; i++) {
    ap.update(dt, ac, { altitude: 300, heading: 0, speed: V });
    ac.step(dt, world);
    if (i > 240 * 5) { sa += ac.cmd.aileron; sr += ac.cmd.rudder; n++; }
  }
  return { aileron: clamp(sa / n, -0.25, 0.25), elevator: 0, rudder: clamp(sr / n, -0.25, 0.25) };
}

/**
 * Ajusta la incidencia del estabilizador horizontal para que el momento de cabeceo sea nulo
 * en vuelo nivelado a la velocidad indicada, con la profundidad en neutro.
 */
function trimTail(full, V) {
  const tails = full.surfaces.filter((s) => s.kind === 'hTail');
  if (!tails.length) return 0;
  const W = full.mass * G;
  const rho = 1.225;
  const out = makeAeroOut();
  const ctx = {
    v: new Vec3(), omega: new Vec3(), wind: new Vec3(), windGrad: new Vec3(), rho,
    defl: { aileron: 0, elevator: 0, rudder: 0, flap: 0, airbrake: 0 }, slip: 0, agl: 100, upB: null, damage: null, gearPos: 0,
  };
  const momentAt = (inc) => {
    for (const t of tails) t.incidence = inc;
    const model = buildAeroModel(full, full.cgX, { asym: 0 });
    // ángulo de ataque para sustentación = peso
    let lo = -8 * DEG, hi = 20 * DEG;
    for (let i = 0; i < 30; i++) {
      const a = (lo + hi) / 2;
      ctx.v.set(V * Math.cos(a), -V * Math.sin(a), 0);
      evaluateAero(model, ctx, out);
      const L = out.force.x * Math.sin(a) + out.force.y * Math.cos(a);
      if (L > W) hi = a; else lo = a;
    }
    return out.moment.z;
  };
  let lo = -8, hi = 8;
  const mLo = momentAt(lo);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const m = momentAt(mid);
    if (Math.sign(m) === Math.sign(mLo)) lo = mid; else hi = mid;
  }
  const inc = (lo + hi) / 2;
  for (const t of tails) t.incidence = inc;
  return inc;
}

function buildContacts(full, d, g) {
  const L = full.length, H = full.fuseH, span = full.span;
  const cgX = full.cgX;
  const propR = full.prop.hasProp ? full.prop.dia / 2 : 0;
  const wheelR = (g.wheel || 0.06) / 2;
  const pts = [];
  const isJet = full.category === 'jet';
  let yb;
  if (g.type === 'tricycle' || g.type === 'taildragger') {
    // distancia al suelo: rueda + amortiguación y holgura de hélice en actitud nivelada
    yb = -Math.max(H * 0.5 + 0.9 * wheelR * 2 + 0.02 * (span / 1.4), propR + 0.05 + 0.035 * Math.sqrt(span / 1.4));
    if (isJet) yb = Math.min(yb, -(H * 0.5 + (L * 0.45) * Math.tan(8 * DEG)));
  }
  if (g.type === 'tricycle') {
    const xm = cgX + Math.max(Math.tan(14 * DEG) * Math.abs(yb), 0.05 * L);
    const track = Math.max(0.24 * span, 1.6 * full.fuseW);
    const xn = Math.max(0.12 * L, isJet ? 0.18 * L : 0.08 * L);
    pts.push({ id: 'mainR', x: xm, y: yb, z: track / 2, kind: 'wheel', role: 'main', radius: wheelR, brake: true, retract: full.retract });
    pts.push({ id: 'mainL', x: xm, y: yb, z: -track / 2, kind: 'wheel', role: 'main', radius: wheelR, brake: true, retract: full.retract });
    pts.push({ id: 'nose', x: xn, y: yb, z: 0, kind: 'wheel', role: 'nose', radius: wheelR * 0.85, steer: 25, retract: full.retract });
  } else if (g.type === 'taildragger') {
    const xm = cgX - Math.tan(16 * DEG) * Math.abs(yb);
    const track = Math.max(0.22 * span, 1.6 * full.fuseW);
    const xt = L * 0.96;
    const yt = Math.min(-H * 0.18, yb + (xt - xm) * Math.tan(11 * DEG));
    pts.push({ id: 'mainR', x: xm, y: yb, z: track / 2, kind: 'wheel', role: 'main', radius: wheelR, brake: true, retract: full.retract });
    pts.push({ id: 'mainL', x: xm, y: yb, z: -track / 2, kind: 'wheel', role: 'main', radius: wheelR, brake: true, retract: full.retract });
    pts.push({ id: 'tail', x: xt, y: yt, z: 0, kind: 'wheel', role: 'tail', radius: 0.015 * (span / 1.4) + 0.008, steer: -25, retract: false });
  } else if (g.type === 'mono') {
    pts.push({ id: 'mono', x: cgX - 0.04, y: -(H * 0.5 + wheelR * 0.8), z: 0, kind: 'wheel', role: 'main', radius: wheelR, brake: true, retract: full.retract });
    pts.push({ id: 'noseSkid', x: 0.12 * L, y: -H * 0.45, z: 0, kind: 'skid', role: 'nose' });
    pts.push({ id: 'tailSkid', x: 0.96 * L, y: -H * 0.12, z: 0, kind: 'skid', role: 'tail' });
  } else {
    pts.push({ id: 'belly', x: cgX - 0.02, y: -H * 0.5, z: 0, kind: 'skid', role: 'main' });
    pts.push({ id: 'noseSkid', x: 0.1 * L, y: -H * 0.45, z: 0, kind: 'skid', role: 'nose' });
    pts.push({ id: 'tailSkid', x: 0.95 * L, y: -H * 0.15, z: 0, kind: 'skid', role: 'tail' });
  }
  full.gearPoints = pts;
  if (pts.length) full.gearDrag.y = Math.min(...pts.map((p) => p.y)) * 0.7;

  // puntos estructurales (detección de golpes y deslizamiento de la célula)
  const air = [];
  air.push({ id: 'nose', x: 0, y: 0, z: 0, group: 'fuselage' });
  if (full.prop.hasProp) air.push({ id: 'propTip', x: -0.02, y: -propR, z: 0, group: 'prop' });
  air.push({ id: 'belly', x: cgX, y: -H * 0.5, z: 0, group: 'fuselage', belly: true });
  air.push({ id: 'bellyF', x: 0.2 * L, y: -H * 0.45, z: 0, group: 'fuselage', belly: true });
  air.push({ id: 'tailEnd', x: L, y: 0, z: 0, group: 'hTail' });
  air.push({ id: 'canopy', x: 0.35 * L, y: H * 0.5 + 0.03, z: 0, group: 'fuselage' });
  for (const s of full.surfaces) {
    if (s.kind === 'fuse' || s.sfg) continue;
    const tipSt = stationAt(s, 1);
    const grp = s.kind === 'wing' ? s.group : s.group;
    air.push({ id: `${s.id}Tip`, x: tipSt.le[0] + tipSt.chord * 0.5, y: tipSt.le[1], z: tipSt.le[2], group: grp, tip: s.kind === 'wing' });
    if (s.kind === 'wing') {
      const mid = stationAt(s, 0.5);
      air.push({ id: `${s.id}Mid`, x: mid.le[0] + mid.chord * 0.5, y: mid.le[1], z: mid.le[2], group: grp });
    }
  }
  full.airframePoints = air;
}

/** Prestaciones estimadas con el modelo de paneles (sin trimado de profundidad). */
export function estimatePerformance(full) {
  const model = buildAeroModel(full, full.cgX, { asym: 0 });
  const prop = new Propulsion(full.prop);
  const out = makeAeroOut();
  const W = full.mass * G;
  const rho = 1.225;
  const ctx = {
    v: new Vec3(), omega: new Vec3(), wind: new Vec3(), windGrad: new Vec3(), rho,
    defl: { aileron: 0, elevator: 0, rudder: 0, flap: 0, airbrake: 0 }, slip: 0, agl: 100, upB: null, damage: null,
    gearPos: full.retract ? 0 : 1,
  };
  const forces = (V, alpha) => {
    ctx.v.set(V * Math.cos(alpha), -V * Math.sin(alpha), 0);
    evaluateAero(model, ctx, out);
    const f = out.force;
    return { L: f.x * Math.sin(alpha) + f.y * Math.cos(alpha), D: -(f.x * Math.cos(alpha) - f.y * Math.sin(alpha)) };
  };
  const clMaxA = (flap) => {
    ctx.defl.flap = flap;
    let best = 0;
    for (let a = 0; a <= 35; a += 0.5) best = Math.max(best, forces(15, a * DEG).L / (0.5 * rho * 225));
    ctx.defl.flap = 0;
    return best;
  };
  const CLAmax = clMaxA(0);
  const stall = Math.sqrt((2 * W) / (rho * CLAmax));
  const stallFlaps = full.hasFlaps ? Math.sqrt((2 * W) / (rho * clMaxA(1))) : stall;

  const dragLevel = (V) => {
    let lo = -8 * DEG, hi = 25 * DEG;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (forces(V, mid).L > W) hi = mid; else lo = mid;
    }
    return forces(V, (lo + hi) / 2).D;
  };
  const isPowered = full.prop.type !== 'none';
  // misma correspondencia acelerador → RPM que Propulsion.update
  const throttleToR = (thr) => {
    const t = full.prop.type;
    if (t === 'turbine') return full.prop.idle + (1 - full.prop.idle) * thr;
    if (t === 'glow2' || t === 'glow4' || t === 'gas') return full.prop.idle + (1 - full.prop.idle) * Math.pow(thr, 0.9);
    return thr;
  };
  const thrustAt = (V, thr) => prop.steadyThrust(throttleToR(thr), V);

  let maxSpeed = 0, cruise = 0, bestLD = 0, bestLDSpeed = 0, minSink = Infinity, minSinkSpeed = 0, maxClimb = 0;
  for (let V = stall * 1.15; V < 140; V += 0.5) {
    const D = dragLevel(V);
    const ld = W / D;
    if (ld > bestLD) { bestLD = ld; bestLDSpeed = V; }
    const sink = (D * V) / W;
    if (sink < minSink) { minSink = sink; minSinkSpeed = V; }
    if (isPowered) {
      const T = thrustAt(V, 1);
      if (T >= D) maxSpeed = V;
      if (thrustAt(V, CRUISE_THROTTLE) >= D) cruise = V;
      maxClimb = Math.max(maxClimb, ((T - D) * V) / W);
    }
    if (isPowered && V > maxSpeed + 8 && maxSpeed > 0) break;
    if (!isPowered && V > bestLDSpeed * 2.5) break;
  }
  if (!isPowered) { maxSpeed = Math.sqrt((2 * W) / (rho * full.wingArea * 0.12)); cruise = bestLDSpeed; }

  // autonomía a régimen de crucero
  let endurance = null;
  const p = full.prop;
  if (p.type === 'electric' || p.type === 'edf') {
    const r = CRUISE_THROTTLE;
    const watts = (p.power * r ** 3) / 0.82;
    endurance = (p.capacity * 0.8 * 60) / Math.max(watts, 1);
  } else if (p.type !== 'none') {
    const r = throttleToR(CRUISE_THROTTLE);
    const flow = p.drain * (0.18 + 0.82 * (p.type === 'turbine' ? r ** 2.4 : r ** 3));
    endurance = p.capacity / flow;
  }

  return {
    wingLoading: full.mass / full.wingArea, // kg/m²
    stallSpeed: stall,
    stallSpeedFlaps: stallFlaps,
    cruiseSpeed: cruise,
    maxSpeed,
    bestLD, bestLDSpeed, minSink, minSinkSpeed,
    maxClimb,
    thrustWeight: isPowered ? (p.thrust) / W : 0,
    endurance, // minutos
    clMaxA: CLAmax,
    approximate: true,
  };
}

/**
 * Catálogo de aeronaves (base + personalizadas). Cachea los specs completos.
 */
export class AircraftRegistry {
  constructor(storage = null) {
    this.storage = storage;
    this.cache = new Map();
    this.base = AIRCRAFT_DATA;
  }

  /** Lista resumida (sin construir) de todas las aeronaves disponibles. */
  list() {
    const custom = this.customList();
    return [...this.base, ...custom.map((c) => ({ ...this.baseEntry(c.baseId), id: c.id, name: c.name, custom: true, baseId: c.baseId }))];
  }

  baseEntry(id) { return this.base.find((a) => a.id === id); }

  customList() {
    return this.storage ? this.storage.get('customAircraft', []) : [];
  }

  /** Spec completo de una aeronave (base o personalizada). */
  get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    let full;
    const base = this.baseEntry(id);
    if (base) full = buildFullSpec(base);
    else {
      const c = this.customList().find((x) => x.id === id);
      if (!c) return this.get(this.base[0].id);
      const b = this.baseEntry(c.baseId);
      full = buildFullSpec({ ...b, id: c.id, baseId: c.baseId, name: c.name, custom: true }, c.mods);
    }
    this.cache.set(id, full);
    return full;
  }

  exists(id) {
    return !!this.baseEntry(id) || this.customList().some((c) => c.id === id);
  }

  /** Guarda una aeronave personalizada (nunca sobrescribe las originales). */
  saveCustom({ id, baseId, name, mods }) {
    const list = this.customList();
    const newId = id && id.startsWith('custom-') ? id : `custom-${Date.now().toString(36)}`;
    const idx = list.findIndex((c) => c.id === newId);
    const entry = { id: newId, baseId, name, mods };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    this.storage?.set('customAircraft', list);
    this.cache.delete(newId);
    return newId;
  }

  deleteCustom(id) {
    const list = this.customList().filter((c) => c.id !== id);
    this.storage?.set('customAircraft', list);
    this.cache.delete(id);
  }

  /** Advertencias de estabilidad / realismo para una configuración del editor. */
  static analyse(full) {
    const w = [];
    const sm = full.staticMargin;
    if (sm < 0) w.push({ level: 'danger', es: `CG detrás del punto neutro (margen ${(sm * 100).toFixed(0)}%): aeronave inestable en cabeceo.`, en: `CG behind the neutral point (margin ${(sm * 100).toFixed(0)}%): pitch-unstable aircraft.` });
    else if (sm < 0.03) w.push({ level: 'warn', es: 'Margen estático muy pequeño: respuesta en cabeceo muy sensible.', en: 'Very small static margin: very sensitive pitch response.' });
    else if (sm > 0.3) w.push({ level: 'warn', es: 'CG muy adelantado: podría faltar profundidad para el flare.', en: 'CG far forward: elevator authority may be insufficient to flare.' });
    if (full.perf.thrustWeight > 0 && full.perf.thrustWeight < 0.25) w.push({ level: 'warn', es: 'Relación empuje/peso baja: despegue largo y ascenso pobre.', en: 'Low thrust-to-weight: long takeoff and poor climb.' });
    if (full.perf.thrustWeight > 3) w.push({ level: 'warn', es: 'Relación empuje/peso poco realista (> 3).', en: 'Unrealistic thrust-to-weight (> 3).' });
    if (full.perf.wingLoading > 25) w.push({ level: 'warn', es: 'Carga alar muy alta: velocidad de pérdida elevada.', en: 'Very high wing loading: high stall speed.' });
    if (full.perf.maxSpeed > 0 && full.perf.stallSpeed > full.perf.maxSpeed * 0.8) w.push({ level: 'danger', es: 'La velocidad de pérdida está cerca de la máxima: difícil de volar.', en: 'Stall speed is close to max speed: hard to fly.' });
    return w;
  }
}
