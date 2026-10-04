/**
 * Coeficientes aerodinámicos de superficies sustentadoras (modelo 360° de ángulo de ataque).
 *
 * Régimen adherido: CL = CL0 + a·α_eff  (a = pendiente de ala finita, fórmula de Helmbold/DATCOM)
 * Régimen desprendido: placa plana  CL = k·sin(2α), CD = 2k·sin²α
 * La transición entre ambos usa una sigmoide centrada en el ángulo de pérdida, de modo que
 * la pérdida es progresiva y continua (sin saltos que desestabilicen la integración).
 */
import { clamp, DEG } from '../utils/math3d.js';

/** Pendiente de sustentación de un ala finita [1/rad]. AR = alargamiento, sweep = flecha en rad. */
export function liftSlope(AR, sweep = 0) {
  const a0 = 2 * Math.PI * 0.95; // pendiente 2D realista de un perfil
  const tanS = Math.tan(sweep);
  return (a0 * AR) / (2 + Math.sqrt(AR * AR * (1 + tanS * tanS) + 4));
}

/** Eficiencia de una superficie de control según la fracción de cuerda (teoría de perfil delgado). */
export function controlEffectiveness(chordFrac) {
  const cf = clamp(chordFrac, 0.05, 0.95);
  const th = Math.acos(2 * cf - 1);
  return 1 - (th - Math.sin(th)) / Math.PI;
}

/** Pérdida de eficacia de una superficie de control con deflexiones grandes (separación). */
export function deflectionFalloff(deltaRad) {
  const d = Math.abs(deltaRad);
  const lo = 15 * DEG, hi = 50 * DEG;
  if (d <= lo) return 1;
  const t = clamp((d - lo) / (hi - lo), 0, 1);
  return 1 - 0.45 * t;
}

/** Factor de efecto suelo sobre la resistencia inducida (h = altura, b = envergadura). */
export function groundEffectFactor(h, b) {
  if (h <= 0) return 0.25;
  const x = (16 * h) / b;
  const x2 = x * x;
  return Math.max(0.25, x2 / (1 + x2));
}

/**
 * Calcula CL y CD de un panel.
 * @param {number} alpha     ángulo de ataque geométrico local [rad] (rango -π..π)
 * @param {number} dAlphaCtl incremento equivalente de α por flap/alerón [rad]
 * @param {object} p         parámetros del panel: cl0, a, alphaStallPos, alphaStallNeg, cd0, k (1/πeAR), plate, stallWidth
 * @param {object} out       { cl, cd, stalled }
 */
export function panelCoefficients(alpha, dAlphaCtl, p, out, inducedScale = 1) {
  // La deflexión del control desplaza la curva; la pérdida ocurre algo antes con flap bajado,
  // pero CLmax aumenta (sólo el 35% del desplazamiento afecta al ángulo de pérdida).
  const aEff = alpha + dAlphaCtl;
  const aStallTest = alpha + 0.35 * dAlphaCtl;

  // Régimen lineal (válido sólo cerca de α pequeños; fuera de él lo sustituye la placa plana)
  const clLin = p.cl0 + p.a * aEff;

  // Placa plana en todo el rango de 360°
  const s = Math.sin(aEff), c = Math.cos(aEff);
  const clPlate = p.plate * 2 * s * c;
  const cdPlate = p.plate * 2 * s * s + p.cd0;

  // Mezcla por sigmoide alrededor del ángulo de pérdida (positivo o negativo)
  const w = p.stallWidth;
  // el centro de la sigmoide se desplaza una anchura para que el pico de CL se acerque a CLmax
  const sPos = 1 / (1 + Math.exp(-(aStallTest - p.alphaStallPos - w * 0.8) / w));
  const sNeg = 1 / (1 + Math.exp((aStallTest - p.alphaStallNeg + w * 0.8) / w));
  const sep = clamp(sPos + sNeg, 0, 1);

  // Flujo invertido (|α| > 90°): siempre régimen de placa
  const attached = Math.abs(alpha) < Math.PI / 2 ? 1 - sep : 0;

  const cl = attached * clLin + (1 - attached) * clPlate;
  const cdAttached = p.cd0 + p.k * clLin * clLin * inducedScale + 0.6 * dAlphaCtl * dAlphaCtl * 0.25;
  const cd = attached * cdAttached + (1 - attached) * Math.max(cdPlate, cdAttached);

  out.cl = cl;
  out.cd = cd;
  out.stalled = 1 - attached;
  return out;
}

/** Densidad del aire (atmósfera estándar ajustada por temperatura) [kg/m³]. */
export function airDensity(altitudeMSL, temperatureC = 15, refElevation = 0) {
  const T0 = 288.15;
  const L = 0.0065;
  const p0 = 101325;
  const h = clamp(altitudeMSL, -500, 11000);
  const p = p0 * Math.pow(1 - (L * h) / T0, 5.25588);
  // la temperatura configurada corresponde a la cota del escenario; decrece con el gradiente estándar
  const T = temperatureC + 273.15 - L * (h - refElevation);
  return p / (287.058 * Math.max(200, T));
}
