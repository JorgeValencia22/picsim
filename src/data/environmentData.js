/**
 * Catálogo de escenarios. Cada entrada crea su escenario bajo demanda (la generación del
 * terreno y los objetos sólo se ejecuta cuando el usuario lo elige).
 */
import { Airfield } from '../environments/Airfield.js';
import { Countryside } from '../environments/Countryside.js';
import { Mountains } from '../environments/Mountains.js';
import { Coast } from '../environments/Coast.js';
import { CompetitionField } from '../environments/CompetitionField.js';
import { RuralTown } from '../environments/RuralTown.js';

export const ENVIRONMENTS = [
  { id: 'airfield', create: () => new Airfield(), icon: 'airfield', tags: { es: ['Pista de césped', 'Principiantes', 'Boxes'], en: ['Grass strip', 'Beginners', 'Pits'] }, gradient: ['#6a9a3a', '#c9dba0'] },
  { id: 'countryside', create: () => new Countryside(), icon: 'field', tags: { es: ['Térmicas', 'Terreno irregular', 'Lagunas'], en: ['Thermals', 'Rough ground', 'Ponds'] }, gradient: ['#7aa53e', '#e5d37a'] },
  { id: 'mountains', create: () => new Mountains(), icon: 'mountain', tags: { es: ['Ladera', 'Planeadores', 'Viento fuerte'], en: ['Slope', 'Gliders', 'Strong wind'] }, gradient: ['#3f5f4a', '#a7b8c2'] },
  { id: 'coast', create: () => new Coast(), icon: 'coast', tags: { es: ['Acantilados', 'Brisa marina', 'Playa'], en: ['Cliffs', 'Sea breeze', 'Beach'] }, gradient: ['#1b6f9a', '#f0dca0'] },
  { id: 'competition', create: () => new CompetitionField(), icon: 'trophy', tags: { es: ['Asfalto', 'Caja acrobática', 'Jets'], en: ['Asphalt', 'Aerobatic box', 'Jets'] }, gradient: ['#4c5a68', '#c3ccd4'] },
  { id: 'ruraltown', create: () => new RuralTown(), icon: 'town', tags: { es: ['Pueblo', 'Precisión', 'Referencias'], en: ['Town', 'Precision', 'References'] }, gradient: ['#8a6a46', '#d9c7a0'] },
];

/** Metadatos sin construir el escenario (nombre y descripción para menús). */
const META_CACHE = new Map();
export function environmentMeta(id) {
  if (META_CACHE.has(id)) return META_CACHE.get(id);
  const entry = ENVIRONMENTS.find((e) => e.id === id) || ENVIRONMENTS[0];
  const inst = entry.create(); // el constructor no genera el terreno (sólo build() lo hace)
  const meta = { id: entry.id, name: inst.name, desc: inst.desc, tags: entry.tags, gradient: entry.gradient, icon: entry.icon, elevation: inst.elevation, size: inst.size, windDefault: inst.windDefault || null };
  META_CACHE.set(id, meta);
  return meta;
}

export function createEnvironment(id) {
  const entry = ENVIRONMENTS.find((e) => e.id === id) || ENVIRONMENTS[0];
  return entry.create().build();
}
