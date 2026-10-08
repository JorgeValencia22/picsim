/**
 * Construye y anima la representación 3D de un escenario (EnvironmentBase):
 * - Terreno dividido en bloques con 3 niveles de detalle (THREE.LOD) y faldones anti-grietas.
 * - Colores de vértice por superficie + textura de detalle repetida.
 * - Pistas y caminos como "calcos" que siguen el terreno; agua animada (mar y lagunas).
 * - Objetos estáticos fusionados por bloques (pocas llamadas de dibujo, culling por bloque).
 * - Vegetación instanciada por bloques con LOD y balanceo por viento en el shader.
 * - Elementos vivos: mangas de viento y banderas con el viento.
 */
import * as THREE from 'three';
import { SURFACES } from '../environments/EnvironmentBase.js';
import { propParts, mergeColored } from './PropGeometry.js';
import { foliageAtlas, foliageTreeGeometry, foliageMaterial } from './Foliage.js';
import { terrainDetail, mownStripes, runwayAsphalt, windsockStripes } from './TextureFactory.js';
import { DEG, clamp } from '../utils/math3d.js';

const STATIC_TYPES = new Set(['house', 'shed', 'barn', 'hangar', 'shelter', 'booth', 'stand', 'container', 'silo', 'church', 'tower', 'table', 'bench', 'car', 'pole', 'lamp', 'marker', 'groundMarker', 'rock', 'fence', 'flag', 'windsock']);
// colores sRGB de cultivos: trigo, labrado, verde, rastrojo, pradera
const FIELD_TINTS = [[0.79, 0.7, 0.36], [0.55, 0.43, 0.29], [0.45, 0.6, 0.25], [0.72, 0.64, 0.32], [0.56, 0.68, 0.3]];

export class EnvironmentRenderer {
  /**
   * @param {EnvironmentBase} env
   * @param {object} quality { terrainDetail: 0..2, vegetation: 0..1, shadows: bool, textureQuality }
   */
  constructor(env, quality = {}) {
    this.env = env;
    this.q = { terrainDetail: 1, vegetation: 1, shadows: true, ...quality };
    this.group = new THREE.Group();
    this.group.name = `env-${env.id}`;
    this.disposables = [];
    this.animated = { windsocks: [], flags: [] };
    this.treeChunks = [];
    this.waterMaterials = [];
    this.time = 0;
    this.buildTerrain();
    this.buildWater();
    this.buildRunways();
    this.buildRoads();
    this.buildProps();
    this.buildTrees();
    this.buildAnimatedProps();
  }

  track(o) { this.disposables.push(o); return o; }

  /* ─────────────────────────────── Terreno ─────────────────────────────── */

  vertexColor(x, z, h, out) {
    const env = this.env;
    const pal = env.palette || {};
    let type = null, tint = 0;
    for (let k = env.surfaces.length - 1; k >= 0; k--) {
      const r = env.surfaces[k];
      if (env.inRegion(r, x, z)) { type = r.type; tint = r.tint ?? 0; break; }
    }
    const slope = env.slopeAt(x, z);
    if (!type) type = env.defaultSurface(x, z, h, slope);
    const n = env.noise.noise2(x * 0.012, z * 0.012) * 0.5 + 0.5;
    const n2 = env.noise.noise2(x * 0.05 + 40, z * 0.05) * 0.5 + 0.5;
    let c;
    if (type === 'grass' || type === 'forest') {
      const g = pal.grass || SURFACES.grass.color, d = pal.dry || [0.6, 0.58, 0.32];
      const t = clamp(n * 0.55 + n2 * 0.2 - 0.1, 0, 1);
      c = [g[0] + (d[0] - g[0]) * t * 0.6, g[1] + (d[1] - g[1]) * t * 0.6, g[2] + (d[2] - g[2]) * t * 0.6];
    } else if (type === 'field') {
      const col = FIELD_TINTS[Math.floor(tint * FIELD_TINTS.length) % FIELD_TINTS.length];
      const stripes = 0.94 + 0.06 * Math.sin((x * 0.7 + z * 0.3));
      c = [col[0] * stripes, col[1] * stripes, col[2] * stripes];
    } else {
      c = (SURFACES[type] || SURFACES.grass).color.slice();
    }
    // roca en pendientes fuertes, arena junto al agua, oscurecimiento en vaguadas
    const rockT = clamp((slope - 0.55) / 0.5, 0, 1);
    if (type !== 'asphalt' && type !== 'concrete') {
      const rk = SURFACES.rock.color;
      c = [c[0] + (rk[0] - c[0]) * rockT, c[1] + (rk[1] - c[1]) * rockT, c[2] + (rk[2] - c[2]) * rockT];
    }
    const v = 0.9 + n2 * 0.14;
    out[0] = c[0] * v; out[1] = c[1] * v; out[2] = c[2] * v;
    return out;
  }

  buildTerrain() {
    const env = this.env;
    const n = env.res + 1;
    // colores (espacio lineal) por vértice de la rejilla completa
    const colors = new Float32Array(n * n * 3);
    const tmp = [0, 0, 0];
    const col = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -env.half + i * env.cell, z = -env.half + j * env.cell;
        this.vertexColor(x, z, env.hf[j * n + i], tmp);
        col.setRGB(tmp[0], tmp[1], tmp[2], THREE.SRGBColorSpace);
        colors[(j * n + i) * 3] = col.r; colors[(j * n + i) * 3 + 1] = col.g; colors[(j * n + i) * 3 + 2] = col.b;
      }
    }
    this.terrainColors = colors;
    const detail = terrainDetail();
    const mat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0 }));
    // la textura de detalle usa las uv en metros/6; se mezcla a tres escalas para que no se note
    // la repetición, y se atenúa con la distancia para evitar el centelleo (moiré)
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          float t1 = texture2D( map, vMapUv ).r;
          float t2 = texture2D( map, vMapUv * 0.137 + vec2( 0.31, 0.77 ) ).r;
          float t3 = texture2D( map, vMapUv * 0.019 + vec2( 0.53, 0.11 ) ).r;
          float fade = clamp( length( vViewPosition ) / 220.0, 0.0, 1.0 );
          float dtl = mix( t1 * 0.5 + t2 * 0.3 + t3 * 0.2, t2 * 0.45 + t3 * 0.55, fade );
          diffuseColor.rgb *= dtl * 1.06;
        #endif`);
    };
    this.terrainMaterial = mat;
    const chunkCells = 32;
    const chunks = Math.ceil(env.res / chunkCells);
    const chunkSize = chunkCells * env.cell;
    const strides = this.q.terrainDetail >= 1 ? [1, 2, 4] : [2, 4, 8];
    for (let cj = 0; cj < chunks; cj++) {
      for (let ci = 0; ci < chunks; ci++) {
        const lod = new THREE.LOD();
        strides.forEach((s, li) => {
          const geo = this.chunkGeometry(ci * chunkCells, cj * chunkCells, chunkCells, s);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.receiveShadow = true;
          this.track(geo);
          lod.addLevel(mesh, li === 0 ? 0 : chunkSize * (li === 1 ? 1.3 : 2.8));
        });
        lod.autoUpdate = true;
        this.group.add(lod);
      }
    }
    // plano exterior hasta el horizonte (más allá del campo de alturas)
    const pal = env.palette?.far || [0.45, 0.52, 0.38];
    let edgeH = 0;
    for (let i = 0; i < n; i++) edgeH += env.hf[i] + env.hf[(n - 1) * n + i] + env.hf[i * n] + env.hf[i * n + n - 1];
    edgeH /= 4 * n;
    const outer = new THREE.Mesh(
      this.track(new THREE.RingGeometry(env.half * 0.98, env.half * 12, 64, 1)),
      this.track(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(pal[0], pal[1], pal[2], THREE.SRGBColorSpace), roughness: 1 })),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = env.seaLevel != null ? env.seaLevel - 0.6 : edgeH - 3;
    this.outer = outer;
    if (env.seaLevel == null) this.group.add(outer);
  }

  chunkGeometry(i0, j0, cells, stride) {
    const env = this.env;
    const n = env.res + 1;
    const cnt = Math.floor(cells / stride) + 1;
    const pos = [], col = [], uv = [], idx = [];
    for (let j = 0; j < cnt; j++) {
      for (let i = 0; i < cnt; i++) {
        const gi = Math.min(env.res, i0 + i * stride), gj = Math.min(env.res, j0 + j * stride);
        const x = -env.half + gi * env.cell, z = -env.half + gj * env.cell;
        pos.push(x, env.hf[gj * n + gi], z);
        const k = (gj * n + gi) * 3;
        col.push(this.terrainColors[k], this.terrainColors[k + 1], this.terrainColors[k + 2]);
        uv.push(x / 6, z / 6);
      }
    }
    for (let j = 0; j < cnt - 1; j++) {
      for (let i = 0; i < cnt - 1; i++) {
        const a = j * cnt + i, b = a + 1, c = a + cnt, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // faldones en los bordes (ocultan grietas entre niveles de detalle)
    if (stride > 1 || this.q.terrainDetail < 1) {
      const skirt = (ids) => {
        for (let k = 0; k < ids.length - 1; k++) {
          const a = ids[k], b = ids[k + 1];
          const base = pos.length / 3;
          for (const v of [a, b]) {
            pos.push(pos[v * 3], pos[v * 3 + 1] - 4, pos[v * 3 + 2]);
            col.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
            uv.push(uv[v * 2], uv[v * 2 + 1]);
          }
          idx.push(a, base, b, b, base, base + 1);
          idx.push(a, b, base, b, base + 1, base);
        }
      };
      const row = (j) => Array.from({ length: cnt }, (_, i) => j * cnt + i);
      const colm = (i) => Array.from({ length: cnt }, (_, j) => j * cnt + i);
      skirt(row(0)); skirt(row(cnt - 1)); skirt(colm(0)); skirt(colm(cnt - 1));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  /* ─────────────────────────────── Agua ─────────────────────────────── */

  waterNormalTexture() {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const img = g.createImageData(s, s);
    const h = (x, y) => {
      const a = (x / s) * Math.PI * 2, b = (y / s) * Math.PI * 2;
      return Math.sin(a * 3 + Math.cos(b * 2)) * 0.5 + Math.sin(b * 5 + a) * 0.3 + Math.sin((a + b) * 7) * 0.2;
    };
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
        const nx = -dx * 2, ny = -dy * 2, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const i = (y * s + x) * 4;
        img.data[i] = (nx / l * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    return this.track(t);
  }

  buildWater() {
    const env = this.env;
    if (env.seaLevel == null && !env.lakes.length) return;
    const normal = this.waterNormalTexture();
    const mk = (color, repeat) => {
      const nm = normal.clone();
      nm.repeat.set(repeat, repeat);
      nm.needsUpdate = true;
      this.track(nm);
      const m = this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.08, metalness: 0.35, normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.9 }));
      this.waterMaterials.push(m);
      return m;
    };
    if (env.seaLevel != null) {
      const sea = new THREE.Mesh(this.track(new THREE.PlaneGeometry(env.size * 12, env.size * 12, 1, 1)), mk('#1f5878', 900));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = env.seaLevel;
      sea.receiveShadow = true;
      this.group.add(sea);
    }
    for (const l of env.lakes) {
      const lake = new THREE.Mesh(this.track(new THREE.CircleGeometry(l.r * 1.32, 40)), mk('#2f6476', 40));
      lake.rotation.x = -Math.PI / 2;
      lake.position.set(l.x, l.level, l.z);
      lake.receiveShadow = true;
      this.group.add(lake);
    }
  }

  /* ─────────────────────────────── Pistas y caminos ─────────────────────────────── */

  buildRunways() {
    const env = this.env;
    for (const rw of env.runways) {
      const segL = Math.ceil(rw.length / 6);
      const geo = new THREE.PlaneGeometry(rw.width, rw.length, 2, segL);
      geo.rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      const h = rw.heading * DEG;
      const dir = [Math.sin(h), -Math.cos(h)], perp = [Math.cos(h), Math.sin(h)];
      for (let i = 0; i < p.count; i++) {
        const lx = p.getX(i), lz = p.getZ(i);
        // eje largo (−z local) según el rumbo
        const x = rw.x + perp[0] * lx - dir[0] * lz;
        const z = rw.z + perp[1] * lx - dir[1] * lz;
        p.setXYZ(i, x, env.heightAt(x, z) + 0.05, z);
      }
      geo.computeVertexNormals();
      let tex;
      if (rw.surface === 'asphalt') tex = runwayAsphalt(rw.name);
      else {
        tex = mownStripes().clone();
        tex.needsUpdate = true;
        tex.repeat.set(1, rw.length / 16);
        this.track(tex);
      }
      const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, color: rw.surface === 'asphalt' ? '#ffffff' : '#8fb35a', roughness: rw.surface === 'asphalt' ? 0.85 : 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const mesh = new THREE.Mesh(this.track(geo), mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  buildRoads() {
    const env = this.env;
    if (!env.roads.length) return;
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (const rd of env.roads) {
      const base = SURFACES[rd.type]?.color || [0.5, 0.45, 0.35];
      c.setRGB(base[0], base[1], base[2], THREE.SRGBColorSpace);
      // remuestreo de la polilínea cada ~8 m
      const pts = [];
      for (let i = 0; i < rd.points.length - 1; i++) {
        const [ax, az] = rd.points[i], [bx, bz] = rd.points[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
        for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
      }
      pts.push(rd.points[rd.points.length - 1]);
      const start = pos.length / 3;
      let count = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        if (Math.abs(x) > env.half - 5 || Math.abs(z) > env.half - 5) continue;
        const [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
        let dx = nx - px, dz = nz - pz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const ox = -dz * rd.width / 2, oz = dx * rd.width / 2;
        for (const s of [1, -1]) {
          const X = x + ox * s, Z = z + oz * s;
          if (env.waterLevelAt(X, Z) != null) { pos.push(X, env.heightAt(X, Z) - 5, Z); } else pos.push(X, env.heightAt(X, Z) + 0.07, Z);
          const v = 0.92 + 0.08 * Math.sin(i * 1.7);
          col.push(c.r * v, c.g * v, c.b * v);
        }
        if (count > 0) {
          const a = start + (count - 1) * 2, b = a + 1, cc = a + 2, d = a + 3;
          idx.push(a, cc, b, b, cc, d);
        }
        count++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(this.track(geo), this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide })));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /* ─────────────────────────────── Objetos ─────────────────────────────── */

  buildProps() {
    const env = this.env;
    const chunkSize = 300;
    const chunks = new Map();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (const pr of env.props) {
      if (!STATIC_TYPES.has(pr.type)) continue;
      const parts = propParts(pr);
      if (!parts.length) continue;
      const key = `${Math.floor(pr.x / chunkSize)},${Math.floor(pr.z / chunkSize)}`;
      if (!chunks.has(key)) chunks.set(key, []);
      if (pr.type === 'fence') {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-(pr.z1 - pr.z0), pr.x1 - pr.x0));
      } else q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pr.rot || 0);
      p.set(pr.x, pr.y ?? env.heightAt(pr.x, pr.z), pr.z);
      m.compose(p, q, s);
      for (const part of parts) chunks.get(key).push({ geo: part.geo, matrix: part.matrix.clone().premultiply(m) });
    }
    const mat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 }));
    for (const list of chunks.values()) {
      const geo = mergeColored(list);
      for (const l of list) l.geo.dispose();
      const mesh = new THREE.Mesh(this.track(geo), mat);
      mesh.castShadow = this.q.shadows;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // línea eléctrica: postes fusionados + cables con catenaria
    for (const pl of env.props.filter((x) => x.type === 'powerline')) this.buildPowerline(pl);
  }

  buildPowerline(pl) {
    const env = this.env;
    const parts = [];
    const tops = [];
    for (const [x, z] of pl.points) {
      const y = env.heightAt(x, z);
      const m = new THREE.Matrix4().makeTranslation(x, y, z);
      const pole = new THREE.CylinderGeometry(0.12, 0.16, 9, 6);
      pole.translate(0, 4.5, 0);
      const arm = new THREE.BoxGeometry(0.15, 0.15, 2.4);
      arm.translate(0, 8.6, 0);
      for (const g of [pole, arm]) {
        const cg = g.toNonIndexed();
        g.dispose();
        const cc = new Float32Array(cg.attributes.position.count * 3).fill(0.35);
        cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
        parts.push({ geo: cg, matrix: m });
      }
      tops.push([x, y + 8.6, z]);
    }
    const geo = mergeColored(parts);
    for (const p of parts) p.geo.dispose();
    this.group.add(new THREE.Mesh(this.track(geo), this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }))));
    const pts = [];
    for (let i = 0; i < tops.length - 1; i++) {
      for (const off of [-1.1, 0, 1.1]) {
        const [x0, y0, z0] = tops[i], [x1, y1, z1] = tops[i + 1];
        const N = 10;
        for (let k = 0; k < N; k++) {
          const t0 = k / N, t1 = (k + 1) / N;
          const sag = (t) => -2.2 * 4 * t * (1 - t);
          pts.push(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0 + sag(t0), z0 + (z1 - z0) * t0 + off);
          pts.push(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1 + sag(t1), z0 + (z1 - z0) * t1 + off);
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.LineSegments(this.track(lg), this.track(new THREE.LineBasicMaterial({ color: '#2b2b2b' }))));
  }

  /* ─────────────────────────────── Vegetación ─────────────────────────────── */

  treeMaterial() {
    this.swayUniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0, 0) } };
    const atlas = foliageAtlas(this.q.textureQuality ?? 1);
    return this.track(foliageMaterial(atlas, this.swayUniforms, { alphaToCoverage: !!this.q.antialias }));
  }

  buildTrees() {
    const env = this.env;
    const trees = env.props.filter((p) => p.type === 'tree');
    if (!trees.length) return;
    const mat = this.treeMaterial();
    const geos = {};
    const getGeo = (v, d) => {
      const k = `${v}-${d}`;
      if (!geos[k]) geos[k] = this.track(foliageTreeGeometry(v, d));
      return geos[k];
    };
    const chunkSize = 250;
    const chunks = new Map();
    const pilot = env.pilot;
    trees.forEach((t, i) => {
      // la densidad de vegetación sólo reduce árboles lejanos (los cercanos tienen colisión)
      const far = Math.hypot(t.x - pilot.x, t.z - pilot.z) > 260;
      if (far && ((i * 2654435761) % 1000) / 1000 > this.q.vegetation) return;
      const key = `${Math.floor(t.x / chunkSize)},${Math.floor(t.z / chunkSize)}`;
      if (!chunks.has(key)) chunks.set(key, {});
      const c = chunks.get(key);
      (c[t.variant] ||= []).push(t);
    });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    for (const [key, byVariant] of chunks) {
      const [ci, cj] = key.split(',').map(Number);
      const center = new THREE.Vector3((ci + 0.5) * chunkSize, 0, (cj + 0.5) * chunkSize);
      const levels = [[], []];
      for (const [variant, list] of Object.entries(byVariant)) {
        for (const d of [1, 0]) {
          const im = new THREE.InstancedMesh(getGeo(variant, d), mat, list.length);
          list.forEach((t, k) => {
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
            s.setScalar(t.scale);
            p.set(t.x, t.y - 0.2, t.z);
            m.compose(p, q, s);
            im.setMatrixAt(k, m);
            const v = 0.85 + (t.tint || 0) * 0.3;
            col.setRGB(v, v * (0.95 + (t.tint || 0) * 0.1), v * 0.9);
            im.setColorAt(k, col);
          });
          im.castShadow = d === 1 && this.q.shadows;
          im.receiveShadow = false;
          im.computeBoundingSphere();
          center.y = im.boundingSphere.center.y;
          levels[d === 1 ? 0 : 1].push(im);
        }
      }
      const hi = new THREE.Group(), lo = new THREE.Group();
      levels[0].forEach((x) => hi.add(x));
      levels[1].forEach((x) => lo.add(x));
      this.group.add(hi, lo);
      this.treeChunks.push({ center, hi, lo });
    }
  }

  /* ─────────────────────── Mangas de viento y banderas ─────────────────────── */

  buildAnimatedProps() {
    const env = this.env;
    const sockTex = windsockStripes();
    for (const p of env.props) {
      if (p.type === 'windsock') {
        const pivot = new THREE.Group();
        pivot.position.set(p.x, p.y + p.h - 0.1, p.z);
        const geo = this.track(new THREE.CylinderGeometry(0.35, 0.16, 2.2, 14, 6, true));
        geo.rotateZ(Math.PI / 2);
        geo.translate(1.1, 0, 0);
        const sock = new THREE.Mesh(geo, this.track(new THREE.MeshStandardMaterial({ map: sockTex, side: THREE.DoubleSide, roughness: 0.8 })));
        const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.36, 0.02, 6, 16)), this.track(new THREE.MeshStandardMaterial({ color: '#666' })));
        ring.rotation.y = Math.PI / 2;
        sock.castShadow = true;
        pivot.add(sock, ring);
        this.group.add(pivot);
        this.animated.windsocks.push({ pivot, sock, base: geo.attributes.position.array.slice() });
      } else if (p.type === 'flag') {
        const geo = this.track(new THREE.PlaneGeometry(1.5, 0.9, 10, 3));
        geo.translate(0.75, 0, 0);
        const mesh = new THREE.Mesh(geo, this.track(new THREE.MeshStandardMaterial({ color: p.color, side: THREE.DoubleSide, roughness: 0.8 })));
        const pivot = new THREE.Group();
        pivot.position.set(p.x, p.y + p.h - 0.5, p.z);
        pivot.add(mesh);
        this.group.add(pivot);
        this.animated.flags.push({ pivot, geo, base: geo.attributes.position.array.slice(), phase: Math.random() * 10 });
      }
    }
  }

  /**
   * Animación por fotograma.
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {{x,z}} wind  viento horizontal (m/s, dirección hacia donde sopla)
   * @param {{x,y,z}} target  posición del avión
   */
  update(dt, camera, wind, target) {
    this.time += dt;
    const t = this.time;
    const ws = Math.hypot(wind.x, wind.z);
    const yaw = Math.atan2(-wind.z, wind.x); // +X local apuntando a sotavento
    if (this.swayUniforms) {
      this.swayUniforms.uTime.value = t;
      this.swayUniforms.uWind.value.set(wind.x * 0.35, wind.z * 0.35);
    }
    for (const w of this.waterMaterials) {
      if (w.normalMap) { w.normalMap.offset.x = t * 0.004; w.normalMap.offset.y = t * 0.0025; }
    }
    // mangas de viento: orientación y caída según la intensidad
    const droop = (1 - clamp(ws / 7.5, 0, 1)) * 70 * DEG;
    for (const sk of this.animated.windsocks) {
      sk.pivot.rotation.set(0, yaw + Math.sin(t * 2.3) * 0.05 * clamp(ws / 3, 0, 1), -droop + Math.sin(t * 5.1) * 0.03);
      const pos = sk.sock.geometry.attributes.position;
      const b = sk.base;
      for (let i = 0; i < pos.count; i++) {
        const x = b[i * 3];
        pos.setY(i, b[i * 3 + 1] + Math.sin(t * 9 + x * 3) * 0.03 * x * clamp(ws / 4, 0.2, 1));
      }
      pos.needsUpdate = true;
    }
    // banderas: onda que viaja por la tela
    for (const f of this.animated.flags) {
      f.pivot.rotation.y = yaw;
      const pos = f.geo.attributes.position;
      const b = f.base;
      const amp = 0.12 + clamp(ws / 8, 0, 1) * 0.2;
      for (let i = 0; i < pos.count; i++) {
        const x = b[i * 3];
        pos.setZ(i, Math.sin(t * (4 + ws) - x * 4 + f.phase) * amp * x * 0.6);
        pos.setY(i, b[i * 3 + 1] - (1 - clamp(ws / 5, 0, 1)) * x * 0.45);
      }
      pos.needsUpdate = true;
      f.geo.computeVertexNormals();
    }
    // LOD de vegetación por bloques
    if (camera) {
      for (const c of this.treeChunks) {
        const d = camera.position.distanceTo(c.center);
        c.hi.visible = d < 520;
        c.lo.visible = d >= 520;
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
  }
}
