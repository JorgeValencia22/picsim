/**
 * Herramienta de desarrollo (no se publica): genera hojas de contacto de los modelos 3D desde
 * varios ángulos para revisarlos visualmente. Uso en la consola del navegador:
 *   const { reviewSheet } = await import('/tools/model-review.js');
 *   const dataUrl = await reviewSheet(['skylark', 'f16']);
 */
import * as THREE from 'three';
import { AircraftModel } from '../src/render/AircraftModel.js';
import { AircraftRegistry } from '../src/aircraft/AircraftRegistry.js';

const registry = new AircraftRegistry(null);

export async function reviewSheet(ids, opts = {}) {
  const TW = opts.tileW || 360, TH = opts.tileH || 230;
  const views = opts.views || [[-2.3, 0.35], [0.9, -0.35], [-0.6, 0.12]];
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(TW, TH);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const pm = new THREE.PMREMGenerator(r);
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y; vec3 c = mix(vec3(0.45,0.43,0.36), mix(vec3(0.75,0.82,0.9), vec3(0.3,0.5,0.85), max(h,0.)), smoothstep(-0.05,0.05,h)); gl_FragColor = vec4(c, 1.0); }',
  })));
  const env = pm.fromScene(es, 0.02);
  const sheet = document.createElement('canvas');
  sheet.width = TW * views.length;
  sheet.height = TH * ids.length;
  const g = sheet.getContext('2d');
  for (let k = 0; k < ids.length; k++) {
    const spec = registry.get(ids[k]);
    const sc = new THREE.Scene();
    sc.background = new THREE.Color('#8fa9c4');
    sc.environment = env.texture;
    sc.environmentIntensity = 0.55;
    sc.add(new THREE.HemisphereLight('#dfefff', '#8d8670', 1.2));
    const sun = new THREE.DirectionalLight('#fff4e6', 2.6);
    sun.position.set(3, 5, 4);
    sc.add(sun);
    const m = new AircraftModel(spec, opts.livery || null, { shadows: false });
    m.update({ defl: opts.defl || { aileron: 0, elevator: 0, rudder: 0, flap: 0, airbrake: 0 }, propAngle: 0.3, rpm: 0, rpmFrac: 0, gearPos: 1, damage: null, wheelSpeed: 0, time: 0, night: false }, 0.016);
    sc.add(m.root);
    const cam = new THREE.PerspectiveCamera(30, TW / TH, 0.01, 100);
    const s = Math.max(spec.span, spec.length) * (opts.zoom || 1);
    views.forEach(([yaw, pitch], v) => {
      const d = s * 1.9;
      cam.position.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d);
      cam.lookAt(0, opts.lookY || 0, 0);
      r.render(sc, cam);
      g.drawImage(r.domElement, v * TW, k * TH);
    });
    g.fillStyle = '#000';
    g.font = 'bold 15px sans-serif';
    g.fillText(spec.name, 6, k * TH + 18);
    m.dispose();
  }
  env.dispose();
  pm.dispose();
  r.dispose();
  return sheet.toDataURL('image/jpeg', 0.85);
}
