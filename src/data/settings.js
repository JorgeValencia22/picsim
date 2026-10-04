/**
 * Valores por defecto de la configuración y perfiles gráficos.
 * La configuración del usuario se fusiona en profundidad con estos valores, de modo que las
 * nuevas opciones añadidas en versiones futuras siempre tienen un valor válido.
 */

export const GRAPHICS_PRESETS = {
  verylow: { label: { es: 'Muy bajo', en: 'Very low' }, resolutionScale: 0.6, shadows: 'off', antialias: false, drawDistance: 1500, vegetation: 0.25, textureQuality: 0.5, effects: 0.3, terrainDetail: 0, clouds: 0.4, envMap: false },
  low: { label: { es: 'Bajo', en: 'Low' }, resolutionScale: 0.75, shadows: 'low', antialias: false, drawDistance: 2200, vegetation: 0.45, textureQuality: 0.75, effects: 0.6, terrainDetail: 0, clouds: 0.6, envMap: false },
  medium: { label: { es: 'Medio', en: 'Medium' }, resolutionScale: 1, shadows: 'medium', antialias: true, drawDistance: 3200, vegetation: 0.7, textureQuality: 1, effects: 1, terrainDetail: 1, clouds: 1, envMap: true },
  high: { label: { es: 'Alto', en: 'High' }, resolutionScale: 1, shadows: 'high', antialias: true, drawDistance: 4500, vegetation: 0.9, textureQuality: 1.5, effects: 1.3, terrainDetail: 1, clouds: 1, envMap: true },
  ultra: { label: { es: 'Ultra', en: 'Ultra' }, resolutionScale: 1.25, shadows: 'ultra', antialias: true, drawDistance: 6000, vegetation: 1, textureQuality: 2, effects: 1.6, terrainDetail: 2, clouds: 1.2, envMap: true },
};

export const SHADOW_SIZES = { off: 0, low: 1024, medium: 2048, high: 2048, ultra: 4096 };

/** Acciones asignables del teclado (dos teclas por acción). */
export const DEFAULT_KEYS = {
  elevatorUp: ['KeyS', 'ArrowDown'], // tirar (morro arriba)
  elevatorDown: ['KeyW', 'ArrowUp'],
  aileronLeft: ['KeyA', 'ArrowLeft'],
  aileronRight: ['KeyD', 'ArrowRight'],
  rudderLeft: ['KeyQ', 'Comma'],
  rudderRight: ['KeyE', 'Period'],
  throttleUp: ['ShiftLeft', 'KeyX'],
  throttleDown: ['ControlLeft', 'KeyZ'],
  flaps: ['KeyF', ''],
  airbrake: ['KeyV', ''],
  brake: ['KeyB', ''],
  gear: ['KeyL', ''],
  launch: ['Space', ''],
  camera: ['KeyC', ''],
  reset: ['KeyR', ''],
  pause: ['KeyP', 'Escape'],
  hud: ['KeyG', ''],
  menu: ['Tab', ''],
  instruments: ['KeyI', ''],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  cameraTrack: ['KeyT', ''],
  dualRate: ['KeyY', ''],
  trimAileronLeft: ['KeyJ', 'Numpad4'],
  trimAileronRight: ['KeyK', 'Numpad6'],
  trimElevatorUp: ['KeyM', 'Numpad2'],
  trimElevatorDown: ['KeyU', 'Numpad8'],
  trimRudderLeft: ['KeyN', 'Numpad7'],
  trimRudderRight: ['KeyH', 'Numpad9'],
  trimReset: ['KeyO', 'Numpad5'],
};

export const ACTION_LABELS = {
  elevatorUp: { es: 'Profundidad arriba (tirar)', en: 'Elevator up (pull)' },
  elevatorDown: { es: 'Profundidad abajo (empujar)', en: 'Elevator down (push)' },
  aileronLeft: { es: 'Alerón izquierda', en: 'Aileron left' },
  aileronRight: { es: 'Alerón derecha', en: 'Aileron right' },
  rudderLeft: { es: 'Timón izquierda', en: 'Rudder left' },
  rudderRight: { es: 'Timón derecha', en: 'Rudder right' },
  throttleUp: { es: 'Acelerador +', en: 'Throttle +' },
  throttleDown: { es: 'Acelerador −', en: 'Throttle −' },
  flaps: { es: 'Flaps (ciclo)', en: 'Flaps (cycle)' },
  airbrake: { es: 'Aerofrenos / mariposa', en: 'Airbrakes / crow' },
  brake: { es: 'Frenos de rueda', en: 'Wheel brakes' },
  gear: { es: 'Tren de aterrizaje', en: 'Landing gear' },
  launch: { es: 'Lanzamiento', en: 'Launch' },
  camera: { es: 'Cambiar cámara', en: 'Change camera' },
  reset: { es: 'Reiniciar aeronave', en: 'Reset aircraft' },
  pause: { es: 'Pausa', en: 'Pause' },
  hud: { es: 'Mostrar/ocultar HUD', en: 'Toggle HUD' },
  menu: { es: 'Menú de vuelo', en: 'Flight menu' },
  instruments: { es: 'Instrumentos', en: 'Instruments' },
  zoomIn: { es: 'Zoom +', en: 'Zoom +' },
  zoomOut: { es: 'Zoom −', en: 'Zoom −' },
  cameraTrack: { es: 'Seguimiento de cámara', en: 'Camera tracking' },
  dualRate: { es: 'Dual rate (alto/bajo)', en: 'Dual rate (high/low)' },
  trimAileronLeft: { es: 'Trim alerón ←', en: 'Aileron trim ←' },
  trimAileronRight: { es: 'Trim alerón →', en: 'Aileron trim →' },
  trimElevatorUp: { es: 'Trim profundidad ↑ (morro arriba)', en: 'Elevator trim ↑ (nose up)' },
  trimElevatorDown: { es: 'Trim profundidad ↓', en: 'Elevator trim ↓' },
  trimRudderLeft: { es: 'Trim timón ←', en: 'Rudder trim ←' },
  trimRudderRight: { es: 'Trim timón →', en: 'Rudder trim →' },
  trimReset: { es: 'Reiniciar trims', en: 'Reset trims' },
};

/** Funciones asignables a ejes de joystick / emisora. */
export const AXIS_FUNCTIONS = ['aileron', 'elevator', 'rudder', 'throttle', 'flap', 'airbrake'];

export function defaultAxisMap() {
  // Asignación típica de un mando (Gamepad API "standard"): stick izq. X/Y = 0/1, stick der. X/Y = 2/3
  return {
    aileron: { index: 2, invert: false, center: 0, min: -1, max: 1, deadzone: 0.04 },
    elevator: { index: 3, invert: false, center: 0, min: -1, max: 1, deadzone: 0.04 },
    rudder: { index: 0, invert: false, center: 0, min: -1, max: 1, deadzone: 0.06 },
    throttle: { index: 1, invert: true, center: 0, min: -1, max: 1, deadzone: 0.02, unipolar: true },
    flap: { index: -1, invert: false, center: 0, min: -1, max: 1, deadzone: 0.02, unipolar: true },
    airbrake: { index: -1, invert: false, center: 0, min: -1, max: 1, deadzone: 0.02, unipolar: true },
  };
}

export function defaultSettings() {
  return {
    version: 2,
    graphics: { preset: 'medium', ...structuredClone(GRAPHICS_PRESETS.medium), dynamicResolution: false, targetFps: 60, showFps: false },
    controls: {
      mode: 2,
      keyboard: { bindings: structuredClone(DEFAULT_KEYS), analogRate: 3.2, returnRate: 5, throttleRate: 0.55 },
      mouse: { flight: false, sensitivity: 1, invertY: false },
      gamepad: { enabled: true, axes: defaultAxisMap(), buttons: { camera: 4, reset: 3, launch: 0, flaps: 1, pause: 9, gear: 2 }, throttleIncremental: false },
      touch: { enabled: 'auto', style: 'picasim', showTrims: true, size: 1, opacity: 0.65, throttleSelfCenter: false, sticksSelfCenter: true, left: { x: 0.16, y: 0.72 }, right: { x: 0.84, y: 0.72 }, haptics: true },
      rates: { aileron: 1, elevator: 1, rudder: 1 },
      lowRate: 0.6, // fracción del recorrido con el dual rate en «bajo»
      expo: { aileron: 0.35, elevator: 0.3, rudder: 0.2 },
      mixAileronRudder: 0,
    },
    physics: { assist: 'expert', fidelity: 'realistic', damage: true, limitAttitude: false, limitBank: false, maxBank: 45, maxPitch: 30, autoLevel: true, speedHold: false, landingAid: true, turbulenceScale: 1, flightRadius: 900, signalLoss: true },
    audio: { master: 0.8, engine: 0.85, ambient: 0.55, effects: 0.8, ui: 0.6, spatial: true, muted: false },
    ui: { hud: true, hudScale: 1, hudOpacity: 0.92, units: 'metric', language: 'es', instruments: true, maneuverPopup: true, reduceMotion: false, uiScale: 1, highContrast: false, instructor: true },
    camera: { default: 'pilot', fov: 55, autoZoom: true, chaseDistance: 1, chaseHeight: 0.3, smoothing: 0.5, sensitivity: 1, shake: true },
    flight: { aircraft: 'skylark', environment: 'airfield', launch: 'runway', weatherMode: 'manual', weather: null },
  };
}

/**
 * Migración de configuraciones guardadas por versiones anteriores.
 * v2: por defecto vuelo realista sin ayudas ni estabilización artificial.
 */
export function migrateSettings(saved) {
  if (!saved || typeof saved !== 'object') return saved;
  const v = saved.version || 1;
  if (v < 2) {
    saved.physics = { ...(saved.physics || {}), assist: 'expert', fidelity: 'realistic' };
    saved.version = 2;
  }
  return saved;
}

/** Fusión profunda (objetos planos); los arrays del usuario sustituyen a los por defecto. */
export function deepMerge(base, over) {
  if (over == null || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}
