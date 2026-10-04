/**
 * Cielo procedural (gradiente + sol + estrellas), iluminación según la hora del día,
 * niebla, mapa de entorno para reflejos, nubes en movimiento, lluvia y aves.
 */
import * as THREE from 'three';
import { cloudPuff } from './TextureFactory.js';
import { DEG, clamp, lerp, makeRng, smoothstep } from '../utils/math3d.js';

const skyVert = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunColor;
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform float uStars; uniform float uSunSize; uniform float uHaze;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.08, h));
  // halo y disco solar
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 8.0) * 0.25 * uHaze + pow(sd, 64.0) * 0.35);
  col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, sd) * 6.0;
  // luna
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, md) * 1.5 * uStars;
  // estrellas
  if (uStars > 0.01 && h > 0.0) {
    vec3 q = floor(d * 420.0);
    float s = hash(q);
    col += vec3(step(0.9975, s) * uStars * (0.6 + 0.4 * sin(s * 100.0)));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Paletas por elevación solar (colores sRGB). */
const PRESETS = [
  { el: -18, zenith: '#04070f', horizon: '#0c1424', ground: '#05070a', sun: '#000000', sunI: 0, hemi: 0.18, fog: '#0c1322' },
  { el: -6, zenith: '#14203c', horizon: '#5b4a5e', ground: '#121214', sun: '#ff7a3c', sunI: 0.05, hemi: 0.32, fog: '#3d3a4a' },
  { el: 2, zenith: '#2f5487', horizon: '#f0a25e', ground: '#3a3530', sun: '#ff9a50', sunI: 1.1, hemi: 0.55, fog: '#c99a78' },
  { el: 12, zenith: '#3a6eb5', horizon: '#e9c9a0', ground: '#4b4a40', sun: '#ffd2a0', sunI: 2.2, hemi: 0.85, fog: '#cfc7b8' },
  { el: 30, zenith: '#2f6fc9', horizon: '#b9d3ec', ground: '#55584a', sun: '#fff1dc', sunI: 3.0, hemi: 1.0, fog: '#bccfe0' },
  { el: 70, zenith: '#2a66c4', horizon: '#aecbe8', ground: '#5a5d4e', sun: '#ffffff', sunI: 3.3, hemi: 1.05, fog: '#b3cbe2' },
];

const CLOUD_COUNTS = { clear: 0, partly: 22, cloudy: 48, overcast: 70 };

export class SkySystem {
  constructor(scene, renderer, quality = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.q = { clouds: 1, rain: 1, birds: true, envMap: true, ...quality };
    this.time = 0;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() },
      uStars: { value: 0 }, uSunSize: { value: 0.0007 }, uHaze: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight('#ffffff', 3);
    this.sun.castShadow = false;
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    scene.add(this.sun);
    this.moon = new THREE.DirectionalLight('#9fb4ff', 0);
    scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight('#bcd4ff', '#4a4a3a', 1);
    scene.add(this.hemi);
    this.fog = new THREE.Fog('#bccfe0', 400, 4000);
    scene.fog = this.fog;

    this.clouds = new THREE.Group();
    scene.add(this.clouds);
    this.cloudSprites = [];
    this.rain = null;
    this.birds = [];
    this.pmrem = null;
    this.envRT = null;
    this.night = false;
  }

  /** Aplica hora, nubosidad, niebla y lluvia. drawDistance en metros. */
  configure(weather, env, drawDistance = 4000) {
    this.weather = weather;
    this.env = env;
    this.drawDistance = drawDistance;
    const cfg = weather.cfg;
    const h = cfg.timeOfDay;
    const el = (h >= 6 && h <= 18) ? 62 * Math.sin(((h - 6) / 12) * Math.PI) : -25 * Math.sin((((h + 24 - 18) % 24) / 12) * Math.PI);
    const elev = h < 6.0 && h > 5 ? lerp(-6, 0, h - 5) : h > 18 && h < 19 ? lerp(0, -6, h - 18) : el;
    const az = (90 + ((h - 6) / 12) * 180) * DEG;
    const e = elev * DEG;
    this.sunDir.set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)).normalize();
    this.elevation = elev;
    // interpolación de la paleta
    let a = PRESETS[0], b = PRESETS[PRESETS.length - 1];
    for (let i = 0; i < PRESETS.length - 1; i++) {
      if (elev >= PRESETS[i].el && elev <= PRESETS[i + 1].el) { a = PRESETS[i]; b = PRESETS[i + 1]; break; }
    }
    if (elev < PRESETS[0].el) b = a;
    const t = a === b ? 0 : clamp((elev - a.el) / (b.el - a.el), 0, 1);
    const mix = (ca, cb) => new THREE.Color(ca).lerp(new THREE.Color(cb), t);
    const cloud = { clear: 0, partly: 0.2, cloudy: 0.5, overcast: 0.9 }[cfg.sky] ?? 0.2;
    const grey = new THREE.Color('#9aa3ad');
    const zen = mix(a.zenith, b.zenith).lerp(grey.clone().multiplyScalar(elev > 0 ? 1 : 0.15), cloud * 0.75);
    const hor = mix(a.horizon, b.horizon).lerp(grey.clone().multiplyScalar(elev > 0 ? 1.05 : 0.18), cloud * 0.6);
    const fogC = mix(a.fog, b.fog).lerp(new THREE.Color(elev > 0 ? '#aab2ba' : '#1a1c22'), Math.max(cloud * 0.5, cfg.fog));
    this.uniforms.uZenith.value.copy(zen);
    this.uniforms.uHorizon.value.copy(hor);
    this.uniforms.uGround.value.copy(mix(a.ground, b.ground));
    this.uniforms.uSunColor.value.copy(mix(a.sun, b.sun)).multiplyScalar(1 - cloud * 0.85);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uMoonDir.value.set(-this.sunDir.x, Math.abs(this.sunDir.y) * 0.8 + 0.3, -this.sunDir.z).normalize();
    this.uniforms.uStars.value = clamp((-elev - 4) / 10, 0, 1) * (1 - cloud);
    this.uniforms.uHaze.value = 1 + cfg.fog * 2;
    const sunI = lerp(a.sunI, b.sunI, t) * (1 - cloud * 0.7);
    this.sun.color.copy(mix(a.sun, b.sun));
    this.sun.intensity = sunI;
    this.hemi.color.copy(zen).lerp(new THREE.Color('#ffffff'), 0.35);
    this.hemi.groundColor.copy(mix(a.ground, b.ground)).lerp(new THREE.Color('#3b3a2e'), 0.4);
    this.hemi.intensity = lerp(a.hemi, b.hemi, t) * (1 + cloud * 0.25);
    this.night = elev < -4;
    // luz lunar para que el vuelo nocturno sea jugable
    this.moon.intensity = this.night ? 0.55 : 0;
    this.moon.position.copy(this.uniforms.uMoonDir.value).multiplyScalar(100);
    // niebla: nunca por debajo de lo jugable salvo petición expresa
    const vis = weather.visibility;
    const far = Math.min(drawDistance, vis);
    this.fog.color.copy(fogC);
    this.fog.near = Math.min(far * 0.3, 600 + far * 0.1);
    this.fog.far = far;
    this.scene.background = null;
    this.buildClouds(cfg.sky, env);
    this.buildRain(cfg.rain);
    this.buildBirds(env);
    if (this.q.envMap) this.updateEnvMap();
  }

  /** Mapa de entorno filtrado (PMREM) a partir del cielo, para reflejos en aviones y agua. */
  updateEnvMap() {
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const sc = new THREE.Scene();
    const dome = new THREE.Mesh(this.dome.geometry, this.dome.material);
    sc.add(dome);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(sc, 0, 0.1, 2000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.night ? 0.15 : 0.55;
    if (old) old.dispose();
  }

  buildClouds(sky, env) {
    for (const s of this.cloudSprites) { s.material.dispose(); s.removeFromParent(); }
    this.cloudSprites.length = 0;
    const n = Math.round((CLOUD_COUNTS[sky] ?? 20) * this.q.clouds);
    const r = makeRng(77);
    const baseAlt = (env?.cloudBase ?? 450) + (env?.id === 'mountains' ? 350 : 0);
    const tint = this.night ? new THREE.Color('#2a2f3a') : new THREE.Color('#ffffff').lerp(new THREE.Color('#ffd9b0'), clamp((15 - this.elevation) / 15, 0, 0.6));
    if (sky === 'overcast' || sky === 'cloudy') tint.lerp(new THREE.Color('#9aa1aa'), sky === 'overcast' ? 0.5 : 0.25);
    for (let i = 0; i < n; i++) {
      const cx = (r() - 0.5) * 5000, cz = (r() - 0.5) * 5000, cy = baseAlt + r() * 250;
      const puffs = 3 + Math.floor(r() * 4);
      for (let k = 0; k < puffs; k++) {
        const mat = new THREE.SpriteMaterial({ map: cloudPuff(1 + (k % 4)), color: tint, transparent: true, depthWrite: false, opacity: 0.85, fog: true });
        const sp = new THREE.Sprite(mat);
        const size = 180 + r() * 260;
        sp.scale.set(size, size * 0.6, 1);
        sp.position.set(cx + (r() - 0.5) * 300, cy + (r() - 0.5) * 50, cz + (r() - 0.5) * 300);
        sp.userData.base = sp.position.clone();
        this.clouds.add(sp);
        this.cloudSprites.push(sp);
      }
    }
  }

  buildRain(intensity) {
    if (this.rain) { this.rain.geometry.dispose(); this.rain.material.dispose(); this.rain.removeFromParent(); this.rain = null; }
    if (intensity <= 0.01 || this.q.rain <= 0) return;
    const count = Math.round(4000 * intensity * this.q.rain);
    const pos = new Float32Array(count * 6);
    const r = makeRng(5);
    for (let i = 0; i < count; i++) {
      const x = (r() - 0.5) * 120, y = r() * 60, z = (r() - 0.5) * 120;
      pos.set([x, y, z, x, y - 0.6, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#c8d4e0', transparent: true, opacity: 0.35 + intensity * 0.2, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  buildBirds(env) {
    for (const b of this.birds) { b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.mesh.removeFromParent(); }
    this.birds.length = 0;
    if (!this.q.birds || this.night || (this.weather?.cfg.rain ?? 0) > 0.3) return;
    const r = makeRng(9);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0.1, 0, 0, -0.1, 0, 0, 0.12, 0.5, 0, 0.1, 0, 0, -0.1, 0, 0, 0.12]), 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#202020', side: THREE.DoubleSide }));
      mesh.scale.setScalar(0.7);
      this.scene.add(mesh);
      this.birds.push({
        mesh, cx: (r() - 0.5) * 800, cz: (r() - 0.5) * 800, alt: 60 + r() * 120, radius: 40 + r() * 80,
        speed: 0.12 + r() * 0.1, phase: r() * 6.28, flap: 6 + r() * 3,
      });
    }
  }

  /** Coloca la luz del sol (y su cámara de sombras) alrededor del objetivo. */
  followTarget(target) {
    this.sunTarget.position.copy(target);
    const dir = this.night ? this.uniforms.uMoonDir.value : this.sunDir;
    this.sun.position.copy(target).addScaledVector(dir.y > 0.05 ? dir : new THREE.Vector3(0.3, 1, 0.2).normalize(), 150);
  }

  update(dt, camera, windVec) {
    this.time += dt;
    this.dome.position.copy(camera.position);
    // nubes: deriva con el viento y recolocación alrededor de la cámara
    const wx = windVec ? windVec.x * 1.5 : 0, wz = windVec ? windVec.z * 1.5 : 0;
    for (const s of this.cloudSprites) {
      s.userData.base.x += wx * dt;
      s.userData.base.z += wz * dt;
      let dx = s.userData.base.x - camera.position.x, dz = s.userData.base.z - camera.position.z;
      if (dx > 2500) s.userData.base.x -= 5000; else if (dx < -2500) s.userData.base.x += 5000;
      if (dz > 2500) s.userData.base.z -= 5000; else if (dz < -2500) s.userData.base.z += 5000;
      s.position.copy(s.userData.base);
    }
    if (this.rain) {
      this.rain.position.set(camera.position.x, camera.position.y - 30, camera.position.z);
      const p = this.rain.geometry.attributes.position;
      const fall = 14 * dt;
      for (let i = 0; i < p.count; i += 2) {
        let y = p.getY(i) - fall;
        let x = p.getX(i) + wx * 0.3 * dt, z = p.getZ(i) + wz * 0.3 * dt;
        if (y < 0) { y += 60; x = (Math.random() - 0.5) * 120; z = (Math.random() - 0.5) * 120; }
        p.setXYZ(i, x, y, z);
        p.setXYZ(i + 1, x - wx * 0.02, y - 0.6, z - wz * 0.02);
      }
      p.needsUpdate = true;
    }
    for (const b of this.birds) {
      const a = this.time * b.speed + b.phase;
      const ground = this.env ? this.env.heightAt(b.cx, b.cz) : 0;
      b.mesh.position.set(b.cx + Math.cos(a) * b.radius, ground + b.alt + Math.sin(a * 0.7) * 6, b.cz + Math.sin(a) * b.radius);
      b.mesh.rotation.y = -a;
      const f = Math.sin(this.time * b.flap + b.phase) * 0.7;
      const pos = b.mesh.geometry.attributes.position;
      pos.setY(0, f * 0.5); pos.setY(3, f * 0.5);
      pos.needsUpdate = true;
    }
  }

  dispose() {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.dome.removeFromParent();
    for (const s of this.cloudSprites) s.material.dispose();
    this.clouds.removeFromParent();
    this.buildRain(0);
    for (const b of this.birds) { b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.mesh.removeFromParent(); }
    for (const l of [this.sun, this.moon, this.hemi, this.sunTarget]) l.removeFromParent();
    this.envRT?.dispose();
    this.pmrem?.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
  }
}
