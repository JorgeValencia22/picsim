/**
 * Herramienta de desarrollo: mide cómo vuela cada aeronave (lo que nota un piloto) para comparar
 * con valores reales de aeromodelos. Uso: node tools/flight-diagnostics.mjs [id ...]
 *
 * Métricas: velocidades (km/h), régimen de alabeo y cabeceo a fondo, g máximos, tiempo 0→90° de
 * alabeo, estabilidad con mandos sueltos, oscilación en tierra parada y rodando (temblor), y
 * "temblor" de alta frecuencia de la actitud en crucero con turbulencia.
 */
import { buildFullSpec } from '../src/aircraft/AircraftRegistry.js';
import { AIRCRAFT_DATA } from '../src/data/aircraftData.js';
import { AircraftPhysics } from '../src/aircraft/AircraftPhysics.js';
import { Autopilot } from '../src/aircraft/Autopilot.js';

const DT = 1 / 240;
const RAD = 180 / Math.PI;
const SURF = { type: 'grass', rolling: 0.05, grip: 0.8, friction: 0.5, rough: 0 };
const world = (turb = 0) => {
  let t = 0;
  return {
    heightAt: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), surfaceAt: () => SURF, waterLevelAt: () => null,
    sampleWind: (p, o) => {
      if (!turb) return o.set(0, 0, 0);
      // turbulencia determinista suave (varias frecuencias espaciales)
      const s = p.x * 0.11 + p.z * 0.07, r = p.x * 0.05 - p.z * 0.13 + p.y * 0.2;
      return o.set(turb * Math.sin(s * 1.7 + 1), turb * 0.6 * Math.sin(r * 2.3), turb * Math.cos(s * 1.1 + r));
    },
    density: () => 1.225, collision: null, temperature: 15,
  };
};

function run(ac, w, seconds, ctl) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { ctl?.(ac, i * DT, i); ac.step(DT, w); }
}

function measure(id) {
  const spec = buildFullSpec(AIRCRAFT_DATA.find((a) => a.id === id));
  const p = spec.perf;
  const r = { id, mass: spec.mass, span: spec.span, Vs: p.stallSpeed * 3.6, Vcru: p.cruiseSpeed * 3.6, Vmax: p.maxSpeed * 3.6, LD: p.bestLD, TW: p.thrustWeight };
  const V0 = p.cruiseSpeed || p.bestLDSpeed;
  const powered = spec.prop.type !== 'none';
  const ap = new Autopilot(spec);
  const trimmed = (ac, w, secs = 4) => {
    ac.resetTo(w, { x: 0, z: 0, y: 200, heading: 0, speed: V0 });
    run(ac, w, secs, (a) => { ap.update(DT, a, { altitude: 200, heading: 0, speed: V0 }); });
  };
  // alabeo a fondo
  {
    const w = world();
    const ac = new AircraftPhysics(spec, { fidelity: 'realistic', damage: false });
    trimmed(ac, w);
    const thr = ac.cmd.throttle, el = ac.cmd.elevator;
    let maxP = 0, t90 = null, t = 0;
    run(ac, w, 2, (a, tt) => {
      a.cmd.aileron = 1; a.cmd.rudder = 0; a.cmd.elevator = el; a.cmd.throttle = thr;
      maxP = Math.max(maxP, a.omega.x);
      if (t90 == null && Math.abs(a.telemetry.bank) > Math.PI / 2) t90 = tt;
    });
    r.rollRate = maxP * RAD; r.t90 = t90;
  }
  // cabeceo a fondo (tirar)
  {
    const w = world();
    const ac = new AircraftPhysics(spec, { fidelity: 'realistic', damage: false });
    trimmed(ac, w);
    const thr = ac.cmd.throttle;
    let maxQ = 0, maxG = 0;
    run(ac, w, 1.2, (a) => { a.cmd.elevator = 1; a.cmd.aileron = 0; a.cmd.throttle = thr; maxQ = Math.max(maxQ, a.omega.z); maxG = Math.max(maxG, a.telemetry.gLoad); });
    r.pitchRate = maxQ * RAD; r.maxG = maxG;
  }
  // timón a fondo (guiñada)
  {
    const w = world();
    const ac = new AircraftPhysics(spec, { fidelity: 'realistic', damage: false });
    trimmed(ac, w);
    const thr = ac.cmd.throttle, el = ac.cmd.elevator;
    let maxR = 0;
    run(ac, w, 1.5, (a) => { a.cmd.rudder = 1; a.cmd.aileron = 0; a.cmd.elevator = el; a.cmd.throttle = thr; maxR = Math.max(maxR, Math.abs(a.omega.y)); });
    r.yawRate = maxR * RAD;
  }
  // mandos sueltos 10 s desde crucero trimado (estabilidad): alabeo/cabeceo finales, oscilación
  {
    const w = world();
    const ac = new AircraftPhysics(spec, { fidelity: 'realistic', damage: false });
    trimmed(ac, w, 6);
    const thr = ac.cmd.throttle;
    let qMax = 0;
    run(ac, w, 10, (a, t) => { a.cmd.aileron = 0; a.cmd.rudder = 0; a.cmd.elevator = 0; a.cmd.throttle = thr; if (t > 1) qMax = Math.max(qMax, Math.abs(a.omega.z)); });
    r.handsOffBank = ac.telemetry.bank * RAD; r.handsOffPitch = ac.telemetry.pitch * RAD; r.handsOffV = ac.telemetry.airspeed * 3.6; r.handsOffQ = qMax * RAD;
  }
  // temblor de alta frecuencia en crucero con turbulencia (segunda diferencia de ω)
  {
    const w = world(1.5);
    const ac = new AircraftPhysics(spec, { fidelity: 'realistic', damage: false });
    trimmed(ac, w, 3);
    let prev = null, prev2 = null, acc = 0, n = 0;
    run(ac, w, 4, (a) => {
      ap.update(DT, a, { altitude: 200, heading: 0, speed: V0 });
      const o = [a.omega.x, a.omega.y, a.omega.z];
      if (prev2) { for (let k = 0; k < 3; k++) { const d2 = o[k] - 2 * prev[k] + prev2[k]; acc += d2 * d2; } n++; }
      prev2 = prev; prev = o;
    });
    r.jitterAir = Math.sqrt(acc / n) * RAD; // °/s de "ruido" entre pasos
  }
  // en tierra: parado con motor al ralentí y rodando a media potencia
  if (spec.gearType === 'tricycle' || spec.gearType === 'taildragger') {
    const w = world();
    const ac = new AircraftPhysics(spec, { fidelity: 'realistic', damage: false });
    ac.resetTo(w, { x: 0, z: 0, heading: 0, onGround: true });
    let ys = [], ws = [];
    run(ac, w, 4, (a, t) => { a.cmd.throttle = 0.05; if (t > 2) { ys.push(a.pos.y); ws.push(a.omega.length()); } });
    const ym = ys.reduce((s, y) => s + y, 0) / ys.length;
    r.groundBounce = Math.sqrt(ys.reduce((s, y) => s + (y - ym) ** 2, 0) / ys.length) * 1000; // mm
    r.groundOmega = Math.max(...ws) * RAD;
    // rodaje a 0,35 de gas 6 s: oscilación de rumbo y de cabeceo
    ws = []; let hs = [];
    run(ac, w, 6, (a, t) => { a.cmd.throttle = powered ? 0.3 : 0; if (t > 2) { ws.push(Math.abs(a.omega.z) + Math.abs(a.omega.x)); hs.push(a.telemetry.heading); } });
    r.taxiOmega = Math.max(...ws) * RAD;
    r.taxiSpeed = ac.telemetry.groundSpeed * 3.6;
    r.taxiHeadingDrift = (hs[hs.length - 1] - hs[0]) * RAD;
  }
  return r;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : AIRCRAFT_DATA.map((a) => a.id);
const rows = ids.map(measure);
const f = (v, d = 0) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(d) : v);
console.log('id            kg    env  Vs  Vcru Vmax  L/D  T/W | roll°/s t90  pitch°/s gMax yaw°/s | HO bank pitch  V   q°/s | jitAir | gnd mm gndω taxiω taxiV hdgDrift');
for (const r of rows) {
  console.log(`${r.id.padEnd(13)}${f(r.mass, 2).padStart(5)}${f(r.span, 2).padStart(5)}${f(r.Vs).padStart(4)}${f(r.Vcru).padStart(5)}${f(r.Vmax).padStart(5)}${f(r.LD, 1).padStart(5)}${f(r.TW, 2).padStart(5)} |${f(r.rollRate).padStart(6)}${f(r.t90, 2).padStart(6)}${f(r.pitchRate).padStart(7)}${f(r.maxG, 1).padStart(6)}${f(r.yawRate).padStart(6)} |${f(r.handsOffBank).padStart(6)}${f(r.handsOffPitch).padStart(6)}${f(r.handsOffV).padStart(5)}${f(r.handsOffQ).padStart(6)} |${f(r.jitterAir, 2).padStart(7)} |${f(r.groundBounce, 2).padStart(7)}${f(r.groundOmega, 1).padStart(6)}${f(r.taxiOmega, 1).padStart(6)}${f(r.taxiSpeed).padStart(6)}${f(r.taxiHeadingDrift).padStart(8)}`);
}
