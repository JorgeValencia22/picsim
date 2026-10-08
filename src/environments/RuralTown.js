/**
 * Escenario 6 — Entorno urbano-rural.
 * Pueblo con calles, iglesia, depósito de agua, galpones y silos; campos, colinas, una línea
 * eléctrica como referencia visual y una zona de vuelo segura al oeste del pueblo.
 */
import { EnvironmentBase } from './EnvironmentBase.js';
import { addHouse, addFarm } from './scenarioHelpers.js';
import { smoothstep } from '../utils/math3d.js';

export class RuralTown extends EnvironmentBase {
  constructor() {
    super({
      id: 'ruraltown', size: 3200, res: 256, elevation: 420, seed: 89, boundary: 1000,
      ridgeScale: 40, ridgeHeight: 80,
      name: { es: 'Pueblo rural "San Roque"', en: '"San Roque" Rural Town' },
      desc: { es: 'Pueblo con calles, iglesia, galpones y silos junto a campos y colinas. Una línea eléctrica y los caminos sirven de referencia para vuelos de precisión.', en: 'Town with streets, church, sheds and silos next to fields and hills. A power line and roads provide references for precision flying.' },
      ambience: 'town',
      palette: { grass: [0.4, 0.53, 0.24], dry: [0.68, 0.6, 0.36], far: [0.46, 0.5, 0.4] },
    });
    this.town = { x: 520, z: -40, w: 320, l: 360 };
  }

  baseHeight(x, z) {
    const n = this.noise;
    let h = 9 * n.fbm2(x / 450, z / 450, 4) + 3 * n.fbm2(x / 120, z / 120, 2);
    h += 60 * smoothstep(0.25, 0.85, n.noise2(x / 900 - 5, z / 900 + 2)) * smoothstep(300, 700, Math.hypot(x, z));
    h += smoothstep(1000, 1500, Math.hypot(x, z)) * 80 * n.ridged2(x / 700, z / 700, 4);
    return h;
  }

  setup() {
    const t = this.town;
    this.addFlatten({ shape: 'rect', x: t.x, z: t.z, w: t.w, l: t.l, heading: 0, height: 'auto', margin: 80 });
    this.runway = this.addRunway({ x: -60, z: -10, heading: 0, length: 130, width: 14, surface: 'mown', name: '18/36' });
    this.pilot = { x: -32, z: 0, facing: -90 };
    this.hand = { x: -40, z: -2 };
    this.landingTarget = { x: -60, z: -10 };
    // calles del pueblo (cuadrícula)
    for (let i = -2; i <= 2; i++) {
      this.addRoad([[t.x + i * 70, t.z - t.l / 2], [t.x + i * 70, t.z + t.l / 2]], 7, 'asphalt');
      this.addRoad([[t.x - t.w / 2, t.z + i * 75], [t.x + t.w / 2, t.z + i * 75]], 7, 'asphalt');
    }
    this.addRoad([[t.x - t.w / 2, t.z], [100, -10], [-10, 60], [-400, 260], [-1500, 500]], 6, 'gravel');
    this.addRoad([[t.x + t.w / 2, t.z + 75], [1100, 300], [1600, 360]], 7, 'asphalt');
    this.addRoad([[t.x, t.z - t.l / 2], [600, -700], [700, -1500]], 6, 'dirt');
    this.addSurface({ shape: 'rect', x: t.x, z: t.z, w: 60, l: 60, heading: 0, type: 'concrete' }); // plaza
    const fields = [[-300, -300, 180, 260, 0], [-500, 100, 200, 220, 0], [200, 400, 160, 240, 10], [-200, 500, 220, 180, -5], [900, -400, 260, 220, 0], [1000, 500, 240, 200, 15]];
    for (const [x, z, w, l, hd] of fields) {
      this.addSurface({ shape: 'rect', x, z, w, l, heading: hd, type: 'field', tint: this.rng() });
      this.thermalSources.push({ x, z });
    }
    this.thermalSources.push({ x: t.x, z: t.z });
  }

  defaultSurface(x, z, h, slope) {
    if (slope > 0.75) return 'rock';
    return 'grass';
  }

  populate() {
    const t = this.town;
    const r = this.rng;
    // manzanas: casas alrededor de las calles
    for (let i = -2; i < 2; i++) {
      for (let j = -2; j < 2; j++) {
        const bx = t.x + i * 70 + 35, bz = t.z + j * 75 + 37;
        if (Math.abs(bx - t.x) < 40 && Math.abs(bz - t.z) < 40) continue;
        const n = 3 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const side = k % 2 ? 1 : -1;
          const ox = side * 18 + (r() - 0.5) * 6, oz = (k - n / 2) * 15 + (r() - 0.5) * 4;
          addHouse(this, bx + ox, bz + oz, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0.95);
        }
        this.addProp({ type: 'tree', variant: 'broadleaf', x: bx, z: bz, scale: 0.9 + r() * 0.3, rot: r() * 6, tint: r() });
      }
    }
    this.addProp({ type: 'church', x: t.x + 20, z: t.z - 50, rot: 0, w: 12, d: 26, h: 9, roofH: 5, towerH: 26, color: '#efe6d5', roofColor: '#7b3f2a' });
    this.addProp({ type: 'tower', x: t.x - 120, z: t.z + 120, h: 22, color: '#90a4ae', waterTower: true });
    // galpones y silos en las afueras
    this.addProp({ type: 'barn', x: 140, z: -140, rot: 0.2, w: 22, d: 40, h: 7, roofH: 4, color: '#9e9e9e', roofColor: '#757575' });
    this.addProp({ type: 'barn', x: 175, z: -90, rot: 0.2, w: 18, d: 30, h: 6, roofH: 3.5, color: '#b0bec5', roofColor: '#607d8b' });
    for (let i = 0; i < 3; i++) this.addProp({ type: 'silo', x: 210 + i * 9, z: -150, r: 4, h: 16, color: '#cfd8dc' });
    addFarm(this, -650, -450, 0.3);
    addFarm(this, 300, 650, -0.6);
    addFarm(this, -300, 750, 1.1);
    addFarm(this, 1000, -100, 0.1);
    // línea eléctrica de referencia (al sur de la zona de vuelo)
    const pts = [];
    for (let i = 0; i <= 18; i++) pts.push([-900 + i * 80, 260 + Math.sin(i * 0.5) * 6]);
    this.addProp({ type: 'powerline', x: 0, z: 260, points: pts });
    this.addProp({ type: 'windsock', x: -20, z: -30, h: 5 });
    this.addProp({ type: 'car', x: -14, z: 12, rot: 0, color: '#1e8449' });
    this.addProp({ type: 'table', x: -24, z: 6, rot: Math.PI / 2 });
    this.treeLine(-200, -500, -200, 200, 10, 'poplar');
    this.scatterTrees({ count: 1100, area: { shape: 'ring', x: 0, z: 0, r0: 250, r1: 1500 }, variants: ['broadleaf', 'broadleaf', 'pine', 'bush'], cluster: 0.1 });
  }
}
