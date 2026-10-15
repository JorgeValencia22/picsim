/**
 * Herramienta de desarrollo: reproduce el bucle de render del juego (física a paso fijo de 240 Hz,
 * interpolación, fotogramas de duración irregular y cámaras) y mide el «temblor» de la imagen:
 * la aceleración de la posición del avión en pantalla y del giro de la cámara entre fotogramas.
 * Uso: node tools/jitter-check.mjs [id] [turbulencia m/s]
 */
import * as THREE from 'three';
import { buildFullSpec } from '../src/aircraft/AircraftRegistry.js';
import { AIRCRAFT_DATA } from '../src/data/aircraftData.js';
import { AircraftPhysics } from '../src/aircraft/AircraftPhysics.js';
import { Autopilot } from '../src/aircraft/Autopilot.js';
import { CameraManager } from '../src/camera/CameraManager.js';

const id = process.argv[2] || 'extra300';
const turb = Number(process.argv[3] ?? 1.5);
const PDT = 1 / 240;
const spec = buildFullSpec(AIRCRAFT_DATA.find((a) => a.id === id));
const world = {
  heightAt: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), surfaceAt: () => ({ type: 'grass', rolling: 0.05, grip: 0.8, friction: 0.5, rough: 0 }), waterLevelAt: () => null,
  sampleWind: (p, o) => {
    const s = p.x * 0.11 + p.z * 0.07, r = p.x * 0.05 - p.z * 0.13 + p.y * 0.2;
    return o.set(turb * Math.sin(s * 1.7 + 1), turb * 0.6 * Math.sin(r * 2.3), turb * Math.cos(s * 1.1 + r));
  },
  density: () => 1.225, collision: null, temperature: 15,
};

for (const mode of ['pilot', 'chase', 'onboard', 'cinematic']) {
  const ac = new AircraftPhysics(spec, { fidelity: 'realistic', damage: false });
  const V = spec.perf.cruiseSpeed;
  ac.resetTo(world, { x: -150, z: -80, y: 40, heading: 0, speed: V });
  const ap = new Autopilot(spec);
  const cam = new CameraManager({ fov: 55, autoZoom: true, chaseDistance: 1, chaseHeight: 0.3, smoothing: 0.6, sensitivity: 1, shake: true });
  cam.env = { heightAt: () => 0, waterLevelAt: () => null };
  cam.pilotPos.set(0, 1.7, 0);
  cam.setMode(mode);
  cam.camera.aspect = 16 / 9;
  let acc = 0, t = 0, seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), vel = new THREE.Vector3();
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
  const scr = [], rot = [];
  let prevQ = null;
  for (let f = 0; f < 60 * 20; f++) {
    // fotogramas de 60 Hz con variación realista (±2 ms) y algún tirón de 33 ms
    const dt = (f % 97 === 50 ? 33.3 : 16.67 + (rnd() - 0.5) * 4) / 1000;
    t += dt;
    acc += dt;
    while (acc >= PDT) {
      ap.update(PDT, ac, { altitude: 40, heading: Math.floor(t / 6) % 2 ? Math.PI : 0, speed: V });
      ac.step(PDT, world);
      acc -= PDT;
    }
    const a = acc / PDT;
    pos.set(ac.prevPos.x + (ac.pos.x - ac.prevPos.x) * a, ac.prevPos.y + (ac.pos.y - ac.prevPos.y) * a, ac.prevPos.z + (ac.pos.z - ac.prevPos.z) * a);
    q0.set(ac.prevQ.x, ac.prevQ.y, ac.prevQ.z, ac.prevQ.w); q1.set(ac.q.x, ac.q.y, ac.q.z, ac.q.w);
    quat.copy(q0).slerp(q1, a);
    vel.set(ac.vel.x, ac.vel.y, ac.vel.z);
    cam.update(dt, { pos, quat, vel, span: spec.span, vibration: ac.engine.vibration, gLoad: ac.telemetry.gLoad, onboard: new THREE.Vector3(0.1, 0.12, 0) });
    cam.camera.updateMatrixWorld();
    if (f < 120) continue;
    if (mode === 'onboard') {
      if (prevQ) rot.push({ dt, a: prevQ.angleTo(cam.camera.quaternion) });
      prevQ = cam.camera.quaternion.clone();
    } else {
      const p = pos.clone().project(cam.camera);
      scr.push({ dt, x: p.x, y: p.y });
    }
  }
  if (mode === 'onboard') {
    // velocidad angular de la vista y su cambio entre fotogramas (temblor)
    const w = rot.map((r) => r.a / r.dt);
    let j = 0;
    for (let i = 1; i < w.length; i++) j = Math.max(j, Math.abs(w[i] - w[i - 1]));
    console.log(mode.padEnd(10), `cambio máx. de velocidad de giro de la vista entre fotogramas: ${(j * 57.3).toFixed(0)}°/s`);
  } else {
    // aceleración en pantalla (fracción de la mitad de la pantalla por s²): picos = tirones
    const acc2 = [];
    for (let i = 2; i < scr.length; i++) {
      const v1x = (scr[i].x - scr[i - 1].x) / scr[i].dt, v0x = (scr[i - 1].x - scr[i - 2].x) / scr[i - 1].dt;
      const v1y = (scr[i].y - scr[i - 1].y) / scr[i].dt, v0y = (scr[i - 1].y - scr[i - 2].y) / scr[i - 1].dt;
      acc2.push(Math.hypot(v1x - v0x, v1y - v0y) / scr[i].dt);
    }
    acc2.sort((x, y) => x - y);
    const p99 = acc2[Math.floor(acc2.length * 0.99)], med = acc2[Math.floor(acc2.length / 2)];
    const off = Math.max(...scr.map((s) => Math.hypot(s.x, s.y)));
    console.log(mode.padEnd(10), `aceleración en pantalla mediana ${med.toFixed(2)}  p99 ${p99.toFixed(2)}  desvío máx. del centro ${off.toFixed(2)}`);
  }
}
