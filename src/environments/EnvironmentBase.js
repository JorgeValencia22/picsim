/**
 * Base de los escenarios: campo de alturas, superficies (pista, caminos, arena...), agua,
 * zonas aplanadas, objetos (descriptores) y colisionadores. Es independiente de Three.js:
 * la física consulta este objeto y el EnvironmentRenderer construye las mallas a partir de él.
 */
import { SimplexNoise } from '../utils/noise.js';
import { clamp, smoothstep, makeRng, lerp, DEG } from '../utils/math3d.js';
import { CollisionSystem } from '../core/CollisionSystem.js';

/** Propiedades físicas de cada tipo de superficie. */
export const SURFACES = {
  grass: { type: 'grass', rolling: 0.07, grip: 0.75, friction: 0.45, rough: 0.05, color: [0.36, 0.52, 0.22] },
  mown: { type: 'mown', rolling: 0.045, grip: 0.8, friction: 0.42, rough: 0.015, color: [0.44, 0.62, 0.27] },
  asphalt: { type: 'asphalt', rolling: 0.02, grip: 0.95, friction: 0.4, rough: 0, color: [0.27, 0.28, 0.3] },
  concrete: { type: 'concrete', rolling: 0.02, grip: 0.95, friction: 0.42, rough: 0, color: [0.62, 0.62, 0.6] },
  dirt: { type: 'dirt', rolling: 0.06, grip: 0.68, friction: 0.5, rough: 0.08, color: [0.55, 0.43, 0.3] },
  gravel: { type: 'gravel', rolling: 0.08, grip: 0.65, friction: 0.55, rough: 0.12, color: [0.6, 0.57, 0.52] },
  sand: { type: 'sand', rolling: 0.2, grip: 0.55, friction: 0.6, rough: 0.05, color: [0.86, 0.78, 0.58] },
  field: { type: 'field', rolling: 0.12, grip: 0.7, friction: 0.55, rough: 0.2, color: [0.62, 0.58, 0.3] },
  rough: { type: 'rough', rolling: 0.1, grip: 0.65, friction: 0.55, rough: 0.28, color: [0.45, 0.48, 0.28] },
  rock: { type: 'rock', rolling: 0.05, grip: 0.6, friction: 0.6, rough: 0.2, color: [0.48, 0.45, 0.42] },
  forest: { type: 'forest', rolling: 0.12, grip: 0.65, friction: 0.6, rough: 0.2, color: [0.24, 0.36, 0.17] },
  snow: { type: 'snow', rolling: 0.15, grip: 0.4, friction: 0.25, rough: 0.05, color: [0.92, 0.94, 0.97] },
};

export class EnvironmentBase {
  /**
   * @param {object} def { id, size, res, elevation, seed, name, desc, ... }
   */
  constructor(def) {
    Object.assign(this, def);
    this.half = def.size / 2;
    this.cell = def.size / def.res;
    this.noise = new SimplexNoise(def.seed || 1);
    this.rng = makeRng((def.seed || 1) * 7919);
    this.flattens = [];
    this.surfaces = []; // regiones con tipo de superficie
    this.roads = [];
    this.lakes = [];
    this.seaLevel = def.seaLevel ?? null;
    this.props = [];
    this.thermalSources = []; // puntos preferentes para térmicas
    this.markers = []; // marcadores con nombre (zonas de aterrizaje, pistas)
    this.runways = [];
    this.collision = new CollisionSystem(16);
    this.boundary = def.boundary || def.size * 0.4;
  }

  /** Construye el escenario completo. */
  build() {
    this.setup();
    this.generateHeightfield();
    this.populate();
    for (const p of this.props) if (p.y == null) p.y = this.heightAt(p.x, p.z);
    this.buildColliders();
    return this;
  }

  // ── a implementar por cada escenario ────────────────────────────────────
  /** Altura natural del terreno (antes de aplanados y lagos). */
  baseHeight() { return 0; }
  /** Define pistas, superficies, lagos, caminos y zonas aplanadas. */
  setup() {}
  /** Coloca árboles, edificios y objetos. */
  populate() {}
  /** Superficie por defecto según altura/pendiente cuando no hay región definida. */
  defaultSurface() { return 'grass'; }

  // ── definición ─────────────────────────────────────────────────────────
  /** Zona aplanada rectangular (girada) o circular. height: número o 'auto'. */
  addFlatten(z) {
    const f = { margin: 30, ...z };
    if (f.heading != null) { f.cos = Math.cos(f.heading * DEG); f.sin = Math.sin(f.heading * DEG); }
    this.flattens.push(f);
    return f;
  }

  addSurface(region) {
    const r = { ...region };
    if (r.heading != null) { r.cos = Math.cos(r.heading * DEG); r.sin = Math.sin(r.heading * DEG); }
    this.surfaces.push(r);
    return r;
  }

  /** Pista: superficie + zona plana + marcador. heading en grados (rumbo de despegue). */
  addRunway({ x, z, heading, length, width, surface = 'mown', name = 'RWY', flatten = true }) {
    const rw = { x, z, heading, length, width, surface, name };
    // el eje largo de la pista va según el rumbo: dirección (sin h, −cos h)
    if (flatten) this.addFlatten({ shape: 'rect', x, z, w: width * 3 + 20, l: length + 60, heading, height: 'auto', margin: 40 });
    this.addSurface({ shape: 'rect', x, z, w: width, l: length, heading, type: surface, runway: true });
    this.runways.push(rw);
    return rw;
  }

  addRoad(points, width = 5, type = 'dirt') {
    this.roads.push({ points, width, type });
  }

  addLake({ x, z, r, depth = 4, level = null }) {
    const lake = { x, z, r, depth, level };
    this.lakes.push(lake);
    return lake;
  }

  addProp(p) { this.props.push(p); return p; }

  // ── generación ─────────────────────────────────────────────────────────
  generateHeightfield() {
    const n = this.res + 1;
    this.hf = new Float32Array(n * n);
    // alturas automáticas de las zonas planas (muestreadas sobre el terreno natural)
    for (const f of this.flattens) if (f.height === 'auto') f.height = this.baseHeight(f.x, f.z);
    for (const l of this.lakes) if (l.level == null) l.level = this.baseHeight(l.x, l.z) - 0.5;
    for (let j = 0; j < n; j++) {
      const z = -this.half + j * this.cell;
      for (let i = 0; i < n; i++) {
        const x = -this.half + i * this.cell;
        this.hf[j * n + i] = this.shapedHeight(x, z);
      }
    }
  }

  /** Altura con aplanados y lagos aplicados (sobre coordenadas continuas). */
  shapedHeight(x, z) {
    let h = this.baseHeight(x, z);
    for (const f of this.flattens) {
      const w = this.flattenWeight(f, x, z);
      if (w > 0) h = lerp(h, f.height, w);
    }
    for (const l of this.lakes) {
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < l.r * 1.6) {
        const t = 1 - smoothstep(l.r * 0.55, l.r * 1.25, d);
        const shore = l.level + 0.6;
        if (d < l.r * 1.25) h = Math.min(h, lerp(shore, l.level - l.depth, t));
      }
    }
    return h;
  }

  flattenWeight(f, x, z) {
    if (f.shape === 'circle') {
      const d = Math.hypot(x - f.x, z - f.z);
      return 1 - smoothstep(f.r, f.r + f.margin, d);
    }
    const dx = x - f.x, dz = z - f.z;
    // coordenadas locales: u a lo largo del rumbo, v perpendicular
    const u = dx * f.sin - dz * f.cos;
    const v = dx * f.cos + dz * f.sin;
    const eu = Math.abs(u) - f.l / 2, ev = Math.abs(v) - f.w / 2;
    const d = Math.hypot(Math.max(eu, 0), Math.max(ev, 0));
    return 1 - smoothstep(0, f.margin, d);
  }

  // ── consultas (física y renderizado) ───────────────────────────────────
  /** Altura interpolada con la MISMA triangulación que la malla visual. */
  heightAt(x, z) {
    const n = this.res + 1;
    let gx = (x + this.half) / this.cell, gz = (z + this.half) / this.cell;
    gx = clamp(gx, 0, this.res - 1e-6);
    gz = clamp(gz, 0, this.res - 1e-6);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const a = this.hf[j * n + i], b = this.hf[j * n + i + 1];
    const c = this.hf[(j + 1) * n + i], d = this.hf[(j + 1) * n + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  normalAt(x, z, out) {
    const e = this.cell * 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  /** Gradiente del terreno suavizado a una escala dada (para la sustentación de ladera). */
  gradientAt(x, z, scale = 25) {
    const hx = (this.heightAt(x + scale, z) - this.heightAt(x - scale, z)) / (2 * scale);
    const hz = (this.heightAt(x, z + scale) - this.heightAt(x, z - scale)) / (2 * scale);
    return { x: hx, z: hz };
  }

  slopeAt(x, z) {
    const g = this.gradientAt(x, z, this.cell);
    return Math.hypot(g.x, g.z);
  }

  /** Nivel del agua en (x,z) o null si no hay agua. */
  waterLevelAt(x, z) {
    if (this.seaLevel != null && this.heightAt(x, z) < this.seaLevel) return this.seaLevel;
    for (const l of this.lakes) {
      if (Math.hypot(x - l.x, z - l.z) < l.r * 1.3 && this.heightAt(x, z) < l.level) return l.level;
    }
    return null;
  }

  surfaceTypeAt(x, z) {
    for (let k = this.surfaces.length - 1; k >= 0; k--) {
      const r = this.surfaces[k];
      if (this.inRegion(r, x, z)) return r.type;
    }
    for (const rd of this.roads) if (this.nearPolyline(rd.points, x, z, rd.width / 2)) return rd.type;
    return this.defaultSurface(x, z, this.heightAt(x, z), this.slopeAt(x, z));
  }

  surfaceAt(x, z) {
    return SURFACES[this.surfaceTypeAt(x, z)] || SURFACES.grass;
  }

  inRegion(r, x, z) {
    if (r.shape === 'circle') return (x - r.x) ** 2 + (z - r.z) ** 2 < r.r * r.r;
    if (r.shape === 'rect') {
      const dx = x - r.x, dz = z - r.z;
      const u = dx * r.sin - dz * r.cos, v = dx * r.cos + dz * r.sin;
      return Math.abs(u) <= r.l / 2 && Math.abs(v) <= r.w / 2;
    }
    if (r.shape === 'fn') return r.fn(x, z);
    return false;
  }

  nearPolyline(pts, x, z, w) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const vx = bx - ax, vz = bz - az;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
      const px = ax + vx * t - x, pz = az + vz * t - z;
      if (px * px + pz * pz < w * w) return true;
    }
    return false;
  }

  /** ¿El punto está libre de pistas, caminos, agua y otros objetos cercanos? */
  isFree(x, z, clearance = 6) {
    if (Math.abs(x) > this.half - 20 || Math.abs(z) > this.half - 20) return false;
    if (this.waterLevelAt(x, z) != null) return false;
    for (const r of this.surfaces) {
      if (r.noTrees === false) continue;
      if (r.shape === 'rect') {
        const g = { ...r, w: r.w + clearance * 2, l: r.l + clearance * 2 };
        if (this.inRegion(g, x, z)) return false;
      } else if (r.shape === 'circle' && (x - r.x) ** 2 + (z - r.z) ** 2 < (r.r + clearance) ** 2) return false;
    }
    for (const rd of this.roads) if (this.nearPolyline(rd.points, x, z, rd.width / 2 + clearance * 0.5)) return false;
    for (const f of this.flattens) if (f.keepClear && this.flattenWeight(f, x, z) > 0.2) return false;
    return true;
  }

  /** Dispersa árboles en un área con una función de densidad. */
  scatterTrees({ count, area, variants, minScale = 0.8, maxScale = 1.3, density = null, clearance = 8, cluster = 0 }) {
    let placed = 0, tries = 0;
    const rng = this.rng;
    while (placed < count && tries < count * 12) {
      tries++;
      let x, z;
      if (area.shape === 'circle') {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * area.r;
        x = area.x + Math.cos(a) * r; z = area.z + Math.sin(a) * r;
      } else if (area.shape === 'ring') {
        const a = rng() * Math.PI * 2, r = area.r0 + rng() * (area.r1 - area.r0);
        x = area.x + Math.cos(a) * r; z = area.z + Math.sin(a) * r;
      } else {
        x = area.x0 + rng() * (area.x1 - area.x0); z = area.z0 + rng() * (area.z1 - area.z0);
      }
      if (cluster > 0) {
        const n = this.noise.noise2(x * 0.006 + 31, z * 0.006 - 17);
        if (n < cluster) continue;
      }
      if (density && rng() > density(x, z)) continue;
      if (!this.isFree(x, z, clearance)) continue;
      const v = variants[Math.floor(rng() * variants.length)];
      this.addProp({ type: 'tree', variant: v, x, z, scale: minScale + rng() * (maxScale - minScale), rot: rng() * Math.PI * 2, tint: rng() });
      placed++;
    }
    return placed;
  }

  /** Fila de árboles a lo largo de una línea (cortavientos, alamedas). */
  treeLine(x0, z0, x1, z1, spacing, variant, jitter = 1.5) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.floor(len / spacing);
    for (let i = 0; i <= n; i++) {
      const t = i / Math.max(1, n);
      const x = lerp(x0, x1, t) + (this.rng() - 0.5) * jitter;
      const z = lerp(z0, z1, t) + (this.rng() - 0.5) * jitter;
      if (this.waterLevelAt(x, z) != null) continue;
      this.addProp({ type: 'tree', variant, x, z, scale: 0.85 + this.rng() * 0.35, rot: this.rng() * 6.28, tint: this.rng() });
    }
  }

  fence(x0, z0, x1, z1, kind = 'rail', height = 1.1) {
    this.addProp({ type: 'fence', kind, x: (x0 + x1) / 2, z: (z0 + z1) / 2, x0, z0, x1, z1, height });
  }

  // ── colisionadores a partir de los descriptores ───────────────────────────
  buildColliders() {
    const C = this.collision;
    for (const p of this.props) {
      const s = p.scale || 1;
      switch (p.type) {
        case 'tree': {
          const dims = TREE_DIMS[p.variant] || TREE_DIMS.broadleaf;
          C.addCylinder({ x: p.x, z: p.z, r: dims.trunkR * s, y0: p.y - 1, y1: p.y + dims.trunkH * s, id: 'tree' });
          C.addCylinder({ x: p.x, z: p.z, r: dims.crownR * s, y0: p.y + dims.crownY0 * s, y1: p.y + dims.height * s, soft: true, id: 'tree' });
          break;
        }
        case 'house': case 'barn': case 'hangar': case 'shelter': case 'booth': case 'stand': case 'shed': case 'container': {
          const h = p.h + (p.roofH || 0) * 0.6;
          C.addBox({ x: p.x, y: p.y + h / 2, z: p.z, hx: p.w / 2, hy: h / 2, hz: p.d / 2, rot: p.rot || 0, id: p.type });
          break;
        }
        case 'church': {
          C.addBox({ x: p.x, y: p.y + (p.h + p.roofH * 0.6) / 2, z: p.z, hx: p.w / 2, hy: (p.h + p.roofH * 0.6) / 2, hz: p.d / 2, rot: p.rot || 0, id: 'church' });
          const tc = Math.cos(p.rot || 0), ts = Math.sin(p.rot || 0);
          const ox = (p.d / 2 + 2.5) * ts, oz = (p.d / 2 + 2.5) * tc;
          C.addBox({ x: p.x - ox, y: p.y + p.towerH / 2, z: p.z - oz, hx: 2.5, hy: p.towerH / 2, hz: 2.5, rot: p.rot || 0, id: 'church' });
          break;
        }
        case 'table':
          C.addBox({ x: p.x, y: p.y + 0.38, z: p.z, hx: 0.9, hy: 0.38, hz: 0.4, rot: p.rot || 0, id: 'table' });
          break;
        case 'bench':
          C.addBox({ x: p.x, y: p.y + 0.25, z: p.z, hx: 0.9, hy: 0.25, hz: 0.2, rot: p.rot || 0, id: 'bench' });
          break;
        case 'car':
          C.addBox({ x: p.x, y: p.y + 0.7, z: p.z, hx: 2.1, hy: 0.7, hz: 0.9, rot: p.rot || 0, id: 'car' });
          break;
        case 'pole': case 'flag': case 'marker': case 'windsock': case 'lamp':
          C.addCylinder({ x: p.x, z: p.z, r: 0.12, y0: p.y - 1, y1: p.y + (p.h || 6), id: p.type });
          break;
        case 'pylon':
          C.addCylinder({ x: p.x, z: p.z, r: 0.6, y0: p.y - 1, y1: p.y + (p.h || 8), id: 'pylon' });
          break;
        case 'tower':
          C.addCylinder({ x: p.x, z: p.z, r: 1.5, y0: p.y - 1, y1: p.y + (p.h || 25), id: 'tower' });
          break;
        case 'silo':
          C.addCylinder({ x: p.x, z: p.z, r: p.r || 3, y0: p.y - 1, y1: p.y + (p.h || 12), id: 'silo' });
          break;
        case 'rock':
          C.addSphere({ x: p.x, y: p.y + (p.r || 2) * 0.3, z: p.z, r: p.r || 2, id: 'rock' });
          break;
        case 'fence': {
          const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
          const len = Math.hypot(dx, dz);
          const rot = Math.atan2(-dz, dx);
          C.addBox({ x: p.x, y: p.y + p.height / 2, z: p.z, hx: len / 2, hy: p.height / 2, hz: 0.08, rot, id: 'fence' });
          break;
        }
        case 'powerline': {
          // postes de la línea
          for (const [x, z] of p.points) C.addCylinder({ x, z, r: 0.2, y0: this.heightAt(x, z) - 1, y1: this.heightAt(x, z) + 9, id: 'pole' });
          break;
        }
        default: break;
      }
    }
  }

  /** Información pública del escenario para la interfaz. */
  get info() {
    return { id: this.id, name: this.name, desc: this.desc };
  }
}

/** Dimensiones base de los árboles (escala 1) compartidas por física y render. */
export const TREE_DIMS = {
  broadleaf: { height: 11, trunkH: 4, trunkR: 0.3, crownR: 3.6, crownY0: 3.5 },
  pine: { height: 15, trunkH: 3, trunkR: 0.28, crownR: 2.8, crownY0: 2.5 },
  poplar: { height: 17, trunkH: 2.5, trunkR: 0.25, crownR: 1.8, crownY0: 2.5 },
  palm: { height: 10, trunkH: 9, trunkR: 0.22, crownR: 2.8, crownY0: 8.5 },
  bush: { height: 2.2, trunkH: 0.4, trunkR: 0.15, crownR: 1.5, crownY0: 0.2 },
  cypress: { height: 12, trunkH: 1.5, trunkR: 0.2, crownR: 1.4, crownY0: 1.2 },
};
