import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraManager } from '../src/camera/CameraManager.js';

/**
 * Avión en viraje a 25 m/s con turbulencia de alta frecuencia y fotogramas irregulares
 * (16/33 ms). La cámara debe filtrar las sacudidas (movimiento suave, «de película») y aun así
 * mantener el avión cerca del centro de la imagen.
 */
function simulate(mode) {
  const cam = new CameraManager({ fov: 55, autoZoom: false, chaseDistance: 1, chaseHeight: 0.3, smoothing: 0.6, sensitivity: 1, shake: false });
  cam.env = { heightAt: () => 0, waterLevelAt: () => null };
  cam.pilotPos.set(0, 1.7, 60);
  cam.setMode(mode);
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), quat = new THREE.Quaternion();
  let t = 0, seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const dirs = [], offCenter = [];
  for (let i = 0; i < 900; i++) {
    const dt = i % 7 === 3 ? 1 / 30 : 1 / 60;
    t += dt;
    const w = 25 / 120;
    pos.set(Math.cos(t * w) * 120 + rnd() * 0.5, 40 + rnd() * 0.5, Math.sin(t * w) * 120 - 100 + rnd() * 0.5);
    vel.set(-Math.sin(t * w) * 25 + rnd() * 3, rnd() * 3, Math.cos(t * w) * 25 + rnd() * 3);
    quat.setFromUnitVectors(new THREE.Vector3(1, 0, 0), vel.clone().normalize());
    cam.update(dt, { pos, quat, vel, span: 1.4, vibration: 0, gLoad: 1, onboard: null });
    if (i < 120) continue; // asentamiento
    const fwd = cam.camera.getWorldDirection(new THREE.Vector3());
    dirs.push(fwd.clone());
    const toPlane = pos.clone().sub(cam.camera.position).normalize();
    offCenter.push(Math.acos(Math.min(1, fwd.dot(toPlane))) * 180 / Math.PI);
  }
  // sacudida: cambio de la velocidad angular de la mirada entre fotogramas consecutivos
  let jerk = 0;
  for (let i = 2; i < dirs.length; i++) {
    const a1 = dirs[i].angleTo(dirs[i - 1]), a0 = dirs[i - 1].angleTo(dirs[i - 2]);
    jerk += Math.abs(a1 - a0);
  }
  return { jerkDeg: (jerk / (dirs.length - 2)) * 180 / Math.PI, maxOff: Math.max(...offCenter) };
}

test('cámara: seguimiento suave (sin sacudidas) que mantiene el avión centrado', () => {
  for (const mode of ['pilot', 'chase']) {
    const r = simulate(mode);
    // antes de la cámara con resortes: piloto 0,094° y seguimiento 0,765° por fotograma
    assert.ok(r.jerkDeg < (mode === 'pilot' ? 0.06 : 0.1), `${mode}: sacudida media ${r.jerkDeg.toFixed(3)}°/fotograma`);
    assert.ok(r.maxOff < 6, `${mode}: el avión se aleja ${r.maxOff.toFixed(1)}° del centro`);
  }
});
