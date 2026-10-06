/**
 * «Render realista» (mejora de pago, SOLO visual). Cadena de posprocesado propia, sin dependencias:
 *  1. La escena se dibuja en un búfer HDR de coma flotante con MSAA ×4 (sin tonemapping).
 *  2. Bloom físico: paso de brillo + cadena de 5 mips con desenfoque (dual filter) y suma.
 *  3. Composición: exposición, curva fílmica ACES (ajuste de Hill), gradación de color
 *     (contraste, saturación, sombras frías / luces cálidas), viñeteado, grano de película muy
 *     suave, nitidez adaptativa y conversión a sRGB.
 * No toca la simulación: solo cambia cómo se ve cada fotograma.
 */
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */`
uniform sampler2D tSrc; uniform float uThreshold; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  // 4 muestras (reduce el parpadeo de brillos de un píxel) y umbral suave
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  c = min(c, vec3(40.0));
  float l = max(c.r, max(c.g, c.b));
  float k = clamp((l - uThreshold) / max(l, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(c * k * k, 1.0);
}`;

const DOWN = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv - uTexel).rgb + texture2D(tSrc, vUv + uTexel).rgb;
  s += texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv + vec2(-uTexel.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(uTexel.x * 2.0, 0.0)).rgb
         + texture2D(tSrc, vUv + vec2(0.0, -uTexel.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, uTexel.y * 2.0)).rgb;
  s += (texture2D(tSrc, vUv + uTexel).rgb + texture2D(tSrc, vUv - uTexel).rgb
      + texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb) * 2.0;
  gl_FragColor = vec4(s / 12.0, 1.0);
}`;

const COMPOSITE = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tDepth;
uniform float uNear; uniform float uFar; uniform vec3 uHaze; uniform float uHazeDensity;
uniform vec2 uTexel; uniform float uExposure; uniform float uBloom; uniform float uTime;
uniform float uContrast; uniform float uSaturation; uniform float uVignette; uniform float uGrain; uniform float uSharpen;
varying vec2 vUv;

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFitted(vec3 c) {
  const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(ACESOut * RRTAndODTFit(ACESIn * c), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  // nitidez adaptativa (compensa el suavizado del MSAA y del filtrado de texturas)
  vec3 n = texture2D(tScene, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tScene, vUv - vec2(uTexel.x, 0.0)).rgb
         + texture2D(tScene, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tScene, vUv - vec2(0.0, uTexel.y)).rgb;
  vec3 detail = c - n * 0.25;
  c = max(c + detail * uSharpen / (1.0 + dot(abs(detail), vec3(4.0))), vec3(0.0));
  // perspectiva aérea: la bruma crece con la distancia (el cielo ya la lleva)
  float z = texture2D(tDepth, vUv).x;
  if (z < 0.9999) {
    float ndc = z * 2.0 - 1.0;
    float dist = (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
    float k = 1.0 - exp(-pow(dist * uHazeDensity, 1.25));
    c = mix(c, uHaze, clamp(k, 0.0, 0.8));
  }
  c += texture2D(tBloom, vUv).rgb * uBloom;
  c *= uExposure;
  c = acesFitted(c);
  // gradación de color: contraste en torno al gris medio, saturación y tinte por luminancia
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = clamp((c - 0.18) * uContrast + 0.18, 0.0, 1.0);
  c *= mix(vec3(0.97, 1.0, 1.04), vec3(1.035, 1.0, 0.965), smoothstep(0.15, 0.85, l));
  // viñeteado óptico
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
  vec3 o = toSRGB(clamp(c, 0.0, 1.0));
  // grano fino (también rompe el bandeado de los degradados del cielo)
  o += (hash(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * uGrain;
  gl_FragColor = vec4(o, 1.0);
}`;

export class RealisticPost {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.BufferGeometry(), null);
    // triángulo que cubre la pantalla
    this.quad.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mBright = mat(BRIGHT, { tSrc: { value: null }, uThreshold: { value: 1.1 }, uTexel: { value: new THREE.Vector2() } });
    this.mDown = mat(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mUp = mat(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mUp.blending = THREE.AdditiveBlending;
    this.mComp = mat(COMPOSITE, {
      tScene: { value: null }, tBloom: { value: null }, uTexel: { value: new THREE.Vector2() },
      tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 4000 }, uHaze: { value: new THREE.Color(0.62, 0.7, 0.8) }, uHazeDensity: { value: 1 / 3300 },
      uExposure: { value: 1.55 }, uBloom: { value: 0.06 }, uTime: { value: 0 },
      uContrast: { value: 1.04 }, uSaturation: { value: 0.9 }, uVignette: { value: 0.22 }, uGrain: { value: 0.01 }, uSharpen: { value: 0.3 },
    });
    this.width = 0; this.height = 0;
    this.mips = [];
  }

  setSize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.disposeTargets();
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    this.sceneRT.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    let mw = Math.max(1, w >> 1), mh = Math.max(1, h >> 1);
    for (let i = 0; i < 5; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, opts));
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
    }
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera, time) {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(_size);
    this.setSize(size.x, size.y);
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    // 1. escena en HDR lineal
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    // 2. bloom
    this.mBright.uniforms.tSrc.value = this.sceneRT.texture;
    this.mBright.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    this.pass(this.mBright, this.mips[0]);
    for (let i = 1; i < this.mips.length; i++) {
      this.mDown.uniforms.tSrc.value = this.mips[i - 1].texture;
      this.mDown.uniforms.uTexel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
      this.pass(this.mDown, this.mips[i]);
    }
    const autoClear = r.autoClear;
    r.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) {
      this.mUp.uniforms.tSrc.value = this.mips[i].texture;
      this.mUp.uniforms.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
      this.pass(this.mUp, this.mips[i - 1]);
    }
    r.autoClear = autoClear;
    // 3. composición en pantalla
    const u = this.mComp.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = this.mips[0].texture;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    if (scene.fog?.color) u.uHaze.value.copy(scene.fog.color);
    u.uTexel.value.set(1 / size.x, 1 / size.y);
    u.uTime.value = time || 0;
    this.pass(this.mComp, null);
    r.toneMapping = prevTone;
  }

  disposeTargets() {
    this.sceneRT?.depthTexture?.dispose();
    this.sceneRT?.dispose();
    for (const m of this.mips) m.dispose();
    this.mips = [];
  }

  dispose() {
    this.disposeTargets();
    for (const m of [this.mBright, this.mDown, this.mUp, this.mComp]) m.dispose();
    this.quad.geometry.dispose();
  }
}

const _size = new THREE.Vector2();
