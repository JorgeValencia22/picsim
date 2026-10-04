/** Utilidades compartidas por las pruebas (mundo plano, creación de aeronaves, simulación). */
import { buildFullSpec } from '../src/aircraft/AircraftRegistry.js';
import { AIRCRAFT_DATA } from '../src/data/aircraftData.js';
import { AircraftPhysics } from '../src/aircraft/AircraftPhysics.js';

export const DT = 1 / 240;

const SURF = { type: 'grass', rolling: 0.05, grip: 0.8, friction: 0.5, rough: 0 };

/** Mundo plano sin viento (o con viento constante). */
export function flatWorld({ wind = [0, 0, 0], collision = null, water = null } = {}) {
  return {
    heightAt: () => 0,
    normalAt: (x, z, o) => o.set(0, 1, 0),
    surfaceAt: () => SURF,
    waterLevelAt: () => water,
    sampleWind: (p, o) => o.set(wind[0], wind[1], wind[2]),
    density: () => 1.225,
    collision,
    temperature: 15,
  };
}

const specCache = new Map();
export function spec(id) {
  if (!specCache.has(id)) specCache.set(id, buildFullSpec(AIRCRAFT_DATA.find((a) => a.id === id)));
  return specCache.get(id);
}

export function aircraft(id, opts = {}) {
  return new AircraftPhysics(spec(id), { fidelity: 'realistic', ...opts });
}

export function run(ac, world, seconds, control) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    control?.(ac, i * DT);
    ac.step(DT, world);
  }
  return ac;
}

/** Almacenamiento en memoria con la misma interfaz que Storage. */
export function memoryStorage() {
  const m = new Map();
  return {
    available: true,
    get: (k, f = null) => (m.has(k) ? JSON.parse(m.get(k)) : structuredClone(f)),
    set: (k, v) => { m.set(k, JSON.stringify(v)); return true; },
    remove: (k) => m.delete(k),
  };
}
