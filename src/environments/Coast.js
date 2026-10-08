/**
 * Escenario 4 — Costa.
 * Océano al oeste, playa de arena, dunas, acantilados al norte (vuelo de ladera con brisa
 * marina), vegetación costera, caminos y un pequeño caserío. Pista de hierba en la meseta.
 */
import { EnvironmentBase } from './EnvironmentBase.js';
import { addHouse } from './scenarioHelpers.js';
import { smoothstep, lerp } from '../utils/math3d.js';

export class Coast extends EnvironmentBase {
  constructor() {
    super({
      id: 'coast', size: 3600, res: 256, elevation: 0, seed: 53, boundary: 1100, seaLevel: 0,
      ridgeScale: 30, ridgeHeight: 70,
      name: { es: 'Costa "Punta Brava"', en: '"Punta Brava" Coast' },
      desc: { es: 'Playa, dunas y acantilados de 40 m sobre el océano. La brisa marina del oeste genera ascendencia en los acantilados.', en: 'Beach, dunes and 40 m cliffs over the ocean. The westerly sea breeze creates lift along the cliffs.' },
      ambience: 'sea', windDefault: { windSpeed: 5.5, windDir: 265 },
      palette: { grass: [0.45, 0.55, 0.28], dry: [0.7, 0.66, 0.42], far: [0.5, 0.56, 0.48] },
    });
  }

  coastX(z) {
    return -220 + 70 * this.noise.fbm2(z / 600, 2.3, 3) + 30 * this.noise.noise2(z / 150, 8.1);
  }

  cliffMask(z) {
    return smoothstep(-180, -380, z);
  }

  baseHeight(x, z) {
    const n = this.noise;
    const xs = this.coastX(z);
    const u = x - xs;
    const inland = 7 + 9 * n.fbm2(x / 420, z / 420, 4) + Math.max(0, u - 200) * 0.025 + 3 * n.fbm2(x / 90, z / 90, 2);
    let h;
    if (u < 0) h = -1.5 + u * 0.06; // fondo marino
    else if (u < 55) h = lerp(0.2, 2.6, u / 55); // playa
    else if (u < 180) {
      const t = (u - 55) / 125;
      const dunes = 6 * Math.max(0, n.noise2(x / 45, z / 70)) * Math.sin(t * Math.PI);
      h = lerp(2.6, inland, smoothstep(0, 1, t)) + dunes;
    } else h = inland;
    // acantilados al norte: meseta que cae directamente al mar
    const m = this.cliffMask(z);
    if (m > 0) {
      const plateau = 38 + 10 * n.fbm2(x / 300, z / 300, 3);
      const face = smoothstep(-6, 22, u);
      const cliff = u < -6 ? -4 + (u + 6) * 0.1 : lerp(-2, plateau, face);
      h = lerp(h, Math.max(cliff, u > 22 ? Math.max(h, plateau - Math.max(0, u - 300) * 0.02) : cliff), m);
    }
    return h;
  }

  setup() {
    this.runway = this.addRunway({ x: 120, z: 30, heading: 85, length: 130, width: 14, surface: 'mown', name: '08/26' });
    this.pilot = { x: 120, z: 52, facing: -10 };
    this.hand = { x: 118, z: 46 };
    this.landingTarget = { x: 120, z: 30 };
    // punto de vuelo de ladera en el borde del acantilado
    const zc = -520;
    this.slopeSite = { x: this.coastX(zc) + 45, z: zc, facing: -90 };
    this.addFlatten({ shape: 'circle', x: this.slopeSite.x + 5, z: zc, r: 14, height: 'auto', margin: 10 });
    this.addSurface({ shape: 'fn', type: 'sand', fn: (x, z) => {
      const u = x - this.coastX(z);
      return u > -3 && u < 150 * (1 - this.cliffMask(z)) && this.heightAt(x, z) < 12;
    } });
    this.addRoad([[360, -1700], [300, -800], [200, -300], [140, 60], [260, 400], [420, 900], [500, 1700]], 6, 'asphalt');
    this.addRoad([[140, 60], [40, 90], [-60, 140]], 4, 'sand');
    this.addRoad([[200, -300], [this.coastX(-520) + 60, -520]], 3, 'dirt');
    this.thermalSources.push({ x: 600, z: 100 }, { x: 800, z: -500 }, { x: 500, z: 700 });
  }

  defaultSurface(x, z, h, slope) {
    if (slope > 0.8) return 'rock';
    if (h < 3) return 'sand';
    return 'grass';
  }

  populate() {
    // caserío junto a la carretera
    const r = this.rng;
    for (let i = 0; i < 14; i++) {
      const z = 250 + i * 45 + (r() - 0.5) * 10;
      const x = 270 + (z - 250) * 0.3 + (i % 2 ? 30 : -30);
      addHouse(this, x, z, (i % 2 ? Math.PI / 2 : -Math.PI / 2) + 0.3, 0.9);
    }
    addHouse(this, 30, 110, 0.4, 1);
    this.addProp({ type: 'tower', x: 330, z: -240, h: 18, color: '#f5f5f5', lighthouse: true });
    this.addProp({ type: 'windsock', x: 150, z: 48, h: 5 });
    this.addProp({ type: 'car', x: 160, z: 70, rot: 0.2, color: '#f39c12' });
    this.addProp({ type: 'car', x: 166, z: 72, rot: 0.1, color: '#ecf0f1' });
    this.addProp({ type: 'table', x: 130, z: 60, rot: 0 });
    // vegetación costera
    const coastal = (x, z) => {
      const u = x - this.coastX(z);
      if (u < 60) return 0;
      return u < 220 ? 0.5 : 0.75;
    };
    this.scatterTrees({ count: 300, area: { x0: -400, x1: 600, z0: -1700, z1: 1700 }, variants: ['palm', 'bush', 'bush'], density: (x, z) => (x - this.coastX(z) < 240 ? coastal(x, z) : 0), clearance: 6 });
    this.scatterTrees({ count: 1100, area: { x0: 200, x1: 1750, z0: -1750, z1: 1750 }, variants: ['pine', 'broadleaf', 'bush', 'cypress'], density: coastal, cluster: 0.05 });
    for (let i = 0; i < 50; i++) {
      const z = -400 - r() * 1300;
      const x = this.coastX(z) - 5 + r() * 15;
      this.addProp({ type: 'rock', x, z, r: 2 + r() * 4 });
    }
  }
}
