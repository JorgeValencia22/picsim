/**
 * Grabación y reproducción de vuelos a partir de los datos esenciales (sin vídeo):
 * posición, orientación, velocidad, motor, superficies de control, tren, daños y meteorología.
 * Los fotogramas se guardan en bloques Float32Array a 30 Hz e interpolan al reproducir.
 */
import { clamp } from '../utils/math3d.js';

export const FRAME_FIELDS = ['t', 'px', 'py', 'pz', 'qx', 'qy', 'qz', 'qw', 'vx', 'vy', 'vz', 'ail', 'ele', 'rud', 'flap', 'brk', 'rpmF', 'rpm', 'prop', 'gear', 'thr', 'dmg'];
const F = FRAME_FIELDS.length;
const IDX = Object.fromEntries(FRAME_FIELDS.map((f, i) => [f, i]));

/** Codifica el estado de daños en un número (bits + salud de grupos cuantizada). */
export function encodeDamage(d, destroyed) {
  let v = 0;
  if (d.lostWingL) v |= 1;
  if (d.lostWingR) v |= 2;
  if (d.gear < 0.35) v |= 4;
  if (d.prop < 0.2) v |= 8;
  if (destroyed) v |= 16;
  return v;
}

export function decodeDamage(v) {
  return { lostWingL: !!(v & 1), lostWingR: !!(v & 2), gear: v & 4 ? 0.2 : 1, prop: v & 8 ? 0.1 : 1, destroyed: !!(v & 16) };
}

export class ReplayRecorder {
  constructor(rate = 30, maxSeconds = 1200) {
    this.interval = 1 / rate;
    this.maxFrames = Math.ceil(maxSeconds * rate);
    this.reset();
  }

  reset(meta = {}) {
    this.meta = { ...meta };
    this.chunks = [];
    this.chunk = new Float32Array(F * 512);
    this.count = 0;
    this.inChunk = 0;
    this.acc = this.interval;
    this.time = 0;
    this.events = [];
  }

  /** Registra un evento con marca de tiempo (aterrizajes, maniobras, choques). */
  event(type, data = {}) {
    this.events.push({ t: this.time, type, ...data });
  }

  /** @param {AircraftPhysics} ac */
  update(dt, ac) {
    this.time += dt;
    this.acc += dt;
    if (this.acc < this.interval || this.count >= this.maxFrames) return;
    this.acc = 0;
    if (this.inChunk >= 512) {
      this.chunks.push(this.chunk);
      this.chunk = new Float32Array(F * 512);
      this.inChunk = 0;
    }
    const o = this.inChunk * F;
    const c = this.chunk;
    const e = ac.engine;
    c[o] = this.time;
    c[o + 1] = ac.pos.x; c[o + 2] = ac.pos.y; c[o + 3] = ac.pos.z;
    c[o + 4] = ac.q.x; c[o + 5] = ac.q.y; c[o + 6] = ac.q.z; c[o + 7] = ac.q.w;
    c[o + 8] = ac.vel.x; c[o + 9] = ac.vel.y; c[o + 10] = ac.vel.z;
    c[o + 11] = ac.defl.aileron; c[o + 12] = ac.defl.elevator; c[o + 13] = ac.defl.rudder;
    c[o + 14] = ac.defl.flap; c[o + 15] = ac.defl.airbrake;
    c[o + 16] = e.r; c[o + 17] = e.rpm; c[o + 18] = e.angle; c[o + 19] = ac.gearPos; c[o + 20] = ac.cmd.throttle;
    c[o + 21] = encodeDamage(ac.damage, ac.destroyed);
    this.inChunk++;
    this.count++;
  }

  /** Devuelve los datos compactos (un único Float32Array) listos para guardar o reproducir. */
  finish() {
    const data = new Float32Array(this.count * F);
    let off = 0;
    for (const ch of this.chunks) { data.set(ch, off); off += ch.length; }
    data.set(this.chunk.subarray(0, this.inChunk * F), off);
    return { meta: { ...this.meta, frames: this.count, duration: this.time, date: this.meta.date || Date.now() }, data, events: this.events.slice() };
  }

  get duration() { return this.time; }
}

/** Reproductor: interpolación entre fotogramas, velocidad variable, búsqueda y bucle. */
export class ReplayPlayer {
  constructor(replay) {
    this.replay = replay;
    this.data = replay.data instanceof Float32Array ? replay.data : new Float32Array(replay.data);
    this.frames = Math.floor(this.data.length / F);
    this.duration = this.frames ? this.data[(this.frames - 1) * F] : 0;
    this.time = 0;
    this.speed = 1;
    this.playing = true;
    this.frame = { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, defl: {}, rpmFrac: 0, rpm: 0, propAngle: 0, gearPos: 1, throttle: 0, damage: decodeDamage(0) };
  }

  get(i, f) { return this.data[i * F + IDX[f]]; }

  /** Índice del fotograma anterior a t (búsqueda binaria). */
  indexAt(t) {
    let lo = 0, hi = this.frames - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.data[mid * F] <= t) lo = mid; else hi = mid;
    }
    return lo;
  }

  seek(t) { this.time = clamp(t, 0, this.duration); }
  restart() { this.time = 0; this.playing = true; }

  update(dt) {
    if (this.playing) {
      this.time += dt * this.speed;
      if (this.time >= this.duration) { this.time = this.duration; this.playing = false; }
      if (this.time < 0) { this.time = 0; this.playing = false; }
    }
    return this.sample(this.time);
  }

  sample(t) {
    const out = this.frame;
    if (this.frames < 2) return out;
    const i = this.indexAt(t);
    const j = Math.min(this.frames - 1, i + 1);
    const t0 = this.get(i, 't'), t1 = this.get(j, 't');
    const a = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 0;
    const L = (f) => this.get(i, f) + (this.get(j, f) - this.get(i, f)) * a;
    out.pos.x = L('px'); out.pos.y = L('py'); out.pos.z = L('pz');
    out.vel.x = L('vx'); out.vel.y = L('vy'); out.vel.z = L('vz');
    // slerp del cuaternión
    let bx = this.get(j, 'qx'), by = this.get(j, 'qy'), bz = this.get(j, 'qz'), bw = this.get(j, 'qw');
    const ax = this.get(i, 'qx'), ay = this.get(i, 'qy'), az = this.get(i, 'qz'), aw = this.get(i, 'qw');
    let cos = ax * bx + ay * by + az * bz + aw * bw;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let k0 = 1 - a, k1 = a;
    if (cos < 0.9995) { const th = Math.acos(cos), s = Math.sin(th); k0 = Math.sin((1 - a) * th) / s; k1 = Math.sin(a * th) / s; }
    const qx = ax * k0 + bx * k1, qy = ay * k0 + by * k1, qz = az * k0 + bz * k1, qw = aw * k0 + bw * k1;
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    out.quat.x = qx / n; out.quat.y = qy / n; out.quat.z = qz / n; out.quat.w = qw / n;
    out.defl.aileron = L('ail'); out.defl.elevator = L('ele'); out.defl.rudder = L('rud'); out.defl.flap = L('flap'); out.defl.airbrake = L('brk');
    out.rpmFrac = L('rpmF'); out.rpm = L('rpm'); out.gearPos = L('gear'); out.throttle = L('thr');
    out.propAngle = this.get(i, 'prop') + (out.rpm * Math.PI * 2 / 60) * (t - t0);
    out.damage = decodeDamage(this.get(i, 'dmg'));
    return out;
  }
}
