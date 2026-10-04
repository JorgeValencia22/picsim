/**
 * Orquestador de la simulación: integra física (paso fijo de 240 Hz independiente de los FPS),
 * entorno, meteorología, entrada, asistencias, cámaras, renderizado, audio, efectos,
 * evaluaciones, misiones, estadísticas y repeticiones.
 *
 * Modos: 'menu' (vuelo de demostración con piloto automático detrás del menú principal),
 *        'flight' (vuelo del usuario) y 'replay' (reproducción / espectador).
 */
import * as THREE from 'three';
import { AircraftPhysics } from '../aircraft/AircraftPhysics.js';
import { FIDELITY } from '../aircraft/AeroModel.js';
import { Autopilot } from '../aircraft/Autopilot.js';
import { createEnvironment, environmentMeta } from '../data/environmentData.js';
import { WeatherSystem, defaultWeather } from './WeatherSystem.js';
import { EnvironmentRenderer } from '../render/EnvironmentRenderer.js';
import { SkySystem } from '../render/SkySystem.js';
import { AircraftModel } from '../render/AircraftModel.js';
import { Effects } from '../render/Effects.js';
import { FlightAssist } from '../controls/FlightAssist.js';
import { ManeuverDetector, MANEUVERS } from '../gameplay/ManeuverDetector.js';
import { LandingEvaluator } from '../gameplay/LandingEvaluator.js';
import { ReplayRecorder, ReplayPlayer } from '../gameplay/Replay.js';
import { MissionRunner } from '../gameplay/Missions.js';
import { Vec3, Quat, DEG, RAD, clamp, wrapPi } from '../utils/math3d.js';
import { L, T } from './i18n.js';
import { GRAPHICS_PRESETS } from '../data/settings.js';

export const PHYSICS_DT = 1 / 240;
const MAX_FRAME = 0.25;

const _q3 = new THREE.Quaternion(), _v3 = new THREE.Vector3(), _v3b = new THREE.Vector3();

export class Simulation {
  /**
   * @param {object} deps { settings, storage, registry, renderer, cameras, input, audio, bus, stats, replayStore }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.scene = new THREE.Scene();
    this.mode = 'idle';
    this.paused = false;
    this.env = null;
    this.envRenderer = null;
    this.sky = new SkySystem(this.scene, this.renderer.renderer, this.skyQuality());
    this.effects = new Effects(this.scene, this.settings.graphics.effects);
    this.acc = 0;
    this.simTime = 0;
    this.aircraft = null;
    this.model = null;
    this.assistOut = { aileron: 0, elevator: 0, rudder: 0, throttle: 0 };
    this.messages = [];
    this.renderState = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3() };
    this.lastStatPos = null;
    this.bungeeLine = null;
    this.frameStats = { fps: 60, physicsMs: 0, frameMs: 0 };
    this.timeScale = 1;
  }

  skyQuality() {
    const g = this.settings.graphics;
    return { clouds: g.clouds ?? 1, rain: g.effects ?? 1, birds: (g.effects ?? 1) > 0.4, envMap: g.envMap !== false };
  }

  /* ─────────────────────────── carga de sesiones ─────────────────────────── */

  /** Construye/reutiliza el escenario. */
  async ensureEnvironment(envId, onProgress) {
    if (this.env && this.env.id === envId) return false;
    onProgress?.(0.15, L('Generando terreno…', 'Generating terrain…'));
    await nextFrame();
    if (this.envRenderer) { this.envRenderer.dispose(); this.envRenderer = null; }
    this.env = createEnvironment(envId);
    onProgress?.(0.45, L('Construyendo escenario…', 'Building scenery…'));
    await nextFrame();
    const g = this.settings.graphics;
    this.envRenderer = new EnvironmentRenderer(this.env, { terrainDetail: g.terrainDetail ?? 1, vegetation: g.vegetation ?? 0.7, shadows: g.shadows !== 'off' });
    this.scene.add(this.envRenderer.group);
    onProgress?.(0.75, L('Preparando cámaras…', 'Preparing cameras…'));
    await nextFrame();
    return true;
  }

  /** Configuración meteorológica final para una sesión. */
  resolveWeather(cfg) {
    const w = { ...defaultWeather(), ...(cfg || {}) };
    return w;
  }

  /**
   * Carga una sesión de vuelo (aeronave + escenario + clima + lanzamiento).
   * @param {object} cfg { aircraft, environment, weather, launch, camera, mission, livery, mode }
   */
  async loadSession(cfg, onProgress) {
    this.stopReplay(false);
    this.session = { ...cfg };
    this.mode = cfg.mode || 'flight';
    const envChanged = await this.ensureEnvironment(cfg.environment, onProgress);
    const fid = this.settings.physics.fidelity;
    this.weather = new WeatherSystem(this.resolveWeather(cfg.weather), this.env, { turbulenceScale: this.turbulenceScale(fid), seed: (Date.now() & 0xffff) + 1 });
    this.world = {
      heightAt: (x, z) => this.env.heightAt(x, z),
      normalAt: (x, z, o) => this.env.normalAt(x, z, o),
      surfaceAt: (x, z) => this.env.surfaceAt(x, z),
      waterLevelAt: (x, z) => this.env.waterLevelAt(x, z),
      sampleWind: (p, o) => this.weather.sampleWind(p, o),
      density: (y) => this.weather.density(y),
      collision: this.env.collision,
      temperature: this.weather.cfg.temperature,
    };
    this.sky.configure(this.weather, this.env, this.settings.graphics.drawDistance);
    this.renderer.configureShadowLight(this.sky.sun);
    this.cameras.setEnvironment(this.env, this.env.pilot);
    this.cameras.camera.far = Math.max(1500, this.settings.graphics.drawDistance * 1.2);
    this.cameras.camera.updateProjectionMatrix();
    onProgress?.(0.85, L('Montando la aeronave…', 'Assembling the aircraft…'));
    await nextFrame();
    this.setAircraft(cfg.aircraft, cfg.livery);
    this.audio.setAmbience(this.env.ambience, this.weather);
    this.effects.reset();
    this.effects.setMarkers([]);
    this.mission = cfg.mission ? new MissionRunner(cfg.mission) : null;
    if (this.mission?.m.markers) this.effects.setMarkers(this.mission.m.markers(this.env, this.mission.m));
    this.landingEval = new LandingEvaluator({ stallSpeed: this.aircraft.spec.perf.stallSpeed, runways: this.env.runways, target: cfg.mission?.id === 'c7' || cfg.mission?.id === 'c1' ? this.env.landingTarget : null });
    this.maneuvers = new ManeuverDetector(this.aircraft.spec.perf.stallSpeed);
    this.mode = cfg.mode || 'flight';
    this.spawn(cfg.launch || 'runway');
    onProgress?.(1, '');
    return envChanged;
  }

  turbulenceScale(fid) {
    return { arcade: 0.35, casual: 0.65, realistic: 1, expert: 1.15 }[fid] ?? 1;
  }

  setAircraft(id, livery) {
    const spec = this.registry.get(id);
    if (this.model) { this.model.dispose(); this.model = null; }
    const fid = this.mode === 'menu' ? 'realistic' : this.settings.physics.fidelity;
    this.aircraft = new AircraftPhysics(spec, { fidelity: fid, damage: this.settings.physics.damage, seed: 1234 });
    const quality = this.settings.graphics;
    this.model = new AircraftModel(spec, livery || this.activeLivery(id), { shadows: quality.shadows !== 'off' });
    this.scene.add(this.model.root);
    this.assist = new FlightAssist(spec);
    this.autopilot = new Autopilot(spec);
    this.audio.setAircraft(spec);
    this.onboardOffset = this.computeOnboardOffset(spec);
    this.bus.emit('aircraftChanged', spec);
  }

  activeLivery(id) {
    const all = this.storage.get('liveries', {});
    const entry = all[id];
    if (entry && entry.slots && entry.slots[entry.active]) return entry.slots[entry.active].livery;
    return null;
  }

  computeOnboardOffset(spec) {
    const L = spec.length, H = spec.fuseH / 2;
    if (spec.canopy === 'none' || spec.fuseShape === 'profile') return new THREE.Vector3(spec.cgX - L * 0.75, H + spec.span * 0.06, 0);
    const t0 = spec.canopy === 'glider' ? 0.12 : spec.fuseShape === 'jet' ? 0.26 : spec.canopy === 'cabin' ? 0.22 : 0.36;
    return new THREE.Vector3(spec.cgX - L * t0, H * 1.05 + 0.02, 0);
  }

  /* ─────────────────────────── lanzamientos ─────────────────────────── */

  /** Rumbo de despegue de una pista orientado contra el viento. */
  runwayIntoWind(rw) {
    const h = rw.heading * DEG;
    const w = this.weather;
    const dot = Math.sin(h) * w.windDirX + -Math.cos(h) * w.windDirZ;
    return dot > 0 && w.cfg.windSpeed > 0.5 ? h + Math.PI : h;
  }

  intoWindHeading(fallback) {
    const w = this.weather;
    if (w.cfg.windSpeed < 0.5) return fallback;
    return Math.atan2(-w.windDirX, w.windDirZ); // dirección opuesta a hacia donde sopla
  }

  spawn(launch) {
    const ac = this.aircraft, env = this.env, spec = ac.spec;
    const ms = this.mission?.m.setup || {};
    let canHand = spec.mass <= 3.2 && spec.launch.includes('hand');
    if (launch === 'hand' && !canHand) launch = spec.launch.includes('bungee') ? 'bungee' : (spec.gearType === 'skid' || spec.gearType === 'mono' ? 'air' : 'runway');
    if (launch === 'runway' && (spec.gearType === 'skid' || spec.gearType === 'mono')) launch = spec.launch.includes('bungee') ? 'bungee' : 'hand';
    if (launch === 'bungee' && !spec.launch.includes('bungee') && spec.gearType !== 'skid') launch = 'runway';
    this.launchMode = launch;
    this.bungee = null;
    this.removeBungeeLine();
    const pilot = env.pilot;
    const vs = spec.perf.stallSpeed;
    const facing = (pilot.facing ?? 0) * DEG;
    const air = ms.air || this.session.air || {};
    switch (launch) {
      case 'runway': {
        const rw = env.runways[0];
        const hd = this.runwayIntoWind(rw);
        const dir = [Math.sin(hd), -Math.cos(hd)];
        const back = rw.length / 2 - Math.max(8, spec.span);
        ac.resetTo(this.world, { x: rw.x - dir[0] * back, z: rw.z - dir[1] * back, heading: hd, onGround: true });
        this.spawnInfo = { kind: 'runway', heading: hd };
        break;
      }
      case 'hand':
      case 'bungee': {
        const hd = this.intoWindHeading(facing);
        const hx = env.hand.x, hz = env.hand.z;
        if (launch === 'hand') {
          const y = env.heightAt(hx, hz) + 1.7;
          ac.resetTo(this.world, { x: hx, z: hz, y, heading: hd, pitch: 4 * DEG, speed: 0 });
          ac.hold(ac.pos, ac.q);
        } else {
          ac.resetTo(this.world, { x: hx, z: hz, heading: hd, onGround: true });
          ac.hold(ac.pos, ac.q);
          const dir = [Math.sin(hd), -Math.cos(hd)];
          const ax = hx + dir[0] * 170, az = hz + dir[1] * 170;
          this.bungee = { anchor: new Vec3(ax, env.heightAt(ax, az) + 0.2, az), armed: true, released: false, k: (3.6 * spec.mass * 9.81) / 120, rest: 50 };
          this.createBungeeLine();
        }
        this.spawnInfo = { kind: launch, heading: hd };
        break;
      }
      case 'approach': {
        const rw = env.runways[0];
        const hd = this.runwayIntoWind(rw);
        const dir = [Math.sin(hd), -Math.cos(hd)];
        const dist = air.dist ?? 220;
        const thx = rw.x - dir[0] * rw.length * 0.35, thz = rw.z - dir[1] * rw.length * 0.35;
        const x = thx - dir[0] * dist, z = thz - dir[1] * dist;
        const y = Math.max(env.heightAt(x, z), env.heightAt(thx, thz)) + (air.alt ?? 35);
        ac.resetTo(this.world, { x, z, y, heading: hd, pitch: -3 * DEG, speed: vs * 1.55 });
        this.spawnInfo = { kind: 'approach', heading: hd };
        break;
      }
      case 'air':
      default: {
        const dist = air.dist ?? 150;
        let x = pilot.x + Math.sin(facing) * dist, z = pilot.z - Math.cos(facing) * dist;
        let hd = facing + Math.PI / 2;
        if (air.toward) {
          x = air.toward.x - Math.sin(facing) * dist * 0.2 - Math.cos(facing) * dist;
          z = air.toward.z + Math.cos(facing) * dist * 0.2 - Math.sin(facing) * dist;
          hd = Math.atan2(air.toward.x - x, -(air.toward.z - z));
        }
        const y = env.heightAt(x, z) + (air.alt ?? 70);
        ac.resetTo(this.world, { x, z, y, heading: hd, speed: Math.max(spec.trimSpeed || vs * 1.6, vs * 1.4) });
        this.spawnInfo = { kind: 'air', heading: hd };
        break;
      }
    }
    if (ms.battery != null && ac.engine.isElectric) ac.engine.energyUsed = spec.prop.capacity * (1 - ms.battery);
    this.spawnInfo.y = ac.pos.y;
    this.spawnInfo.x = ac.pos.x;
    this.spawnInfo.z = ac.pos.z;
    this.input.resetSwitches();
    const thr = launch === 'air' || launch === 'approach' ? (ms.throttle ?? (launch === 'approach' ? 0.35 : 0.6)) : 0;
    this.input.keyboard.values.throttle = thr;
    this.input.out.throttle = thr;
    this.input.touch.syncThrottle(thr);
    if (thr > 0 && ac.engine.spec.type !== 'none') {
      // el motor arranca ya en régimen para los inicios en vuelo
      ac.engine.r = ac.engine.isFuel && ac.engine.spec.type !== 'turbine' ? Math.max(ac.engine.r, thr) : thr;
    }
    ac.cmd.throttle = thr;
    this.assist.reset();
    this.autopilot.reset();
    this.landingEval?.reset();
    this.maneuvers?.reset();
    this.effects.reset();
    this.signal = 1;
    this.failsafe = false;
    this.crashed = false;
    this.flightTime = 0;
    this.acc = 0;
    this.renderState.pos.set(ac.pos.x, ac.pos.y, ac.pos.z);
    this.cameras.initialized = false;
    if (this.mode === 'flight') {
      this.recorder = new ReplayRecorder();
      this.recorder.reset({ aircraft: spec.id, aircraftName: spec.name, environment: this.env.id, envName: T(this.env.name), weather: { ...this.weather.cfg }, livery: this.activeLivery(spec.id), mission: this.mission?.m.id ?? null });
      this.stats.begin(spec.id, spec.name, this.env.id, T(this.env.name), this.mission ? this.mission.m.kind : 'free');
    }
    this.bus.emit('spawned', { launch, held: !!ac.held, spec });
  }

  /** Lanzamiento a mano o suelta de la goma. */
  launch() {
    const ac = this.aircraft;
    if (!ac || !ac.held) return false;
    const spec = ac.spec;
    if (this.launchMode === 'bungee' && this.bungee) {
      ac.release(new Vec3(0, 0, 0));
      this.bungee.armed = false;
      this.audio.play('launch');
      return true;
    }
    const f = ac.bodyForward;
    const speed = clamp(spec.perf.stallSpeed * 1.35, 7, 13);
    ac.release(new Vec3(f.x * speed, f.y * speed + 1.2, f.z * speed));
    this.audio.play('launch');
    this.recorder?.event('launch');
    return true;
  }

  createBungeeLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.bungeeLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#202020' }));
    this.bungeeLine.frustumCulled = false;
    this.scene.add(this.bungeeLine);
  }

  removeBungeeLine() {
    if (!this.bungeeLine) return;
    this.bungeeLine.geometry.dispose();
    this.bungeeLine.material.dispose();
    this.bungeeLine.removeFromParent();
    this.bungeeLine = null;
  }

  /** Fuerza de la goma de lanzamiento (aplicada en el gancho bajo el morro). */
  applyBungee() {
    const b = this.bungee;
    if (!b || b.released || b.armed) return;
    const ac = this.aircraft;
    const hookB = new Vec3(ac.spec.length * 0.06, -ac.spec.fuseH * 0.5, 0); // gancho ligeramente delante del CG
    const hook = hookB.clone().applyQuat(ac.q).add(ac.pos);
    const d = new Vec3().subVectors(b.anchor, hook);
    const len = d.length();
    const horiz = Math.hypot(d.x, d.z);
    const angle = Math.atan2(-d.y, horiz); // ángulo de la línea bajo la horizontal
    const stretch = len - b.rest;
    if (stretch <= 0 || angle > 55 * DEG || horiz < 25) {
      b.released = true;
      this.removeBungeeLine();
      this.bus.emit('message', { text: L('Goma liberada', 'Bungee released'), kind: 'info' });
      return;
    }
    d.scale((b.k * stretch) / len);
    ac.addExternalForce(hookB, d);
    b.hook = hook;
  }

  resetAircraft() {
    if (!this.aircraft) return;
    this.finishRecording();
    this.mission?.onReset();
    this.spawn(this.launchMode || this.session.launch);
    this.bus.emit('message', { text: L('Aeronave reiniciada', 'Aircraft reset'), kind: 'info' });
  }

  /* ─────────────────────────── bucle principal ─────────────────────────── */

  frame(dtReal) {
    const dt = Math.min(MAX_FRAME, dtReal);
    const t0 = performance.now();
    if (this.mode === 'replay') this.updateReplay(dt);
    else if (this.aircraft && (this.mode === 'flight' || this.mode === 'menu')) {
      if (!this.paused) this.simulate(dt * this.timeScale);
      else this.input.update(0);
    }
    const t1 = performance.now();
    this.render(dt);
    this.frameStats.physicsMs = t1 - t0;
    this.frameStats.frameMs = performance.now() - t0;
  }

  simulate(dt) {
    const ac = this.aircraft;
    const isMenu = this.mode === 'menu';
    // entrada (a la frecuencia de fotogramas; los servos ya filtran a la de la física)
    if (!isMenu) this.applyInput(dt);
    this.weather.update(dt);
    // pasos fijos de física
    this.acc += dt;
    let steps = 0;
    const tp = performance.now();
    while (this.acc >= PHYSICS_DT && steps < 120) {
      if (isMenu) this.menuAutopilot(PHYSICS_DT);
      if (this.bungee) this.applyBungee();
      ac.step(PHYSICS_DT, this.world);
      this.acc -= PHYSICS_DT;
      this.simTime += PHYSICS_DT;
      steps++;
    }
    this.frameStats.physicsSteps = steps;
    this.frameStats.physicsCalcMs = performance.now() - tp;
    this.alpha = this.acc / PHYSICS_DT;
    if (!isMenu) {
      this.flightTime += dt;
      this.processEvents(dt);
      this.updateGameplay(dt);
      this.recorder?.update(dt, ac);
    } else {
      ac.events.length = 0;
      if (ac.destroyed || ac.pos.y < this.env.heightAt(ac.pos.x, ac.pos.z) - 5 || ac.telemetry.onGround) this.startMenuDemo(true);
    }
  }

  applyInput(dt) {
    const ac = this.aircraft;
    const raw = this.input.update(dt);
    const spec = ac.spec;
    const cfg = this.settings.physics;
    // aeronaves sin alerones (RES): el stick de alerones mueve el timón
    const inp = { aileron: raw.aileron, elevator: raw.elevator, rudder: raw.rudder, throttle: raw.throttle };
    if (!spec.hasAilerons && cfg.assist !== 'beginner') inp.rudder = clamp(raw.rudder + raw.aileron, -1, 1);
    // mezcla alerón→timón configurable (coordinación)
    const mix = this.settings.controls.mixAileronRudder || 0;
    if (mix && spec.hasAilerons) inp.rudder = clamp(inp.rudder + raw.aileron * mix, -1, 1);
    const out = this.assist.apply(dt, inp, ac, cfg, this.assistOut);
    // enlace de radio simulado: fuera de alcance → failsafe (motor a ralentí, mandos neutros)
    const dPilot = Math.hypot(ac.pos.x - this.env.pilot.x, ac.pos.z - this.env.pilot.z, ac.pos.y - this.env.heightAt(this.env.pilot.x, this.env.pilot.z));
    const R = cfg.flightRadius || 900;
    this.signal = clamp(1 - (dPilot - R * 0.75) / (R * 0.4), 0, 1);
    const wasFailsafe = this.failsafe;
    this.failsafe = cfg.signalLoss !== false && dPilot > R * 1.12;
    if (this.failsafe && !wasFailsafe) { this.bus.emit('message', { text: L('¡PÉRDIDA DE SEÑAL! Failsafe activo', 'SIGNAL LOST! Failsafe active'), kind: 'danger' }); this.audio.play('warning'); }
    if (!this.failsafe && wasFailsafe) this.bus.emit('message', { text: L('Señal recuperada', 'Signal recovered'), kind: 'ok' });
    if (this.failsafe) { out.aileron = 0; out.elevator = 0.1; out.rudder = 0; out.throttle = 0; }
    ac.cmd.aileron = out.aileron;
    ac.cmd.elevator = out.elevator;
    ac.cmd.rudder = out.rudder;
    ac.cmd.throttle = out.throttle;
    ac.cmd.trim = this.failsafe ? { aileron: 0, elevator: 0, rudder: 0 } : raw.trim;
    ac.cmd.flap = raw.flap;
    ac.cmd.airbrake = raw.airbrake;
    ac.cmd.brake = raw.brake;
    if (ac.cmd.gearDown !== raw.gearDown && spec.retract) this.audio.play('gear');
    ac.cmd.gearDown = raw.gearDown;
    // en tierra a baja velocidad, el freno se aplica automáticamente con motor cortado (como un RC real sin freno, mucha fricción)
    if (ac.telemetry.wheelsOnGround > 0 && raw.throttle < 0.02 && ac.telemetry.groundSpeed < 2) ac.cmd.brake = Math.max(ac.cmd.brake, 0.4);
  }

  /** Piloto automático del vuelo de demostración: circuito sobre el aeródromo. */
  menuAutopilot(dt) {
    const ac = this.aircraft;
    const t = ac.telemetry;
    if (!this.demo) return;
    const wp = this.demo.points[this.demo.i];
    const dx = wp.x - ac.pos.x, dz = wp.z - ac.pos.z;
    if (Math.hypot(dx, dz) < 60) this.demo.i = (this.demo.i + 1) % this.demo.points.length;
    const hd = Math.atan2(dx, -dz);
    this.autopilot.update(dt, ac, { heading: hd, altitude: this.env.heightAt(ac.pos.x, ac.pos.z) + wp.alt, speed: ac.spec.perf.cruiseSpeed * 0.95 });
    void t;
  }

  /** Inicia el vuelo de demostración detrás del menú principal. */
  async startMenuDemo(respawnOnly = false) {
    if (!respawnOnly) {
      await this.loadSession({ aircraft: this.session?.menuAircraft || 'extra300', environment: 'airfield', weather: { windSpeed: 2, gusts: 0.1, turbulence: 0.05, thermals: 0, sky: 'partly', timeOfDay: 17.3 }, launch: 'air', mode: 'menu' });
      this.mode = 'menu';
      this.cameras.setMode('cinematic');
    }
    const r = 260;
    this.demo = { i: 0, points: [{ x: r, z: -60, alt: 45 }, { x: 0, z: -r, alt: 60 }, { x: -r, z: -60, alt: 40 }, { x: 0, z: 120, alt: 50 }] };
    const ac = this.aircraft;
    ac.resetTo(this.world, { x: -r, z: -40, y: this.env.heightAt(-r, -40) + 45, heading: 0, speed: ac.spec.perf.cruiseSpeed * 0.9 });
    ac.engine.r = 0.7;
    this.autopilot.reset();
  }

  /* ─────────────────────────── eventos y juego ─────────────────────────── */

  processEvents() {
    const ac = this.aircraft;
    const evs = ac.events.splice(0);
    this.frameEvents = evs;
    for (const e of evs) {
      switch (e.type) {
        case 'contact': {
          const p = this.pointWorld(e.point);
          if (e.kind === 'wheel' || e.kind === 'skid') {
            if (e.vn > 0.6) this.audio.play('touchdown', clamp(e.vn / 3, 0.3, 1));
            if (p) this.effects.groundContact(p, Math.max(e.vt, e.vn * 3), e.surface, 1.5 + e.vn);
          } else if (e.vn + e.vt * 0.2 > 1.5) {
            this.audio.play('scrape');
            if (p) this.effects.groundContact(p, e.vt + e.vn * 2, e.surface, 2);
          }
          break;
        }
        case 'hardLanding':
          this.audio.play('hardLanding');
          this.bus.emit('message', { text: L('Aterrizaje duro: tren dañado', 'Hard landing: gear damaged'), kind: 'warn' });
          break;
        case 'damage':
          this.audio.play('damage');
          this.bus.emit('damage', { group: e.group, amount: e.amount, damage: ac.damage });
          break;
        case 'partLost': {
          const names = { wingL: L('Ala izquierda desprendida', 'Left wing detached'), wingR: L('Ala derecha desprendida', 'Right wing detached'), gear: L('Tren de aterrizaje roto', 'Landing gear broken'), prop: L('Hélice rota', 'Propeller broken') };
          this.bus.emit('message', { text: names[e.part] || e.part, kind: 'danger' });
          if (e.part === 'wingL' || e.part === 'wingR') {
            const meshes = this.model.detachable[e.part].filter((m) => m.visible);
            this.effects.spawnDebris(meshes, ac.vel);
          }
          this.recorder?.event('partLost', { part: e.part });
          break;
        }
        case 'destroyed':
          this.crashed = true;
          this.audio.play('crash');
          this.effects.impactSmoke(ac.pos, true);
          this.effects.spawnDebris(this.model.debrisParts(), ac.vel);
          this.stats.crash();
          this.recorder?.event('destroyed');
          this.mission?.fail('destroyed');
          this.bus.emit('crash', { reason: e.reason, mission: this.mission });
          break;
        case 'collision':
          if (e.soft) { this.audio.play('branch'); }
          else { this.audio.play(e.speed > 6 ? 'crash' : 'damage'); this.effects.impactSmoke(ac.pos, false); }
          this.stats.collision();
          if (!e.soft || e.speed > 6) this.bus.emit('message', { text: L(`Colisión (${e.object})`, `Collision (${e.object})`), kind: 'warn' });
          break;
        case 'splash':
          this.audio.play('splash');
          this.effects.splash(ac.pos, e.speed);
          this.bus.emit('message', { text: L('¡Al agua!', 'In the water!'), kind: 'danger' });
          if (!this.crashed) { this.crashed = true; this.stats.crash(); this.mission?.fail('water'); this.bus.emit('crash', { reason: 'water', mission: this.mission }); }
          break;
        case 'overstress':
          this.audio.play('damage');
          this.bus.emit('message', { text: L(`¡Sobrecarga estructural! ${e.g.toFixed(1)} g`, `Structural overload! ${e.g.toFixed(1)} g`), kind: 'danger' });
          break;
        case 'numeric':
          console.warn('Corrección numérica en la integración');
          break;
        default: break;
      }
    }
  }

  pointWorld(id) {
    const ac = this.aircraft;
    const p = ac.allPoints.find((x) => x.id === id);
    if (!p) return null;
    return p.r.clone().applyQuat(ac.q).add(ac.pos);
  }

  /** Alineación y desviación lateral respecto a la pista principal. */
  runwayRelative() {
    const ac = this.aircraft;
    const rw = this.env.runways[0];
    if (!rw) return { align: null, lateral: null };
    const h = rw.heading * DEG;
    const dx = ac.pos.x - rw.x, dz = ac.pos.z - rw.z;
    const lateral = Math.abs(dx * Math.cos(h) + dz * Math.sin(h));
    const e1 = Math.abs(wrapPi(ac.telemetry.heading - h)), e2 = Math.abs(wrapPi(ac.telemetry.heading - h - Math.PI));
    return { align: Math.min(e1, e2) * RAD, lateral };
  }

  updateGameplay(dt) {
    const ac = this.aircraft;
    const t = ac.telemetry;
    // estadísticas
    const airborne = !t.onGround && t.agl > 1 && !ac.held;
    this.stats.tick(dt, t, airborne, ac.pos, this.lastStatPos);
    this.lastStatPos = { x: ac.pos.x, y: ac.pos.y, z: ac.pos.z };
    // maniobras
    const found = this.maneuvers.update(dt, { omega: ac.omega, heading: t.heading, pitch: t.pitch, bank: t.bank, upY: t.upY, rightY: -Math.sin(t.bank) * Math.cos(t.pitch), altitude: ac.pos.y, airspeed: t.airspeed, vs: t.vs, alpha: t.alpha, stall: t.stall, onGround: t.onGround, agl: t.agl });
    const visible = found.filter((m) => !m.hidden);
    for (const m of visible) {
      this.stats.maneuver(m.id, m.score);
      this.recorder?.event('maneuver', { id: m.id, score: m.score });
      if (this.settings.ui.maneuverPopup) this.bus.emit('maneuver', { id: m.id, name: T(MANEUVERS[m.id]), score: m.score });
      this.audio.play('maneuver');
    }
    // aterrizajes
    const wheelContact = ac.gearPoints.some((p) => p.contact) || (ac.spec.gearType === 'skid' && t.onGround);
    const dmgSum = Object.entries(ac.damage).reduce((s, [k, v]) => s + (typeof v === 'number' ? v : 0), 0);
    const landing = this.landingEval.update(dt, { pos: ac.pos, vs: t.vs, airspeed: t.airspeed, groundSpeed: t.groundSpeed, bank: t.bank, pitch: t.pitch, heading: t.heading, agl: t.agl, wheelContact, destroyed: ac.destroyed, damageSum: dmgSum, track: Math.atan2(ac.vel.x, -ac.vel.z) });
    if (landing) {
      this.stats.landing(landing);
      this.recorder?.event('landing', { score: landing.score });
      this.bus.emit('landing', landing);
      this.audio.play(landing.score >= 72 ? 'success' : 'step');
    }
    // rodadura: polvo/hierba continuos
    if (t.wheelsOnGround > 0 && t.groundSpeed > 3 && Math.random() < 0.5) {
      const main = ac.gearPoints.find((p) => p.role === 'main' && p.contact);
      if (main) {
        const p = main.r.clone().applyQuat(ac.q).add(ac.pos);
        this.effects.groundContact(p, t.groundSpeed, this.env.surfaceTypeAt(p.x, p.z), 0.6);
      }
    }
    // humo del escape (motores térmicos)
    const et = ac.engine.type;
    if ((et === 'glow2' || et === 'glow4' || et === 'gas') && ac.engine.running) {
      const ex = new Vec3(ac.spec.cgX - ac.spec.length * 0.08, -ac.spec.fuseH * 0.3, ac.spec.fuseW * 0.6).applyQuat(ac.q).add(ac.pos);
      this.effects.exhaust(ex, ac.vel, 0.25 + ac.engine.r * 0.3);
    }
    // misión
    if (this.mission && !this.mission.finished) {
      const rr = this.runwayRelative();
      const ctx = {
        dt, t, ac, input: this.input.out, env: this.env, weather: this.weather, maneuvers: visible, landing,
        events: this.frameEvents, spawn: this.spawnInfo, runwayAlign: rr.align, lateral: rr.lateral, sound: (n) => this.audio.play(n),
      };
      const r = this.mission.update(ctx);
      if (this.mission.lastStatus?.highlight != null) this.effects.highlightMarker(this.mission.lastStatus.highlight);
      if (r?.type === 'step') { this.audio.play('step'); this.bus.emit('missionStep', { mission: this.mission }); }
      if (r?.type === 'complete') { this.audio.play('success'); this.onMissionComplete(); }
    }
  }

  onMissionComplete() {
    const m = this.mission;
    const rec = this.stats.record(m.m.kind, m.m.id, m.result.score, { medal: m.result.medal, stars: m.result.stars });
    this.bus.emit('missionComplete', { mission: m, result: m.result, record: rec });
  }

  /* ─────────────────────────── renderizado ─────────────────────────── */

  render(dt) {
    const ac = this.aircraft;
    const cam = this.cameras.camera;
    if (this.mode === 'replay' && this.player) {
      // estado ya aplicado por updateReplay
    } else if (ac) {
      const a = this.alpha ?? 1;
      _q3.set(ac.prevQ.x, ac.prevQ.y, ac.prevQ.z, ac.prevQ.w).slerp(new THREE.Quaternion(ac.q.x, ac.q.y, ac.q.z, ac.q.w), a);
      this.renderState.pos.set(ac.prevPos.x + (ac.pos.x - ac.prevPos.x) * a, ac.prevPos.y + (ac.pos.y - ac.prevPos.y) * a, ac.prevPos.z + (ac.pos.z - ac.prevPos.z) * a);
      this.renderState.quat.copy(_q3);
      this.renderState.vel.set(ac.vel.x, ac.vel.y, ac.vel.z);
      this.model.root.position.copy(this.renderState.pos);
      this.model.root.quaternion.copy(this.renderState.quat);
      // vibración visual sutil del motor
      if (ac.engine.vibration > 0.01 && !this.settings.ui.reduceMotion) {
        const v = ac.engine.vibration * 0.0015;
        this.model.root.position.x += (Math.random() - 0.5) * v;
        this.model.root.position.y += (Math.random() - 0.5) * v;
      }
      const wheelSpeed = ac.telemetry.wheelsOnGround > 0 ? ac.telemetry.groundSpeed : this.model.lastWheelSpeed * 0.98 || 0;
      this.model.lastWheelSpeed = wheelSpeed;
      this.model.update({
        defl: ac.defl, propAngle: ac.engine.angle, rpm: ac.engine.rpm, rpmFrac: ac.engine.r, gearPos: ac.gearPos,
        damage: ac.damage, wheelSpeed, time: this.simTime, night: this.sky.night,
      }, dt);
    }
    if (!ac && !this.player) return;
    const target = {
      pos: this.renderState.pos, quat: this.renderState.quat, vel: this.renderState.vel,
      span: (this.aircraft?.spec || this.replaySpec).span,
      vibration: ac ? ac.engine.vibration : 0, gLoad: ac ? ac.telemetry.gLoad : 1,
      onboard: this.onboardOffset,
    };
    this.cameras.s.reduceMotion = this.settings.ui.reduceMotion;
    this.cameras.update(dt, target);
    if (this.bungeeLine && this.bungee?.hook) {
      const p = this.bungeeLine.geometry.attributes.position;
      p.setXYZ(0, this.bungee.hook.x, this.bungee.hook.y, this.bungee.hook.z);
      p.setXYZ(1, this.bungee.anchor.x, this.bungee.anchor.y, this.bungee.anchor.z);
      p.needsUpdate = true;
    } else if (this.bungeeLine && this.aircraft) {
      const p = this.bungeeLine.geometry.attributes.position;
      p.setXYZ(0, this.aircraft.pos.x, this.aircraft.pos.y - 0.1, this.aircraft.pos.z);
      p.setXYZ(1, this.bungee.anchor.x, this.bungee.anchor.y, this.bungee.anchor.z);
      p.needsUpdate = true;
    }
    // viento horizontal para la vegetación, banderas y nubes
    const w = this.weather;
    const windVec = { x: w.windDirX * w.cfg.windSpeed * w.gust, z: w.windDirZ * w.cfg.windSpeed * w.gust };
    this.envRenderer?.update(dt, cam, windVec, this.renderState.pos);
    this.sky.update(dt, cam, windVec);
    this.sky.followTarget(this.renderState.pos);
    this.effects.update(dt, this.env);
    const shadowsOn = this.settings.graphics.shadows !== 'off';
    this.effects.updateBlob(this.env, this.renderState.pos, target.span, true, shadowsOn ? 0.45 : 1);
    if ((this.weather.cfg.thermalHints && this.settings.physics.assist !== 'expert') || this.mission?.m.setup?.weather?.thermalHints) {
      if (this.mode !== 'menu') this.effects.thermalHints(this.weather, this.renderState.pos, dt);
    }
    // audio
    if (ac || this.player) {
      const t = ac?.telemetry;
      this.audio.update(dt, {
        pos: this.renderState.pos, vel: this.renderState.vel,
        rpm: this.player ? this.player.frame.rpm : ac.engine.rpm, rpmFrac: this.player ? this.player.frame.rpmFrac : ac.engine.r,
        throttle: this.player ? this.player.frame.throttle : ac.cmd.throttle, airspeed: this.player ? this.renderState.vel.length() : t.airspeed,
        wheelSpeed: t ? t.groundSpeed : 0, onGround: t ? t.wheelsOnGround > 0 : false, paused: this.paused,
        windSpeed: this.weather.cfg.windSpeed, vario: t ? t.vs : 0,
        varioOn: !!(t && this.settings.audio.vario !== false && (ac.spec.category === 'glider') && this.mode === 'flight'),
      }, cam);
    }
    this.renderer.render(this.scene, cam);
  }

  /* ─────────────────────────── repeticiones ─────────────────────────── */

  finishRecording() {
    const rec = this.recorder;
    this.recorder = null;
    if (!rec || rec.duration < 8) return null;
    const replay = rec.finish();
    replay.id = `r${Date.now().toString(36)}`;
    this.lastReplay = replay;
    this.replayStore?.save(replay).catch?.(() => {});
    return replay;
  }

  /** Termina el vuelo actual (estadísticas y repetición). */
  endFlight() {
    const replay = this.finishRecording();
    const summary = this.stats.end();
    this.bus.emit('flightEnded', { summary, replay });
    return { summary, replay };
  }

  async startReplay(replay, onProgress) {
    const meta = replay.meta;
    await this.ensureEnvironment(meta.environment, onProgress);
    this.weather = new WeatherSystem(meta.weather, this.env, { turbulenceScale: 0 });
    this.world = this.world || {};
    this.sky.configure(this.weather, this.env, this.settings.graphics.drawDistance);
    this.renderer.configureShadowLight(this.sky.sun);
    this.cameras.setEnvironment(this.env, this.env.pilot);
    const spec = this.registry.get(meta.aircraft);
    this.replaySpec = spec;
    if (this.model) this.model.dispose();
    this.model = new AircraftModel(spec, meta.livery, { shadows: this.settings.graphics.shadows !== 'off' });
    this.scene.add(this.model.root);
    this.onboardOffset = this.computeOnboardOffset(spec);
    this.audio.setAircraft(spec);
    this.audio.setAmbience(this.env.ambience, this.weather);
    this.aircraft = null;
    this.effects.reset();
    this.effects.setMarkers([]);
    this.player = new ReplayPlayer(replay);
    this.mode = 'replay';
    this.paused = false;
    this.cameras.setMode('chase');
    this.bus.emit('replayStarted', { replay, player: this.player });
  }

  updateReplay(dt) {
    const pl = this.player;
    if (!pl) return;
    const f = pl.update(dt);
    this.weather.update(dt);
    this.renderState.pos.set(f.pos.x, f.pos.y, f.pos.z);
    this.renderState.quat.set(f.quat.x, f.quat.y, f.quat.z, f.quat.w);
    this.renderState.vel.set(f.vel.x, f.vel.y, f.vel.z);
    this.model.root.position.copy(this.renderState.pos);
    this.model.root.quaternion.copy(this.renderState.quat);
    const ground = this.env.heightAt(f.pos.x, f.pos.z);
    this.model.update({ defl: f.defl, propAngle: f.propAngle, rpm: f.rpm, rpmFrac: f.rpmFrac, gearPos: f.gearPos, damage: { ...f.damage, prop: f.damage.prop }, wheelSpeed: f.pos.y - ground < 0.6 ? Math.hypot(f.vel.x, f.vel.z) : 0, time: pl.time, night: this.sky.night }, dt);
    this.model.root.visible = !f.damage.destroyed || pl.time < pl.duration;
  }

  stopReplay(emit = true) {
    if (!this.player) return;
    this.player = null;
    this.replaySpec = null;
    if (emit) this.bus.emit('replayStopped');
  }

  /* ─────────────────────────── utilidades ─────────────────────────── */

  setPaused(p) {
    this.paused = p;
    this.audio.setPaused(p);
    if (p) this.input.keyboard.releaseAll();
  }

  /** Aplica cambios de configuración en caliente. */
  applySettings(changed = {}) {
    if (changed.graphics) {
      const recreated = this.renderer.apply(this.settings.graphics);
      if (recreated) {
        this.input.attachCanvas(this.renderer.canvas);
        this.sky.renderer = this.renderer.renderer;
        if (this.sky.pmrem) { this.sky.pmrem.dispose(); this.sky.pmrem = null; }
      }
      this.renderer.configureShadowLight(this.sky.sun);
      this.effects.quality = this.settings.graphics.effects;
      Object.assign(this.sky.q, this.skyQuality());
      if (this.weather && this.env) this.sky.configure(this.weather, this.env, this.settings.graphics.drawDistance);
      this.cameras.camera.far = Math.max(1500, this.settings.graphics.drawDistance * 1.2);
      this.cameras.camera.updateProjectionMatrix();
    }
    if (changed.physics && this.aircraft && this.mode === 'flight') {
      const f = this.settings.physics.fidelity;
      this.aircraft.fidelityKey = f;
      this.aircraft.fid = FIDELITY[f] || FIDELITY.realistic;
      this.aircraft._ctx.fid = this.aircraft.fid;
      this.aircraft.damageEnabled = this.settings.physics.damage;
      this.weather.turbScale = this.turbulenceScale(f);
    }
    if (changed.audio) this.audio.applyVolumes();
  }

  /** Reconstruye el escenario (cambio de calidad de vegetación o de detalle del terreno). */
  async rebuildEnvironmentVisuals() {
    if (!this.env) return;
    this.envRenderer?.dispose();
    const g = this.settings.graphics;
    this.envRenderer = new EnvironmentRenderer(this.env, { terrainDetail: g.terrainDetail ?? 1, vegetation: g.vegetation ?? 0.7, shadows: g.shadows !== 'off' });
    this.scene.add(this.envRenderer.group);
  }

  get presets() { return GRAPHICS_PRESETS; }

  envInfo() { return this.env ? environmentMeta(this.env.id) : null; }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
