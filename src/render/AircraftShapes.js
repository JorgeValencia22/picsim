/**
 * Formas visuales de cada aeronave, ajustadas a las vistas en tres planos de los aviones reales
 * (perfil lateral, planta y sección del fuselaje, cabina, carenados y detalles característicos).
 * Solo afectan al modelo 3D: la física sigue usando las dimensiones de aircraftData.
 *
 * Estaciones del fuselaje: [t, w, top, bot, nTop?, nBot?]
 *   t    posición a lo largo del fuselaje (0 = morro, 1 = cola)
 *   w    semiancho relativo a fuseW/2
 *   top  cota del borde superior relativa a fuseH/2 ('W' = intradós del ala alta: techo de cabina)
 *   bot  cota del borde inferior relativa a fuseH/2
 *   n    exponente de la superelipse de la sección (2 = elipse, >3 = sección casi rectangular)
 * Cabina (bubble/tandem/glider): { t0, t1, peak, h, w, frames } con h relativo a fuseH/2 sobre
 * el lomo y w relativo al semiancho local; peak = posición del punto más alto (0..1 de la cabina).
 */

// Cabinas de ala alta (techo hasta el ala, parabrisas inclinado, luneta y cono de cola que sube)
const CESSNA = {
  n: [3.2, 3.4],
  st: [
    [0, 0.62, 0.55, -0.62], [0.04, 0.86, 0.78, -0.92], [0.12, 0.98, 0.95, -1.0],
    [0.2, 1, 'W', -1.0], [0.47, 1, 'W', -1.0], [0.58, 0.86, 1.55, -0.86],
    [0.75, 0.55, 1.05, -0.45], [0.9, 0.32, 0.86, -0.08], [1, 0.16, 0.72, 0.12],
  ],
  windows: [[0.115, 0.2, 0.39, 0.61], [0.205, 0.33, 0.29, 0.45], [0.205, 0.33, 0.55, 0.71], [0.335, 0.44, 0.3, 0.44], [0.335, 0.44, 0.56, 0.7], [0.48, 0.56, 0.42, 0.58]],
  spinner: { len: 1.5 },
  extras: ['dorsalFin', 'springGear', 'cowlFace'],
};
const CUB = {
  n: [3.6, 3.6],
  st: [
    [0, 0.6, 0.45, -0.6], [0.05, 0.8, 0.7, -0.88], [0.15, 0.95, 0.95, -1.0],
    [0.23, 1, 'W', -1.0], [0.48, 1, 'W', -1.0], [0.56, 0.9, 1.55, -0.9],
    [0.8, 0.5, 0.95, -0.42], [1, 0.12, 0.66, 0.08],
  ],
  windows: [[0.14, 0.225, 0.39, 0.61], [0.235, 0.42, 0.3, 0.46], [0.235, 0.42, 0.54, 0.7]],
  spinner: { len: 1.1 },
  extras: ['cylinders', 'vStruts', 'tubeGear'],
};
const FOAM_TRAINER = {
  n: [3.0, 3.0],
  st: [
    [0, 0.66, 0.6, -0.62], [0.05, 0.88, 0.85, -0.92], [0.14, 1, 1.05, -1.0],
    [0.22, 1, 'W', -1.0], [0.47, 1, 'W', -1.0], [0.56, 0.86, 1.5, -0.86],
    [0.78, 0.48, 0.98, -0.38], [1, 0.14, 0.7, 0.12],
  ],
  windows: [[0.135, 0.215, 0.39, 0.61], [0.225, 0.42, 0.3, 0.45], [0.225, 0.42, 0.55, 0.7]],
  spinner: { len: 1.3 },
  extras: ['tubeGear'],
};

// Acrobáticos: morro corto con capó ancho, cabina burbuja alargada y lomo alto
const AEROBAT = (o = {}) => ({
  n: [2.3, 2.9],
  st: [
    [0, 0.72, 0.62, -0.62], [0.05, 0.94, 0.86, -0.92], [0.16, 1, 1.0, -1.04],
    [0.3, 1, 1.0, -1.06], [0.5, 0.92, 0.98, -0.96], [0.72, 0.6, 0.86, -0.58],
    [0.9, 0.3, 0.74, -0.18], [1, 0.12, 0.68, 0.06],
  ],
  canopy: { t0: o.c0 ?? 0.27, t1: o.c1 ?? 0.56, peak: 0.36, h: o.ch ?? 0.85, w: 0.8, frames: [0.04] },
  spinner: { len: 1.35 },
  extras: ['springGear', 'cowlFace', ...(o.extras || [])],
});
const RADIAL = (o = {}) => ({
  n: [2.1, 2.3],
  st: [
    [0, 1, 0.98, -0.98], [0.1, 1.02, 1.0, -1.0], [0.18, 1, 1.0, -1.0],
    [0.34, 0.98, 1.0, -0.98], [0.55, 0.82, 0.92, -0.78], [0.75, 0.52, 0.8, -0.45],
    [0.9, 0.28, 0.72, -0.12], [1, 0.12, 0.68, 0.06],
  ],
  canopy: { t0: o.c0 ?? 0.3, t1: o.c1 ?? 0.6, peak: 0.36, h: o.ch ?? 0.72, w: 0.78, frames: [0.04] },
  spinner: { len: 1.0 },
  extras: ['tubeGear', ...(o.extras || [])],
});

// Reactores
const SPORTJET = (o = {}) => ({
  n: [2.2, 2.4],
  st: [
    [0, 0.03, 0.03, -0.05], [0.04, 0.38, 0.32, -0.42], [0.1, 0.64, 0.6, -0.7],
    [0.2, 0.86, 0.86, -0.88], [0.34, 1, 1.0, -0.98], [0.62, 1, 0.98, -0.96],
    [0.85, 0.8, 0.82, -0.8], [1, 0.62, 0.66, -0.62],
  ],
  canopy: { t0: o.c0 ?? 0.11, t1: o.c1 ?? 0.33, peak: 0.42, h: o.ch ?? 0.78, w: 0.7, frames: o.frames ?? [0.05] },
  extras: ['sideIntakesD', 'nozzle', ...(o.extras || [])],
});

// Veleros: morro de cabina, góndola bajo el ala y botalón fino que se ensancha en la deriva
const GLIDER = (o = {}) => ({
  n: [2.1, 2.1],
  st: [
    [0, 0.18, 0.12, -0.3], [0.04, 0.6, 0.55, -0.8], [0.12, 0.92, 0.9, -1.0],
    [0.26, 1, 1.0, -1.0], [0.36, 0.86, 0.9, -0.78], [0.5, 0.42, 0.55, -0.28],
    [0.78, 0.26, 0.42, 0.02], [0.86, 0.28, o.finTop ?? 0.66, 0.0], [1, 0.16, o.finTop ?? 0.66, 0.1],
  ],
  canopy: { t0: o.c0 ?? 0.03, t1: o.c1 ?? 0.22, peak: 0.38, h: o.ch ?? 0.55, w: 0.86, frames: [] },
  extras: [],
});

export const SHAPES = {
  skylark: FOAM_TRAINER,
  voltranger: { ...FOAM_TRAINER, spinner: { len: 1.4 } },
  titan2100: { ...FOAM_TRAINER, extras: ['springGear', 'cowlFace'] },
  cessna182: CESSNA,
  cubj3: CUB,
  tundracub: { ...CUB, extras: ['vStruts', 'tubeGear', 'cowlFace'] },
  outback: { ...CESSNA, windows: CUB.windows, extras: ['vStruts', 'tubeGear', 'cowlFace'] },
  falcon46: {
    n: [2.6, 3.2],
    st: [
      [0, 0.68, 0.6, -0.6], [0.06, 0.92, 0.88, -0.92], [0.2, 1, 1.0, -1.0],
      [0.48, 0.95, 1.0, -1.0], [0.75, 0.55, 0.85, -0.5], [0.9, 0.3, 0.74, -0.14], [1, 0.13, 0.68, 0.06],
    ],
    canopy: { t0: 0.26, t1: 0.5, peak: 0.42, h: 0.72, w: 0.72, frames: [0.05] },
    spinner: { len: 1.3 },
    extras: ['tubeGear'],
  },
  // Extra 300L: biplaza en tándem, cúpula larga de una pieza, costados planos (tubo y tela)
  extra300: {
    ...AEROBAT({ c0: 0.25, c1: 0.62, ch: 0.88, extras: ['spades', 'hornBalance', 'exhaustStubs'] }),
    n: [2.3, 3.4],
    st: [
      [0, 0.74, 0.62, -0.64], [0.05, 0.95, 0.86, -0.94], [0.16, 1, 1.0, -1.06],
      [0.3, 1, 1.02, -1.08], [0.52, 0.9, 1.0, -0.94], [0.72, 0.58, 0.88, -0.56],
      [0.9, 0.28, 0.76, -0.16], [1, 0.11, 0.7, 0.06],
    ],
  },
  // Edge 540: monoplaza de carreras, fuselaje estrecho y alto, cúpula alta y corta
  edge540: {
    ...AEROBAT({ c0: 0.27, c1: 0.5, ch: 1.0, extras: ['spades', 'hornBalance', 'exhaustStubs'] }),
    n: [2.2, 3.4],
    st: [
      [0, 0.72, 0.6, -0.62], [0.05, 0.92, 0.86, -0.92], [0.16, 0.97, 1.0, -1.04],
      [0.3, 0.92, 1.0, -1.04], [0.5, 0.8, 0.96, -0.9], [0.72, 0.52, 0.86, -0.54],
      [0.9, 0.26, 0.74, -0.15], [1, 0.1, 0.68, 0.06],
    ],
  },
  // CAP 232: ala baja, cúpula adelantada sobre el ala y lomo que cae suave
  cap232: {
    ...AEROBAT({ c0: 0.24, c1: 0.5, ch: 0.84, extras: ['spades', 'exhaustStubs'] }),
    n: [2.3, 3.2],
  },
  // Su-26: radial M-14P de gran diámetro, cúpula burbuja grande y fuselaje que se afila
  su26: { ...RADIAL({ c0: 0.29, c1: 0.62, ch: 0.66, extras: ['spades', 'radialCyls'] }), spinner: { len: 1.1 } },
  // Yak-55: ala media gruesa, cúpula en burbuja más corta y capó radial
  yak55: RADIAL({ c0: 0.32, c1: 0.55, ch: 0.72, extras: ['radialCyls'] }),
  pitts: {
    n: [2.2, 2.4],
    st: [
      [0, 0.86, 0.85, -0.85], [0.08, 1, 1.0, -1.0], [0.3, 1, 1.02, -1.02],
      [0.5, 0.86, 0.96, -0.85], [0.75, 0.52, 0.8, -0.45], [0.9, 0.28, 0.72, -0.12], [1, 0.12, 0.68, 0.06],
    ],
    spinner: { len: 1.0 },
    extras: ['tubeGear'],
  },
  formula1: {
    n: [2.1, 2.3],
    st: [
      [0, 0.5, 0.42, -0.42], [0.1, 0.84, 0.78, -0.82], [0.28, 1, 0.98, -1.0],
      [0.5, 0.88, 0.95, -0.9], [0.75, 0.52, 0.8, -0.48], [0.9, 0.26, 0.7, -0.1], [1, 0.1, 0.64, 0.04],
    ],
    canopy: { t0: 0.36, t1: 0.6, peak: 0.36, h: 0.62, w: 0.66, frames: [] },
    spinner: { len: 2.0 },
    extras: ['springGear'],
  },
  p51: {
    n: [2.1, 2.5],
    st: [
      [0, 0.58, 0.62, -0.62], [0.06, 0.8, 0.82, -0.9], [0.16, 0.95, 0.94, -1.0],
      [0.32, 1, 1.0, -1.04], [0.5, 0.92, 0.94, -1.0], [0.7, 0.64, 0.86, -0.62],
      [0.88, 0.34, 0.78, -0.2], [1, 0.12, 0.7, 0.04],
    ],
    canopy: { t0: 0.34, t1: 0.56, peak: 0.42, h: 0.85, w: 0.84, frames: [0.12] },
    spinner: { len: 2.2 },
    extras: ['dorsalFin', 'p51Scoop', 'tubeGear'],
  },
  spitfire: {
    n: [2.0, 2.2],
    st: [
      [0, 0.52, 0.56, -0.62], [0.08, 0.76, 0.8, -0.86], [0.22, 0.92, 0.95, -1.0],
      [0.36, 1, 1.02, -1.02], [0.52, 0.86, 1.0, -0.92], [0.72, 0.56, 0.84, -0.55],
      [0.9, 0.3, 0.74, -0.14], [1, 0.12, 0.68, 0.04],
    ],
    canopy: { t0: 0.33, t1: 0.5, peak: 0.55, h: 0.62, w: 0.78, frames: [0.12, 0.62] },
    spinner: { len: 2.3 },
    extras: ['tubeGear'],
  },
  vipersj: SPORTJET({ c0: 0.1, c1: 0.32 }),
  jetster70: SPORTJET({ c0: 0.12, c1: 0.34, ch: 0.85 }),
  strike90: { ...SPORTJET({ c0: 0.1, c1: 0.3, ch: 0.85 }), n: [2.4, 2.8] },
  l39: {
    n: [2.1, 2.3],
    st: [
      [0, 0.06, 0.04, -0.1], [0.05, 0.52, 0.45, -0.62], [0.12, 0.8, 0.78, -0.92],
      [0.26, 0.96, 0.98, -1.0], [0.42, 1, 1.0, -0.98], [0.62, 0.86, 0.92, -0.86],
      [0.85, 0.6, 0.78, -0.62], [1, 0.46, 0.64, -0.52],
    ],
    canopy: { t0: 0.1, t1: 0.38, peak: 0.6, h: 0.82, w: 0.7, frames: [0.04, 0.45] },
    extras: ['shoulderIntakes', 'nozzle'],
  },
  f16: {
    n: [2.4, 3.6],
    st: [
      [0, 0.02, 0.0, -0.06], [0.04, 0.3, 0.24, -0.34], [0.1, 0.56, 0.5, -0.58],
      [0.2, 0.76, 0.74, -0.7], [0.32, 1.0, 0.9, -0.72], [0.45, 1.45, 0.9, -0.72],
      [0.66, 1.42, 0.86, -0.72], [0.8, 1.0, 0.8, -0.68], [0.93, 0.68, 0.7, -0.62], [1, 0.6, 0.6, -0.58],
    ],
    canopy: { t0: 0.1, t1: 0.33, peak: 0.42, h: 1.0, w: 0.82, frames: [] },
    extras: ['ventralIntake', 'ventralFins', 'nozzle', 'spine', 'radome'],
  },
  f18: {
    n: [2.4, 3.2],
    st: [
      [0, 0.02, 0.0, -0.06], [0.04, 0.32, 0.28, -0.36], [0.1, 0.56, 0.55, -0.62],
      [0.2, 0.74, 0.8, -0.78], [0.34, 1.1, 0.9, -0.82], [0.5, 1.45, 0.86, -0.8],
      [0.7, 1.45, 0.82, -0.76], [0.88, 1.3, 0.7, -0.66], [1, 1.15, 0.56, -0.54],
    ],
    canopy: { t0: 0.1, t1: 0.32, peak: 0.45, h: 0.95, w: 0.8, frames: [0.04] },
    extras: ['sideIntakesD', 'twinNozzle', 'radome'],
  },
  aquila2000: GLIDER({ c0: 0.03, c1: 0.2, finTop: 0.66 }),
  zephyr: GLIDER({ c0: 0.07, c1: 0.24, finTop: 0.66 }),
  nimbusf3j: GLIDER({ c0: 0.03, c1: 0.19, finTop: 0.66 }),
  ridgeracer: GLIDER({ c0: 0.03, c1: 0.2, finTop: 0.4, ch: 0.5 }),
  apexf3b: GLIDER({ c0: 0.03, c1: 0.18, finTop: 0.4, ch: 0.48 }),
  ventus45: {
    ...GLIDER({ c0: 0.03, c1: 0.28, finTop: 0.7, ch: 0.62 }),
    st: [
      [0, 0.14, 0.1, -0.3], [0.04, 0.6, 0.55, -0.78], [0.12, 0.92, 0.9, -1.0],
      [0.26, 1, 0.98, -1.0], [0.36, 0.84, 0.86, -0.72], [0.52, 0.42, 0.52, -0.2],
      [0.76, 0.28, 0.44, 0.04], [0.84, 0.32, 0.72, 0.0], [1, 0.18, 0.7, 0.1],
    ],
  },
};

/** Forma para un spec (los aviones personalizados heredan la del modelo base). */
export function shapeFor(spec) {
  return SHAPES[spec.id] || SHAPES[spec.baseId] || null;
}

/** Interpolación cúbica monótona (Fritsch–Carlson): sin sobreoscilaciones entre estaciones. */
export function monotone(xs, ys) {
  const n = xs.length;
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/**
 * Prepara los interpoladores del fuselaje. wingTop = cota (en semialturas) del intradós del ala
 * alta, usada por las estaciones 'W'.
 */
export function buildProfile(shape, wingTop) {
  const st = shape.st.map((s) => s.map((v) => (v === 'W' ? wingTop : v)));
  const ts = st.map((s) => s[0]);
  const [n0, n1] = shape.n || [2.4, 2.4];
  const fw = monotone(ts, st.map((s) => s[1]));
  const ft = monotone(ts, st.map((s) => s[2]));
  const fb = monotone(ts, st.map((s) => s[3]));
  const fnT = monotone(ts, st.map((s) => s[4] ?? n0));
  const fnB = monotone(ts, st.map((s) => s[5] ?? n1));
  return (t) => {
    const top = ft(t), bot = fb(t);
    const yc = (top + bot) / 2, half = Math.max(0.005, (top - bot) / 2);
    return { w: Math.max(0.005, fw(t)), top: half, bot: half, yc, nT: fnT(t), nB: fnB(t) };
  };
}
