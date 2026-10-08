/**
 * Escenario 2 — Campo abierto.
 * Praderas onduladas, caminos rurales, granjas con cercos, alamedas, cultivos y dos lagunas.
 * Pista improvisada de hierba sobre una loma suave. Ideal para vuelo recreativo y planeadores.
 */
import { EnvironmentBase } from './EnvironmentBase.js';
import { addFarm } from './scenarioHelpers.js';
import { smoothstep } from '../utils/math3d.js';

export class Countryside extends EnvironmentBase {
  constructor() {
    super({
      id: 'countryside', size: 3600, res: 256, elevation: 350, seed: 23, boundary: 1100,
      ridgeScale: 45, ridgeHeight: 70,
      name: { es: 'Campo abierto "Valle Verde"', en: '"Green Valley" Countryside' },
      desc: { es: 'Praderas onduladas, granjas, lagunas y caminos de tierra. Terreno irregular para practicar aterrizajes fuera de pista y buscar térmicas.', en: 'Rolling meadows, farms, ponds and dirt roads. Uneven ground to practise off-field landings and to hunt thermals.' },
      ambience: 'meadow',
      palette: { grass: [0.4, 0.55, 0.22], dry: [0.66, 0.6, 0.3], far: [0.45, 0.52, 0.36] },
    });
  }

  baseHeight(x, z) {
    const n = this.noise;
    let h = 16 * n.fbm2(x / 520, z / 520, 4) + 5 * n.fbm2(x / 140, z / 140, 3);
    h += 45 * smoothstep(0.2, 0.9, n.noise2(x / 1100 + 7, z / 1100 - 3));
    h += smoothstep(900, 1700, Math.hypot(x, z)) * 90 * n.ridged2(x / 800, z / 800, 4);
    return h;
  }

  setup() {
    this.runway = this.addRunway({ x: 0, z: -28, heading: 60, length: 120, width: 12, surface: 'mown', name: '06/24' });
    this.addFlatten({ shape: 'circle', x: 0, z: 0, r: 25, height: this.baseHeight(0, -28), margin: 30 });
    this.pilot = { x: 0, z: 0, facing: -30 };
    this.hand = { x: -2, z: -6 };
    this.landingTarget = { x: 0, z: -28 };
    this.addLake({ x: 380, z: 260, r: 75, depth: 4 });
    this.addLake({ x: -520, z: -330, r: 115, depth: 5 });
    this.addLake({ x: 260, z: -620, r: 55, depth: 3 });
    this.addRoad([[-1700, 120], [-900, 60], [-300, 40], [0, 30], [400, -10], [900, 60], [1700, 20]], 6, 'dirt');
    this.addRoad([[150, -1700], [120, -900], [60, -300], [0, 30], [-60, 500], [-200, 1100], [-300, 1700]], 5, 'dirt');
    this.addRoad([[400, -10], [600, 300], [700, 900]], 4, 'gravel');
    // cultivos (parcelas rectangulares)
    const fields = [[-300, -200, 160, 260, 20], [450, -280, 200, 180, -10], [-650, 250, 220, 200, 35], [700, 450, 180, 260, 5], [-220, 600, 200, 160, 70], [900, -700, 260, 220, 15]];
    for (const [x, z, w, l, hd] of fields) {
      this.addSurface({ shape: 'rect', x, z, w, l, heading: hd, type: 'field', tint: this.rng() });
      this.thermalSources.push({ x, z });
    }
  }

  defaultSurface(x, z, h, slope) {
    if (slope > 0.75) return 'rock';
    return 'grass';
  }

  populate() {
    addFarm(this, 520, 120, 0.4);
    addFarm(this, -420, 160, -0.3);
    addFarm(this, -760, -620, 1.2);
    addFarm(this, 820, -380, 2.1);
    addFarm(this, 120, 820, 0.9);
    this.addProp({ type: 'windsock', x: 25, z: -5, h: 5 });
    this.addProp({ type: 'car', x: 14, z: 18, rot: 0.6, color: '#2c3e50' });
    this.addProp({ type: 'car', x: 20, z: 22, rot: 0.8, color: '#bdc3c7' });
    this.addProp({ type: 'table', x: 8, z: 12, rot: 0.6 });
    // cercos a lo largo del camino principal
    this.fence(-300, 50, 0, 40, 'wire', 1.1);
    this.fence(400, 8, 900, 78, 'wire', 1.1);
    this.treeLine(-900, 75, -320, 55, 10, 'poplar');
    this.treeLine(420, 10, 880, 76, 10, 'poplar');
    this.treeLine(75, -300, 135, -900, 12, 'poplar');
    this.scatterTrees({ count: 1300, area: { shape: 'ring', x: 0, z: 0, r0: 160, r1: 1700 }, variants: ['broadleaf', 'broadleaf', 'pine', 'bush', 'bush'], cluster: 0.1 });
    for (const l of this.lakes) this.scatterTrees({ count: 25, area: { shape: 'ring', x: l.x, z: l.z, r0: l.r * 1.3, r1: l.r * 1.8 }, variants: ['poplar', 'bush'], clearance: 2 });
  }
}
