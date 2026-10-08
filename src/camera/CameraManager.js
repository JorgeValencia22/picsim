/**
 * Sistema de cámaras: piloto en tierra (con auto-zoom y seguimiento), seguimiento, cinematográfica
 * (planos automáticos), a bordo (con vibración) y libre. Ninguna cámara altera la física.
 */
import * as THREE from 'three';
import { clamp, damp, lerp } from '../utils/math3d.js';

export const CAMERA_MODES = ['pilot', 'chase', 'cinematic', 'onboard', 'free'];

const CINE_SHOTS = ['side', 'flyby', 'rear', 'orbit', 'front', 'lowpass', 'approach'];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Resorte críticamente amortiguado (SmoothDamp): sigue al objetivo sin rebotes ni saltos aunque el
 * intervalo entre fotogramas varíe. vel guarda la velocidad interna del resorte.
 */
function smoothDampVec(cur, target, vel, smoothTime, dt) {
  const st = Math.max(1e-4, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  for (const c of ['x', 'y', 'z']) {
    const change = cur[c] - target[c];
    const temp = (vel[c] + omega * change) * dt;
    vel[c] = (vel[c] - omega * temp) * k;
    cur[c] = target[c] + (change + temp) * k;
  }
  return cur;
}
function smoothDamp(cur, target, state, smoothTime, dt) {
  const st = Math.max(1e-4, smoothTime);
  const omega = 2 / st, x = omega * dt;
  const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * k;
  return target + (change + temp) * k;
}
const _lead = new THREE.Vector3(), _fwd = new THREE.Vector3();

export class CameraManager {
  constructor(settings) {
    this.s = settings; // settings.camera (referencia viva)
    this.camera = new THREE.PerspectiveCamera(settings.fov, 16 / 9, 0.1, 4000);
    this.mode = settings.default || 'pilot';
    this.env = null;
    this.pilotPos = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.zoom = 1;
    this.tracking = true;
    this.lookYaw = 0; this.lookPitch = 0; // desplazamiento manual de la mirada
    this.chasePos = new THREE.Vector3();
    this.free = { pos: new THREE.Vector3(), yaw: 0, pitch: -0.1 };
    this.cine = { shot: 0, t: 0, anchor: new THREE.Vector3(), orbit: 0 };
    this.shake = 0;
    this.initialized = false;
    this.fovCurrent = settings.fov;
    // estado de los resortes de la cámara (seguimiento tipo película)
    this.lookVel = new THREE.Vector3();
    this.velSmooth = new THREE.Vector3();
    this.velSmoothVel = new THREE.Vector3();
    this.chaseVel = new THREE.Vector3();
    this.chaseFwd = new THREE.Vector3(1, 0, 0);
    this.fovState = { v: 0 };
  }

  setEnvironment(env, pilot) {
    this.env = env;
    this.pilotPos.set(pilot.x, env.heightAt(pilot.x, pilot.z) + 1.7, pilot.z);
    this.initialized = false;
  }

  setMode(m) {
    if (!CAMERA_MODES.includes(m)) return;
    this.mode = m;
    this.initialized = false;
    this.lookYaw = this.lookPitch = 0;
    if (m === 'free') {
      this.free.pos.copy(this.camera.position);
      const dir = this.camera.getWorldDirection(_v);
      this.free.yaw = Math.atan2(-dir.x, -dir.z);
      this.free.pitch = Math.asin(clamp(dir.y, -1, 1));
    }
  }

  cycle() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  /** Arrastre del ratón/dedo: mirar alrededor (piloto) u orbitar (libre/seguimiento). */
  drag(dx, dy, pan = false) {
    const k = 0.004 * (this.s.sensitivity || 1);
    if (this.mode === 'free') {
      if (pan) {
        const right = _v.set(Math.cos(this.free.yaw), 0, -Math.sin(this.free.yaw));
        this.free.pos.addScaledVector(right, -dx * 0.05);
        this.free.pos.y += dy * 0.05;
      } else {
        this.free.yaw -= dx * k;
        this.free.pitch = clamp(this.free.pitch - dy * k, -1.45, 1.45);
      }
    } else {
      this.lookYaw = clamp(this.lookYaw - dx * k, -Math.PI, Math.PI);
      this.lookPitch = clamp(this.lookPitch - dy * k, -1.2, 1.2);
      this.lastManual = performance.now();
    }
  }

  zoomBy(f) {
    if (this.mode === 'free') {
      const dir = _v.set(-Math.sin(this.free.yaw) * Math.cos(this.free.pitch), Math.sin(this.free.pitch), -Math.cos(this.free.yaw) * Math.cos(this.free.pitch));
      this.free.pos.addScaledVector(dir, (f - 1) * 25);
      return;
    }
    this.zoom = clamp(this.zoom * f, 0.4, 6);
  }

  toggleTracking() {
    this.tracking = !this.tracking;
    return this.tracking;
  }

  groundAt(x, z) {
    if (!this.env) return 0;
    const h = this.env.heightAt(x, z);
    const w = this.env.waterLevelAt(x, z);
    return w != null ? Math.max(h, w) : h;
  }

  /**
   * @param {number} dt
   * @param {object} t { pos: Vector3, quat: Quaternion, vel: Vector3, span, vibration, gLoad, onboard: Vector3 (cuerpo) }
   */
  update(dt, t) {
    const cam = this.camera;
    const sm = this.s.smoothing ?? 0.5;
    const baseFov = this.s.fov || 55;
    let fov = baseFov;
    const reduce = this.s.reduceMotion;

    switch (this.mode) {
      case 'pilot': {
        cam.position.copy(this.pilotPos);
        // la mirada vuelve al avión cuando se suelta el arrastre (si el seguimiento está activo)
        const since = (performance.now() - (this.lastManual || 0)) / 1000;
        if (this.tracking && since > 1.2) {
          this.lookYaw *= 1 - damp(3, dt);
          this.lookPitch *= 1 - damp(3, dt);
        }
        if (this.tracking) {
          if (!this.initialized) { this.lookTarget.copy(t.pos); this.lookVel.set(0, 0, 0); this.velSmooth.copy(t.vel); }
          // el objetivo se adelanta lo que el resorte retrasa: el avión queda centrado sin temblores
          const st = lerp(0.03, 0.22, sm);
          smoothDampVec(this.velSmooth, t.vel, this.velSmoothVel, st * 1.5 + 0.05, dt);
          _lead.copy(t.pos).addScaledVector(this.velSmooth, st);
          smoothDampVec(this.lookTarget, _lead, this.lookVel, st, dt);
        } else if (!this.initialized) this.lookTarget.copy(t.pos);
        const dir = _v.copy(this.lookTarget).sub(cam.position);
        const dist = dir.length();
        dir.normalize();
        // desplazamiento manual alrededor de la dirección de seguimiento
        const yaw = Math.atan2(dir.x, dir.z) + this.lookYaw;
        const pitch = Math.asin(clamp(dir.y, -1, 1)) + this.lookPitch;
        _v2.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        cam.lookAt(_v2.add(cam.position));
        // auto-zoom: mantiene el avión con un tamaño aparente legible a cualquier distancia
        if (this.s.autoZoom && this.tracking) {
          const desired = 2 * Math.atan((t.span * 4.2) / Math.max(1, dist * this.zoom)) * (180 / Math.PI);
          fov = clamp(desired, 9, baseFov);
        } else fov = clamp(baseFov / this.zoom, 8, 100);
        break;
      }
      case 'chase': {
        const span = Math.max(1.2, t.span);
        const D = (span * 2.6 + 2) * (this.s.chaseDistance || 1) / Math.max(0.5, this.zoom);
        const H = D * (this.s.chaseHeight ?? 0.3);
        // detrás según la trayectoria suavizada (o el morro si va despacio): los giros bruscos y la
        // turbulencia no sacuden la cámara, que describe curvas amplias como una toma de película
        const fwdT = _fwd.set(1, 0, 0).applyQuaternion(t.quat);
        if (t.vel.length() > 3) fwdT.lerp(_v2.copy(t.vel).normalize(), 0.7).normalize();
        if (!this.initialized) this.chaseFwd.copy(fwdT);
        this.chaseFwd.lerp(fwdT, 1 - Math.exp(-dt / lerp(0.12, 0.7, sm))).normalize();
        const fwd = _v.copy(this.chaseFwd);
        const desired = _v2.copy(t.pos).addScaledVector(fwd, -D);
        desired.y += H;
        // órbita manual alrededor del avión
        if (this.lookYaw || this.lookPitch) {
          const off = desired.clone().sub(t.pos);
          off.applyAxisAngle(UP, this.lookYaw);
          off.y += this.lookPitch * D;
          desired.copy(t.pos).add(off);
          const since = (performance.now() - (this.lastManual || 0)) / 1000;
          if (since > 2.5) { this.lookYaw *= 1 - damp(1.5, dt); this.lookPitch *= 1 - damp(1.5, dt); }
        }
        if (!this.initialized) { this.chasePos.copy(desired); this.chaseVel.set(0, 0, 0); this.lookTarget.copy(t.pos); this.lookVel.set(0, 0, 0); this.velSmooth.copy(t.vel); }
        smoothDampVec(this.chasePos, desired, this.chaseVel, lerp(0.05, 0.4, sm), dt);
        const g = this.groundAt(this.chasePos.x, this.chasePos.z) + 0.8;
        if (this.chasePos.y < g) { this.chasePos.y = g; this.chaseVel.y = Math.max(0, this.chaseVel.y); }
        cam.position.copy(this.chasePos);
        const stL = lerp(0.04, 0.17, sm);
        smoothDampVec(this.velSmooth, t.vel, this.velSmoothVel, stL * 1.5 + 0.05, dt);
        _lead.copy(t.pos).addScaledVector(this.velSmooth, stL);
        smoothDampVec(this.lookTarget, _lead, this.lookVel, stL, dt);
        cam.lookAt(this.lookTarget);
        fov = baseFov;
        break;
      }
      case 'cinematic':
        fov = this.updateCinematic(dt, t, baseFov);
        break;
      case 'onboard': {
        const off = t.onboard || _v.set(0.1, 0.1, 0);
        _v2.copy(off).applyQuaternion(t.quat).add(t.pos);
        cam.position.copy(_v2);
        _q.copy(t.quat);
        // la cámara de Three mira hacia −Z: el morro del avión es +X → giro de −90° en Y
        _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, -Math.PI / 2));
        if (this.lookYaw || this.lookPitch) {
          _q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ')));
          const since = (performance.now() - (this.lastManual || 0)) / 1000;
          if (since > 2) { this.lookYaw *= 1 - damp(2, dt); this.lookPitch *= 1 - damp(2, dt); }
        }
        cam.quaternion.copy(_q);
        fov = clamp(72 / this.zoom, 20, 100);
        // vibración (motor + aceleraciones)
        if (this.s.shake !== false && !reduce) {
          const amp = (t.vibration || 0) * 0.004 + Math.max(0, Math.abs((t.gLoad || 1) - 1) - 0.3) * 0.002;
          cam.rotateX((Math.random() - 0.5) * amp);
          cam.rotateY((Math.random() - 0.5) * amp);
        }
        break;
      }
      case 'free': {
        cam.position.copy(this.free.pos);
        const g = this.groundAt(cam.position.x, cam.position.z) + 0.5;
        if (cam.position.y < g) { cam.position.y = g; this.free.pos.y = g; }
        cam.rotation.set(this.free.pitch, this.free.yaw, 0, 'YXZ');
        fov = baseFov;
        break;
      }
      default: break;
    }
    this.initialized = true;
    this.fovCurrent = smoothDamp(this.fovCurrent, fov, this.fovState, reduce ? 0.6 : 0.35, dt);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
  }

  updateCinematic(dt, t, baseFov) {
    const c = this.cine;
    const cam = this.camera;
    c.t += dt;
    const span = Math.max(1.2, t.span);
    const shot = CINE_SHOTS[c.shot % CINE_SHOTS.length];
    const fwd = _v.set(1, 0, 0).applyQuaternion(t.quat);
    const vdir = t.vel.length() > 2 ? _v2.copy(t.vel).normalize() : fwd.clone();
    const right = new THREE.Vector3().crossVectors(vdir, UP).normalize();
    if (!this.initialized || c.t > 8) {
      c.t = 0;
      if (this.initialized) c.shot++;
      // anclajes para planos fijos
      const s = CINE_SHOTS[c.shot % CINE_SHOTS.length];
      if (s === 'flyby') c.anchor.copy(t.pos).addScaledVector(vdir, t.vel.length() * 3.5 + 15).addScaledVector(right, span * 4 + 6);
      if (s === 'lowpass') c.anchor.copy(t.pos).addScaledVector(vdir, t.vel.length() * 3 + 20).addScaledVector(right, -span * 3);
      if (s === 'approach') c.anchor.copy(this.pilotPos).addScaledVector(right, 10);
      if (s === 'flyby' || s === 'lowpass' || s === 'approach') c.anchor.y = Math.max(c.anchor.y, this.groundAt(c.anchor.x, c.anchor.z) + (s === 'lowpass' ? 0.6 : 2));
      if (s === 'lowpass') c.anchor.y = this.groundAt(c.anchor.x, c.anchor.z) + 0.6;
    }
    let fov = baseFov;
    switch (shot) {
      case 'side':
        cam.position.copy(t.pos).addScaledVector(right, span * 3 + 2).addScaledVector(UP, span * 0.4);
        break;
      case 'rear':
        cam.position.copy(t.pos).addScaledVector(vdir, -(span * 3 + 3)).addScaledVector(UP, span * 0.6);
        break;
      case 'front':
        cam.position.copy(t.pos).addScaledVector(vdir, span * 3 + 3).addScaledVector(UP, span * 0.3);
        break;
      case 'orbit': {
        c.orbit += dt * 0.5;
        const R = span * 4 + 3;
        cam.position.set(t.pos.x + Math.cos(c.orbit) * R, t.pos.y + span * 0.8, t.pos.z + Math.sin(c.orbit) * R);
        break;
      }
      case 'flyby':
      case 'lowpass':
      case 'approach': {
        cam.position.copy(c.anchor);
        const d = cam.position.distanceTo(t.pos);
        fov = clamp(2 * Math.atan((span * 3) / Math.max(1, d)) * (180 / Math.PI), 10, baseFov);
        break;
      }
      default: break;
    }
    const g = this.groundAt(cam.position.x, cam.position.z) + 0.4;
    if (cam.position.y < g) cam.position.y = g;
    if (!this.initialized || c.t === 0) { this.lookTarget.copy(t.pos); this.lookVel.set(0, 0, 0); }
    smoothDampVec(this.lookTarget, t.pos, this.lookVel, 0.08, dt);
    cam.lookAt(this.lookTarget);
    return fov;
  }
}
