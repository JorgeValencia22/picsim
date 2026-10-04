/**
 * Emisoras RC conectadas por USB (modo joystick HID: EdgeTX/OpenTX, FrSky, RadioMaster,
 * Jumper, Spektrum, Futaba, interfaces tipo "Interlink"...). Detecta el dispositivo por su
 * nombre y ofrece asignaciones de canales habituales (AETR / TAER) con acelerador bipolar.
 */
import { defaultAxisMap } from '../data/settings.js';

const TX_PATTERNS = [
  { re: /edgetx|opentx|frsky|taranis|horus|radiomaster|tx16|zorro|boxer|jumper|t-lite|t16|t18|betafpv|lite radio/i, brand: 'EdgeTX/OpenTX', order: 'AETR' },
  { re: /spektrum|ws1000|wireless simulator/i, brand: 'Spektrum', order: 'TAER' },
  { re: /futaba|interlink|realflight|phoenix|simulator|usb rc|rc sim|joystick rc|flysky|fs-i6|turnigy/i, brand: 'Interfaz RC genérica', order: 'AETR' },
];

/** ¿Es una emisora / interfaz de simulador? Devuelve { brand, order } o null. */
export function detectTransmitter(gamepad) {
  const id = gamepad?.id || '';
  for (const p of TX_PATTERNS) if (p.re.test(id)) return { brand: p.brand, order: p.order, id };
  return null;
}

/**
 * Asignación de ejes para un orden de canales. En las emisoras el acelerador ocupa todo el
 * recorrido del eje (−1 → 1), por eso se marca como unipolar con min −1 y max 1.
 */
export function transmitterAxisMap(order = 'AETR') {
  const map = defaultAxisMap();
  const idx = {};
  [...order].forEach((ch, i) => { idx[ch] = i; });
  map.aileron = { index: idx.A, invert: false, center: 0, min: -1, max: 1, deadzone: 0.01 };
  map.elevator = { index: idx.E, invert: false, center: 0, min: -1, max: 1, deadzone: 0.01 };
  map.throttle = { index: idx.T, invert: false, center: 0, min: -1, max: 1, deadzone: 0.01, unipolar: true };
  map.rudder = { index: idx.R, invert: false, center: 0, min: -1, max: 1, deadzone: 0.01 };
  map.flap = { index: 4, invert: false, center: 0, min: -1, max: 1, deadzone: 0.02, unipolar: true };
  map.airbrake = { index: 5, invert: false, center: 0, min: -1, max: 1, deadzone: 0.02, unipolar: true };
  return map;
}

/** Asignación recomendada según el modo de emisora (1–4) para mandos de consola. */
export function gamepadAxisMapForMode(mode = 2) {
  const map = defaultAxisMap();
  // ejes estándar: 0 = izq X, 1 = izq Y, 2 = der X, 3 = der Y
  const set = (fn, index, invert = false, unipolar = false) => {
    map[fn] = { ...map[fn], index, invert, unipolar, center: 0, min: -1, max: 1 };
  };
  switch (mode) {
    case 1: set('rudder', 0); set('elevator', 1, true); set('aileron', 2); set('throttle', 3, true, true); break;
    case 3: set('aileron', 0); set('elevator', 1, true); set('rudder', 2); set('throttle', 3, true, true); break;
    case 4: set('aileron', 0); set('throttle', 1, true, true); set('rudder', 2); set('elevator', 3, true); break;
    case 2:
    default: set('rudder', 0); set('throttle', 1, true, true); set('aileron', 2); set('elevator', 3, true); break;
  }
  // en los mandos, empujar el stick hacia delante da −1: profundidad "tirar" positiva = stick atrás
  map.elevator.invert = !map.elevator.invert;
  return map;
}
