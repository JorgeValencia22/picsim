/**
 * Efectos visuales: partículas (polvo, hierba, salpicaduras, humo, indicadores de térmicas),
 * sombra difusa bajo la aeronave, escombros con física balística simple y marcadores 3D
 * (aros de desafíos, zonas de aterrizaje).
 */
import * as THREE from 'three';
import { softDot } from './TextureFactory.js';
import { clamp } from '../utils/math3d.js';

const pVert = `
attribute vec4 aColor; attribute float aSize;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const pFrag = `
uniform sampler2D uMap; varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
  #include <colorspace_fragment>
}`;

class ParticlePool {
  constructor(max, blending = THREE.NormalBlending, drag = 1.5) {
    this.max = max;
    this.drag = drag;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.next = 0;
    this.alive = false; // sin partículas vivas no se recorre ni se sube nada a la GPU
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({ uniforms: { uMap: { value: softDot() } }, vertexShader: pVert, fragmentShader: pFrag, transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(x, y, z, vx, vy, vz, life, r, g, b, a, size, grow = 0, gravity = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([r, g, b, a], i * 4);
    this.alpha0[i] = a;
    this.size[i] = size;
    this.grow[i] = grow;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.alive = true;
  }

  update(dt, env) {
    if (!this.alive) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      any = true;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.gravity[i] * dt;
      const drag = Math.exp(-this.drag * dt);
      this.vel[k] *= drag; this.vel[k + 1] *= this.gravity[i] > 0 ? 1 : drag; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (env && this.gravity[i] > 0) {
        const h = env.heightAt(this.pos[k], this.pos[k + 2]);
        if (this.pos[k + 1] < h) { this.pos[k + 1] = h; this.vel[k] *= 0.3; this.vel[k + 2] *= 0.3; this.vel[k + 1] = 0; }
      }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = this.alpha0[i] * clamp(t * 1.5, 0, 1);
    }
    this.alive = any;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.col.fill(0); this.points.geometry.attributes.aColor.needsUpdate = true; this.alive = false; }

  dispose() { this.points.geometry.dispose(); this.points.material.dispose(); this.points.removeFromParent(); }
}

export class Effects {
  constructor(scene, quality = 1) {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    const n = Math.round(600 * Math.max(0.3, quality));
    this.dust = new ParticlePool(n);
    this.bits = new ParticlePool(Math.round(n * 0.6));
    this.thermalBits = new ParticlePool(300);
    // humo acrobático: estela larga que deriva con el viento y se disipa
    this.smokePool = new ParticlePool(Math.round(1500 * Math.max(0.5, Math.min(1.2, quality))), THREE.NormalBlending, 0.08);
    this.group.add(this.dust.points, this.bits.points, this.thermalBits.points, this.smokePool.points);
    this.smokeAcc = 0;
    // sombra difusa
    const shadowMat = new THREE.MeshBasicMaterial({ map: softDot('0,0,0'), transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -4 });
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 2;
    this.group.add(this.blob);
    this.debris = [];
    this.markers = new THREE.Group();
    this.group.add(this.markers);
    this.thermalTimer = 0;
  }

  /** Polvo / hierba al rodar o tomar contacto. */
  groundContact(pos, speed, surfaceType, strength = 1) {
    if (speed < 1.5) return;
    const n = Math.min(6, Math.ceil(speed * 0.3 * strength * this.quality));
    for (let i = 0; i < n; i++) {
      const r = Math.random;
      if (surfaceType === 'asphalt' || surfaceType === 'concrete') {
        if (strength > 1.5) this.dust.spawn(pos.x, pos.y + 0.05, pos.z, (r() - 0.5) * 1.5, 0.5 + r(), (r() - 0.5) * 1.5, 1.2, 0.85, 0.85, 0.85, 0.35, 0.6, 1.2);
        continue;
      }
      if (surfaceType === 'sand' || surfaceType === 'dirt' || surfaceType === 'gravel' || surfaceType === 'field') {
        this.dust.spawn(pos.x, pos.y + 0.05, pos.z, (r() - 0.5) * 2, 0.4 + r() * 1.2, (r() - 0.5) * 2, 1.6 + r(), 0.62, 0.52, 0.38, 0.4, 0.5 + r() * 0.4, 1.6);
      } else {
        // hierba: pequeños fragmentos verdes que saltan
        this.bits.spawn(pos.x, pos.y + 0.03, pos.z, (r() - 0.5) * 2.5, 1 + r() * 2.5 * strength, (r() - 0.5) * 2.5, 0.9, 0.3, 0.55, 0.18, 0.9, 0.1, 0, 9.8);
        if (r() < 0.3) this.dust.spawn(pos.x, pos.y + 0.05, pos.z, (r() - 0.5), 0.3, (r() - 0.5), 1.1, 0.55, 0.6, 0.45, 0.18, 0.5, 1);
      }
    }
  }

  splash(pos, speed) {
    const n = Math.round(40 * this.quality);
    for (let i = 0; i < n; i++) {
      const r = Math.random;
      const a = r() * Math.PI * 2, s = 1 + r() * speed * 0.3;
      this.bits.spawn(pos.x, pos.y, pos.z, Math.cos(a) * s, 2 + r() * speed * 0.4, Math.sin(a) * s, 1.4, 0.9, 0.95, 1, 0.9, 0.18, 0, 9.8);
    }
    for (let i = 0; i < 10; i++) this.dust.spawn(pos.x, pos.y + 0.2, pos.z, (Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3, 2, 0.95, 0.97, 1, 0.45, 1.2, 2);
  }

  impactSmoke(pos, big = false) {
    const n = big ? 40 : 14;
    for (let i = 0; i < n; i++) {
      const r = Math.random;
      this.dust.spawn(pos.x, pos.y + 0.2, pos.z, (r() - 0.5) * 3, 0.5 + r() * 2, (r() - 0.5) * 3, 2.5 + r() * 2, 0.45, 0.42, 0.4, 0.5, big ? 1.4 : 0.8, 2.2);
    }
    for (let i = 0; i < n; i++) {
      const r = Math.random;
      this.bits.spawn(pos.x, pos.y + 0.1, pos.z, (r() - 0.5) * 6, 2 + r() * 4, (r() - 0.5) * 6, 2, 0.25, 0.25, 0.25, 1, 0.07, 0, 9.8);
    }
  }

  /** Humo del escape de motores glow/gasolina (estela fina azulada). */
  exhaust(pos, vel, amount) {
    if (Math.random() > amount * this.quality) return;
    this.dust.spawn(pos.x, pos.y, pos.z, vel.x * 0.2, vel.y * 0.2 + 0.2, vel.z * 0.2, 1.2, 0.75, 0.78, 0.85, 0.12, 0.25, 0.9);
  }

  /** Ayuda visual de térmicas para principiantes: semillas/vilanos que ascienden. */
  /**
   * Estela de humo desde la cola (pos = salida del humo en el mundo, vel = velocidad del avión).
   * Se emite por distancia recorrida para que la estela sea continua a cualquier velocidad.
   */
  smoke(pos, vel, wind, dt, span) {
    const v = Math.hypot(vel.x, vel.y, vel.z);
    const spacing = Math.max(0.2, span * 0.12);
    this.smokeAcc += (v * dt) / spacing + dt * 8;
    let n = Math.min(40, Math.floor(this.smokeAcc));
    this.smokeAcc -= n;
    // tamaño en unidades del sombreador de puntos (≈ 3,3 × diámetro en metros)
    const size0 = Math.max(1.1, span * 1.05);
    for (let i = 0; i < n; i++) {
      // repartidas a lo largo del tramo recorrido en este fotograma
      const f = (i + Math.random()) / Math.max(1, n);
      const x = pos.x - vel.x * dt * f, y = pos.y - vel.y * dt * f, z = pos.z - vel.z * dt * f;
      const j = 0.6;
      this.smokePool.spawn(x, y, z, wind.x * 0.9 + (Math.random() - 0.5) * j, 0.15 + (Math.random() - 0.5) * j, wind.z * 0.9 + (Math.random() - 0.5) * j,
        7 + Math.random() * 3, 0.96, 0.96, 0.95, 0.42, size0, size0 * 0.5);
    }
  }

  thermalHints(weather, center, dt) {
    this.thermalTimer += dt;
    if (this.thermalTimer < 0.08) return;
    this.thermalTimer = 0;
    for (const th of weather.thermals) {
      const dx = th.x - center.x, dz = th.z - center.z;
      if (dx * dx + dz * dz > 900 * 900) continue;
      const env = weather.thermalEnvelope(th);
      if (env < 0.2) continue;
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * th.radius * 0.7;
      const x = th.x + Math.cos(a) * rr, z = th.z + Math.sin(a) * rr;
      const ground = weather.env ? weather.env.heightAt(x, z) : 0;
      const y = ground + 10 + Math.random() * 120;
      this.thermalBits.spawn(x, y, z, 0, th.strength * env * 1.2, 0, 6, 1, 1, 0.95, 0.55, 1.4, 0);
    }
  }

  /** Sombra difusa bajo la aeronave (complementa o sustituye al mapa de sombras). */
  updateBlob(env, pos, span, visible, strength = 1) {
    if (!visible) { this.blob.visible = false; return; }
    const h = env.heightAt(pos.x, pos.z);
    const agl = pos.y - h;
    const water = env.waterLevelAt(pos.x, pos.z);
    this.blob.visible = agl < 60;
    this.blob.position.set(pos.x, (water != null ? water : h) + 0.06, pos.z);
    const s = span * (1.1 + agl * 0.02);
    this.blob.scale.set(s, s, 1);
    this.blob.material.opacity = clamp(0.55 - agl / 80, 0, 0.55) * strength;
  }

  /** Lanza piezas de la aeronave como escombros. */
  spawnDebris(meshes, vel) {
    for (const m of meshes) {
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
      m.updateWorldMatrix(true, false);
      m.matrixWorld.decompose(wp, wq, ws);
      const clone = m.clone();
      clone.position.copy(wp);
      clone.quaternion.copy(wq);
      clone.scale.copy(ws);
      clone.castShadow = true;
      this.group.add(clone);
      m.visible = false;
      this.debris.push({
        mesh: clone,
        vel: new THREE.Vector3(vel.x + (Math.random() - 0.5) * 6, vel.y * 0.3 + Math.random() * 4, vel.z + (Math.random() - 0.5) * 6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        life: 25,
      });
    }
  }

  clearDebris() {
    for (const d of this.debris) d.mesh.removeFromParent();
    this.debris.length = 0;
  }

  /** Aros y marcadores 3D de los desafíos. */
  setMarkers(list) {
    for (const c of [...this.markers.children]) { c.geometry?.dispose(); c.material?.dispose(); c.removeFromParent(); }
    for (const mk of list || []) {
      if (mk.type === 'ring') {
        const mesh = new THREE.Mesh(new THREE.TorusGeometry(mk.radius, Math.max(0.25, mk.radius * 0.05), 8, 40), new THREE.MeshBasicMaterial({ color: mk.color || '#ffb300', transparent: true, opacity: 0.85 }));
        mesh.position.set(mk.x, mk.y, mk.z);
        mesh.rotation.y = mk.yaw || 0;
        mesh.userData = mk;
        this.markers.add(mesh);
      } else if (mk.type === 'pad') {
        const mesh = new THREE.Mesh(new THREE.RingGeometry(mk.radius * 0.85, mk.radius, 48), new THREE.MeshBasicMaterial({ color: mk.color || '#ffffff', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(mk.x, mk.y + 0.12, mk.z);
        this.markers.add(mesh);
        const dot = new THREE.Mesh(new THREE.CircleGeometry(mk.radius * 0.15, 24), mesh.material.clone());
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(mk.x, mk.y + 0.12, mk.z);
        this.markers.add(dot);
      } else if (mk.type === 'pylon') {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, mk.h || 12, 10), new THREE.MeshStandardMaterial({ color: mk.color || '#ff6d00' }));
        mesh.position.set(mk.x, mk.y + (mk.h || 12) / 2, mk.z);
        this.markers.add(mesh);
      } else if (mk.type === 'box') {
        const mesh = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(mk.w, mk.h, mk.d)), new THREE.LineBasicMaterial({ color: mk.color || '#4fc3f7', transparent: true, opacity: 0.6 }));
        mesh.position.set(mk.x, mk.y + mk.h / 2, mk.z);
        mesh.rotation.y = mk.yaw || 0;
        this.markers.add(mesh);
      }
    }
  }

  /** Resalta el siguiente aro (índice) y atenúa los demás. */
  highlightMarker(index) {
    let k = 0;
    for (const c of this.markers.children) {
      if (c.userData && c.userData.type === 'ring') {
        c.material.color.set(k === index ? '#00e676' : k < index ? '#546e7a' : '#ffb300');
        c.material.opacity = k < index ? 0.25 : 0.85;
        k++;
      }
    }
  }

  update(dt, env) {
    this.dust.update(dt, env);
    this.bits.update(dt, env);
    this.thermalBits.update(dt, null);
    this.smokePool.update(dt, null);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      const h = env.heightAt(d.mesh.position.x, d.mesh.position.z) + 0.05;
      if (d.mesh.position.y < h) {
        d.mesh.position.y = h;
        d.vel.y = Math.abs(d.vel.y) * 0.25;
        d.vel.x *= 0.5; d.vel.z *= 0.5;
        d.spin.multiplyScalar(0.5);
      }
      if (d.life <= 0) { d.mesh.removeFromParent(); this.debris.splice(i, 1); }
    }
    for (const c of this.markers.children) if (c.userData && c.userData.type === 'ring') c.rotation.z += dt * 0.3;
  }

  reset() {
    this.dust.clear(); this.bits.clear(); this.thermalBits.clear(); this.smokePool.clear();
    this.clearDebris();
  }

  dispose() {
    this.dust.dispose(); this.bits.dispose(); this.thermalBits.dispose(); this.smokePool.dispose();
    this.blob.geometry.dispose(); this.blob.material.dispose();
    this.clearDebris();
    this.setMarkers([]);
    this.group.removeFromParent();
  }
}
