/**
 * Teclado con respuesta analógica simulada: las órdenes de alerón, profundidad y timón se
 * desplazan hacia el objetivo con una velocidad configurable y regresan al centro al soltar.
 * El acelerador se mantiene (incremental), como el stick sin muelle de una emisora.
 */
import { moveTowards, clamp } from '../utils/math3d.js';

export class KeyboardControls {
  constructor(settingsRef, onAction) {
    this.settings = settingsRef; // settings.controls.keyboard (referencia viva)
    this.onAction = onAction;
    this.down = new Set();
    this.values = { aileron: 0, elevator: 0, rudder: 0, throttle: 0, airbrake: 0, brake: 0 };
    this.throttleTouched = false;
    this.enabled = true;
    this.captureNext = null; // para reasignar teclas desde la configuración
    this.keydown = (e) => this.onKey(e, true);
    this.keyup = (e) => this.onKey(e, false);
    this.blur = () => this.releaseAll();
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.blur);
  }

  /** Acción asignada a un código de tecla. */
  actionFor(code) {
    const b = this.settings.bindings;
    for (const [action, keys] of Object.entries(b)) if (keys.includes(code)) return action;
    return null;
  }

  isDown(action) {
    const keys = this.settings.bindings[action] || [];
    return keys.some((k) => k && this.down.has(k));
  }

  onKey(e, isDown) {
    if (this.captureNext && isDown) {
      e.preventDefault();
      const cb = this.captureNext;
      this.captureNext = null;
      cb(e.code);
      return;
    }
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const action = this.actionFor(e.code);
    const repeatable = action && action.startsWith('trim') && action !== 'trimReset';
    if (isDown) {
      // los trims se repiten al mantener la tecla (como los botones de trim de una emisora)
      if (this.down.has(e.code) && !repeatable) { if (action) e.preventDefault(); return; }
      this.down.add(e.code);
    } else this.down.delete(e.code);
    if (!action || !this.enabled) return;
    e.preventDefault();
    // acciones discretas al pulsar
    if (isDown && ['flaps', 'gear', 'launch', 'camera', 'reset', 'pause', 'hud', 'menu', 'instruments', 'zoomIn', 'zoomOut', 'cameraTrack', 'dualRate', 'trimAileronLeft', 'trimAileronRight', 'trimElevatorUp', 'trimElevatorDown', 'trimRudderLeft', 'trimRudderRight', 'trimReset'].includes(action)) {
      this.onAction(action, e.code);
    }
  }

  releaseAll() {
    this.down.clear();
  }

  update(dt) {
    const s = this.settings;
    const v = this.values;
    const axis = (pos, neg, key) => {
      const target = (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
      const rate = target === 0 ? s.returnRate : (Math.sign(target) !== Math.sign(v[key]) && v[key] !== 0 ? s.returnRate + s.analogRate : s.analogRate);
      v[key] = moveTowards(v[key], target, rate * dt);
    };
    axis('aileronRight', 'aileronLeft', 'aileron');
    axis('elevatorUp', 'elevatorDown', 'elevator');
    axis('rudderRight', 'rudderLeft', 'rudder');
    const up = this.isDown('throttleUp'), dn = this.isDown('throttleDown');
    if (up || dn) {
      v.throttle = clamp(v.throttle + ((up ? 1 : 0) - (dn ? 1 : 0)) * s.throttleRate * dt, 0, 1);
      this.throttleTouched = true;
    }
    v.airbrake = moveTowards(v.airbrake, this.isDown('airbrake') ? 1 : 0, 2.5 * dt);
    v.brake = this.isDown('brake') ? 1 : 0;
  }

  /** Captura la próxima tecla pulsada (reasignación). */
  capture(cb) { this.captureNext = cb; }

  dispose() {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.blur);
  }
}
