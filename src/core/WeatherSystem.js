/**
 * Meteorología que afecta a la física: viento medio con gradiente vertical, ráfagas,
 * turbulencia (campo de ruido 3D advectado), sustentación de ladera calculada con el
 * gradiente del terreno, rotores de sotavento, térmicas con ciclo de vida y densidad del aire.
 * El estado visual (cielo, nubes, niebla, lluvia, hora) se consulta desde el renderizador.
 */
import { SimplexNoise } from '../utils/noise.js';
import { clamp, DEG, makeRng, smoothstep } from '../utils/math3d.js';
import { airDensity } from '../aircraft/Aerodynamics.js';

export const SKY_PRESETS = ['clear', 'partly', 'cloudy', 'overcast'];

export function defaultWeather() {
  return {
    windSpeed: 3, // m/s a 10 m
    windDir: 270, // procedencia (grados, 270 = del oeste)
    gusts: 0.3, // 0..1
    turbulence: 0.25, // 0..1
    thermals: 0.5, // 0..1
    temperature: 18, // °C en la cota del escenario
    sky: 'partly',
    fog: 0, // 0..1
    rain: 0, // 0..1
    timeOfDay: 11, // horas
    thermalHints: true,
  };
}

/** Clima aleatorio jugable (sin condiciones extremas). */
export function randomWeather(seed = Date.now()) {
  const r = makeRng(seed);
  const sky = SKY_PRESETS[Math.floor(r() * 4)];
  return {
    windSpeed: Math.round(r() * 8 * 10) / 10,
    windDir: Math.round(r() * 36) * 10,
    gusts: Math.round(r() * 0.7 * 100) / 100,
    turbulence: Math.round(r() * 0.6 * 100) / 100,
    thermals: sky === 'overcast' ? 0.1 : Math.round((0.3 + r() * 0.7) * 100) / 100,
    temperature: Math.round(5 + r() * 28),
    sky,
    fog: r() < 0.15 ? Math.round(r() * 0.5 * 100) / 100 : 0,
    rain: sky === 'overcast' && r() < 0.4 ? Math.round(r() * 0.8 * 100) / 100 : 0,
    timeOfDay: Math.round((6 + r() * 13) * 2) / 2,
    thermalHints: true,
  };
}

export class WeatherSystem {
  /**
   * @param {object} cfg      configuración (defaultWeather)
   * @param {object} env      escenario (EnvironmentBase) o null
   * @param {object} options  { turbulenceScale, seed }
   */
  constructor(cfg, env, options = {}) {
    this.cfg = { ...defaultWeather(), ...cfg };
    this.env = env;
    this.noise = new SimplexNoise(options.seed ?? 4242);
    this.turbScale = options.turbulenceScale ?? 1;
    this.time = 0;
    this.gust = 1;
    this.dirWobble = 0;
    this.thermals = [];
    this.rng = makeRng(options.seed ?? 4242);
    this.elevation = env ? env.elevation || 0 : 0;
    this.applyConfig(this.cfg);
  }

  applyConfig(cfg) {
    this.cfg = { ...this.cfg, ...cfg };
    const th = this.cfg.windDir * DEG;
    // dirección hacia la que SOPLA el viento (opuesta a la procedencia)
    this.windDirX = -Math.sin(th);
    this.windDirZ = Math.cos(th);
    this.initThermals();
  }

  /** Factor solar (0 de noche, 1 a mediodía) para las térmicas. */
  get solarFactor() {
    const h = this.cfg.timeOfDay;
    return clamp(Math.sin(((h - 6) / 12) * Math.PI), 0, 1);
  }

  initThermals() {
    this.thermals.length = 0;
    const strength = this.cfg.thermals * this.solarFactor * (this.cfg.sky === 'overcast' ? 0.3 : 1);
    if (strength < 0.05) return;
    const n = Math.round(3 + strength * 6);
    for (let i = 0; i < n; i++) this.thermals.push(this.spawnThermal(true));
  }

  spawnThermal(initial = false) {
    const env = this.env;
    const r = this.rng;
    let x = 0, z = 0;
    const sources = env?.thermalSources || [];
    const range = env ? Math.min(env.boundary, env.half - 100) * 0.9 : 700;
    if (sources.length && r() < 0.6) {
      const s = sources[Math.floor(r() * sources.length)];
      x = s.x + (r() - 0.5) * 120; z = s.z + (r() - 0.5) * 120;
    } else {
      const a = r() * Math.PI * 2, d = 120 + r() * range;
      x = Math.cos(a) * d; z = Math.sin(a) * d;
    }
    const strength = this.cfg.thermals * this.solarFactor * (this.cfg.sky === 'overcast' ? 0.3 : 1);
    return {
      x, z,
      radius: 35 + r() * 55,
      strength: (0.8 + r() * 2.4) * strength + 0.3,
      top: 350 + r() * 500,
      life: 150 + r() * 200,
      age: initial ? r() * 200 : 0,
    };
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const g = this.cfg.gusts;
    // ráfagas: suma de ruido lento y rápido
    this.gust = 1 + g * (0.38 * this.noise.noise2(t * 0.11, 3.7) + 0.2 * this.noise.noise2(t * 0.53, 9.1));
    this.dirWobble = g * 14 * DEG * this.noise.noise2(t * 0.07, 41.3);
    // ciclo de vida y deriva de las térmicas
    const ws = this.cfg.windSpeed;
    for (let i = 0; i < this.thermals.length; i++) {
      const th = this.thermals[i];
      th.age += dt;
      th.x += this.windDirX * ws * 0.6 * dt;
      th.z += this.windDirZ * ws * 0.6 * dt;
      const out = this.env && (Math.abs(th.x) > this.env.half - 50 || Math.abs(th.z) > this.env.half - 50);
      if (th.age > th.life || out) this.thermals[i] = this.spawnThermal(false);
    }
  }

  /** Intensidad de una térmica según su edad (aparece y se desvanece). */
  thermalEnvelope(th) {
    return smoothstep(0, 30, th.age) * (1 - smoothstep(th.life - 40, th.life, th.age));
  }

  /** Componente vertical del aire en (x, z) a la altura sobre el terreno agl. */
  thermalLift(x, z, agl, altitude) {
    let w = 0;
    for (let i = 0; i < this.thermals.length; i++) {
      const th = this.thermals[i];
      const dx = x - th.x, dz = z - th.z;
      const d2 = dx * dx + dz * dz;
      const R = th.radius;
      if (d2 > R * R * 9) continue;
      const env = this.thermalEnvelope(th);
      const hProfile = smoothstep(0, 40, agl) * (1 - smoothstep(th.top * 0.75, th.top, altitude));
      const d = Math.sqrt(d2);
      const core = Math.exp(-d2 / (R * R));
      const ring = -0.3 * Math.exp(-(((d - 1.7 * R) / (0.6 * R)) ** 2));
      w += th.strength * env * hProfile * (core + ring);
    }
    return w;
  }

  /** Viento horizontal medio a una altura sobre el terreno (perfil logarítmico aproximado). */
  windAtHeight(agl) {
    const shear = clamp(Math.pow(Math.max(agl, 0.3) / 10, 0.16), 0.35, 1.45);
    return this.cfg.windSpeed * shear * this.gust;
  }

  /**
   * Velocidad del aire (mundo) en una posición. Incluye todos los efectos.
   * @param {{x,y,z}} pos
   * @param {{x,y,z,set}} out
   */
  sampleWind(pos, out) {
    const env = this.env;
    const ground = env ? env.heightAt(pos.x, pos.z) : 0;
    const agl = Math.max(0, pos.y - ground);
    const speed = this.windAtHeight(agl);
    const c = Math.cos(this.dirWobble), s = Math.sin(this.dirWobble);
    const dx = this.windDirX * c - this.windDirZ * s;
    const dz = this.windDirX * s + this.windDirZ * c;
    let wx = dx * speed, wz = dz * speed, wy = 0;

    // ── sustentación de ladera y rotor de sotavento
    let leeFactor = 0;
    if (env && this.cfg.windSpeed > 0.3) {
      const scale = env.ridgeScale || 30;
      // se muestrea un poco a barlovento para que la ascendencia preceda a la cresta
      const ux = pos.x - dx * scale * 0.6, uz = pos.z - dz * scale * 0.6;
      const gr = env.gradientAt(ux, uz, scale);
      const slopeAlong = gr.x * dx + gr.z * dz; // >0: el terreno sube en la dirección del viento
      const decay = Math.exp(-agl / (env.ridgeHeight || 120));
      if (slopeAlong > 0) wy += speed * clamp(slopeAlong, 0, 1.2) * decay * 0.9;
      else {
        wy += speed * clamp(slopeAlong, -1, 0) * decay * 0.55;
        leeFactor = clamp(-slopeAlong * 2, 0, 1) * decay;
      }
    }

    // ── térmicas
    if (this.thermals.length) wy += this.thermalLift(pos.x, pos.z, agl, pos.y);

    // ── turbulencia: ruido 3D advectado por el viento medio
    const amp = this.cfg.turbulence * (0.35 + 0.22 * this.cfg.windSpeed) * this.turbScale * (1 + leeFactor * 2.5) * (agl < 20 ? 1.15 : 1);
    if (amp > 0.001) {
      const k = 1 / 22;
      const t = this.time;
      const px = (pos.x - wx * t) * k, py = pos.y * k, pz = (pos.z - wz * t) * k;
      const tt = t * 0.25;
      const n = this.noise;
      wx += amp * n.noise3(px, py + tt, pz);
      wy += amp * 0.7 * n.noise3(px + 17.3, py - tt, pz + 5.1) * smoothstep(0, 6, agl);
      wz += amp * n.noise3(px - 9.7, py + tt * 0.7, pz - 13.9);
    }
    out.x = wx; out.y = wy; out.z = wz;
    return out;
  }

  /** Densidad del aire a una altura de mundo (la cota 0 del mundo = elevación del escenario). */
  density(y) {
    return airDensity(this.elevation + y, this.cfg.temperature, this.elevation);
  }

  /** Visibilidad (m) para la niebla y la lluvia; nunca menor que lo jugable salvo petición expresa. */
  get visibility() {
    const fog = this.cfg.fog;
    const rain = this.cfg.rain;
    const v = 9000 * (1 - fog * 0.93) * (1 - rain * 0.35);
    return Math.max(this.cfg.allowLowVisibility ? 120 : 450, v);
  }
}
