/**
 * Escenario 1 — Aeródromo RC (escenario principal).
 * Club de aeromodelismo con pista de césped cortado, línea de pilotos, caseta, mesas de
 * trabajo, zona de espectadores, aparcamiento, vallas, banderas y manga de viento.
 */
import { EnvironmentBase } from './EnvironmentBase.js';
import { addPitArea, addParking } from './scenarioHelpers.js';
import { smoothstep } from '../utils/math3d.js';

export class Airfield extends EnvironmentBase {
  constructor() {
    super({
      id: 'airfield', size: 3000, res: 256, elevation: 180, seed: 11, boundary: 900,
      ridgeScale: 40, ridgeHeight: 60,
      name: { es: 'Aeródromo RC "Los Aromos"', en: '"Los Aromos" RC Airfield' },
      desc: { es: 'Club de aeromodelismo con pista de césped de 140 m, boxes, zona de espectadores y campo abierto. El lugar ideal para aprender.', en: 'Model flying club with a 140 m grass strip, pits, spectator area and open fields. The ideal place to learn.' },
      ambience: 'meadow',
      palette: { grass: [0.36, 0.52, 0.22], dry: [0.6, 0.58, 0.32], far: [0.42, 0.5, 0.36] },
    });
  }

  baseHeight(x, z) {
    const n = this.noise;
    const d = Math.hypot(x, z);
    let h = 3 * n.fbm2(x / 500, z / 500, 4) + 1.2 * n.fbm2(x / 120, z / 120, 3);
    const hills = smoothstep(450, 1300, d);
    h += hills * (70 * n.ridged2(x / 900 + 3, z / 900 - 2, 4) + 20 * n.fbm2(x / 260, z / 260, 4));
    return h;
  }

  setup() {
    this.runway = this.addRunway({ x: 0, z: -22, heading: 90, length: 140, width: 14, surface: 'mown', name: '09/27' });
    // césped de seguridad y zona de boxes aplanados
    this.addFlatten({ shape: 'rect', x: 0, z: 10, w: 90, l: 240, heading: 90, height: this.baseHeight(0, -22), margin: 50 });
    this.addSurface({ shape: 'rect', x: 0, z: 12, w: 26, l: 90, heading: 90, type: 'mown' });
    this.addSurface({ shape: 'rect', x: 72, z: 46, w: 28, l: 60, heading: 90, type: 'gravel' });
    this.addRoad([[72, 46], [110, 90], [130, 260], [180, 520], [260, 900], [300, 1400]], 5, 'dirt');
    this.addRoad([[-1400, 380], [-600, 330], [-100, 300], [130, 260], [700, 240], [1400, 300]], 6, 'dirt');
    this.pilot = { x: 0, z: 0, facing: 0 };
    this.hand = { x: 0, z: -6 };
    this.landingTarget = { x: 0, z: -22 };
    this.thermalSources.push({ x: 300, z: 400 }, { x: -450, z: -300 }, { x: 600, z: -500 }, { x: -700, z: 450 });
  }

  defaultSurface(x, z, h, slope) {
    if (slope > 0.7) return 'rock';
    const n = this.noise.noise2(x * 0.004, z * 0.004);
    if (n > 0.45 && Math.hypot(x, z) > 220) return 'field';
    return 'grass';
  }

  populate() {
    // vallas de seguridad entre pilotos y boxes, y alrededor de los espectadores
    this.fence(-60, 4, -6, 4, 'mesh', 1.2);
    this.fence(6, 4, 60, 4, 'mesh', 1.2);
    this.fence(-60, 28, 60, 28, 'rail', 1.0);
    addPitArea(this, -18, 16, 0);
    // puestos de pilotos (postes numerados)
    for (let i = -2; i <= 2; i++) this.addProp({ type: 'pole', x: i * 9, z: 3, h: 1.2, color: '#f5f5f5' });
    this.addProp({ type: 'windsock', x: 60, z: -2, h: 6 });
    this.addProp({ type: 'flag', x: -40, z: 1, h: 8, color: '#2e7d32' });
    this.addProp({ type: 'flag', x: 42, z: 1, h: 8, color: '#f9a825' });
    // espectadores
    for (let i = -3; i <= 3; i++) this.addProp({ type: 'bench', x: i * 8, z: 34, rot: 0 });
    // aparcamiento
    addParking(this, 48, 38, 3, 14, Math.PI / 2);
    this.addProp({ type: 'container', x: -45, z: 20, rot: 0, w: 6, d: 2.5, h: 2.6, color: '#3c6e71' });
    // arbolado: alamedas en los linderos y grupos dispersos
    this.treeLine(-260, 120, 260, 120, 9, 'poplar');
    this.treeLine(-260, -170, 260, -170, 11, 'poplar');
    this.scatterTrees({ count: 900, area: { shape: 'ring', x: 0, z: 0, r0: 230, r1: 1400 }, variants: ['broadleaf', 'broadleaf', 'pine', 'bush'], cluster: 0.05 });
    this.scatterTrees({ count: 60, area: { x0: -230, x1: 230, z0: 60, z1: 110 }, variants: ['broadleaf', 'bush'], clearance: 4 });
  }
}
