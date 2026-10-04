/**
 * Combina todas las fuentes de entrada (teclado, ratón, joystick/emisora y táctil) en las
 * órdenes de la emisora virtual: sticks con recorridos (dual rates) y curvas exponenciales,
 * acelerador desde la última fuente activa, interruptores (flaps, tren) y acciones.
 */
import { KeyboardControls } from './KeyboardControls.js';
import { GamepadControls } from './GamepadControls.js';
import { TouchControls } from './TouchControls.js';
import { clamp } from '../utils/math3d.js';

export function expoCurve(x, e) {
  return (1 - e) * x + e * x * x * x;
}

export class InputManager {
  /**
   * @param {object} settings  configuración completa (referencia viva)
   * @param {HTMLElement} uiRoot
   * @param {HTMLCanvasElement|null} canvas
   * @param {CameraManager} camera
   * @param {(action:string, src?:any)=>void} onAction
   */
  constructor(settings, uiRoot, camera, onAction) {
    this.settings = settings;
    this.camera = camera;
    this.onAction = onAction;
    this.out = { aileron: 0, elevator: 0, rudder: 0, throttle: 0, flap: 0, airbrake: 0, brake: 0, gearDown: true };
    this.raw = { aileron: 0, elevator: 0, rudder: 0 };
    // trims digitales (fracción del recorrido) y dual rate, como en una emisora real
    this.trim = { aileron: 0, elevator: 0, rudder: 0 };
    this.out.trim = this.trim;
    this.dualRateLow = false;
    this.flapStep = 0;
    this.throttleSource = 'keyboard';
    this.enabled = true;
    const handler = (a, src) => this.handleAction(a, src);
    this.keyboard = new KeyboardControls(settings.controls.keyboard, handler);
    this.gamepad = new GamepadControls(settings.controls.gamepad, handler);
    this.touch = new TouchControls(uiRoot, settings.controls.touch, () => settings.controls.mode, handler, camera);
    this.mouse = { x: 0, y: 0, locked: false };
    this.updateTouchVisibility();
  }

  updateTouchVisibility(inFlight = this.inFlight) {
    this.inFlight = inFlight;
    const mode = this.settings.controls.touch.enabled;
    const show = inFlight && (mode === 'on' || (mode === 'auto' && TouchControls.isTouchDevice()));
    this.touch.setVisible(show);
  }

  /** Conecta el lienzo para ratón: arrastre de cámara, rueda de zoom y vuelo con ratón opcional. */
  attachCanvas(canvas) {
    this.detachCanvas();
    this.canvas = canvas;
    let dragging = null;
    this.onPointerDown = (e) => {
      if (e.pointerType !== 'mouse') return;
      if (this.settings.controls.mouse.flight && !this.mouse.locked && this.inFlight) {
        canvas.requestPointerLock?.();
        return;
      }
      dragging = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
      canvas.setPointerCapture(e.pointerId);
    };
    this.onPointerMove = (e) => {
      if (this.mouse.locked) {
        const k = 0.004 * (this.settings.controls.mouse.sensitivity || 1);
        this.mouse.x = clamp(this.mouse.x + e.movementX * k, -1, 1);
        this.mouse.y = clamp(this.mouse.y + e.movementY * k * (this.settings.controls.mouse.invertY ? -1 : 1), -1, 1);
        return;
      }
      if (!dragging || e.pointerType !== 'mouse') return;
      this.camera.drag(e.clientX - dragging.x, e.clientY - dragging.y, dragging.pan);
      dragging.x = e.clientX; dragging.y = e.clientY;
    };
    this.onPointerUp = () => { dragging = null; };
    this.onWheel = (e) => {
      e.preventDefault();
      this.camera.zoomBy(e.deltaY > 0 ? 1 / 1.12 : 1.12);
    };
    this.onLockChange = () => {
      this.mouse.locked = document.pointerLockElement === canvas;
      if (!this.mouse.locked) { this.mouse.x = 0; this.mouse.y = 0; }
    };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  detachCanvas() {
    if (!this.canvas) return;
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.canvas = null;
  }

  handleAction(action, src) {
    if (action === 'flaps') {
      this.flapStep = (this.flapStep + 1) % 3;
      this.out.flap = [0, 0.5, 1][this.flapStep];
    } else if (action === 'gear') {
      this.out.gearDown = !this.out.gearDown;
    } else if (action === 'dualRate') {
      this.dualRateLow = !this.dualRateLow;
    } else if (action.startsWith('trim')) {
      const step = 0.01;
      const t = this.trim;
      const add = (k, d) => { t[k] = Math.round(Math.max(-0.25, Math.min(0.25, t[k] + d)) * 100) / 100; };
      if (action === 'trimAileronLeft') add('aileron', -step);
      else if (action === 'trimAileronRight') add('aileron', step);
      else if (action === 'trimElevatorUp') add('elevator', step);
      else if (action === 'trimElevatorDown') add('elevator', -step);
      else if (action === 'trimRudderLeft') add('rudder', -step);
      else if (action === 'trimRudderRight') add('rudder', step);
      else if (action === 'trimReset') { t.aileron = t.elevator = t.rudder = 0; }
      this.onAction('trimChanged', { ...t });
    }
    this.onAction(action, src);
  }

  /** Reinicia los interruptores y el acelerador (al empezar un vuelo). */
  resetSwitches() {
    this.flapStep = 0;
    this.out.flap = 0;
    this.out.gearDown = true;
    this.keyboard.values.throttle = 0;
    this.touch.syncThrottle(0);
    this.throttleSource = 'keyboard';
    this.gamepad.throttleActive = false;
  }

  update(dt) {
    const c = this.settings.controls;
    this.keyboard.update(dt);
    this.gamepad.update();
    this.touch.update();
    const k = this.keyboard.values, g = this.gamepad.values, t = this.touch.values;
    const gpOn = this.gamepad.active;
    // ratón: muelle hacia el centro
    if (this.mouse.locked) { this.mouse.x *= Math.exp(-0.8 * dt); this.mouse.y *= Math.exp(-0.8 * dt); }
    const m = this.mouse.locked ? this.mouse : { x: 0, y: 0 };
    let ail = k.aileron + (gpOn ? g.aileron : 0) + t.aileron + m.x;
    let ele = k.elevator + (gpOn ? g.elevator : 0) + t.elevator + m.y;
    let rud = k.rudder + (gpOn ? g.rudder : 0) + t.rudder;
    ail = clamp(ail, -1, 1); ele = clamp(ele, -1, 1); rud = clamp(rud, -1, 1);
    this.raw.aileron = ail; this.raw.elevator = ele; this.raw.rudder = rud;
    // recorridos, dual rate y exponenciales
    const dr = this.dualRateLow ? (c.lowRate ?? 0.6) : 1;
    this.out.aileron = expoCurve(ail, c.expo.aileron) * c.rates.aileron * dr;
    this.out.elevator = expoCurve(ele, c.expo.elevator) * c.rates.elevator * dr;
    this.out.rudder = expoCurve(rud, c.expo.rudder) * c.rates.rudder * dr;
    // acelerador: la última fuente que lo movió toma el control
    if (this.keyboard.throttleTouched) { this.throttleSource = 'keyboard'; this.keyboard.throttleTouched = false; }
    if (this.touch.throttleTouched) { this.throttleSource = 'touch'; this.touch.throttleTouched = false; }
    if (gpOn && this.gamepad.throttleActive) { this.throttleSource = 'gamepad'; this.gamepad.throttleActive = false; }
    let thr = this.out.throttle;
    if (this.throttleSource === 'keyboard') thr = k.throttle;
    else if (this.throttleSource === 'touch') thr = t.throttle;
    else if (this.throttleSource === 'gamepad') thr = g.throttle;
    this.out.throttle = clamp(thr, 0, 1);
    // mantener sincronizadas las demás fuentes para evitar saltos al cambiar
    if (this.throttleSource !== 'keyboard') k.throttle = this.out.throttle;
    if (this.throttleSource !== 'touch') this.touch.syncThrottle(this.out.throttle);
    // flaps / aerofrenos analógicos desde la emisora si están asignados
    if (gpOn && g.flap != null) this.out.flap = g.flap;
    this.out.airbrake = Math.max(k.airbrake, t.airbrake, gpOn && g.airbrake != null ? g.airbrake : 0);
    this.out.brake = Math.max(k.brake, t.brake);
    return this.out;
  }

  dispose() {
    this.keyboard.dispose();
    this.gamepad.dispose();
    this.touch.dispose();
    this.detachCanvas();
  }
}
