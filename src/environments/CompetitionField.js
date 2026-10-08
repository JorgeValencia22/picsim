/**
 * Escenario 5 — Aeródromo de competición acrobática.
 * Pista de asfalto de 220 m, zona de jueces, caja acrobática señalizada con postes,
 * gradas de espectadores, hangar y espacio aéreo despejado.
 */
import { EnvironmentBase } from './EnvironmentBase.js';
import { addParking } from './scenarioHelpers.js';
import { smoothstep } from '../utils/math3d.js';

export class CompetitionField extends EnvironmentBase {
  constructor() {
    super({
      id: 'competition', size: 3000, res: 192, elevation: 60, seed: 71, boundary: 1000,
      ridgeScale: 40, ridgeHeight: 50,
      name: { es: 'Aeródromo de competición "Copa Andes"', en: '"Andes Cup" Competition Field' },
      desc: { es: 'Pista de asfalto de 220 m, caja acrobática señalizada, jueces, gradas y hangar. Espacio aéreo despejado para acrobacia de alto nivel.', en: '220 m asphalt runway, marked aerobatic box, judges, grandstands and hangar. Clear airspace for top-level aerobatics.' },
      ambience: 'meadow',
      palette: { grass: [0.42, 0.56, 0.24], dry: [0.66, 0.62, 0.34], far: [0.46, 0.52, 0.38] },
    });
  }

  baseHeight(x, z) {
    const n = this.noise;
    const d = Math.hypot(x, z);
    return 1.2 * n.fbm2(x / 300, z / 300, 3) + smoothstep(700, 1400, d) * 45 * n.fbm2(x / 500, z / 500, 4);
  }

  setup() {
    this.runway = this.addRunway({ x: 0, z: -35, heading: 90, length: 220, width: 20, surface: 'asphalt', name: '09/27' });
    this.addFlatten({ shape: 'rect', x: 0, z: 0, w: 260, l: 700, heading: 90, height: this.baseHeight(0, -35), margin: 80 });
    this.addSurface({ shape: 'rect', x: 0, z: 0, w: 30, l: 400, heading: 90, type: 'mown' });
    this.addSurface({ shape: 'rect', x: -150, z: 60, w: 50, l: 70, heading: 90, type: 'concrete' });
    this.addSurface({ shape: 'rect', x: 150, z: 70, w: 40, l: 120, heading: 90, type: 'gravel' });
    this.addSurface({ shape: 'rect', x: -150, z: 20, w: 30, l: 14, heading: 0, type: 'concrete' });
    this.addRoad([[150, 70], [300, 200], [400, 700], [450, 1500]], 7, 'asphalt');
    this.pilot = { x: 0, z: 0, facing: 0 };
    this.hand = { x: 0, z: -8 };
    this.landingTarget = { x: 0, z: -35 };
    // caja acrobática: 150 m delante del piloto, 500 m de ancho
    this.aeroBox = { z: -150, xMin: -250, xMax: 250, depth: 150 };
    this.thermalSources.push({ x: 500, z: -500 }, { x: -600, z: -400 }, { x: 700, z: 500 });
  }

  defaultSurface(x, z, h, slope) {
    if (slope > 0.7) return 'rock';
    return Math.hypot(x, z) > 500 && this.noise.noise2(x * 0.005, z * 0.005) > 0.3 ? 'field' : 'grass';
  }

  populate() {
    const box = this.aeroBox;
    // postes de la caja acrobática y paneles de orientación
    for (const x of [box.xMin, 0, box.xMax]) {
      this.addProp({ type: 'marker', x, z: box.z, h: 10, color: x === 0 ? '#ffffff' : '#ff6d00' });
      this.addProp({ type: 'marker', x, z: box.z - box.depth, h: 10, color: '#ff6d00' });
    }
    for (const x of [-120, 120]) this.addProp({ type: 'groundMarker', x, z: -75, rot: 0, color: '#ffffff' });
    this.addProp({ type: 'booth', x: 0, z: 14, rot: 0, w: 8, d: 4, h: 2.6, roofH: 0.4, color: '#eceff1', roofColor: '#263238' });
    this.addProp({ type: 'stand', x: -50, z: 48, rot: 0, w: 40, d: 9, h: 4, color: '#90a4ae' });
    this.addProp({ type: 'stand', x: 50, z: 48, rot: 0, w: 40, d: 9, h: 4, color: '#90a4ae' });
    this.addProp({ type: 'hangar', x: -150, z: 75, rot: 0, w: 40, d: 26, h: 9, roofH: 4, color: '#b0bec5', roofColor: '#78909c' });
    this.addProp({ type: 'windsock', x: 120, z: -5, h: 7 });
    this.addProp({ type: 'windsock', x: -120, z: -5, h: 7 });
    for (let i = -4; i <= 4; i++) this.addProp({ type: 'flag', x: i * 14, z: 30, h: 8, color: ['#e53935', '#1e88e5', '#fdd835', '#43a047'][Math.abs(i) % 4] });
    addParking(this, 105, 45, 4, 26, Math.PI / 2);
    this.fence(-120, 24, 120, 24, 'mesh', 1.2);
    this.scatterTrees({ count: 900, area: { shape: 'ring', x: 0, z: 0, r0: 450, r1: 1400 }, variants: ['broadleaf', 'pine', 'poplar', 'bush'], cluster: 0.05 });
    this.treeLine(-400, 140, 400, 140, 12, 'cypress');
  }
}
