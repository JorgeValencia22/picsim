/**
 * Joysticks, gamepads y emisoras RC (Gamepad API). Cada función (alerón, profundidad, timón,
 * acelerador, flaps, aerofrenos) se asigna a un eje con inversión, centro, extremos y zona
 * muerta calibrables. Los botones generan acciones discretas.
 */
import { clamp } from '../utils/math3d.js';
import { detectTransmitter } from './RadioController.js';

export class GamepadControls {
  constructor(settingsRef, onAction) {
    this.settings = settingsRef; // settings.controls.gamepad (referencia viva)
    this.onAction = onAction;
    this.values = { aileron: 0, elevator: 0, rudder: 0, throttle: 0, flap: null, airbrake: null };
    this.connected = null;
    this.prevButtons = [];
    this.raw = [];
    this.lastThrottle = null;
    this.throttleActive = false;
    this.calibrating = null;
    this.supported = typeof navigator !== 'undefined' && 'getGamepads' in navigator;
    this.onConnect = (e) => {
      this.connected = e.gamepad.id;
      this.transmitter = detectTransmitter(e.gamepad);
      this.onAction('gamepadConnected', e.gamepad);
    };
    this.onDisconnect = () => {
      this.connected = null;
      this.reset();
      this.onAction('gamepadDisconnected');
    };
    if (this.supported) {
      window.addEventListener('gamepadconnected', this.onConnect);
      window.addEventListener('gamepaddisconnected', this.onDisconnect);
    }
  }

  reset() {
    Object.assign(this.values, { aileron: 0, elevator: 0, rudder: 0 });
    this.throttleActive = false;
  }

  pad() {
    if (!this.supported) return null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Normaliza un eje bruto con la calibración (bipolar −1..1 o unipolar 0..1). */
  static mapAxis(raw, cfg) {
    if (cfg.index < 0 || raw == null) return null;
    let v;
    if (cfg.unipolar) {
      v = (raw - cfg.min) / Math.max(1e-3, cfg.max - cfg.min);
      if (cfg.invert) v = 1 - v;
      v = clamp(v, 0, 1);
      if (v < cfg.deadzone) v = 0;
      return v;
    }
    const c = cfg.center ?? 0;
    v = raw >= c ? (raw - c) / Math.max(1e-3, (cfg.max ?? 1) - c) : (raw - c) / Math.max(1e-3, c - (cfg.min ?? -1));
    v = clamp(v, -1, 1);
    const dz = cfg.deadzone || 0;
    if (Math.abs(v) < dz) v = 0;
    else v = Math.sign(v) * (Math.abs(v) - dz) / (1 - dz);
    return cfg.invert ? -v : v;
  }

  update() {
    const p = this.pad();
    if (!p || !this.settings.enabled) { this.active = false; return; }
    this.active = true;
    this.raw = Array.from(p.axes);
    // calibración: registro de extremos
    if (this.calibrating) {
      for (let i = 0; i < this.raw.length; i++) {
        const c = this.calibrating[i] || (this.calibrating[i] = { min: this.raw[i], max: this.raw[i] });
        c.min = Math.min(c.min, this.raw[i]);
        c.max = Math.max(c.max, this.raw[i]);
      }
    }
    const axes = this.settings.axes;
    for (const fn of ['aileron', 'elevator', 'rudder']) {
      const v = GamepadControls.mapAxis(this.raw[axes[fn].index], axes[fn]);
      this.values[fn] = v ?? 0;
    }
    // acelerador absoluto: sólo toma el control cuando el eje se mueve
    const thr = GamepadControls.mapAxis(this.raw[axes.throttle.index], axes.throttle);
    if (thr != null) {
      if (this.lastThrottle != null && Math.abs(thr - this.lastThrottle) > 0.02) this.throttleActive = true;
      if (this.lastThrottle == null) this.lastThrottle = thr;
      if (Math.abs(thr - this.lastThrottle) > 0.02) this.lastThrottle = thr;
      this.values.throttle = thr;
    }
    this.values.flap = GamepadControls.mapAxis(this.raw[axes.flap.index], axes.flap);
    this.values.airbrake = GamepadControls.mapAxis(this.raw[axes.airbrake.index], axes.airbrake);
    // botones → acciones
    const btn = this.settings.buttons;
    p.buttons.forEach((b, i) => {
      const was = this.prevButtons[i];
      if (b.pressed && !was) {
        for (const [action, idx] of Object.entries(btn)) if (idx === i) this.onAction(action, `pad${i}`);
        this.onAction('padButton', i);
      }
      this.prevButtons[i] = b.pressed;
    });
  }

  /** Inicia/termina la captura de extremos para la calibración. */
  startCalibration() { this.calibrating = []; }

  finishCalibration() {
    const cal = this.calibrating;
    this.calibrating = null;
    if (!cal) return;
    for (const cfg of Object.values(this.settings.axes)) {
      const c = cal[cfg.index];
      if (!c || c.max - c.min < 0.2) continue;
      cfg.min = c.min;
      cfg.max = c.max;
    }
  }

  /** Toma la posición actual de los sticks como centro. */
  captureCenters() {
    for (const [fn, cfg] of Object.entries(this.settings.axes)) {
      if (cfg.unipolar || cfg.index < 0) continue;
      const v = this.raw[cfg.index];
      if (v != null) cfg.center = v;
      void fn;
    }
  }

  dispose() {
    if (!this.supported) return;
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
  }
}
