/**
 * Envoltorio del WebGLRenderer (WebGL2): perfiles de calidad, sombras, antialiasing
 * (recrea el contexto si cambia), escala de resolución, resolución dinámica y límite de FPS.
 */
import * as THREE from 'three';
import { SHADOW_SIZES } from '../data/settings.js';
import { setTextureQuality } from './TextureFactory.js';
import { clamp } from '../utils/math3d.js';
import { RealisticPost } from './RealisticPost.js';

export class Renderer {
  constructor(container, gfx) {
    this.container = container;
    this.gfx = { ...gfx };
    this.dynScale = 1;
    this.frameTimes = [];
    this.create();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this.onResize);
  }

  create() {
    const canvas = document.createElement('canvas');
    canvas.className = 'gl-canvas';
    let r;
    try {
      r = new THREE.WebGLRenderer({ canvas, antialias: !!this.gfx.antialias, powerPreference: 'high-performance', alpha: false });
    } catch (e) {
      throw new Error('WebGL2 no está disponible en este navegador o dispositivo.');
    }
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = SHADOW_SIZES[this.shadowLevel] > 0;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.canvas = canvas;
    this.container.prepend(canvas);
    setTextureQuality(this.gfx.textureQuality ?? 1);
    this.resize();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; });
  }

  /** Aplica una configuración gráfica. Devuelve true si hubo que recrear el contexto. */
  apply(gfx) {
    const needRecreate = !!gfx.antialias !== !!this.gfx.antialias;
    this.gfx = { ...gfx };
    setTextureQuality(gfx.textureQuality ?? 1);
    if (needRecreate) {
      const old = this.renderer;
      this.post?.dispose();
      this.post = null;
      this.canvas.remove();
      old.dispose();
      this.create();
      return true;
    }
    this.renderer.shadowMap.enabled = SHADOW_SIZES[this.shadowLevel] > 0;
    if (!gfx.realistic && this.post) { this.post.dispose(); this.post = null; }
    this.resize();
    return false;
  }

  /** Render realista (mejora de pago, solo visual): sombras de alta resolución como mínimo. */
  get shadowLevel() {
    if (!this.gfx.realistic || this.gfx.shadows === 'off') return this.gfx.shadows;
    return this.gfx.shadows === 'ultra' ? 'ultra' : 'high';
  }

  get pixelRatio() {
    const base = Math.min(window.devicePixelRatio || 1, 2);
    return clamp(base * (this.gfx.resolutionScale ?? 1) * this.dynScale, 0.35, 2.5);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.width = w;
    this.height = h;
    if (this.camera) {
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
  }

  setCamera(camera) {
    this.camera = camera;
    this.resize();
  }

  /** Ajuste automático de la escala de resolución para acercarse a los FPS objetivo. */
  adaptResolution(frameDt) {
    if (!this.gfx.dynamicResolution) {
      if (this.dynScale !== 1) { this.dynScale = 1; this.resize(); }
      return;
    }
    // cada cambio de resolución reasigna los búferes y provoca un tirón: se decide con ventanas de
    // ~1,5 s, se baja enseguida si hace falta pero se sube solo tras varias ventanas holgadas
    this.frameTimes.push(frameDt);
    if (this.frameTimes.length < 90) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    this.frameTimes.length = 0;
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const target = 1 / (this.gfx.targetFps || 60);
    let s = this.dynScale;
    if (p75 > target * 1.2) { s *= 0.85; this.goodWindows = 0; }
    else if (p75 < target * 1.05) { this.goodWindows = (this.goodWindows || 0) + 1; if (this.goodWindows >= 6) { s *= 1.08; this.goodWindows = 0; } }
    else this.goodWindows = 0;
    s = clamp(s, 0.5, 1);
    if (Math.abs(s - this.dynScale) > 0.02) { this.dynScale = s; this.resize(); }
  }

  configureShadowLight(light) {
    const level = this.shadowLevel;
    const size = SHADOW_SIZES[level] || 0;
    light.castShadow = size > 0;
    if (size > 0) {
      light.shadow.mapSize.set(size, size);
      const ext = level === 'ultra' ? 45 : level === 'low' ? 25 : 35;
      const cam = light.shadow.camera;
      cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
      cam.near = 1; cam.far = 400;
      cam.updateProjectionMatrix();
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.03;
      if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
    }
  }

  render(scene, camera) {
    if (this.contextLost) return;
    if (this.gfx.realistic) {
      this.post ??= new RealisticPost(this.renderer);
      this.post.render(scene, camera, performance.now() / 1000);
      return;
    }
    this.renderer.render(scene, camera);
  }

  get info() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }

  dispose() {
    this.post?.dispose();
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
