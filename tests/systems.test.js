/** Pruebas de integración de los sistemas: escenarios, meteorología, juego, repeticiones y controles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENTS, createEnvironment } from '../src/data/environmentData.js';
import { WeatherSystem } from '../src/core/WeatherSystem.js';
import { ManeuverDetector } from '../src/gameplay/ManeuverDetector.js';
import { LandingEvaluator } from '../src/gameplay/LandingEvaluator.js';
import { ReplayRecorder, ReplayPlayer } from '../src/gameplay/Replay.js';
import { Statistics } from '../src/gameplay/Statistics.js';
import { MissionRunner, LESSONS, CHALLENGES, medalFor } from '../src/gameplay/Missions.js';
import { GamepadControls } from '../src/controls/GamepadControls.js';
import { expoCurve } from '../src/controls/InputManager.js';
import { MODE_MAP } from '../src/controls/TouchControls.js';
import { detectTransmitter, transmitterAxisMap } from '../src/controls/RadioController.js';
import { defaultSettings, deepMerge } from '../src/data/settings.js';
import { Vec3, DEG } from '../src/utils/math3d.js';
import { flatWorld, spec, aircraft, run, DT, memoryStorage } from './helpers.js';

const envCache = {};
const env = (id) => (envCache[id] ||= createEnvironment(id));

test('los 6 escenarios se generan con pista plana, piloto en tierra y colisionadores', () => {
  assert.equal(ENVIRONMENTS.length, 6);
  for (const e of ENVIRONMENTS) {
    const E = env(e.id);
    const rw = E.runways[0];
    const h0 = E.heightAt(rw.x, rw.z);
    const hd = rw.heading * DEG;
    for (const d of [-rw.length / 2 + 5, rw.length / 2 - 5]) {
      const h = E.heightAt(rw.x + Math.sin(hd) * d, rw.z - Math.cos(hd) * d);
      assert.ok(Math.abs(h - h0) < 1.0, `${e.id}: pista plana (${(h - h0).toFixed(2)} m)`);
    }
    assert.equal(E.waterLevelAt(E.pilot.x, E.pilot.z), null, `${e.id}: piloto fuera del agua`);
    assert.ok(E.collision.count > 100, `${e.id}: colisionadores`);
    assert.ok(E.props.filter((p) => p.type === 'tree').length > 200, `${e.id}: vegetación`);
  }
});

test('la altura física coincide exactamente con los vértices de la malla', () => {
  const E = env('airfield');
  const n = E.res + 1;
  for (const [i, j] of [[10, 10], [128, 77], [200, 31]]) {
    const x = -E.half + i * E.cell, z = -E.half + j * E.cell;
    assert.ok(Math.abs(E.heightAt(x, z) - E.hf[j * n + i]) < 1e-4);
  }
});

test('superficies: pista de asfalto, arena en la costa y agua del mar', () => {
  assert.equal(env('competition').surfaceTypeAt(0, -35), 'asphalt');
  const c = env('coast');
  assert.equal(c.waterLevelAt(-800, 0), 0, 'mar');
  assert.ok(['sand', 'rock'].includes(c.surfaceTypeAt(c.coastX(300) + 25, 300)));
});

test('meteorología: ascendencia de ladera a barlovento, térmicas y densidad con la altitud', () => {
  const M = env('mountains');
  const w = new WeatherSystem({ windSpeed: 8, windDir: 270, gusts: 0, turbulence: 0, thermals: 0 }, M);
  const out = new Vec3();
  const xFace = M.crestX(0) - 60;
  const lift = w.sampleWind({ x: xFace, y: M.heightAt(xFace, 0) + 30, z: 0 }, out).y;
  assert.ok(lift > 1.5, `ascendencia de ladera ${lift.toFixed(2)} m/s`);
  const xLee = M.crestX(0) + 400;
  assert.ok(w.sampleWind({ x: xLee, y: M.heightAt(xLee, 0) + 200, z: 0 }, out).y < lift);
  assert.ok(w.density(0) > w.density(500), 'menor densidad con la altura');
  assert.ok(w.density(0) < 1.12, 'la cota de 1150 m reduce la densidad');
  const th = new WeatherSystem({ windSpeed: 0, thermals: 1, timeOfDay: 13, sky: 'clear' }, env('countryside'));
  const t0 = th.thermals[0];
  t0.age = 100;
  const core = th.sampleWind({ x: t0.x, y: env('countryside').heightAt(t0.x, t0.z) + 120, z: t0.z }, out).y;
  assert.ok(core > 0.5, `núcleo de térmica ${core.toFixed(2)} m/s`);
  const night = new WeatherSystem({ thermals: 1, timeOfDay: 23 }, env('countryside'));
  assert.equal(night.thermals.length, 0, 'sin térmicas de noche');
});

test('maniobras detectadas a partir del vuelo real: looping y tonel del Extra 300', () => {
  const world = flatWorld();
  const s = spec('extra300');
  const det = new ManeuverDetector(s.perf.stallSpeed);
  const telem = (a) => ({ omega: a.omega, heading: a.telemetry.heading, pitch: a.telemetry.pitch, bank: a.telemetry.bank, upY: a.telemetry.upY, rightY: -Math.sin(a.telemetry.bank) * Math.cos(a.telemetry.pitch), altitude: a.pos.y, airspeed: a.telemetry.airspeed, vs: a.telemetry.vs, alpha: a.telemetry.alpha, stall: a.telemetry.stall, onGround: false, agl: a.pos.y });
  const found = [];
  const ac = aircraft('extra300');
  ac.resetTo(world, { x: 0, z: 0, y: 250, heading: 0, speed: 24 });
  let pitched = 0;
  run(ac, world, 9, (a, t) => {
    a.cmd.throttle = 1;
    pitched += a.omega.z * DT;
    // tirón moderado (30 %): con más profundidad el Extra entra en pérdida acelerada y hace un snap roll
    a.cmd.elevator = pitched < 6.1 ? 0.3 : 0;
    a.cmd.aileron = 0;
    if (Math.round(t / DT) % 4 === 0) found.push(...det.update(DT * 4, telem(a)));
  });
  assert.ok(found.some((m) => m.id === 'loop'), `looping detectado (${found.map((m) => m.id)})`);
  const ac2 = aircraft('extra300');
  ac2.resetTo(world, { x: 0, z: 0, y: 250, heading: 0, speed: 24 });
  det.reset();
  const f2 = [];
  let rolled = 0;
  run(ac2, world, 6, (a, t) => {
    a.cmd.throttle = 0.8;
    rolled += a.omega.x * DT;
    a.cmd.aileron = rolled < 6.1 ? 1 : -a.omega.x * 0.2;
    a.cmd.elevator = 0.05;
    if (Math.round(t / DT) % 4 === 0) f2.push(...det.update(DT * 4, telem(a)));
  });
  assert.ok(f2.some((m) => m.id === 'roll' || m.id === 'doubleRoll'), `tonel detectado (${f2.map((m) => m.id)})`);
});

test('evaluación de aterrizaje: suave y alineado puntúa alto; duro puntúa bajo', () => {
  const rw = { x: 0, z: 0, heading: 0, length: 140, width: 14 };
  const mk = (vs, bank) => {
    const ev = new LandingEvaluator({ stallSpeed: 7, runways: [rw], target: null });
    const s = { pos: { x: 0, z: 0 }, vs: -vs, airspeed: 8.5, groundSpeed: 8.5, bank: bank * DEG, pitch: 0.05, heading: 0, agl: 10, wheelContact: false, destroyed: false, damageSum: 7, track: 0 };
    for (let i = 0; i < 200; i++) ev.update(0.02, s); // en el aire
    s.agl = 0; s.wheelContact = true;
    let r = null;
    for (let i = 0; i < 200 && !r; i++) r = ev.update(0.02, s);
    return r;
  };
  const good = mk(0.3, 1), hard = mk(3, 12);
  assert.ok(good.score >= 90 && good.grade.id === 'perfect', `suave ${good.score}`);
  assert.ok(hard.score < 50, `duro ${hard.score}`);
});

test('repetición: grabación compacta e interpolación fiel de la trayectoria', () => {
  const world = flatWorld();
  const ac = aircraft('skylark');
  ac.resetTo(world, { x: 0, z: 0, y: 50, heading: 0, speed: 13 });
  const rec = new ReplayRecorder(30);
  rec.reset({ aircraft: 'skylark' });
  const truth = [];
  run(ac, world, 10, (a, t) => {
    a.cmd.throttle = 0.6; a.cmd.aileron = 0.3;
    rec.update(DT, a);
    if (Math.abs((t % 1) - 0.5) < DT / 2) truth.push({ t: t + DT, z: a.pos.z, x: a.pos.x });
  });
  const replay = rec.finish();
  assert.ok(replay.meta.frames >= 295 && replay.meta.frames <= 302);
  assert.ok(replay.data.byteLength < 40000, 'menos de 40 KB para 10 s');
  const pl = new ReplayPlayer(replay);
  for (const p of truth) {
    const f = pl.sample(p.t);
    assert.ok(Math.hypot(f.pos.x - p.x, f.pos.z - p.z) < 0.25, `error de interpolación en t=${p.t.toFixed(1)}`);
  }
  pl.speed = 2; pl.seek(9.5);
  pl.update(1);
  assert.equal(pl.playing, false, 'se detiene al final');
});

test('estadísticas persistentes y récords', () => {
  const st = memoryStorage();
  const s = new Statistics(st);
  s.begin('skylark', 'Skylark', 'airfield', 'Aeródromo');
  for (let i = 0; i < 600; i++) s.tick(0.05, { agl: 20, airspeed: 12 }, true, { x: i * 0.6, y: 20, z: 0 }, i ? { x: (i - 1) * 0.6, y: 20, z: 0 } : null);
  s.landing({ score: 93, perfect: true, destroyed: false });
  s.maneuver('loop', 8);
  s.end();
  const again = new Statistics(st);
  assert.equal(again.data.flights, 1);
  assert.ok(Math.abs(again.data.flightTime - 30) < 0.01);
  assert.equal(again.data.perfectLandings, 1);
  assert.equal(again.data.maneuvers.loop, 1);
  assert.ok(again.data.distance > 350);
  assert.equal(again.record('challenge', 'c1', 70).better, true);
  assert.equal(again.record('challenge', 'c1', 60).better, false);
});

test('misiones: 8 lecciones y 10 desafíos; una lección avanza con el vuelo observado', () => {
  assert.equal(LESSONS.length, 8);
  assert.equal(CHALLENGES.length, 10);
  for (const c of CHALLENGES) assert.ok(c.medals.bronze < c.medals.silver && c.medals.silver < c.medals.gold);
  assert.equal(medalFor(CHALLENGES[0], 90), 'gold');
  assert.equal(medalFor(CHALLENGES[0], 10), null);
  const r = new MissionRunner(LESSONS[0]);
  const base = { dt: 0.1, ac: { omega: { y: 0 } }, input: { throttle: 0.6, aileron: 0.8 }, maneuvers: [], spawn: {} };
  r.update({ ...base, t: { bank: -30 * DEG, pitch: 0, vs: 0 } });
  assert.equal(r.step, 0, 'alabear en el sentido contrario no cuenta');
  r.update({ ...base, t: { bank: 30 * DEG, pitch: 0, vs: 0 } });
  assert.equal(r.step, 1, 'paso 1 completado al alabear a la derecha');
  r.update({ ...base, input: { throttle: 0.6, aileron: -0.8 }, t: { bank: -30 * DEG, pitch: 0, vs: 0 } });
  assert.equal(r.step, 2);
});

test('controles: curvas exponenciales, calibración de ejes, modos de emisora y detección de emisoras', () => {
  assert.equal(expoCurve(1, 0.5), 1);
  assert.ok(expoCurve(0.5, 0.5) < 0.5);
  const cfg = { index: 0, invert: false, center: 0.1, min: -0.8, max: 0.9, deadzone: 0.05 };
  assert.equal(GamepadControls.mapAxis(0.9, cfg), 1);
  assert.equal(GamepadControls.mapAxis(-0.8, cfg), -1);
  assert.equal(GamepadControls.mapAxis(0.11, cfg), 0, 'zona muerta');
  assert.equal(GamepadControls.mapAxis(-1, { index: 0, unipolar: true, min: -1, max: 1, deadzone: 0, invert: false }), 0);
  assert.equal(MODE_MAP[2].left.y, 'throttle');
  assert.equal(MODE_MAP[1].right.y, 'throttle');
  assert.ok(detectTransmitter({ id: 'EdgeTX RadioMaster TX16S Joystick' }));
  assert.equal(detectTransmitter({ id: 'Xbox Wireless Controller' }), null);
  assert.equal(transmitterAxisMap('AETR').throttle.index, 2);
});

test('configuración: la fusión conserva valores nuevos por defecto y respeta los del usuario', () => {
  const merged = deepMerge(defaultSettings(), { physics: { assist: 'expert' }, graphics: { preset: 'low' } });
  assert.equal(merged.physics.assist, 'expert');
  assert.equal(merged.physics.limitAttitude, false, 'sin topes de actitud por defecto');
  assert.equal(defaultSettings().physics.assist, 'expert', 'sin ayudas por defecto');
  assert.equal(defaultSettings().physics.fidelity, 'realistic');
  assert.equal(merged.graphics.preset, 'low');
  assert.ok(merged.controls.keyboard.bindings.throttleUp.includes('ShiftLeft'));
});

test('migración: configuraciones antiguas pasan a vuelo realista sin ayudas', async () => {
  const { migrateSettings } = await import('../src/data/settings.js');
  const old = { version: 1, physics: { assist: 'beginner', fidelity: 'casual', damage: false } };
  const m = migrateSettings(old);
  assert.equal(m.physics.assist, 'expert');
  assert.equal(m.physics.fidelity, 'realistic');
  assert.equal(m.physics.damage, false, 'conserva el resto de preferencias');
});
