/** Pruebas de integración del modelo de vuelo con las 30 aeronaves. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT_DATA } from '../src/data/aircraftData.js';
import { Autopilot } from '../src/aircraft/Autopilot.js';
import { FlightAssist } from '../src/controls/FlightAssist.js';
import { CollisionSystem } from '../src/core/CollisionSystem.js';
import { DEG, RAD } from '../src/utils/math3d.js';
import { flatWorld, spec, aircraft, run, DT } from './helpers.js';

const world = flatWorld();

test('las 30 aeronaves tienen geometría válida, son estables y sus prestaciones son coherentes', () => {
  assert.equal(AIRCRAFT_DATA.length, 30);
  for (const e of AIRCRAFT_DATA) {
    const s = spec(e.id);
    assert.ok(s.staticMargin > 0, `${e.id}: margen estático positivo`);
    assert.ok(s.perf.stallSpeed > 3 && s.perf.stallSpeed < 20, `${e.id}: Vs ${s.perf.stallSpeed}`);
    if (s.prop.type !== 'none') assert.ok(s.perf.maxSpeed > s.perf.stallSpeed * 1.5, `${e.id}: Vmax > 1,5 Vs`);
    else assert.ok(s.perf.bestLD > 15, `${e.id}: planeo L/D ${s.perf.bestLD}`);
  }
});

test('cada aeronave mantiene un vuelo nivelado y vira con el piloto automático (60 s)', () => {
  for (const e of AIRCRAFT_DATA) {
    const s = spec(e.id);
    const ac = aircraft(e.id);
    ac.resetTo(world, { x: 0, z: 0, y: 150, heading: 0, speed: s.perf.cruiseSpeed || s.perf.bestLDSpeed });
    const ap = new Autopilot(s);
    let maxBank = 0;
    run(ac, world, 60, (a, t) => {
      ap.update(DT, a, { altitude: 150, heading: t > 20 ? Math.PI / 2 : 0 });
      if (t > 5) maxBank = Math.max(maxBank, Math.abs(a.telemetry.bank));
    });
    const t = ac.telemetry;
    assert.ok(ac.pos.isFinite(), `${e.id}: estado finito`);
    assert.ok(maxBank < 50 * DEG, `${e.id}: alabeo controlado (${(maxBank * RAD).toFixed(0)}°)`);
    if (s.prop.type !== 'none') assert.ok(Math.abs(t.altitude - 150) < 12, `${e.id}: altitud ${t.altitude.toFixed(1)}`);
    else assert.ok(t.altitude > 70, `${e.id}: planeo prolongado (${t.altitude.toFixed(0)} m)`);
    assert.ok(Math.abs(((t.heading * RAD) - 90)) < 35, `${e.id}: rumbo final ${(t.heading * RAD).toFixed(0)}°`);
  }
});

test('despegue desde pista: el entrenador acelera por el empuje y despega en menos de 40 m', () => {
  const ac = aircraft('skylark');
  ac.resetTo(world, { x: 0, z: 0, heading: 0, onGround: true });
  run(ac, world, 0.5);
  assert.equal(ac.telemetry.wheelsOnGround, 3, 'apoyado en las tres ruedas');
  let lift = null;
  run(ac, world, 10, (a) => {
    a.cmd.throttle = 1;
    a.cmd.elevator = lift == null ? (a.telemetry.airspeed > a.spec.perf.stallSpeed * 1.3 ? 0.3 : 0) : (0.17 - a.telemetry.pitch) * 2 - a.omega.z * 0.3;
    a.cmd.rudder = -a.pos.x * 0.5 - a.vel.x * 0.6;
    if (lift == null && a.telemetry.wheelsOnGround === 0 && a.telemetry.agl > 0.5) lift = -a.pos.z;
  });
  assert.ok(lift != null && lift < 40, `carrera de despegue ${lift}`);
  assert.ok(ac.telemetry.agl > 5);
});

test('sin motor no hay despegue: la fricción y la resistencia frenan el avión', () => {
  const ac = aircraft('skylark');
  ac.resetTo(world, { x: 0, z: 0, heading: 0, onGround: true });
  ac.vel.set(0, 0, -8);
  run(ac, world, 6, (a) => { a.cmd.throttle = 0; });
  assert.ok(ac.telemetry.groundSpeed < 5, `velocidad residual ${ac.telemetry.groundSpeed}`);
  assert.ok(ac.telemetry.agl < 0.3, 'sigue en el suelo');
  run(ac, world, 2, (a) => { a.cmd.brake = 1; });
  assert.ok(ac.telemetry.groundSpeed < 0.5, 'los frenos lo detienen');
});

test('pérdida aerodinámica real: al tirar sin motor el ala entra en pérdida y se recupera cediendo', () => {
  const ac = aircraft('falcon46');
  const s = ac.spec;
  ac.resetTo(world, { x: 0, z: 0, y: 200, heading: 0, speed: s.perf.cruiseSpeed });
  let maxStall = 0, minSpeed = 99;
  run(ac, world, 8, (a) => {
    a.cmd.throttle = 0;
    a.cmd.elevator = 1;
    a.cmd.aileron = -a.telemetry.bank * 0.5;
    maxStall = Math.max(maxStall, a.telemetry.stall);
    minSpeed = Math.min(minSpeed, a.telemetry.airspeed);
  });
  assert.ok(maxStall > 0.4, `fracción de ala en pérdida ${maxStall.toFixed(2)}`);
  assert.ok(minSpeed < s.perf.stallSpeed * 1.05);
  let recovered = false;
  run(ac, world, 4, (a) => {
    a.cmd.elevator = 0; a.cmd.throttle = 1; a.cmd.aileron = 0;
    if (a.telemetry.stall < 0.1 && a.telemetry.airspeed > s.perf.stallSpeed * 1.2) recovered = true;
  });
  assert.ok(recovered, 'recuperado al ceder la profundidad');
});

test('el viento modifica la velocidad respecto al suelo y la deriva', () => {
  const s = spec('skylark');
  const calm = aircraft('skylark'), windy = aircraft('skylark');
  const ap1 = new Autopilot(s), ap2 = new Autopilot(s);
  const head = flatWorld({ wind: [0, 0, 5] }); // viento hacia el sur: en contra si se vuela al norte
  calm.resetTo(world, { x: 0, z: 0, y: 100, heading: 0, speed: 12 });
  windy.resetTo(head, { x: 0, z: 0, y: 100, heading: 0, speed: 12 });
  run(calm, world, 20, (a) => ap1.update(DT, a, { altitude: 100, heading: 0, speed: 12 }));
  run(windy, head, 20, (a) => ap2.update(DT, a, { altitude: 100, heading: 0, speed: 12 }));
  assert.ok(Math.abs(calm.telemetry.airspeed - windy.telemetry.airspeed) < 1.5, 'misma velocidad aerodinámica');
  assert.ok(windy.telemetry.groundSpeed < calm.telemetry.groundSpeed - 3.5, 'menor velocidad respecto al suelo con viento de cara');
  const cross = aircraft('skylark');
  const crossW = flatWorld({ wind: [4, 0, 0] });
  cross.resetTo(crossW, { x: 0, z: 0, y: 100, heading: 0, speed: 12 });
  cross.vel.x += 4; // la aeronave se mueve con la masa de aire
  const ap3 = new Autopilot(s);
  run(cross, crossW, 10, (a) => ap3.update(DT, a, { altitude: 100, heading: 0, speed: 12 }));
  assert.ok(cross.pos.x > 25, `deriva lateral ${cross.pos.x.toFixed(1)} m`);
});

test('el paso fijo hace que la física no dependa de los FPS', () => {
  const simulate = (frameDt) => {
    const ac = aircraft('extra300');
    ac.resetTo(world, { x: 0, z: 0, y: 100, heading: 0.3, speed: 18 });
    let acc = 0, steps = 0;
    while (steps < 1200) {
      acc += frameDt;
      while (acc >= DT - 1e-12 && steps < 1200) {
        ac.cmd.throttle = 0.8; ac.cmd.aileron = 0.4; ac.cmd.elevator = 0.2;
        ac.step(DT, world);
        acc -= DT;
        steps++;
      }
    }
    return ac;
  };
  const a = simulate(1 / 120), b = simulate(1 / 30);
  assert.ok(Math.abs(a.pos.x - b.pos.x) < 1e-6 && Math.abs(a.pos.y - b.pos.y) < 1e-6 && Math.abs(a.q.w - b.q.w) < 1e-9);
});

test('aterrizaje duro daña el tren; impacto fuerte destruye la aeronave; sin daños no hay daño', () => {
  const soft = aircraft('skylark');
  soft.resetTo(world, { x: 0, z: 0, y: 1.2, heading: 0, pitch: 3 * DEG, speed: 9 });
  soft.vel.y = -0.6;
  run(soft, world, 3, (a) => { a.cmd.throttle = 0; });
  assert.equal(soft.damage.gear, 1, 'toma suave sin daños');
  const hard = aircraft('skylark');
  hard.resetTo(world, { x: 0, z: 0, y: 1.5, heading: 0, speed: 9 });
  hard.vel.y = -5.5;
  run(hard, world, 2, (a) => { a.cmd.throttle = 0; });
  assert.ok(hard.damage.gear < 1, 'tren dañado');
  const crash = aircraft('extra300');
  crash.resetTo(world, { x: 0, z: 0, y: 30, heading: 0, pitch: -80 * DEG, speed: 30 });
  run(crash, world, 3);
  assert.ok(crash.destroyed, 'picado contra el suelo: destruida');
  const nodmg = aircraft('extra300', { damage: false });
  nodmg.resetTo(world, { x: 0, z: 0, y: 30, heading: 0, pitch: -80 * DEG, speed: 30 });
  run(nodmg, world, 3);
  assert.ok(!nodmg.destroyed && nodmg.damage.fuselage === 1, 'con daños desactivados no hay destrucción');
});

test('los daños tienen consecuencias: perder un ala provoca alabeo incontrolable', () => {
  const ac = aircraft('skylark');
  ac.resetTo(world, { x: 0, z: 0, y: 200, heading: 0, speed: 13 });
  ac.damage.lostWingR = true;
  run(ac, world, 2, (a) => { a.cmd.throttle = 0.6; a.cmd.aileron = 0; });
  assert.ok(ac.telemetry.bank > 60 * DEG || ac.omega.x > 1, 'rueda hacia el ala perdida');
});

test('colisión con un edificio: evento, impulso y daño', () => {
  const col = new CollisionSystem(16);
  col.addBox({ x: 0, y: 4, z: -32, hx: 5, hy: 4, hz: 3, id: 'house' });
  const w = flatWorld({ collision: col });
  const ac = aircraft('voltranger');
  ac.resetTo(w, { x: 0, z: 0, y: 3, heading: 0, speed: 14 });
  const events = [];
  run(ac, w, 3, (a) => { a.cmd.throttle = 0.7; events.push(...a.events.splice(0)); });
  assert.ok(events.some((e) => e.type === 'collision'), 'evento de colisión');
  assert.ok(ac.pos.z > -36, 'no atraviesa el obstáculo');
});

test('caer al agua genera salpicadura y detiene el motor de combustión', () => {
  const w = flatWorld({ water: 0.5 });
  const ac = aircraft('cubj3');
  ac.resetTo(w, { x: 0, z: 0, y: 6, heading: 0, pitch: -20 * DEG, speed: 12 });
  const events = [];
  run(ac, w, 3, (a) => { a.cmd.throttle = 0.5; events.push(...a.events.splice(0)); });
  assert.ok(events.some((e) => e.type === 'splash'));
  assert.ok(ac.inWater && !ac.engine.running);
});

test('asistencia de principiante: nivela las alas sin tocar la orientación directamente', () => {
  const s = spec('skylark');
  const ac = aircraft('skylark');
  ac.resetTo(world, { x: 0, z: 0, y: 150, heading: 0, bank: 50 * DEG, speed: 13 });
  const fa = new FlightAssist(s);
  const out = {};
  run(ac, world, 5, (a) => {
    fa.apply(DT, { aileron: 0, elevator: 0, rudder: 0, throttle: 0.6 }, a, { assist: 'beginner', maxBank: 45, maxPitch: 30 }, out);
    Object.assign(a.cmd, out);
  });
  assert.ok(Math.abs(ac.telemetry.bank) < 6 * DEG, `alabeo final ${(ac.telemetry.bank * RAD).toFixed(1)}°`);
  // experto: sin ayudas, las órdenes pasan sin cambios
  fa.apply(DT, { aileron: 0.3, elevator: -0.2, rudder: 0.1, throttle: 0.5 }, ac, { assist: 'expert' }, out);
  assert.deepEqual([out.aileron, out.elevator, out.rudder], [0.3, -0.2, 0.1]);
});

test('el planeador mide en vuelo un planeo coherente con la ficha técnica', () => {
  const s = spec('nimbusf3j');
  const ac = aircraft('nimbusf3j');
  ac.resetTo(world, { x: 0, z: 0, y: 300, heading: 0, speed: s.perf.bestLDSpeed });
  const ap = new Autopilot(s);
  run(ac, world, 10, (a) => ap.update(DT, a, { altitude: 0, heading: 0, speed: s.perf.bestLDSpeed }));
  const y0 = ac.pos.y, z0 = ac.pos.z;
  run(ac, world, 30, (a) => ap.update(DT, a, { altitude: 0, heading: 0, speed: s.perf.bestLDSpeed }));
  const ld = Math.abs(ac.pos.z - z0) / (y0 - ac.pos.y);
  assert.ok(ld > s.perf.bestLD * 0.6 && ld < s.perf.bestLD * 1.25, `L/D medido ${ld.toFixed(1)} vs ficha ${s.perf.bestLD.toFixed(1)}`);
});

test('principiante sin topes: el stick permite toneles y loopings completos', () => {
  for (const id of ['skylark', 'extra300', 'f16']) {
    const s = spec(id);
    const fa = new FlightAssist(s);
    const out = {};
    const cfg = { assist: 'beginner', maxBank: 45, maxPitch: 30 }; // limitAttitude desactivado (por defecto)
    // tonel: alerón a fondo
    const ac = aircraft(id);
    ac.resetTo(world, { x: 0, z: 0, y: 300, heading: 0, speed: Math.max(s.perf.cruiseSpeed, s.perf.stallSpeed * 2) });
    let rolled = 0;
    run(ac, world, 6, (a) => {
      fa.apply(DT, { aileron: 1, elevator: 0, rudder: 0, throttle: 1 }, a, cfg, out);
      Object.assign(a.cmd, out);
      rolled += a.omega.x * DT;
    });
    assert.ok(rolled * RAD > 360, `${id}: giro de alabeo ${(rolled * RAD).toFixed(0)}° (sin tope)`);
    // looping: profundidad a fondo
    const lp = aircraft(id);
    lp.resetTo(world, { x: 0, z: 0, y: 300, heading: 0, speed: Math.min(s.perf.cruiseSpeed, s.perf.stallSpeed * 2.6) });
    let pitched = 0;
    run(lp, world, 8, (a) => {
      fa.apply(DT, { aileron: 0, elevator: 1, rudder: 0, throttle: 1 }, a, cfg, out);
      Object.assign(a.cmd, out);
      pitched += a.omega.z * DT;
    });
    assert.ok(pitched * RAD > 330 && !lp.destroyed, `${id}: giro de cabeceo ${(pitched * RAD).toFixed(0)}° (looping completo)`);
  }
});

test('principiante con topes activados: el alabeo queda limitado al ángulo configurado', () => {
  const s = spec('skylark');
  const fa = new FlightAssist(s);
  const out = {};
  const ac = aircraft('skylark');
  ac.resetTo(world, { x: 0, z: 0, y: 200, heading: 0, speed: 13 });
  let maxBank = 0;
  run(ac, world, 6, (a) => {
    fa.apply(DT, { aileron: 1, elevator: 0, rudder: 0, throttle: 0.7 }, a, { assist: 'beginner', limitAttitude: true, maxBank: 45, maxPitch: 30 }, out);
    Object.assign(a.cmd, out);
    maxBank = Math.max(maxBank, Math.abs(a.telemetry.bank));
  });
  assert.ok(maxBank < 55 * DEG, `alabeo máximo ${(maxBank * RAD).toFixed(0)}°`);
});
