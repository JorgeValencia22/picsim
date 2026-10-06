/**
 * Tráfico aéreo: otros aviones RC del campo que vuelan circuitos alrededor de la zona de vuelo,
 * como los compañeros de club en PicaSim. Cada uno usa la MISMA física que el avión del jugador
 * (AircraftPhysics) gobernada por el piloto automático; no hay animaciones precalculadas.
 * Vuelan a alturas escalonadas para no cruzarse entre ellos. Si uno cae o se aleja, reaparece.
 */
import * as THREE from 'three';
import { AircraftPhysics } from '../aircraft/AircraftPhysics.js';
import { Autopilot } from '../aircraft/Autopilot.js';
import { AircraftModel } from '../render/AircraftModel.js';

// aviones propulsados habituales en un campo de vuelo (los veleros necesitarían ladera o térmicas)
export const TRAFFIC_POOL = ['cubj3', 'extra300', 'cessna182', 'p51', 'edge540', 'skylark', 'spitfire', 'pitts', 'yak55', 'cap232', 'outback', 'falcon46'];
const _q4 = new THREE.Quaternion();

/** Avión de tráfico (sin modelo visual): física + piloto automático + circuito elíptico. */
export function makeTrafficPlane(spec, i, cx, cz) {
  const ac = new AircraftPhysics(spec, { fidelity: 'realistic', damage: false, seed: 777 + i });
  const rx = 230 + i * 45, rz = 130 + i * 30;
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, z: cz + Math.sin(a) * rz });
  }
  // margen amplio sobre la pérdida y virajes suaves, como un piloto de club tranquilo
  const speed = Math.max(spec.perf.cruiseSpeed * (0.85 + 0.06 * i), spec.perf.stallSpeed * 1.55);
  const ap = new Autopilot(spec);
  ap.maxBank = (28 * Math.PI) / 180;
  return { spec, ac, model: null, ap, pts, i: 0, alt: 45 + i * 18, speed };
}

export function respawnTrafficPlane(p, k, world) {
  p.i = Math.floor(k) % p.pts.length;
  const a = p.pts[p.i], b = p.pts[(p.i + 1) % p.pts.length];
  const heading = Math.atan2(b.x - a.x, -(b.z - a.z));
  p.ac.resetTo(world, { x: a.x, z: a.z, y: world.heightAt(a.x, a.z) + p.alt, heading, speed: p.speed });
  p.ac.engine.r = 0.6;
  p.ac.cmd.gearDown = false;
  p.ap.reset();
  p.i = (p.i + 1) % p.pts.length;
}

/** Un paso de física de un avión del tráfico. Devuelve true si hay que hacerlo reaparecer. */
export function stepTrafficPlane(p, dt, world) {
  const ac = p.ac;
  const wp = p.pts[p.i];
  const dx = wp.x - ac.pos.x, dz = wp.z - ac.pos.z;
  if (dx * dx + dz * dz < 55 * 55) p.i = (p.i + 1) % p.pts.length;
  const gy = world.heightAt(ac.pos.x, ac.pos.z);
  p.ap.update(dt, ac, { heading: Math.atan2(dx, -dz), altitude: gy + p.alt, speed: p.speed });
  ac.step(dt, world);
  ac.events.length = 0;
  return ac.destroyed || ac.telemetry.onGround || ac.pos.y < gy + 5 || !Number.isFinite(ac.pos.y);
}

export class TrafficSystem {
  constructor(scene, registry) {
    this.scene = scene;
    this.registry = registry;
    this.planes = [];
  }

  /**
   * @param {object} o { env, world, count, excludeId, shadows, realistic }
   */
  setup(o) {
    this.clear();
    if (!o.count) return;
    this.env = o.env;
    this.world = o.world;
    const pilot = o.env.pilot;
    const facing = ((pilot.facing ?? 0) * Math.PI) / 180;
    // centro del circuito delante del piloto, como el circuito de tráfico de un club
    const cx = pilot.x + Math.sin(facing) * 150, cz = pilot.z - Math.cos(facing) * 150;
    const pool = TRAFFIC_POOL.filter((id) => id !== o.excludeId && this.registry.exists?.(id) !== false);
    const start = Math.floor(Math.random() * pool.length);
    for (let i = 0; i < o.count; i++) {
      const spec = this.registry.get(pool[(start + i * 3) % pool.length]);
      const plane = makeTrafficPlane(spec, i, cx, cz);
      plane.model = new AircraftModel(spec, null, { shadows: o.shadows, realistic: o.realistic });
      this.scene.add(plane.model.root);
      this.respawn(plane, (i / Math.max(1, o.count)) * 8);
      this.planes.push(plane);
    }
  }

  respawn(p, k = 0) { respawnTrafficPlane(p, k, this.world); }

  /** Un paso fijo de física para todos los aviones del tráfico. */
  step(dt) {
    for (const p of this.planes) if (stepTrafficPlane(p, dt, this.world)) this.respawn(p, p.i + 3);
  }

  /** Dibuja con interpolación entre los dos últimos pasos de física. */
  render(alpha, dt, time, night) {
    for (const p of this.planes) {
      const ac = p.ac, m = p.model;
      m.root.position.set(ac.prevPos.x + (ac.pos.x - ac.prevPos.x) * alpha, ac.prevPos.y + (ac.pos.y - ac.prevPos.y) * alpha, ac.prevPos.z + (ac.pos.z - ac.prevPos.z) * alpha);
      m.root.quaternion.set(ac.prevQ.x, ac.prevQ.y, ac.prevQ.z, ac.prevQ.w).slerp(_q4.set(ac.q.x, ac.q.y, ac.q.z, ac.q.w), alpha);
      m.update({ defl: ac.defl, propAngle: ac.engine.angle, rpm: ac.engine.rpm, rpmFrac: ac.engine.r, gearPos: ac.gearPos, damage: null, wheelSpeed: 0, time, night }, dt);
    }
  }

  /** Posiciones (para que los animales y las aves reaccionen o para el radar del HUD). */
  positions() { return this.planes.map((p) => p.ac.pos); }

  clear() {
    for (const p of this.planes) p.model.dispose();
    this.planes = [];
  }
}
