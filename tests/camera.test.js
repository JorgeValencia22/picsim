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

/**
 * Looping de 30 m de radio a 20 m/s (pasa por la vertical y vuela invertido). Ninguna cámara debe
 * dar saltos: el giro de la vista por fotograma queda acotado y el avión no sale de la imagen.
 */
test('looping: las cámaras de seguimiento y cinematográfica no se invierten ni dan saltos', () => {
  for (const mode of ['chase', 'cinematic', 'pilot']) {
    const cam = new CameraManager({ fov: 55, autoZoom: false, chaseDistance: 1, chaseHeight: 0.3, smoothing: 0.6, sensitivity: 1, shake: false });
    cam.env = { heightAt: () => 0, waterLevelAt: () => null };
    cam.pilotPos.set(0, 1.7, 60);
    cam.setMode(mode);
    const pos = new THREE.Vector3(), vel = new THREE.Vector3(), quat = new THREE.Quaternion();
    const R = 30, V = 20, dt = 1 / 60;
    let prev = null, maxStep = 0, t = 0, maxOff = 0;
    for (let i = 0; i < 60 * 12; i++) {
      t += dt;
      // 2 s recto, looping, recto
      const a = clamp01((t - 2) * V / (2 * Math.PI * R)) * 2 * Math.PI;
      const s = t < 2 ? V * t : 2 * V + Math.max(0, V * (t - 2) - 2 * Math.PI * R);
      pos.set(s + R * Math.sin(a) - (t > 2 ? 0 : 0), 60 + R * (1 - Math.cos(a)), 0);
      vel.set(V * Math.cos(a), V * Math.sin(a), 0);
      const up = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
      const m = new THREE.Matrix4().makeBasis(vel.clone().normalize(), up, new THREE.Vector3().crossVectors(vel.clone().normalize(), up));
      quat.setFromRotationMatrix(m);
      cam.update(dt, { pos, quat, vel, span: 1.2, vibration: 0, gLoad: 1, onboard: null });
      const q = cam.camera.quaternion.clone();
      if (prev && i > 30 && cam.cine.t > 0.05) maxStep = Math.max(maxStep, prev.angleTo(q));
      prev = q;
      const toAc = pos.clone().sub(cam.camera.position).normalize();
      if (i > 30) maxOff = Math.max(maxOff, toAc.angleTo(cam.camera.getWorldDirection(new THREE.Vector3())));
    }
    assert.ok(maxStep < 0.12, `${mode}: giro máximo por fotograma ${(maxStep * 57.3).toFixed(1)}°`);
    assert.ok(maxOff < 0.5, `${mode}: el avión se aleja del centro ${(maxOff * 57.3).toFixed(0)}°`);
  }
});

function clamp01(x) { return Math.min(1, Math.max(0, x)); }
