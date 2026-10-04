/**
 * Piloto automático sencillo (PID) que actúa SOBRE LOS MANDOS, nunca sobre la orientación.
 * Lo usan el avión de demostración del menú principal, las pruebas automáticas de trimado
 * y la asistencia de "control de velocidad". Mantiene rumbo, altitud y velocidad.
 */
import { clamp, wrapPi, DEG } from '../utils/math3d.js';
import { controlEffectiveness } from './Aerodynamics.js';

/**
 * Autoridad relativa de los mandos de una aeronave respecto a un entrenador de referencia.
 * Permite normalizar las ganancias de asistencias y piloto automático (un 3D con superficies
 * enormes necesita mucha menos deflexión que un entrenador para la misma respuesta).
 */
export function controlAuthority(spec) {
  let roll = 0, pitch = 0, yaw = 0;
  for (const s of spec.surfaces) {
    for (const c of s.controls || []) {
      if (c.type === 'spoiler' || c.type === 'flap') continue;
      const tau = c.type === 'stabilator' ? 1 : controlEffectiveness(c.chord);
      const span = (c.to ?? 1) - (c.from ?? 0);
      const k = tau * (c.max || 20) * span;
      if (c.channels.includes('aileron') && s.kind === 'wing') roll = Math.max(roll, k * (s.lower ? 1.5 : 1));
      if (c.channels.includes('elevator')) pitch = Math.max(pitch, k);
      if (c.channels.includes('rudder')) yaw = Math.max(yaw, k);
    }
  }
  const vh = spec.tailType === 'V' ? 0.5 : 1;
  return {
    roll: Math.max(0.3, roll / 4.6),
    pitch: Math.max(0.3, (pitch * vh) / 11.5),
    yaw: Math.max(0.3, yaw / 12),
  };
}

export class Autopilot {
  constructor(spec) {
    this.spec = spec;
    this.iElev = 0;
    this.iThr = 0;
    this.maxBank = 35 * DEG;
    const perf = spec.perf;
    this.cruise = perf.cruiseSpeed || perf.bestLDSpeed || perf.stallSpeed * 1.6;
    this.trimThrottle = spec.prop.type === 'none' ? 0 : 0.55;
    this.auth = controlAuthority(spec);
    this.powered = spec.prop.type !== 'none';
  }

  reset() { this.iElev = 0; this.iThr = 0; }

  /**
   * @param {number} dt
   * @param {AircraftPhysics} ac
   * @param {{altitude:number, heading:number, speed?:number}} target  rumbo en rad
   */
  update(dt, ac, target) {
    const t = ac.telemetry;
    const cmd = ac.cmd;
    const w = ac.omega;

    // ── rumbo → alabeo deseado → alerones
    const hdgErr = wrapPi(target.heading - t.heading);
    const bankT = clamp(hdgErr * 1.2, -this.maxBank, this.maxBank);
    const A = this.auth;
    const ail = (1.6 * (bankT - t.bank) - 0.35 * w.x) / A.roll;
    const hasAil = this.spec.hasAilerons;
    cmd.aileron = hasAil ? clamp(ail, -1, 1) : 0;

    // ── altitud → cabeceo deseado → profundidad (con integrador para el trimado)
    // sin motor (planeadores) el cabeceo gobierna la velocidad, no la altitud
    const altErr = target.altitude - t.altitude;
    const vRef = target.speed ?? this.cruise;
    const pitchT = this.powered
      ? clamp(altErr * 0.025 - t.vs * 0.04, -12 * DEG, 14 * DEG)
      : clamp(-0.04 + (t.airspeed - vRef) * 0.03, -20 * DEG, 8 * DEG);
    const turnComp = (1 / Math.max(0.5, Math.cos(t.bank)) - 1) * 0.6;
    const pErr = pitchT - t.pitch;
    this.iElev = clamp(this.iElev + (pErr * dt * 0.8) / A.pitch, -0.6, 0.6);
    cmd.elevator = clamp((1.3 * pErr + turnComp - 0.25 * w.z) / A.pitch + this.iElev, -1, 1);

    // ── timón: coordinación (anula el derrape) o viraje en aeronaves sin alerones
    if (hasAil) cmd.rudder = clamp((-t.beta * 2.0 + w.y * 0.1) / A.yaw, -1, 1);
    else cmd.rudder = clamp((1.4 * (bankT - t.bank) - 0.3 * w.x) / A.yaw, -1, 1);

    // ── velocidad → acelerador
    if (this.spec.prop.type !== 'none') {
      const vT = target.speed ?? this.cruise;
      const sErr = vT - t.airspeed;
      this.iThr = clamp(this.iThr + sErr * dt * 0.05, -0.5, 0.5);
      cmd.throttle = clamp(this.trimThrottle + sErr * 0.08 + this.iThr, 0.05, 1);
    }
  }
}
