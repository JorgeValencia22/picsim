/**
 * Sistemas de propulsión: eléctrico (hélice), glow/gasolina, turbina y EDF.
 *
 * - Las RPM siguen al acelerador con una dinámica de primer orden (constante de tiempo propia
 *   de cada motor; las turbinas tienen además aceleración limitada y respuesta asimétrica).
 * - El empuje de hélice disminuye con la velocidad de avance: T = T0·r²·(1 − Va / (Vp·r)).
 * - Se modela el consumo (Wh o ml), la caída de tensión de la batería, la temperatura del motor,
 *   el par de reacción, el momento giroscópico y la velocidad inducida de la estela (prop-wash).
 */
import { clamp, makeRng } from '../utils/math3d.js';

const TWO_PI = Math.PI * 2;

export class Propulsion {
  /**
   * @param {object} spec  spec.prop completado por AircraftRegistry
   * @param {number} seed  semilla para las fluctuaciones de motores térmicos
   */
  constructor(spec, seed = 7) {
    this.spec = spec;
    this.type = spec.type;
    this.rng = makeRng(seed);
    this.isElectric = spec.type === 'electric' || spec.type === 'edf';
    this.isFuel = spec.type === 'glow2' || spec.type === 'glow4' || spec.type === 'gas' || spec.type === 'turbine';
    this.hasProp = ['electric', 'glow2', 'glow4', 'gas'].includes(spec.type);
    this.diskArea = this.hasProp ? Math.PI * (spec.dia / 2) ** 2 : 0;
    // inercia de la hélice/rotor (para el efecto giroscópico)
    if (this.hasProp) {
      const propMass = 0.022 * (spec.dia / 0.25) ** 3 * (spec.blades / 2);
      this.rotorInertia = (propMass * spec.dia * spec.dia) / 12;
    } else if (spec.type === 'turbine') {
      this.rotorInertia = 2.5e-5 * (spec.thrust / 100);
    } else if (spec.type === 'edf') {
      this.rotorInertia = 6e-6 * (spec.thrust / 20);
    } else this.rotorInertia = 0;
    this.thrustScale = 1;
    this.reset();
  }

  reset() {
    const s = this.spec;
    this.running = s.type !== 'none';
    this.r = this.isFuel ? (s.idle ?? 0.2) : 0; // fracción de RPM
    this.rpm = this.r * (s.rpm || 0);
    this.angle = 0; // ángulo visual de la hélice
    this.thrust = 0;
    this.shaftPower = 0;
    this.torque = 0;
    this.slipstream = 0;
    this.energyUsed = 0; // Wh
    this.fuelUsed = 0; // ml
    this.temperature = 25;
    this.fluct = 0;
    this.vibration = 0;
    this.health = 1; // daño de la hélice/rotor (1 = intacta)
    this.cutoff = false;
    this.egt = 0;
  }

  /** Fracción restante de batería o combustible (0..1). Planeadores: 1. */
  get remaining() {
    const s = this.spec;
    if (s.type === 'none') return 1;
    if (this.isElectric) return clamp(1 - this.energyUsed / s.capacity, 0, 1);
    return clamp(1 - this.fuelUsed / s.capacity, 0, 1);
  }

  /** Tensión relativa de la batería (curva LiPo simplificada con caída bajo carga). */
  get voltageFactor() {
    const soc = this.remaining;
    const curve = soc > 0.1 ? 0.9 + 0.1 * soc : 0.72 + 1.8 * soc;
    return clamp(curve - 0.035 * this.r * this.r * this.r, 0.6, 1);
  }

  /** Tensión aproximada del pack en voltios (sólo eléctricos). */
  get voltage() {
    return (this.spec.cells || 3) * 4.2 * this.voltageFactor;
  }

  /**
   * Avanza el estado del motor.
   * @param {number} dt
   * @param {number} throttle  0..1
   * @param {number} va        velocidad axial del aire relativa [m/s] (positiva hacia delante)
   * @param {number} rho       densidad del aire
   * @param {number} ambientC  temperatura ambiente
   */
  update(dt, throttle, va, rho, ambientC = 15) {
    const s = this.spec;
    if (s.type === 'none') { this.thrust = 0; return; }
    throttle = clamp(throttle, 0, 1);
    const rho0 = 1.225;
    const densityRatio = rho / rho0;

    // ── objetivo de RPM
    let target = 0;
    if (!this.running) target = 0;
    else if (this.isElectric) {
      if (this.remaining <= 0.02) this.cutoff = true;
      const lim = this.cutoff ? (this.remaining > 0 ? 0.3 : 0) : 1;
      const derate = this.temperature > 105 ? clamp(1 - (this.temperature - 105) / 30, 0.4, 1) : 1;
      target = Math.min(throttle, lim) * this.voltageFactor * derate;
    } else if (s.type === 'turbine') {
      target = s.idle + (1 - s.idle) * throttle;
    } else {
      // glow / gasolina: ralentí mínimo, respuesta algo no lineal y pequeñas variaciones
      this.fluct += (this.rng() - 0.5) * 0.6 * dt - this.fluct * 2 * dt;
      target = (s.idle + (1 - s.idle) * Math.pow(throttle, 0.9)) * (1 + this.fluct * 0.04);
      // un motor térmico rinde algo menos con aire poco denso
      target *= 0.92 + 0.08 * densityRatio;
    }

    // ── dinámica de las RPM
    if (s.type === 'turbine') {
      const up = target > this.r;
      const tau = up ? s.spool : s.spool * 0.55;
      let dr = ((target - this.r) / tau) * dt;
      const maxRate = up ? 0.45 : 0.9; // aceleración máxima por segundo (limitador de la ECU)
      dr = clamp(dr, -maxRate * dt, maxRate * dt);
      this.r += dr;
    } else {
      const tau = s.spool * (target > this.r ? 1 : 0.8);
      this.r += (target - this.r) * (1 - Math.exp(-dt / Math.max(0.02, tau)));
    }
    this.r = clamp(this.r, 0, 1.05);
    this.rpm = this.r * s.rpm;

    // ── empuje
    const hf = this.health < 0.2 ? 0 : 0.25 + 0.75 * this.health;
    const vaPos = Math.max(0, va);
    let thrust;
    if (this.hasProp) {
      const r = this.r;
      if (r < 0.03) {
        // hélice parada o plegada: sólo resistencia
        thrust = s.folding ? -0.004 * rho * va * Math.abs(va) * this.diskArea : -0.06 * rho * va * Math.abs(va) * this.diskArea;
      } else {
        const vp = s.pitchSpeed * r;
        const unloading = 1 - va / vp;
        thrust = s.thrust * r * r * densityRatio * clamp(unloading, -0.6, 1.15);
      }
    } else if (s.type === 'turbine') {
      const frac = Math.pow(this.r, 2.6);
      thrust = s.thrust * frac * densityRatio * (1 - vaPos / s.exitSpeed);
    } else {
      const frac = this.r * this.r;
      thrust = s.thrust * frac * densityRatio * (1 - vaPos / s.exitSpeed);
    }
    this.thrust = thrust * hf * this.thrustScale;

    // ── potencia, consumo y temperatura
    const r3 = this.r * this.r * this.r;
    if (this.isElectric) {
      this.shaftPower = s.power * r3;
      const elecPower = this.shaftPower / 0.82;
      this.energyUsed += (elecPower * dt) / 3600;
      const heat = elecPower * 0.18;
      const cool = (this.temperature - ambientC) * (s.power / 260) * (0.4 + clamp(vaPos, 0, 40) / 18);
      this.temperature += ((heat - cool) / (s.power * 0.11)) * dt;
    } else if (this.isFuel) {
      this.shaftPower = (s.power || s.thrust * 25) * r3;
      if (this.running) {
        const flow = s.drain * (0.18 + 0.82 * (s.type === 'turbine' ? Math.pow(this.r, 2.4) : r3)); // ml/min
        this.fuelUsed += (flow / 60) * dt;
        if (this.fuelUsed >= s.capacity) { this.fuelUsed = s.capacity; this.running = false; }
      }
      const tTarget = s.type === 'turbine' ? 380 + 320 * this.r : 70 + 70 * this.r;
      this.temperature += (tTarget - this.temperature) * (1 - Math.exp(-dt / 4));
      this.egt = s.type === 'turbine' && this.r > 0.05 ? this.temperature : 0;
    }

    const omega = this.rpm * (TWO_PI / 60);
    this.torque = omega > 10 ? (this.shaftPower / omega) * hf : 0;

    // ── estela de la hélice (velocidad inducida lejana por teoría de cantidad de movimiento)
    if (this.hasProp && this.thrust > 0) {
      this.slipstream = Math.sqrt(vaPos * vaPos + (2 * this.thrust) / (rho * this.diskArea)) - vaPos;
    } else this.slipstream = 0;

    // ── giro visual y vibración
    this.angle = (this.angle + omega * dt) % TWO_PI;
    const engineVib = this.type === 'glow2' || this.type === 'glow4' || this.type === 'gas' ? 0.25 * this.r : 0.04 * this.r;
    this.vibration = engineVib + (1 - this.health) * this.r * 1.5;
  }

  /** Momento angular del rotor a lo largo del eje +X del cuerpo [kg·m²/s]. */
  get angularMomentum() {
    return this.rotorInertia * this.rpm * (TWO_PI / 60);
  }

  /** Empuje estático máximo en condiciones estándar (para la ficha técnica). */
  staticThrust() { return this.spec.thrust || 0; }

  /** Empuje estacionario a régimen r y velocidad va (para estimaciones de prestaciones). */
  steadyThrust(r, va, rho = 1.225) {
    const s = this.spec;
    const dr = rho / 1.225;
    if (this.hasProp) {
      if (r < 0.03) return 0;
      return s.thrust * r * r * dr * clamp(1 - va / (s.pitchSpeed * r), -0.6, 1.15);
    }
    if (s.type === 'turbine') return s.thrust * Math.pow(r, 2.6) * dr * (1 - Math.max(0, va) / s.exitSpeed);
    if (s.type === 'edf') return s.thrust * r * r * dr * (1 - Math.max(0, va) / s.exitSpeed);
    return 0;
  }
}
