/**
 * Herramienta de desarrollo (no se publica): genera las imágenes de los menús renderizando los
 * modelos 3D y los escenarios con el propio motor del juego, y las envía a tools/capture-server.mjs
 * para guardarlas en assets/. Uso en la consola del navegador (con el juego en http://localhost):
 *   const cap = await import('/tools/capture-previews.js');
 *   await cap.captureAircraft();                 // assets/aircraft/<id>.png
 *   await cap.captureScenario(window.rcfs, 'airfield', { ... });  // assets/scenarios/<id>.jpg
 */
import * as THREE from 'three';
import { AircraftModel } from '../src/render/AircraftModel.js';
import { AircraftRegistry } from '../src/aircraft/AircraftRegistry.js';
import { AIRCRAFT_DATA } from '../src/data/aircraftData.js';

const SAVE = 'http://localhost:8098/save?path=';

export async function save(path, dataUrl) {
  const r = await fetch(SAVE + encodeURIComponent(path), { method: 'POST', body: dataUrl });
  if (!r.ok) throw new Error(`no se pudo guardar ${path}`);
}

/** Miniaturas de las aeronaves: vista 3/4 delantera, fondo transparente. */
export async function captureAircraft(ids = AIRCRAFT_DATA.map((a) => a.id), { w = 400, h = 240 } = {}) {
  const registry = new AircraftRegistry(null);
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(w, h);
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
  const sc = new THREE.Scene();
  sc.environment = env.texture;
  sc.environmentIntensity = 0.6;
  sc.add(new THREE.HemisphereLight('#dfefff', '#6d6650', 1.4));
  const sun = new THREE.DirectionalLight('#fff4e6', 2.8);
  sun.position.set(3, 6, 4);
  sc.add(sun);
  const rim = new THREE.DirectionalLight('#8fc7ff', 1.1);
  rim.position.set(-4, 2, -5);
  sc.add(rim);
  const cam = new THREE.PerspectiveCamera(28, w / h, 0.01, 200);
  const box = new THREE.Box3(), size = new THREE.Vector3(), center = new THREE.Vector3();
  for (const id of ids) {
    const spec = registry.get(id);
    const m = new AircraftModel(spec, null, { shadows: false });
    m.update({ defl: { aileron: 0, elevator: 0, rudder: 0, flap: 0, airbrake: 0 }, propAngle: 0.4, rpm: 0, rpmFrac: 0, gearPos: 1, damage: null, wheelSpeed: 0, time: 0, night: false }, 0.016);
    for (const l of m.navLights) l.visible = false;
    sc.add(m.root);
    box.setFromObject(m.root);
    box.getSize(size);
    box.getCenter(center);
    // vista 3/4 desde delante-izquierda y algo por encima; distancia que encuadra el avión
    const yaw = -2.25, pitch = 0.3;
    const radius = 0.5 * Math.hypot(size.x, size.y, size.z);
    const d = radius / Math.sin((cam.fov * Math.PI) / 360) * 0.6;
    cam.position.set(center.x + Math.sin(yaw) * Math.cos(pitch) * d, center.y + Math.sin(pitch) * d, center.z + Math.cos(yaw) * Math.cos(pitch) * d);
    cam.lookAt(center);
    r.setClearColor(0x000000, 0);
    r.render(sc, cam);
    await save(`assets/aircraft/${id}.png`, r.domElement.toDataURL('image/png'));
    sc.remove(m.root);
    m.dispose();
  }
  env.dispose();
  pm.dispose();
  r.dispose();
  return ids.length;
}

/**
 * Foto de un escenario con el motor del juego: carga el escenario con una aeronave en vuelo y
 * coloca la cámara libre en el punto indicado (coordenadas del mundo) mirando a `look`.
 */
export async function captureScenario(app, envId, { aircraft = 'extra300', cam, look, planeDist = 5, planeSide = 1.3, planeUp = 0.5, heading = 2.4, timeOfDay = 15.5, sky = 'partly', w = 960, h = 540 } = {}) {
  const sim = app.sim;
  await sim.loadSession({ aircraft, environment: envId, weather: { windSpeed: 2, gusts: 0.1, turbulence: 0, thermals: 0, sky, timeOfDay }, launch: 'air', mode: 'menu' });
  sim.mode = 'menu';
  const ac = sim.aircraft;
  const env = sim.env;
  if (typeof cam === 'function') cam = cam(env);
  if (typeof look === 'function') look = look(env);
  const c = cam || { x: env.pilot.x - 60, z: env.pilot.z + 60, alt: 25 };
  const l = look || { x: env.pilot.x, z: env.pilot.z, alt: 5 };
  const pos = new THREE.Vector3(c.x, env.heightAt(c.x, c.z) + c.alt, c.z);
  const tgt = new THREE.Vector3(l.x, env.heightAt(l.x, l.z) + l.alt, l.z);
  const dir = tgt.clone().sub(pos).normalize();
  const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  // la aeronave en primer plano, algo a un lado de la línea de visión
  const pp = pos.clone().addScaledVector(dir, planeDist).addScaledVector(right, planeSide);
  pp.y += planeUp;
  const viewYaw = Math.atan2(dir.x, -dir.z);
  const place = () => ac.resetTo(sim.world, { x: pp.x, z: pp.z, y: pp.y, heading: viewYaw + heading, speed: ac.spec.perf.cruiseSpeed * 0.9 });
  sim.cameras.setMode('free');
  sim.cameras.free.pos.copy(pos);
  sim.cameras.free.yaw = Math.atan2(-dir.x, -dir.z);
  sim.cameras.free.pitch = Math.asin(dir.y);
  const canvas = app.renderer.renderer.domElement;
  app.renderer.renderer.setPixelRatio(1);
  app.renderer.renderer.setSize(w, h, false);
  sim.cameras.camera.aspect = w / h;
  sim.cameras.camera.updateProjectionMatrix();
  // unos fotogramas para que el sol, las sombras y la vegetación se asienten (avión congelado)
  for (let i = 0; i < 20; i++) {
    place();
    sim.frame(1 / 60);
    await new Promise((r) => setTimeout(r, 30));
  }
  place();
  sim.frame(1 / 60);
  const url = canvas.toDataURL('image/jpeg', 0.86); // mismo fotograma: el búfer aún no se ha borrado
  app.renderer.resize();
  return url;
}

/** Atajo: captura y guarda en assets/scenarios/<id>.jpg. */
export async function saveScenario(app, envId, opts) {
  await save(`assets/scenarios/${envId}.jpg`, await captureScenario(app, envId, opts));
}
