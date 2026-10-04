/**
 * Asistencias de vuelo. Modifican ÚNICAMENTE las órdenes enviadas a los servos (nunca la
 * orientación ni la posición del avión), igual que un estabilizador giroscópico real.
 *
 *  - Principiante: por defecto SIN TOPES de alabeo ni cabeceo: el stick gira el avión con
 *    libertad (amortiguado) y al soltarlo se nivela solo. Opcionalmente, modo "ángulo" con
 *    alabeo/cabeceo limitados. Coordinación de timón, protección de pérdida, ayuda al flare y
 *    dirección en tierra con los alerones. Control de velocidad opcional.
 *  - Intermedio: estabilización parcial (amortiguación de velocidades angulares), limitación
 *    suave y opcional del alabeo y ligera auto-nivelación.
 *  - Experto: sin ayudas.
 */
import { clamp, wrapPi, DEG } from '../utils/math3d.js';
import { controlAuthority } from '../aircraft/Autopilot.js';

export const ASSIST_LEVELS = ['beginner', 'intermediate', 'expert'];

export class FlightAssist {
  constructor(spec) {
    this.setAircraft(spec);
  }

  setAircraft(spec) {
    this.spec = spec;
    this.auth = controlAuthority(spec);
    this.iPitch = 0;
    this.iThr = 0;
  }

  reset() { this.iPitch = 0; this.iThr = 0; }

  /**
   * @param {number} dt
   * @param {object} input  { aileron, elevator, rudder, throttle } tras curvas y recorridos
   * @param {AircraftPhysics} ac
   * @param {object} cfg    settings.physics
   * @param {object} out    órdenes resultantes
   */
  apply(dt, input, ac, cfg, out) {
    const level = cfg.assist || 'expert';
    out.aileron = input.aileron;
    out.elevator = input.elevator;
    out.rudder = input.rudder;
    out.throttle = input.throttle;
    if (level === 'expert' || ac.destroyed || ac.held) return out;
    const t = ac.telemetry;
    const w = ac.omega;
    const A = this.auth;
    const onGround = t.wheelsOnGround > 0 || (t.onGround && t.agl < 0.3);
    const vs = this.spec.perf.stallSpeed;
    const flying = !onGround && t.airspeed > vs * 0.6;

    if (level === 'beginner') {
      if (flying) {
        const turn = (1 / Math.max(0.45, Math.cos(t.bank)) - 1) * 0.45;
        let ail, ele, errB;
        if (cfg.limitAttitude) {
          // modo "ángulo" con topes: el stick ordena el ángulo de alabeo/cabeceo (limitado)
          const maxBank = (cfg.maxBank ?? 45) * DEG, maxPitch = (cfg.maxPitch ?? 30) * DEG;
          errB = wrapPi(input.aileron * maxBank - t.bank);
          ail = (2.2 * errB - 0.45 * w.x) / A.roll;
          const errP = input.elevator * maxPitch - t.pitch;
          this.iPitch = clamp(this.iPitch + (errP * dt * 0.5) / A.pitch, -0.35, 0.35);
          ele = (1.6 * errP - 0.3 * w.z) / A.pitch + this.iPitch + (Math.abs(t.bank) < 1.2 ? turn / A.pitch : 0);
          if (Math.abs(t.bank) > 100 * DEG) ele *= 0.2;
          if (t.airspeed < vs * 1.15) ele = Math.min(ele, (input.elevator * 0.3) / A.pitch);
        } else {
          // modo libre auto-nivelado (por defecto): sin topes de alabeo ni cabeceo.
          // Con el stick movido se gira libremente (toneles y loopings completos) con
          // amortiguación giroscópica; al soltarlo el avión vuelve solo a alas niveladas.
          errB = wrapPi(-t.bank);
          const rollActive = Math.abs(input.aileron) > 0.06;
          ail = rollActive
            ? input.aileron + (0.35 * (input.aileron * 3.2 - w.x) * 0.4) / A.roll
            : (2.2 * errB - 0.45 * w.x) / A.roll;
          const pitchActive = Math.abs(input.elevator) > 0.06;
          if (pitchActive) {
            ele = input.elevator - (0.18 * w.z) / A.pitch * (1 - Math.abs(input.elevator));
            this.iPitch *= 0.98;
          } else if (Math.abs(t.bank) < 70 * DEG) {
            const errP = -t.pitch;
            this.iPitch = clamp(this.iPitch + (errP * dt * 0.5) / A.pitch, -0.35, 0.35);
            ele = (1.6 * errP - 0.3 * w.z) / A.pitch + this.iPitch + turn / A.pitch;
          } else ele = (-0.3 * w.z) / A.pitch; // invertido/cuchillo: primero nivela con alerones
        }
        // protección de pérdida: reduce el tirón (nunca empuja a fondo) si el ala se desprende
        if (t.stall > 0.05 && ele > 0) ele *= 1 - clamp(t.stall * 1.2, 0, 0.9);
        // ayuda al aterrizaje: redondeo automático cerca del suelo
        if (cfg.landingAid !== false && t.agl < 4 && t.vs < -1.2 && input.throttle < 0.35) {
          ele += clamp((-t.vs - 0.8) * 0.35, 0, 0.6) / A.pitch;
          ail += (-1.2 * t.bank) / A.roll;
        }
        out.aileron = clamp(ail, -1, 1);
        out.elevator = clamp(ele, -1, 1);
        // timón coordinado (anula el derrape) o viraje para aeronaves sin alerones
        out.rudder = clamp(input.rudder + (-t.beta * 1.6 + w.y * 0.05) / A.yaw, -1, 1);
        if (!this.spec.hasAilerons) {
          out.rudder = !cfg.limitAttitude && Math.abs(input.aileron) > 0.06
            ? clamp(input.aileron + input.rudder, -1, 1)
            : clamp((2.0 * errB - 0.4 * w.x) / A.yaw + input.rudder, -1, 1);
        }
      } else {
        // en tierra: los alerones también dirigen la rueda (más intuitivo)
        out.rudder = clamp(input.rudder + input.aileron * 0.8, -1, 1);
        out.aileron = input.aileron * 0.5;
        this.iPitch = 0;
      }
    } else if (level === 'intermediate') {
      if (flying) {
        // giróscopo: amortigua las velocidades angulares no ordenadas
        out.aileron = clamp(input.aileron + (0.35 * (input.aileron * 3.2 - w.x)) / A.roll * 0.4, -1, 1);
        out.elevator = clamp(input.elevator - (0.22 * w.z) / A.pitch * (1 - Math.abs(input.elevator)), -1, 1);
        out.rudder = clamp(input.rudder + (-t.beta * 0.8 + 0.1 * w.y) / A.yaw * (1 - Math.abs(input.rudder)), -1, 1);
        const maxBank = (cfg.maxBank ?? 60) * DEG;
        if (cfg.autoLevel && Math.abs(input.aileron) < 0.05 && Math.abs(t.bank) < 100 * DEG) out.aileron += (-0.6 * t.bank) / A.roll;
        if (cfg.limitBank && Math.abs(t.bank) > maxBank) out.aileron -= Math.sign(t.bank) * ((Math.abs(t.bank) - maxBank) * 2.5) / A.roll;
        if (t.stall > 0.25) out.elevator -= (t.stall * 0.8) / A.pitch;
        out.aileron = clamp(out.aileron, -1, 1);
        out.elevator = clamp(out.elevator, -1, 1);
      }
    }

    // control de velocidad (opcional): el acelerador fija la velocidad deseada
    if (cfg.speedHold && this.spec.prop.type !== 'none' && flying) {
      const cruise = this.spec.perf.cruiseSpeed || vs * 2;
      const target = vs * 1.35 + input.throttle * (cruise * 1.25 - vs * 1.35);
      const err = target - t.airspeed;
      this.iThr = clamp(this.iThr + err * dt * 0.06, -0.6, 0.6);
      out.throttle = clamp(0.5 + err * 0.12 + this.iThr, 0, 1);
    }
    return out;
  }
}
