/**
 * Matemática 3D independiente de Three.js para el motor de física.
 *
 * Convención de ejes del cuerpo (aeronave):
 *   +X = adelante (morro), +Y = arriba, +Z = ala derecha.
 *   ωx > 0 → alabeo a la derecha (ala derecha baja)
 *   ωz > 0 → cabeceo hacia arriba (morro arriba)
 *   ωy > 0 → guiñada a la IZQUIERDA (regla de la mano derecha sobre +Y)
 * Mundo: +Y arriba, norte = -Z, este = +X (convención de Three.js).
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const moveTowards = (cur, target, maxDelta) =>
  Math.abs(target - cur) <= maxDelta ? target : cur + Math.sign(target - cur) * maxDelta;
/** Factor de suavizado exponencial independiente del dt. */
export const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);
export const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
export const wrap360 = (d) => ((d % 360) + 360) % 360;

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  /** this = a × b */
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() {
    const l = this.length();
    if (l > 1e-12) this.scale(1 / l);
    return this;
  }
  /** Rota este vector por el cuaternión q (cuerpo → mundo). */
  applyQuat(q) {
    const { x, y, z } = this;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  /** Rota por el inverso de q (mundo → cuerpo). */
  applyQuatInv(q) {
    const { x, y, z } = this;
    const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  isFinite() { return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z); }
  toArray() { return [this.x, this.y, this.z]; }
}

export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  identity() { return this.set(0, 0, 0, 1); }
  setFromAxisAngle(ax, ay, az, angle) {
    const h = angle / 2, s = Math.sin(h);
    return this.set(ax * s, ay * s, az * s, Math.cos(h));
  }
  /** this = a * b */
  multiplyQuats(a, b) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
  multiply(q) { return this.multiplyQuats(this, q); }
  normalize() {
    let l = Math.hypot(this.x, this.y, this.z, this.w);
    if (l < 1e-12) return this.identity();
    l = 1 / l;
    this.x *= l; this.y *= l; this.z *= l; this.w *= l;
    return this;
  }
  /**
   * Integra una velocidad angular expresada en ejes del cuerpo: q ← q ⊗ exp(½ ω dt).
   * Uso de la exponencial exacta para mantener estabilidad a altas velocidades de giro.
   */
  integrateBody(wx, wy, wz, dt) {
    const mag = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (mag < 1e-10) return this;
    const angle = mag * dt;
    const s = Math.sin(angle / 2) / mag;
    _qa.set(wx * s, wy * s, wz * s, Math.cos(angle / 2));
    this.multiply(_qa);
    return this.normalize();
  }
  /** Construye la orientación a partir de rumbo (0=N, 90=E), cabeceo y alabeo en radianes. */
  setFromHeadingPitchBank(heading, pitch, bank) {
    _qa.setFromAxisAngle(0, 1, 0, Math.PI / 2 - heading);
    _qb.setFromAxisAngle(0, 0, 1, pitch);
    _qc.setFromAxisAngle(1, 0, 0, bank);
    return this.multiplyQuats(_qa, _qb).multiply(_qc).normalize();
  }
  /** Interpolación esférica (para renderizado y repeticiones). */
  slerpQuats(a, b, t) {
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let k0, k1;
    if (cos > 0.9995) { k0 = 1 - t; k1 = t; } else {
      const th = Math.acos(cos), s = Math.sin(th);
      k0 = Math.sin((1 - t) * th) / s;
      k1 = Math.sin(t * th) / s;
    }
    this.set(a.x * k0 + bx * k1, a.y * k0 + by * k1, a.z * k0 + bz * k1, a.w * k0 + bw * k1);
    return this.normalize();
  }
  isFinite() { return [this.x, this.y, this.z, this.w].every(Number.isFinite); }
}
const _qa = new Quat(), _qb = new Quat(), _qc = new Quat();

const _f = new Vec3(), _u = new Vec3(), _r = new Vec3();
/** Ángulos de actitud (radianes) a partir del cuaternión cuerpo→mundo. */
export function attitudeFromQuat(q, out = {}) {
  _f.set(1, 0, 0).applyQuat(q);
  _u.set(0, 1, 0).applyQuat(q);
  _r.set(0, 0, 1).applyQuat(q);
  out.pitch = Math.asin(clamp(_f.y, -1, 1));
  out.bank = Math.atan2(-_r.y, _u.y);
  // rumbo: si el morro apunta casi vertical se usa el eje "arriba" invertido
  const hx = Math.abs(_f.y) > 0.98 ? -_u.x * Math.sign(_f.y) : _f.x;
  const hz = Math.abs(_f.y) > 0.98 ? -_u.z * Math.sign(_f.y) : _f.z;
  out.heading = Math.atan2(hx, -hz);
  if (out.heading < 0) out.heading += Math.PI * 2;
  out.upY = _u.y;
  out.rightY = _r.y;
  out.fwdY = _f.y;
  return out;
}

/** Generador pseudoaleatorio con semilla (mulberry32). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
