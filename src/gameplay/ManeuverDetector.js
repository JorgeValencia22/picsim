/**
 * Reconocimiento de maniobras a partir del comportamiento REAL de la aeronave: integra las
 * velocidades angulares en ejes del cuerpo durante cada segmento de actividad y analiza los
 * giros acumulados, su orden, la actitud de entrada/salida, el rumbo y la altitud.
 * Además detecta estados sostenidos (invertido, knife-edge, harrier, torque roll, hover).
 */
import { RAD, DEG, wrapPi, clamp } from '../utils/math3d.js';

export const MANEUVERS = {
  loop: { es: 'Looping', en: 'Loop' },
  outsideLoop: { es: 'Looping invertido', en: 'Outside loop' },
  halfLoop: { es: 'Medio looping', en: 'Half loop' },
  roll: { es: 'Tonel', en: 'Roll' },
  doubleRoll: { es: 'Doble tonel', en: 'Double roll' },
  halfRoll: { es: 'Medio tonel', en: 'Half roll' },
  snapRoll: { es: 'Snap roll', en: 'Snap roll' },
  immelmann: { es: 'Immelmann', en: 'Immelmann' },
  splitS: { es: 'Split-S', en: 'Split-S' },
  cubanEight: { es: 'Ocho cubano', en: 'Cuban eight' },
  inverted: { es: 'Vuelo invertido', en: 'Inverted flight' },
  knifeEdge: { es: 'Knife-edge', en: 'Knife-edge' },
  harrier: { es: 'Harrier', en: 'Harrier' },
  torqueRoll: { es: 'Torque roll', en: 'Torque roll' },
  hover: { es: 'Hover', en: 'Hover' },
};

export class ManeuverDetector {
  constructor(stallSpeed = 8) {
    this.vs = stallSpeed;
    this.reset();
  }

  reset() {
    this.seg = null;
    this.calm = 0;
    this.sustained = {};
    this.time = 0;
  }

  /**
   * @param {number} dt
   * @param {object} s { omega:{x,y,z}, heading, pitch, bank, upY, rightY, altitude, airspeed, vs, alpha, stall, onGround, agl }
   * @returns {Array} maniobras detectadas en este paso
   */
  update(dt, s) {
    this.time += dt;
    const found = [];
    if (s.onGround || s.agl < 1.5) { this.seg = null; this.sustained = {}; return found; }
    const wr = s.omega.x, wp = s.omega.z;
    const active = Math.abs(wr) > 1.0 || Math.abs(wp) > 0.55;
    if (active) {
      if (!this.seg) {
        this.seg = {
          t0: this.time, roll: 0, pitch: 0, absRoll: 0, absPitch: 0,
          heading0: s.heading, alt0: s.altitude, altMin: s.altitude, altMax: s.altitude, upright0: s.upY > 0,
          rollT: 0, pitchT: 0, rollW: 0, pitchW: 0, maxRollRate: 0, stallTime: 0, rollBursts: 0, inBurst: false,
        };
      }
      this.calm = 0;
    } else if (this.seg) {
      this.calm += dt;
    }
    const g = this.seg;
    if (g) {
      g.roll += wr * dt; g.pitch += wp * dt;
      g.absRoll += Math.abs(wr) * dt; g.absPitch += Math.abs(wp) * dt;
      const t = this.time - g.t0;
      g.rollT += Math.abs(wr) * t * dt; g.rollW += Math.abs(wr) * dt;
      g.pitchT += Math.abs(wp) * t * dt; g.pitchW += Math.abs(wp) * dt;
      g.maxRollRate = Math.max(g.maxRollRate, Math.abs(wr));
      g.altMin = Math.min(g.altMin, s.altitude); g.altMax = Math.max(g.altMax, s.altitude);
      if (s.stall > 0.3) g.stallTime += dt;
      const burst = Math.abs(wr) > 1.5;
      if (burst && !g.inBurst) g.rollBursts++;
      g.inBurst = burst;
      if (this.calm > 0.7 || t > 25) {
        const m = this.classify(g, s);
        if (m) found.push(m);
        this.seg = null;
      }
    }
    // estados sostenidos
    const sus = (key, cond, need, score) => {
      if (cond) {
        this.sustained[key] = (this.sustained[key] || 0) + dt;
        if (this.sustained[key] >= need && !this.sustained[`${key}Done`]) {
          this.sustained[`${key}Done`] = true;
          found.push({ id: key, score: score(), duration: this.sustained[key] });
        }
      } else {
        if (this.sustained[`${key}Done`] && this.sustained[key] > need) {
          // fin del estado: se informa la duración total para las puntuaciones
          found.push({ id: `${key}End`, duration: this.sustained[key], hidden: true });
        }
        this.sustained[key] = 0;
        this.sustained[`${key}Done`] = false;
      }
    };
    const levelish = Math.abs(s.vs) < 3;
    sus('inverted', s.upY < -0.85 && levelish && s.airspeed > this.vs * 0.9, 3, () => clamp(10 - Math.abs(s.vs) * 2, 4, 10));
    sus('knifeEdge', Math.abs(s.rightY) > 0.88 && Math.abs(s.vs) < 2.5 && s.airspeed > this.vs * 1.1, 2, () => clamp(10 - Math.abs(s.vs) * 2.5, 4, 10));
    sus('harrier', s.alpha > 22 * DEG && s.pitch > 12 * DEG && s.pitch < 55 * DEG && s.upY > 0.5 && s.airspeed < this.vs * 1.25 && Math.abs(s.vs) < 2, 3, () => clamp(6 + (s.alpha * RAD - 22) / 6, 5, 10));
    sus('torqueRoll', s.pitch > 68 * DEG && Math.abs(s.vs) < 1.6 && Math.abs(s.omega.x) > 1.0, 2, () => clamp(10 - Math.abs(s.vs) * 3, 5, 10));
    sus('hover', s.pitch > 72 * DEG && Math.abs(s.vs) < 1.0 && Math.abs(s.omega.x) < 0.6, 3, () => clamp(10 - Math.abs(s.vs) * 4, 5, 10));
    return found;
  }

  classify(g, s) {
    const roll = Math.abs(g.roll) * RAD;
    const pitch = Math.abs(g.pitch) * RAD;
    const dh = Math.abs(wrapPi(s.heading - g.heading0)) * RAD;
    const dAlt = s.altitude - g.alt0;
    const uprightEnd = s.upY > 0;
    const rollFirst = g.rollW > 0 && g.pitchW > 0 && g.rollT / g.rollW < g.pitchT / g.pitchW;
    const dur = this.time - g.t0;
    const sc = (x) => Math.round(clamp(x, 1, 10) * 10) / 10;

    // ocho cubano: ~1¼+ de giro en cabeceo con dos medios toneles y rumbo final similar
    if (pitch >= 430 && roll >= 280 && g.rollBursts >= 2 && dh < 45) {
      return { id: 'cubanEight', score: sc(9 - dh / 10 - Math.abs(dAlt) / 15) };
    }
    if (pitch >= 300 && roll < 110) {
      return { id: g.pitch > 0 ? 'loop' : 'outsideLoop', score: sc(10 - dh / 6 - Math.abs(dAlt) / 6 - roll / 30) };
    }
    if (roll >= 300 && pitch < 160) {
      const snap = dur < 1.6 && g.stallTime > 0.15;
      if (snap) return { id: 'snapRoll', score: sc(9 - dh / 15 - Math.abs(dAlt) / 8) };
      const n = Math.round(roll / 360);
      return { id: n >= 2 ? 'doubleRoll' : 'roll', score: sc(10 - dh / 5 - Math.abs(dAlt) / 3 - pitch / 40) };
    }
    if (pitch >= 140 && pitch < 260 && roll >= 140 && roll < 260 && uprightEnd && dh > 120) {
      if (!rollFirst && dAlt > 5) return { id: 'immelmann', score: sc(10 - Math.abs(180 - dh) / 8 - Math.abs(180 - roll) / 20) };
      if (rollFirst && dAlt < -5) return { id: 'splitS', score: sc(10 - Math.abs(180 - dh) / 8 - Math.abs(180 - roll) / 20) };
    }
    if (pitch >= 150 && pitch < 260 && roll < 80 && !uprightEnd) {
      return { id: 'halfLoop', score: sc(9 - Math.abs(180 - pitch) / 10) };
    }
    if (roll >= 150 && roll < 300 && pitch < 90) {
      return { id: 'halfRoll', score: sc(9 - Math.abs(180 - roll) / 10 - Math.abs(dAlt) / 3) };
    }
    return null;
  }
}
