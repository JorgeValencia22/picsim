/**
 * Vista previa 3D de una aeronave (hangar y preparación de vuelo): rotar arrastrando,
 * acercar con la rueda o pellizcando, giro automático suave. Usa su propio contexto WebGL
 * pequeño y sólo dibuja mientras está visible.
 */
import * as THREE from 'three';
import { AircraftModel } from '../render/AircraftModel.js';
import { clamp } from '../utils/math3d.js';

export class PreviewRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
    this.scene.add(new THREE.HemisphereLight('#cfe4ff', '#3a3226', 1.6));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#8fc7ff', 1.2);
    rim.position.set(-4, 2, -5);
    this.scene.add(rim);
    // entorno simple para reflejos
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#556677');
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: false, color: '#9fb6cc' }));
    envScene.add(sky);
    this.envRT = pm.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.6;
    pm.dispose();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35 }));
    disc.rotation.x = -Math.PI / 2;
    this.scene.add(disc);
    this.disc = disc;
    this.yaw = -2.3; this.pitch = 0.32; this.dist = 3; this.auto = true;
    this.model = null;
    this.visible = false;
    this.lastInteract = 0;
    this.bindInput();
    this.loop = this.loop.bind(this);
  }

  bindInput() {
    const c = this.canvas;
    const pts = new Map();
    c.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); c.setPointerCapture(e.pointerId); this.auto = false; });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      if (pts.size === 2) {
        const other = [...pts.entries()].find(([id]) => id !== e.pointerId)[1];
        const d0 = Math.hypot(p.x - other.x, p.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (d0 > 5) this.dist = clamp(this.dist * (d0 / d1), this.minDist, this.maxDist);
      } else {
        this.yaw -= (e.clientX - p.x) * 0.01;
        this.pitch = clamp(this.pitch + (e.clientY - p.y) * 0.008, -0.6, 1.3);
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastInteract = performance.now();
    });
    const up = (e) => { pts.delete(e.pointerId); this.lastInteract = performance.now(); };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = clamp(this.dist * (e.deltaY > 0 ? 1.1 : 0.9), this.minDist, this.maxDist); }, { passive: false });
  }

  mount(container) {
    container.append(this.canvas);
    this.container = container;
    this.visible = true;
    this.resize();
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  unmount() {
    this.visible = false;
    this.canvas.remove();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  setAircraft(spec, livery) {
    if (this.model) this.model.dispose();
    this.model = new AircraftModel(spec, livery, { shadows: false });
    this.scene.add(this.model.root);
    const s = Math.max(spec.span, spec.length);
    this.dist = s * 1.55 + 0.4;
    this.minDist = s * 0.6;
    this.maxDist = s * 4;
    this.disc.scale.setScalar(s * 0.75);
    this.restY = 0;
    // apoyado en el "suelo" del disco
    let minY = 0;
    for (const p of spec.gearPoints.length ? spec.gearPoints : spec.airframePoints) minY = Math.min(minY, p.y);
    this.model.root.position.y = -minY;
    this.disc.position.y = 0.002;
    this.spec = spec;
    this.t = 0;
  }

  resize() {
    if (!this.container) return;
    const w = this.container.clientWidth || 300, hgt = this.container.clientHeight || 200;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / Math.max(1, hgt);
    this.camera.updateProjectionMatrix();
  }

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || !this.model) return;
    if (this.canvas.clientWidth && (this.canvas.width !== Math.round(this.canvas.clientWidth * this.renderer.getPixelRatio()))) this.resize();
    const dt = 1 / 60;
    this.t += dt;
    if (!this.auto && now - this.lastInteract > 4000) this.auto = true;
    if (this.auto) this.yaw += dt * 0.25;
    const target = new THREE.Vector3(0, this.spec.fuseH * 0.6 + this.model.root.position.y * 0.5, 0);
    this.camera.position.set(target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, target.y + Math.sin(this.pitch) * this.dist, target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    this.camera.lookAt(target);
    // demostración de mandos: movimiento suave de las superficies y la hélice al ralentí
    const s = Math.sin(this.t * 1.3);
    this.model.update({ defl: { aileron: s * 0.6, elevator: Math.sin(this.t * 0.9) * 0.5, rudder: Math.cos(this.t * 0.7) * 0.5, flap: 0, airbrake: 0 }, propAngle: this.t * 8, rpm: 500, rpmFrac: 0.05, gearPos: 1, damage: null, wheelSpeed: 0, time: this.t, night: false }, dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.unmount();
    this.model?.dispose();
    this.envRT.dispose();
    this.renderer.dispose();
  }
}
