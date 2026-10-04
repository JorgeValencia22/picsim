/**
 * Modelo aerodinámico por elementos de superficie (paneles).
 *
 * Cada ala, estabilizador, deriva y el fuselaje se discretizan en paneles. En cada paso se
 * calcula la velocidad local del aire en cada panel (traslación + rotación + viento local +
 * estela de la hélice), su ángulo de ataque, los coeficientes CL/CD y la fuerza resultante,
 * aplicada en su punto del 25% de cuerda. La suma de fuerzas y momentos produce, sin ningún
 * comportamiento predefinido: estabilidad estática, amortiguamiento, efecto diedro,
 * acoplamientos entre ejes, pérdidas asimétricas, barrenas, knife-edge, harrier, etc.
 *
 * Sustentación  L = ½·ρ·V²·S·CL      Resistencia  D = ½·ρ·V²·S·CD
 */
import { Vec3, DEG, clamp, makeRng } from '../utils/math3d.js';
import { liftSlope, controlEffectiveness, deflectionFalloff, groundEffectFactor, panelCoefficients } from './Aerodynamics.js';
import { stationAt, spanDirAt, segmentArea, coverage } from './SurfaceGeometry.js';

/** Niveles de fidelidad física (modifican realmente la simulación). */
export const FIDELITY = {
  arcade: { turbulence: 0.35, torque: 0, gyro: 0, asym: 0, extraDamping: 2.2, controlGain: 1.15, damageScale: 2.2, swirl: 0, stallWidth: 1.6, groundGrip: 1.6 },
  casual: { turbulence: 0.65, torque: 0.45, gyro: 0.4, asym: 0.4, extraDamping: 0, controlGain: 1.05, damageScale: 1.5, swirl: 0.4, stallWidth: 1.25, groundGrip: 1.25 },
  realistic: { turbulence: 1, torque: 1, gyro: 1, asym: 1, extraDamping: 0, controlGain: 1, damageScale: 1, swirl: 1, stallWidth: 1, groundGrip: 1 },
  expert: { turbulence: 1.15, torque: 1, gyro: 1, asym: 1.3, extraDamping: 0, controlGain: 1, damageScale: 0.85, swirl: 1, stallWidth: 0.85, groundGrip: 1 },
};

export const CHANNEL_AXIS = {
  aileron: [1, 0, 0], // alabeo a la derecha = +X
  elevator: [0, 0, 1], // morro arriba = +Z
  rudder: [0, -1, 0], // guiñada a la derecha = −Y
};

/** Convierte coordenadas de taller (x atrás) a ejes del cuerpo relativos al CG. */
export function toBody(x, y, z, cgX, cgY = 0) {
  return new Vec3(cgX - x, y - cgY, z);
}

/**
 * Construye el modelo de paneles para un spec completo y una posición de CG.
 * @param {object} full  spec completo (AircraftRegistry.buildFullSpec)
 * @param {number} cgX   posición longitudinal del CG desde el morro
 * @param {object} opts  { seed, asym }
 */
export function buildAeroModel(full, cgX, opts = {}) {
  const rng = makeRng(opts.seed ?? 1234);
  const asym = opts.asym ?? 1;
  const panels = [];
  const propBody = toBody(full.prop.x, full.prop.y, 0, cgX);
  const propR = (full.prop.dia || 0) / 2;
  const hasPropwash = full.prop.hasProp;

  for (const surf of full.surfaces) {
    const n = surf.panels;
    const ar = surf.ar;
    const sweepQC = (surf.sweepQC ?? surf.sweep ?? 0) * DEG;
    const a = liftSlope(ar, sweepQC) * (surf.liftSlopeScale || 1);
    const af = surf.airfoil;
    for (let i = 0; i < n; i++) {
      // reparto coseno: paneles más finos hacia la punta, donde cambian más las cargas
      const e0 = surf.kind === 'fuse' ? i / n : 1 - Math.cos(((i / n) * Math.PI) / 2);
      const e1 = surf.kind === 'fuse' ? (i + 1) / n : 1 - Math.cos((((i + 1) / n) * Math.PI) / 2);
      const em = (e0 + e1) / 2;
      const st = stationAt(surf, em);
      const area = segmentArea(surf, e0, e1);
      const sd = spanDirAt(surf, em);
      const s = new Vec3(sd[0], sd[1], sd[2]);
      // normal sin incidencia: perpendicular a la envergadura, "hacia arriba" del perfil
      const n0 = new Vec3().crossVectors(s, new Vec3(1, 0, 0)).scale(surf.side);
      const inc = st.twist * DEG;
      const c = new Vec3(1, 0, 0).scale(Math.cos(inc)).addScaled(n0, Math.sin(inc));
      const nn = n0.clone().scale(Math.cos(inc)).addScaled(new Vec3(1, 0, 0), -Math.sin(inc));
      const sl = new Vec3().crossVectors(c, nn);
      const pos = toBody(st.le[0] + 0.25 * st.chord, st.le[1], st.le[2], cgX);

      const jitter = surf.kind === 'wing' ? (rng() - 0.5) * 1.2 * DEG * asym : 0;
      const clMax = af.clMax * (surf.clMaxScale || 1);
      const alphaStallPos = clamp((clMax - af.cl0) / a, 6 * DEG, 50 * DEG) + jitter;
      const alphaStallNeg = clamp((af.clMin - af.cl0) / a, -50 * DEG, -6 * DEG) - jitter;

      const controls = [];
      let spoilerCov = 0;
      for (const ctl of surf.controls || []) {
        const cov = coverage(e0, e1, ctl.from ?? 0, ctl.to ?? 1);
        if (cov <= 0) continue;
        if (ctl.type === 'spoiler') { spoilerCov = cov; continue; }
        const tau = ctl.type === 'stabilator' ? 1 : controlEffectiveness(ctl.chord);
        const gains = {};
        for (const ch of ctl.channels) {
          if (ch === 'flap') gains.flap = 1;
          else if (ch === 'crowFlap') gains.airbrake = 1;
          else if (ch === 'crowAileron') gains.airbrake = (gains.airbrake || 0) - 0.45;
          else {
            const ax = CHANNEL_AXIS[ch];
            const m = new Vec3().crossVectors(pos, nn);
            const d = m.x * ax[0] + m.y * ax[1] + m.z * ax[2];
            const lever = Math.abs(d);
            if (lever > 1e-3) gains[ch] = Math.sign(d);
          }
        }
        controls.push({ type: ctl.type, tau, cov, max: (ctl.max || 20) * DEG, gains });
      }

      // fracción del panel inmersa en la estela de la hélice (muestreo a lo largo del panel)
      let wash = 0;
      const swirl = new Vec3();
      if (hasPropwash && pos.x < propBody.x - 0.02 && surf.kind !== 'fuse') {
        const rs = propR * 0.95;
        let inside = 0;
        const N = 7;
        for (let k = 0; k < N; k++) {
          const ee = e0 + ((k + 0.5) / N) * (e1 - e0);
          const ss = stationAt(surf, ee);
          const dy = ss.le[1] - full.prop.y, dz = ss.le[2];
          const r = Math.hypot(dy, dz);
          inside += 1 - clamp((r - rs * 0.8) / (rs * 0.4), 0, 1);
        }
        wash = inside / N;
        if (wash > 0) {
          // remolino de la estela: hélice horaria vista desde atrás → giro alrededor de +X
          const ry = pos.y - propBody.y, rz = pos.z;
          const rr = Math.hypot(ry, rz) || 1;
          swirl.set(0, -rz / rr, ry / rr); // x̂ × r̂
        }
      } else if (hasPropwash && surf.kind === 'fuse' && surf.washable) {
        wash = 0.8;
      }

      panels.push({
        id: `${surf.id}${i}`, surfId: surf.id, kind: surf.kind, group: surf.group, side: surf.side,
        eta0: e0, eta1: e1, detachable: surf.kind === 'wing' && em > 0.55,
        pos, c, n: nn, s, sl, area,
        a, cl0: af.cl0, cm0: af.cm0 || 0, chord: st.chord, cd0: af.cd0 * (surf.cdScale || 1), alphaStallPos, alphaStallNeg,
        k: 1 / (Math.PI * (surf.oswald || 0.8) * ar),
        plate: surf.plate ?? 0.9,
        stallWidth: (surf.stallWidth ?? 3) * DEG,
        eff: surf.efficiency ?? 1,
        downwash: surf.kind === 'hTail' ? Math.abs(nn.y) : 0,
        controls, spoilerCov, wash, swirl,
        isWing: surf.kind === 'wing',
      });
    }
  }

  const wingPanels = panels.filter((p) => p.isWing);
  return {
    panels,
    wingArea: full.wingArea,
    wingAR: full.ar,
    wingSpan: full.span,
    fuse: full.fuselageAero,
    gearDrag: full.gearDrag,
    gearPos: toBody(full.gearDrag.x, full.gearDrag.y, 0, cgX),
    propPos: propBody,
    thrustDir: new Vec3(Math.cos(full.prop.downThrust * DEG) * Math.cos(full.prop.rightThrust * DEG), -Math.sin(full.prop.downThrust * DEG), Math.sin(full.prop.rightThrust * DEG)).normalize(),
    wingAreaPanels: wingPanels.reduce((s, p) => s + p.area, 0),
    // brazo de cola (distancia entre el ala y el estabilizador) para el retardo del downwash
    tailArm: (() => {
      const tails = panels.filter((p) => p.kind === 'hTail');
      if (!tails.length || !wingPanels.length) return 0;
      const xw = wingPanels.reduce((s, p) => s + p.pos.x, 0) / wingPanels.length;
      const xt = tails.reduce((s, p) => s + p.pos.x, 0) / tails.length;
      return Math.max(0.05, xw - xt);
    })(),
    epsLag: null,
  };
}

/** Estado de daños neutro. */
export function freshDamage() {
  return { wingL: 1, wingR: 1, hTail: 1, vTail: 1, fuselage: 1, gear: 1, prop: 1, lostWingL: false, lostWingR: false };
}

const _coef = { cl: 0, cd: 0, stalled: 0 };

/**
 * Evalúa fuerzas y momentos aerodinámicos (ejes del cuerpo, momentos respecto al CG).
 * @param {object} model  resultado de buildAeroModel
 * @param {object} ctx    { v, omega, wind, windGrad, rho, defl, slip, agl, upB, damage, fid }
 * @param {object} out    { force: Vec3, moment: Vec3, ... telemetría }
 */
export function evaluateAero(model, ctx, out) {
  const F = out.force.set(0, 0, 0);
  const M = out.moment.set(0, 0, 0);
  const { v, omega, wind, windGrad, rho, defl, damage } = ctx;
  const fid = ctx.fid || FIDELITY.realistic;
  const slip = ctx.slip || 0;
  const swirlK = 0.22 * (fid.swirl ?? 1);
  const ctlGain = fid.controlGain ?? 1;
  const stallWidthScale = fid.stallWidth ?? 1;
  const vx = v.x, vy = v.y, vz = v.z, ox = omega.x, oy = omega.y, oz = omega.z;
  const upB = ctx.upB;
  const agl = ctx.agl ?? 100;

  let wingCLsum = 0, wingArea = 0, stallSum = 0;
  let epsilon = 0;
  let downwashReady = false;

  const pp = { cl0: 0, a: 0, alphaStallPos: 0, alphaStallNeg: 0, cd0: 0, k: 0, plate: 0, stallWidth: 0 };

  for (let i = 0; i < model.panels.length; i++) {
    const p = model.panels[i];
    if (!downwashReady && !p.isWing) {
      const clw = wingArea > 0 ? wingCLsum / wingArea : 0;
      epsilon = clamp((2 * clw) / (Math.PI * model.wingAR) * 0.85, -0.25, 0.25);
      // el aire desviado por el ala tarda lt/V en llegar a la cola: este retardo aporta
      // amortiguamiento en cabeceo (derivada Cm_alpha-punto) como en un avión real
      if (ctx.dt && model.tailArm > 0) {
        const Vt = Math.max(3, Math.hypot(v.x - wind.x, v.y - wind.y, v.z - wind.z));
        if (model.epsLag == null) model.epsLag = epsilon;
        model.epsLag += (epsilon - model.epsLag) * (1 - Math.exp(-ctx.dt * Vt / model.tailArm));
        epsilon = model.epsLag;
      }
      downwashReady = true;
    }
    // salud del grupo
    let health = 1;
    if (damage) {
      health = damage[p.group] ?? 1;
      if (p.detachable && ((p.side > 0 && damage.lostWingR) || (p.side < 0 && damage.lostWingL))) continue;
    }

    const px = p.pos.x, py = p.pos.y, pz = p.pos.z;
    // velocidad del panel respecto al suelo (ejes cuerpo): v + ω × r
    const vpx = vx + (oy * pz - oz * py);
    const vpy = vy + (oz * px - ox * pz);
    const vpz = vz + (ox * py - oy * px);
    // aire relativo al panel = viento local − velocidad del panel
    let ax = wind.x + windGrad.x * pz - vpx;
    let ay = wind.y + windGrad.y * pz - vpy;
    let az = wind.z + windGrad.z * pz - vpz;
    if (p.wash > 0 && slip > 0) {
      const w = slip * p.wash;
      ax -= w;
      ay += p.swirl.y * w * swirlK;
      az += p.swirl.z * w * swirlK;
    }
    // se elimina la componente según la envergadura (teoría de flecha simple)
    const as = ax * p.s.x + ay * p.s.y + az * p.s.z;
    ax -= as * p.s.x; ay -= as * p.s.y; az -= as * p.s.z;
    const V2 = ax * ax + ay * ay + az * az;
    if (V2 < 1e-4) continue;
    const V = Math.sqrt(V2);

    const aC = ax * p.c.x + ay * p.c.y + az * p.c.z;
    const aN = ax * p.n.x + ay * p.n.y + az * p.n.z;
    let alpha = Math.atan2(aN, -aC);
    if (p.downwash && downwashReady) alpha -= epsilon * p.downwash;

    // superficies de control → incremento equivalente de ángulo de ataque
    let dCtl = 0;
    for (let k = 0; k < p.controls.length; k++) {
      const ctl = p.controls[k];
      const g = ctl.gains;
      let d = 0;
      if (g.aileron) d += g.aileron * defl.aileron;
      if (g.elevator) d += g.elevator * defl.elevator;
      if (g.rudder) d += g.rudder * defl.rudder;
      if (g.flap) d += g.flap * defl.flap;
      if (g.airbrake) d += g.airbrake * defl.airbrake;
      const deltaRad = clamp(d, -1.2, 1.2) * ctl.max * ctlGain;
      const ctlHealth = health < 1 ? 0.3 + 0.7 * health : 1;
      dCtl += ctl.tau * deflectionFalloff(deltaRad) * deltaRad * ctl.cov * ctlHealth;
    }

    pp.cl0 = p.cl0; pp.a = p.a; pp.cd0 = p.cd0; pp.k = p.k; pp.plate = p.plate;
    pp.alphaStallPos = p.alphaStallPos; pp.alphaStallNeg = p.alphaStallNeg;
    pp.stallWidth = p.stallWidth * stallWidthScale;

    // efecto suelo sobre la resistencia inducida (sólo alas)
    let indScale = 1;
    if (p.isWing && upB) {
      const h = agl + (px * upB.x + py * upB.y + pz * upB.z);
      indScale = groundEffectFactor(h, model.wingSpan);
    }
    panelCoefficients(alpha, dCtl, pp, _coef, indScale);
    let cl = _coef.cl, cd = _coef.cd;

    if (p.spoilerCov > 0 && defl.airbrake > 0) {
      cl *= 1 - 0.7 * p.spoilerCov * defl.airbrake;
      cd += 0.09 * p.spoilerCov * defl.airbrake;
    }
    if (health < 1) {
      cl *= 0.35 + 0.65 * health;
      cd += (1 - health) * 0.06;
    }

    const qS = 0.5 * rho * V2 * p.area * p.eff;
    // dirección de resistencia d = â; dirección de sustentación l = d × (c × n)
    const dx = ax / V, dy = ay / V, dz = az / V;
    const lx = dy * p.sl.z - dz * p.sl.y;
    const ly = dz * p.sl.x - dx * p.sl.z;
    const lz = dx * p.sl.y - dy * p.sl.x;
    const fx = qS * (cl * lx + cd * dx);
    const fy = qS * (cl * ly + cd * dy);
    const fz = qS * (cl * lz + cd * dz);
    F.x += fx; F.y += fy; F.z += fz;
    M.x += py * fz - pz * fy;
    M.y += pz * fx - px * fz;
    M.z += px * fy - py * fx;
    // momento de cabeceo propio del perfil (curvatura) y de los flaps, sólo con flujo adherido
    if (p.cm0 !== 0 || dCtl !== 0) {
      const cm = (p.cm0 - 0.18 * dCtl) * (1 - _coef.stalled * 0.6);
      const mq = qS * p.chord * cm;
      M.x += p.sl.x * mq; M.y += p.sl.y * mq; M.z += p.sl.z * mq;
    }

    if (p.isWing) {
      wingCLsum += cl * p.area;
      wingArea += p.area;
      stallSum += _coef.stalled * p.area;
    }
  }

  // resistencia parásita del fuselaje (aplicada en el CG) y del tren (bajo el CG)
  const cax = wind.x - vx, cay = wind.y - vy, caz = wind.z - vz;
  const Vc = Math.sqrt(cax * cax + cay * cay + caz * caz);
  if (Vc > 0.01) {
    const fq = 0.5 * rho * Vc * model.fuse.cd * model.fuse.frontalArea * ((damage && damage.fuselage < 1) ? 1.5 - 0.5 * damage.fuselage : 1);
    F.x += fq * cax; F.y += fq * cay; F.z += fq * caz;
    const gearFrac = ctx.gearPos ?? 1;
    if (gearFrac > 0.01) {
      const gq = 0.5 * rho * Vc * model.gearDrag.cda * gearFrac;
      const gx = gq * cax, gy = gq * cay, gz = gq * caz;
      F.x += gx; F.y += gy; F.z += gz;
      const r = model.gearPos;
      M.x += r.y * gz - r.z * gy;
      M.y += r.z * gx - r.x * gz;
      M.z += r.x * gy - r.y * gx;
    }
  }

  out.wingCL = wingArea > 0 ? wingCLsum / wingArea : 0;
  out.stall = wingArea > 0 ? stallSum / wingArea : 0;
  out.downwash = epsilon;
  return out;
}

export function makeAeroOut() {
  return { force: new Vec3(), moment: new Vec3(), wingCL: 0, stall: 0, downwash: 0 };
}

/**
 * Punto neutro (sin motor) calculado numéricamente con el mismo modelo de paneles.
 * Devuelve la posición x desde el morro donde dCm/dα = 0.
 */
export function computeNeutralPoint(full) {
  const model = buildAeroModel(full, 0, { asym: 0 });
  const out = makeAeroOut();
  const V = 15;
  const ctx = {
    v: new Vec3(), omega: new Vec3(), wind: new Vec3(), windGrad: new Vec3(), rho: 1.225,
    defl: { aileron: 0, elevator: 0, rudder: 0, flap: 0, airbrake: 0 }, slip: 0, agl: 100, upB: null, damage: null, gearPos: 0,
  };
  const evalAt = (alpha) => {
    ctx.v.set(V * Math.cos(alpha), -V * Math.sin(alpha), 0);
    evaluateAero(model, ctx, out);
    return { fy: out.force.y, mz: out.moment.z };
  };
  const a1 = evalAt(1 * DEG), a2 = evalAt(4 * DEG);
  const dF = a2.fy - a1.fy, dM = a2.mz - a1.mz;
  // con el origen en el morro (CG=0): x_np(cuerpo, hacia delante) = dM/dF  → distancia desde el morro = −x
  return -(dM / dF);
}
