/**
 * Colisiones con objetos estáticos mediante geometrías simplificadas (cilindros, esferas y
 * cajas orientadas) indexadas en una rejilla espacial (hash) para consultas O(1).
 * El terreno y el agua se resuelven aparte, con el campo de alturas.
 */
export class CollisionSystem {
  constructor(cellSize = 16) {
    this.cell = cellSize;
    this.grid = new Map();
    this.count = 0;
  }

  key(i, j) { return i * 73856093 ^ j * 19349663; }

  insert(c, x0, z0, x1, z1) {
    const s = this.cell;
    const i0 = Math.floor(x0 / s), i1 = Math.floor(x1 / s);
    const j0 = Math.floor(z0 / s), j1 = Math.floor(z1 / s);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
    }
    this.count++;
  }

  addCylinder({ x, z, r, y0, y1, soft = false, id = 'cyl' }) {
    const c = { kind: 'cyl', x, z, r, y0, y1, soft, id };
    this.insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  addSphere({ x, y, z, r, soft = false, id = 'sphere' }) {
    const c = { kind: 'sphere', x, y, z, r, soft, id };
    this.insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  /** Caja orientada con giro rot (rad) alrededor del eje vertical. */
  addBox({ x, y, z, hx, hy, hz, rot = 0, soft = false, id = 'box' }) {
    const c = { kind: 'box', x, y, z, hx, hy, hz, cos: Math.cos(rot), sin: Math.sin(rot), soft, id };
    const R = Math.hypot(hx, hz);
    this.insert(c, x - R, z - R, x + R, z + R);
    return c;
  }

  /** ¿Hay colisionadores en las celdas cercanas a pos? (descarte rápido). */
  nearAny(pos, radius) {
    const s = this.cell;
    const i0 = Math.floor((pos.x - radius) / s), i1 = Math.floor((pos.x + radius) / s);
    const j0 = Math.floor((pos.z - radius) / s), j1 = Math.floor((pos.z + radius) / s);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (this.grid.has(this.key(i, j))) return true;
    return false;
  }

  /**
   * Comprueba si un punto está dentro de algún colisionador. Prioriza los sólidos sobre los
   * blandos (copas de árboles). out: { depth, normal: {x,y,z}, soft, id }
   */
  queryPoint(p, out) {
    const list = this.grid.get(this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell)));
    if (!list) return false;
    let found = false;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (this.testPoint(c, p, out)) {
        found = true;
        if (!c.soft) return true;
      }
    }
    return found;
  }

  testPoint(c, p, out) {
    if (c.kind === 'cyl') {
      if (p.y < c.y0 || p.y > c.y1) return false;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= c.r * c.r) return false;
      const d = Math.sqrt(d2) || 1e-6;
      const side = c.r - d, top = c.y1 - p.y;
      if (top < side) { out.depth = top; out.normal.x = 0; out.normal.y = 1; out.normal.z = 0; }
      else { out.depth = side; out.normal.x = dx / d; out.normal.y = 0; out.normal.z = dz / d; }
      out.soft = c.soft; out.id = c.id;
      return true;
    }
    if (c.kind === 'sphere') {
      const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= c.r * c.r) return false;
      const d = Math.sqrt(d2) || 1e-6;
      out.depth = c.r - d; out.normal.x = dx / d; out.normal.y = dy / d; out.normal.z = dz / d;
      out.soft = c.soft; out.id = c.id;
      return true;
    }
    // caja orientada: a coordenadas locales
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const ex = c.hx - Math.abs(lx), ey = c.hy - Math.abs(dy), ez = c.hz - Math.abs(lz);
    if (ex <= 0 || ey <= 0 || ez <= 0) return false;
    let nx = 0, ny = 0, nz = 0, depth;
    if (ey <= ex && ey <= ez) { depth = ey; ny = Math.sign(dy) || 1; }
    else if (ex <= ez) { depth = ex; nx = Math.sign(lx) || 1; }
    else { depth = ez; nz = Math.sign(lz) || 1; }
    // de vuelta a mundo (rotación inversa)
    out.normal.x = nx * c.cos + nz * c.sin;
    out.normal.y = ny;
    out.normal.z = -nx * c.sin + nz * c.cos;
    out.depth = depth; out.soft = c.soft; out.id = c.id;
    return true;
  }
}
