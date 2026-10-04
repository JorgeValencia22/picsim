/** Pruebas unitarias: matemática, coeficientes aerodinámicos, atmósfera y propulsión. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3, Quat, attitudeFromQuat, DEG } from '../src/utils/math3d.js';
import { liftSlope, panelCoefficients, airDensity, controlEffectiveness, groundEffectFactor } from '../src/aircraft/Aerodynamics.js';
import { Propulsion } from '../src/aircraft/Propulsion.js';
import { spec } from './helpers.js';

test('cuaternión: rumbo/cabeceo/alabeo ida y vuelta', () => {
  const q = new Quat().setFromHeadingPitchBank(1.2, 0.3, -0.5);
  const a = attitudeFromQuat(q);
  assert.ok(Math.abs(a.heading - 1.2) < 1e-6);
  assert.ok(Math.abs(a.pitch - 0.3) < 1e-6);
  assert.ok(Math.abs(a.bank + 0.5) < 1e-6);
});

test('cuaternión: integración de velocidad angular conserva la norma y gira lo esperado', () => {
  const q = new Quat();
  for (let i = 0; i < 1000; i++) q.integrateBody(Math.PI, 0, 0, 0.001); // 180° de alabeo en 1 s
  const a = attitudeFromQuat(q);
  assert.ok(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-9);
  assert.ok(Math.abs(Math.abs(a.bank) - Math.PI) < 1e-3);
  const v = new Vec3(0, 1, 0).applyQuat(q);
  assert.ok(v.y < -0.999, 'el eje arriba del cuerpo apunta hacia abajo tras medio tonel');
});

test('pendiente de sustentación de ala finita menor que 2π y creciente con el alargamiento', () => {
  assert.ok(liftSlope(6) < 2 * Math.PI && liftSlope(6) > 3.5);
  assert.ok(liftSlope(20) > liftSlope(6));
  assert.ok(liftSlope(6, 40 * DEG) < liftSlope(6));
});

test('CL crece linealmente, alcanza un máximo y cae en pérdida (modelo 360°)', () => {
  const a = liftSlope(6);
  const p = { cl0: 0.2, a, alphaStallPos: (1.35 - 0.2) / a, alphaStallNeg: -1.2 / a, cd0: 0.012, k: 1 / (Math.PI * 0.8 * 6), plate: 0.9, stallWidth: 3 * DEG };
  const o = {};
  const cl = (deg) => panelCoefficients(deg * DEG, 0, p, o).cl;
  assert.ok(Math.abs(cl(0) - 0.2) < 0.02);
  assert.ok(cl(5) > cl(2));
  let max = 0, maxAt = 0;
  for (let d = 0; d < 40; d += 0.25) if (cl(d) > max) { max = cl(d); maxAt = d; }
  assert.ok(max > 1.05 && max < 1.45, `CLmax ${max}`);
  assert.ok(cl(maxAt + 10) < max * 0.85, 'la sustentación disminuye tras la pérdida');
  const cdLow = panelCoefficients(4 * DEG, 0, p, o).cd;
  const cdHigh = panelCoefficients(30 * DEG, 0, p, o).cd;
  assert.ok(cdHigh > cdLow * 5, 'la resistencia aumenta en pérdida');
  assert.ok(panelCoefficients(25 * DEG, 0, p, o).stalled > 0.8);
  // flap: más sustentación al mismo ángulo y CLmax mayor
  let maxF = 0;
  for (let d = -5; d < 40; d += 0.25) maxF = Math.max(maxF, panelCoefficients(d * DEG, 0.2, p, o).cl);
  assert.ok(maxF > max + 0.05);
});

test('eficacia de mandos, efecto suelo y densidad del aire', () => {
  assert.ok(controlEffectiveness(0.5) > controlEffectiveness(0.25));
  assert.ok(groundEffectFactor(0.1, 1.5) < groundEffectFactor(5, 1.5));
  assert.ok(Math.abs(airDensity(0, 15) - 1.225) < 0.005);
  assert.ok(airDensity(1500, 15, 1500) < airDensity(0, 15));
  assert.ok(airDensity(0, 35) < airDensity(0, 0), 'aire caliente menos denso');
});

test('propulsión eléctrica: respuesta progresiva, empuje decreciente con la velocidad y consumo', () => {
  const pr = new Propulsion(spec('skylark').prop);
  pr.update(0.02, 1, 0, 1.225);
  assert.ok(pr.r < 0.5, 'la potencia no es instantánea');
  for (let i = 0; i < 200; i++) pr.update(0.01, 1, 0, 1.225);
  const t0 = pr.thrust;
  assert.ok(Math.abs(t0 - spec('skylark').prop.thrust) / t0 < 0.15, `empuje estático ${t0}`);
  pr.update(0.01, 1, 15, 1.225);
  assert.ok(pr.thrust < t0 * 0.7, 'el empuje cae con la velocidad de avance');
  assert.ok(pr.energyUsed > 0 && pr.remaining < 1);
  assert.ok(pr.slipstream > 0, 'estela de la hélice');
});

test('turbina: aceleración lenta y parada por falta de combustible', () => {
  const p = { ...spec('vipersj').prop, capacity: 60 };
  const pr = new Propulsion(p);
  pr.update(0.1, 1, 0, 1.225);
  const early = pr.thrust;
  for (let i = 0; i < 30; i++) pr.update(0.1, 1, 0, 1.225);
  assert.ok(pr.running && early < pr.thrust * 0.3, 'retardo de la turbina');
  for (let i = 0; i < 2000 && pr.running; i++) pr.update(0.1, 1, 0, 1.225);
  assert.equal(pr.running, false, 'se detiene sin combustible');
});
