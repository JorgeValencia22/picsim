/**
 * Evaluación de aterrizajes: velocidad vertical de contacto, velocidad respecto a la de
 * pérdida, alineación con la pista, punto de toma, estabilidad (alabeo, rebotes) y daños.
 */
import { clamp, RAD, wrapPi, DEG } from '../utils/math3d.js';

export const LANDING_GRADES = [
  { min: 90, id: 'perfect', es: 'Perfecto', en: 'Perfect' },
  { min: 72, id: 'good', es: 'Bueno', en: 'Good' },
  { min: 50, id: 'fair', es: 'Aceptable', en: 'Fair' },
  { min: 1, id: 'hard', es: 'Duro', en: 'Hard' },
  { min: -Infinity, id: 'crash', es: 'Accidente', en: 'Crash' },
];

const lin = (x, good, bad) => clamp(1 - (x - good) / (bad - good), 0, 1);

export class LandingEvaluator {
  /**
   * @param {object} opts { stallSpeed, runways: [{x,z,heading,length,width}], target: {x,z} }
   */
  constructor(opts) {
    this.opts = opts;
    this.reset();
  }

  reset() {
    this.airTime = 0;
    this.armed = false;
    this.touch = null;
    this.after = 0;
    this.result = null;
  }

  /** Pista más cercana a un punto y si el punto está sobre ella. */
  nearestRunway(x, z) {
    let best = null, bestD = Infinity;
    for (const r of this.opts.runways || []) {
      const h = r.heading * DEG;
      const dx = x - r.x, dz = z - r.z;
      const u = dx * Math.sin(h) - dz * Math.cos(h);
      const v = dx * Math.cos(h) + dz * Math.sin(h);
      const onRw = Math.abs(u) <= r.length / 2 + 5 && Math.abs(v) <= r.width / 2 + 3;
      const d = Math.hypot(Math.max(0, Math.abs(u) - r.length / 2), Math.max(0, Math.abs(v) - r.width / 2));
      if (d < bestD) { bestD = d; best = { runway: r, onRunway: onRw, dist: d, lateral: v }; }
    }
    return best;
  }

  /**
   * @param {number} dt
   * @param {object} s { pos, vs, airspeed, groundSpeed, bank, pitch, heading, agl, wheelContact, destroyed, damaged, track }
   * @returns {object|null} resultado cuando se completa una evaluación
   */
  update(dt, s) {
    if (!this.touch) {
      if (!s.wheelContact && s.agl > 2.5) this.airTime += dt;
      if (this.airTime > 2.5) this.armed = true;
      if (this.armed && s.wheelContact) {
        const near = this.nearestRunway(s.pos.x, s.pos.z);
        const tgt = this.opts.target;
        this.touch = {
          vs: -s.vs, speed: s.airspeed, groundSpeed: s.groundSpeed, bank: Math.abs(s.bank) * RAD, pitch: s.pitch * RAD,
          heading: s.heading, track: s.track ?? s.heading, pos: { x: s.pos.x, z: s.pos.z },
          near, targetDist: tgt ? Math.hypot(s.pos.x - tgt.x, s.pos.z - tgt.z) : null,
          bounces: 0, airborne: false, damageBefore: s.damageSum, maxBankAfter: 0,
        };
        this.after = 0;
      }
      return null;
    }
    // vigilancia posterior al contacto (rebotes, vuelcos)
    const T = this.touch;
    this.after += dt;
    if (!s.wheelContact && s.agl > 0.35) T.airborne = true;
    if (T.airborne && s.wheelContact) { T.bounces++; T.airborne = false; }
    T.maxBankAfter = Math.max(T.maxBankAfter, Math.abs(s.bank) * RAD);
    if (s.agl > 6) { this.reset(); return null; } // fue un toque y despegue (touch-and-go)
    if (this.after >= 3 || s.destroyed) {
      this.result = this.score(T, s);
      const r = this.result;
      this.reset();
      return r;
    }
    return null;
  }

  score(T, s) {
    const vsS = T.vs <= 0.5 ? 1 : lin(T.vs, 0.5, 3.2);
    const ratio = T.speed / Math.max(1, this.opts.stallSpeed);
    const spdS = ratio < 1.0 ? lin(1.0 - ratio, 0, 0.3) : lin(ratio, 1.4, 2.3);
    let alignS = 1, alignErr = null;
    if (T.near && T.near.dist < 40) {
      const rh = T.near.runway.heading * DEG;
      const e1 = Math.abs(wrapPi(T.heading - rh)), e2 = Math.abs(wrapPi(T.heading - rh - Math.PI));
      alignErr = Math.min(e1, e2) * RAD;
      alignS = lin(alignErr, 3, 25);
    } else {
      alignErr = Math.abs(wrapPi(T.track - T.heading)) * RAD;
      alignS = lin(alignErr, 4, 30);
    }
    let pointS = 1;
    if (T.targetDist != null) pointS = lin(T.targetDist, 6, 90);
    else if (T.near) pointS = T.near.onRunway ? 1 : lin(T.near.dist, 0, 60);
    const stabS = lin(T.bank, 2, 15) * clamp(1 - T.bounces * 0.3, 0, 1) * lin(T.maxBankAfter, 20, 70);
    // el impacto vertical también multiplica: una toma brusca nunca puede ser "buena"
    let total = 100 * (0.35 * vsS + 0.15 * spdS + 0.15 * alignS + 0.15 * pointS + 0.2 * stabS) * (0.4 + 0.6 * vsS);
    const damaged = s.damageSum < (T.damageBefore ?? s.damageSum) - 0.01;
    if (damaged) total *= 0.5;
    if (s.destroyed) total = 0;
    total = Math.round(total);
    const grade = LANDING_GRADES.find((g) => total >= g.min);
    return {
      score: total, grade: s.destroyed ? LANDING_GRADES[4] : grade,
      vs: T.vs, speed: T.speed, speedRatio: ratio, bank: T.bank, alignErr, targetDist: T.targetDist,
      onRunway: !!T.near?.onRunway, bounces: T.bounces, damaged, destroyed: !!s.destroyed,
      perfect: total >= 90,
    };
  }
}
