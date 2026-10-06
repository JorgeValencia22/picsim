/**
 * Vida del escenario (solo visual, sin efecto en la física):
 * - Rebaños de vacas y ovejas que pastan, caminan despacio y huyen si el avión pasa bajo cerca.
 * - Automóviles que circulan por los caminos del escenario.
 * - Bandadas de aves que planean en círculos (térmicas) y se dispersan si el avión se acerca.
 * Todo con InstancedMesh: una llamada de dibujo por tipo.
 */
import * as THREE from 'three';
import { animalGeometry, carGeometry, birdGeometry } from './PropGeometry.js';
import { makeRng, clamp } from '../utils/math3d.js';

const HERDS = {
  airfield: { cow: 0, sheep: 14, birds: 2 },
  countryside: { cow: 16, sheep: 18, birds: 3 },
  ruraltown: { cow: 12, sheep: 10, birds: 3 },
  mountains: { cow: 4, sheep: 20, birds: 3 },
  coast: { cow: 0, sheep: 10, birds: 4 },
  competition: { cow: 0, sheep: 0, birds: 2 },
};
const CAR_COLORS = ['#b71c1c', '#eceff1', '#263238', '#1565c0', '#9e9e9e', '#2e7d32', '#f9a825'];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

export class AmbientLife {
  constructor(env, quality = {}) {
    this.env = env;
    this.q = { density: 1, birds: true, ...quality };
    this.group = new THREE.Group();
    this.group.name = 'ambient-life';
    this.disposables = [];
    this.rng = makeRng((env.seed || 7) * 31 + 5);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.disposables.push(this.mat);
    const cfg = HERDS[env.id] || { cow: 6, sheep: 8, birds: 2 };
    const k = clamp(this.q.density, 0, 1.5);
    this.animals = [];
    this.buildAnimals('cow', Math.round(cfg.cow * k));
    this.buildAnimals('sheep', Math.round(cfg.sheep * k));
    this.buildCars(Math.round(Math.min(6, env.roads.length * 2) * k));
    if (this.q.birds) this.buildBirds(Math.round(cfg.birds * k));
  }

  /** Busca un punto de pasto libre lejos de pistas y del piloto. */
  findPasture(cx, cz, spread) {
    const env = this.env, pilot = env.pilot;
    for (let tries = 0; tries < 40; tries++) {
      const x = cx + (this.rng() - 0.5) * spread, z = cz + (this.rng() - 0.5) * spread;
      if (Math.hypot(x - pilot.x, z - pilot.z) < 90) continue;
      const surf = env.surfaceAt(x, z);
      const type = surf?.type || surf;
      if (!['grass', 'field', 'rough', 'mown'].includes(type)) continue;
      if (!env.isFree(x, z, 12)) continue;
      const n = env.normalAt(x, z, new THREE.Vector3());
      if (n.y < 0.9) continue;
      return { x, z };
    }
    return null;
  }

  buildAnimals(kind, count) {
    if (count <= 0) return;
    const geo = animalGeometry(kind);
    this.disposables.push(geo);
    const mesh = new THREE.InstancedMesh(geo, this.mat, count);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const list = [];
    // el rebaño se agrupa alrededor de un centro de pasto
    const pilot = this.env.pilot;
    let center = null;
    for (let t = 0; t < 20 && !center; t++) {
      const a = this.rng() * Math.PI * 2, d = 200 + this.rng() * 450;
      center = this.findPasture(pilot.x + Math.cos(a) * d, pilot.z + Math.sin(a) * d, 40);
    }
    if (!center) { geo.dispose(); return; }
    for (let i = 0; i < count; i++) {
      const p = this.findPasture(center.x, center.z, kind === 'cow' ? 90 : 60) || { ...center };
      list.push({ x: p.x, z: p.z, h: this.rng() * Math.PI * 2, speed: 0, target: 0, timer: this.rng() * 8, flee: 0, phase: this.rng() * 10, scale: 0.9 + this.rng() * 0.2, home: center });
    }
    this.group.add(mesh);
    this.animals.push({ kind, mesh, list });
  }

  buildCars(count) {
    const roads = this.env.roads.filter((r) => r.points.length >= 2);
    if (count <= 0 || !roads.length) { this.cars = null; return; }
    const geos = [];
    const list = [];
    for (let i = 0; i < count; i++) {
      const road = roads[i % roads.length];
      const seg = road.points;
      let len = 0;
      const cum = [0];
      for (let j = 1; j < seg.length; j++) { len += Math.hypot(seg[j][0] - seg[j - 1][0], seg[j][1] - seg[j - 1][1]); cum.push(len); }
      if (len < 60) continue;
      list.push({ road: seg, cum, len, s: this.rng() * len, dir: i % 2 ? 1 : -1, speed: 8 + this.rng() * 7, lane: (road.width || 6) * 0.22, color: CAR_COLORS[i % CAR_COLORS.length] });
    }
    if (!list.length) { this.cars = null; return; }
    // un InstancedMesh por color sería caro: se usa uno con color por instancia
    const geo = carGeometry('#ffffff');
    geos.push(geo);
    this.disposables.push(geo);
    const mesh = new THREE.InstancedMesh(geo, this.mat, list.length);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const c = new THREE.Color();
    list.forEach((car, i) => mesh.setColorAt(i, c.set(car.color)));
    this.group.add(mesh);
    this.cars = { mesh, list };
  }

  buildBirds(flocks) {
    if (flocks <= 0) { this.birds = null; return; }
    const geo = birdGeometry();
    this.disposables.push(geo);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.disposables.push(mat);
    const per = 6;
    const mesh = new THREE.InstancedMesh(geo, mat, flocks * per);
    mesh.frustumCulled = false;
    const list = [];
    const pilot = this.env.pilot;
    for (let f = 0; f < flocks; f++) {
      const a = this.rng() * Math.PI * 2, d = 150 + this.rng() * 600;
      const cx = pilot.x + Math.cos(a) * d, cz = pilot.z + Math.sin(a) * d;
      const base = this.env.heightAt(cx, cz) + 60 + this.rng() * 90;
      for (let i = 0; i < per; i++) {
        list.push({ cx, cz, base, r: 18 + this.rng() * 25, ang: this.rng() * Math.PI * 2, w: (0.25 + this.rng() * 0.15) * (f % 2 ? 1 : -1), dy: this.rng() * 12, flap: this.rng() * 10, scatter: 0, sx: 0, sz: 0, size: 0.9 + this.rng() * 0.5 });
      }
    }
    this.group.add(mesh);
    this.birds = { mesh, list };
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} plane posición del avión (para que los animales y aves reaccionen)
   */
  update(dt, plane, time) {
    const env = this.env;
    const px = plane?.x ?? 1e9, py = plane?.y ?? 1e9, pz = plane?.z ?? 1e9;
    for (const herd of this.animals) {
      const { list, mesh, kind } = herd;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const gy = env.heightAt(a.x, a.z);
        // el avión pasando bajo y cerca asusta al animal: corre alejándose
        const dx = a.x - px, dz = a.z - pz;
        const d = Math.hypot(dx, dz);
        if (d < 35 && py - gy < 14) { a.flee = 3 + this.rng() * 2; a.h = Math.atan2(dz, dx) + (this.rng() - 0.5) * 0.6; }
        a.timer -= dt;
        if (a.flee > 0) {
          a.flee -= dt;
          a.target = kind === 'cow' ? 3.5 : 4.5;
        } else if (a.timer <= 0) {
          // alterna pastar (quieto) y dar unos pasos; tiende a no alejarse del rebaño
          a.timer = 3 + this.rng() * 9;
          const walk = this.rng() < 0.35;
          a.target = walk ? 0.5 + this.rng() * 0.5 : 0;
          if (walk) {
            const hx = a.home.x - a.x, hz = a.home.z - a.z;
            a.h = Math.hypot(hx, hz) > 70 ? Math.atan2(hz, hx) : a.h + (this.rng() - 0.5) * 1.6;
          }
        }
        a.speed += (a.target - a.speed) * Math.min(1, dt * 2);
        if (a.speed > 0.01) {
          const nx = a.x + Math.cos(a.h) * a.speed * dt, nz = a.z + Math.sin(a.h) * a.speed * dt;
          if (env.isFree(nx, nz, 4) && env.normalAt(nx, nz, _p).y > 0.85) { a.x = nx; a.z = nz; } else { a.h += Math.PI * 0.6; a.target = 0; }
        }
        const bob = a.speed > 0.05 ? Math.abs(Math.sin(time * (a.speed > 2 ? 9 : 4) + a.phase)) * 0.05 * Math.min(1, a.speed) : 0;
        // pastando: cabeza abajo (todo el cuerpo se inclina un poco hacia delante)
        const graze = a.speed < 0.05 ? 0.08 + Math.sin(time * 0.7 + a.phase) * 0.04 : 0;
        _e.set(0, -a.h, -graze, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(a.x, env.heightAt(a.x, a.z) + bob, a.z);
        _s.setScalar(a.scale);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.cars) {
      const { list, mesh } = this.cars;
      _s.setScalar(1);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        c.s += c.dir * c.speed * dt;
        if (c.s > c.len) { c.s = c.len; c.dir = -1; }
        if (c.s < 0) { c.s = 0; c.dir = 1; }
        let j = 1;
        while (j < c.cum.length - 1 && c.cum[j] < c.s) j++;
        const a = c.road[j - 1], b = c.road[j];
        const segLen = c.cum[j] - c.cum[j - 1] || 1;
        const u = (c.s - c.cum[j - 1]) / segLen;
        const tx = (b[0] - a[0]) / segLen, tz = (b[1] - a[1]) / segLen;
        // circula por su carril (a la derecha del sentido de marcha)
        const x = a[0] + (b[0] - a[0]) * u - tz * c.lane * c.dir, z = a[1] + (b[1] - a[1]) * u + tx * c.lane * c.dir;
        const h = Math.atan2(tz * c.dir, tx * c.dir);
        _q.setFromAxisAngle(_up, -h);
        _p.set(x, env.heightAt(x, z), z);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.birds) {
      const { list, mesh } = this.birds;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        b.ang += b.w * dt;
        let x = b.cx + Math.cos(b.ang) * b.r, z = b.cz + Math.sin(b.ang) * b.r;
        let y = b.base + b.dy + Math.sin(time * 0.3 + i) * 3;
        // se dispersan si el avión se acerca
        if (Math.hypot(x - px, y - py, z - pz) < 30) { b.scatter = 4; b.sx = (x - px) * 0.08; b.sz = (z - pz) * 0.08; }
        if (b.scatter > 0) { b.scatter -= dt; b.cx += b.sx * dt * 6; b.cz += b.sz * dt * 6; b.base += dt * 3; }
        x = b.cx + Math.cos(b.ang) * b.r; z = b.cz + Math.sin(b.ang) * b.r;
        y = b.base + b.dy + Math.sin(time * 0.3 + i) * 3;
        b.flap += dt * (b.scatter > 0 ? 14 : 3);
        // planean casi siempre, con aleteos ocasionales
        const flapAmt = b.scatter > 0 ? Math.sin(b.flap) : Math.max(0, Math.sin(b.flap * 0.5)) ** 8 * Math.sin(b.flap * 6);
        const heading = b.ang + (b.w > 0 ? Math.PI / 2 : -Math.PI / 2);
        _e.set(0, -heading, (b.w > 0 ? 1 : -1) * 0.35, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(x, y, z);
        _s.set(b.size, b.size * (1 + flapAmt * 0.8), b.size);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
