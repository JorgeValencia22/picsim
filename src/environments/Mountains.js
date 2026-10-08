/**
 * Escenario 3 — Montañas (vuelo de ladera).
 * Una cresta continua orientada norte-sur con la cara de barlovento al oeste (viento por
 * defecto del oeste). La ascendencia de ladera se calcula con el gradiente real del terreno.
 * El piloto despega a mano desde la cresta; hay un prado de aterrizaje en la cima y otro en el valle.
 */
import { EnvironmentBase } from './EnvironmentBase.js';
import { smoothstep, clamp } from '../utils/math3d.js';

export class Mountains extends EnvironmentBase {
  constructor() {
    super({
      id: 'mountains', size: 4000, res: 256, elevation: 1150, seed: 37, boundary: 1300,
      ridgeScale: 35, ridgeHeight: 190,
      name: { es: 'Cordillera "El Mirador"', en: '"El Mirador" Ridge' },
      desc: { es: 'Cresta de 190 m sobre el valle, con laderas de 35°, bosques y acantilados. Con viento del oeste es el paraíso del vuelo de ladera.', en: 'A 190 m ridge above the valley with 35° slopes, forests and cliffs. With westerly wind it is slope-soaring heaven.' },
      ambience: 'mountain', windDefault: { windSpeed: 7, windDir: 270 },
      palette: { grass: [0.42, 0.52, 0.25], dry: [0.62, 0.57, 0.36], far: [0.42, 0.48, 0.42] },
    });
  }

  /** Posición x de la cresta en función de z. */
  crestX(z) {
    return 25 * Math.sin(z / 380) + 12 * this.noise.noise2(z / 160, 4.2);
  }

  crestH(z) {
    return 185 + 30 * this.noise.fbm2(z / 600, 1.7, 3);
  }

  baseHeight(x, z) {
    const n = this.noise;
    const xc = this.crestX(z);
    const H = this.crestH(z);
    const u = x - xc;
    // cara de barlovento (oeste): subida empinada de ~230 m de ancho
    const face = smoothstep(-260, 0, u);
    const faceShape = face * face * (1.4 - 0.4 * face);
    let h = H * clamp(faceShape, 0, 1);
    // meseta y bajada suave hacia el este
    if (u > 0) h = H - u * 0.07 + 10 * n.fbm2(x / 200, z / 200, 3);
    // valle occidental con colinas bajas
    h += (1 - face) * (12 * n.fbm2(x / 300, z / 300, 4) + 6);
    // barrancos en la ladera (rompen la cara de forma natural)
    h -= face * (1 - face) * 70 * Math.max(0, n.noise2(z / 110, x / 400));
    // montañas lejanas al este y al norte/sur
    h += smoothstep(500, 1500, u) * 420 * n.ridged2(x / 900, z / 900, 5);
    h += smoothstep(1300, 1900, Math.abs(z)) * 250 * n.ridged2(x / 700 + 9, z / 700, 4);
    return h;
  }

  setup() {
    const xc = this.crestX(0);
    // zona de despegue en la cresta y prado de aterrizaje en la cima
    this.addFlatten({ shape: 'circle', x: xc + 6, z: 0, r: 14, height: this.crestH(0) - 1, margin: 12 });
    this.runway = this.addRunway({ x: xc + 120, z: 10, heading: 0, length: 110, width: 18, surface: 'grass', name: 'TOP' });
    this.valleyField = this.addRunway({ x: -650, z: 140, heading: 90, length: 150, width: 25, surface: 'mown', name: 'VALLE' });
    this.pilot = { x: xc + 8, z: 0, facing: -90 };
    this.hand = { x: xc + 2, z: 0 };
    this.landingTarget = { x: xc + 120, z: 10 };
    this.addRoad([[xc + 140, -1800], [xc + 120, -600], [xc + 125, 10], [xc + 160, 700], [xc + 200, 1800]], 4, 'gravel');
    this.addRoad([[-1800, 120], [-650, 140], [-300, 400], [-200, 1200]], 4, 'dirt');
    this.thermalSources.push({ x: -500, z: -300 }, { x: -700, z: 400 }, { x: -300, z: 700 }, { x: -60, z: -500 }, { x: 400, z: 300 });
  }

  defaultSurface(x, z, h, slope) {
    if (h > 520) return 'snow';
    if (slope > 0.85) return 'rock';
    if (slope > 0.55) return 'rough';
    return 'grass';
  }

  populate() {
    const xc = this.crestX(0);
    this.addProp({ type: 'windsock', x: xc + 18, z: 12, h: 5 });
    this.addProp({ type: 'car', x: xc + 140, z: -40, rot: 0, color: '#7f8c8d' });
    this.addProp({ type: 'car', x: xc + 143, z: -30, rot: 0.1, color: '#c0392b' });
    this.addProp({ type: 'shed', x: -680, z: 190, rot: 0, w: 8, d: 6, h: 3, roofH: 1.5, color: '#8d6e63', roofColor: '#4e342e' });
    // bosques: densos en el valle y la parte baja de la ladera, dispersos en la cima
    const dens = (x, z) => {
      const h = this.heightAt(x, z);
      const u = x - this.crestX(z);
      if (u > -40 && u < 60) return 0.15; // cresta despejada
      if (h > 480) return 0;
      return h < 120 ? 0.8 : 0.55;
    };
    this.scatterTrees({ count: 2600, area: { x0: -1900, x1: 1900, z0: -1900, z1: 1900 }, variants: ['pine', 'pine', 'pine', 'cypress', 'bush'], density: dens, cluster: -0.15 });
    for (let i = 0; i < 70; i++) {
      const z = (this.rng() - 0.5) * 2600;
      const x = this.crestX(z) - 60 - this.rng() * 150;
      if (this.slopeAt(x, z) > 0.6) this.addProp({ type: 'rock', x, z, r: 2 + this.rng() * 5 });
    }
  }
}
