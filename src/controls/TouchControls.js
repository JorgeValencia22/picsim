/**
 * Controles táctiles: dos sticks virtuales analógicos multitáctiles (modos de emisora 1–4),
 * botones de función, gestos de cámara (arrastre y pellizco) y modo de edición de la
 * distribución (posición y tamaño). Se liberan todos los toques al perder el foco.
 */
import { clamp } from '../utils/math3d.js';
import { L } from '../core/i18n.js';

/** Canales asignados a cada stick según el modo. */
export const MODE_MAP = {
  1: { left: { x: 'rudder', y: 'elevator' }, right: { x: 'aileron', y: 'throttle' } },
  2: { left: { x: 'rudder', y: 'throttle' }, right: { x: 'aileron', y: 'elevator' } },
  3: { left: { x: 'aileron', y: 'elevator' }, right: { x: 'rudder', y: 'throttle' } },
  4: { left: { x: 'aileron', y: 'throttle' }, right: { x: 'rudder', y: 'elevator' } },
};

const ICONS = {
  camera: '<svg viewBox="0 0 24 24"><path d="M4 7h3l2-2h6l2 2h3v12H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2-5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 4v4h4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  flaps: '<svg viewBox="0 0 24 24"><path d="M3 10h12l3 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4v8" stroke="currentColor" stroke-width="2"/></svg>',
  launch: '<svg viewBox="0 0 24 24"><path d="M4 18L20 6M14 6h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  brake: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5" stroke="currentColor" stroke-width="2"/></svg>',
  airbrake: '<svg viewBox="0 0 24 24"><path d="M3 15h18M9 15l3-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  instruments: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12l4-3" stroke="currentColor" stroke-width="2"/></svg>',
  dualRate: '<svg viewBox="0 0 24 24"><text x="12" y="16" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor" font-family="sans-serif">D/R</text></svg>',
  hud: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2"/></svg>',
};

export class TouchControls {
  constructor(root, settingsRef, modeRef, onAction, camera) {
    this.root = root;
    this.s = settingsRef; // settings.controls.touch
    this.modeRef = modeRef; // () => modo actual
    this.onAction = onAction;
    this.camera = camera; // CameraManager (gestos)
    this.values = { aileron: 0, elevator: 0, rudder: 0, throttle: 0, airbrake: 0, brake: 0 };
    this.stickState = { left: { x: 0, y: -1, id: null }, right: { x: 0, y: 0, id: null } };
    this.camPointers = new Map();
    this.throttleTouched = false;
    this.editing = false;
    this.caps = {};
    this.build();
    this.applyLayout();
    this.blur = () => this.releaseAll();
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.blur);
  }

  static isTouchDevice() {
    return (typeof window !== 'undefined') && (('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches);
  }

  build() {
    const el = document.createElement('div');
    el.className = 'touch-layer';
    el.innerHTML = `
      <div class="tstick left" data-stick="left"><div class="tstick-base"><span class="tlabel tl-y"></span><span class="tlabel tl-x"></span><div class="tstick-knob"></div></div></div>
      <div class="tstick right" data-stick="right"><div class="tstick-base"><span class="tlabel tl-y"></span><span class="tlabel tl-x"></span><div class="tstick-knob"></div></div></div>
      <div class="ttrims left" data-side="left"></div>
      <div class="ttrims right" data-side="right"></div>
      <div class="tbtns top"></div>
      <div class="tbtns side"></div>
      <div class="tedit-bar hidden"><span>${L('Arrastra los sticks para moverlos', 'Drag the sticks to move them')}</span><button class="btn small" data-act="editDone">${L('Listo', 'Done')}</button></div>`;
    this.root.appendChild(el);
    this.el = el;
    this.sticks = { left: el.querySelector('.tstick.left'), right: el.querySelector('.tstick.right') };
    const topBtns = [['pause', L('Pausa', 'Pause')], ['camera', L('Cámara', 'Camera')], ['reset', L('Reiniciar', 'Reset')], ['dualRate', 'D/R'], ['hud', 'HUD'], ['instruments', L('Instrumentos', 'Instruments')]];
    const sideBtns = [['launch', L('Lanzar', 'Launch')], ['flaps', 'Flaps'], ['gear', L('Tren', 'Gear')], ['airbrake', L('Frenos aire', 'Airbrake')], ['brake', L('Freno', 'Brake')]];
    const mk = (parent, [id, label]) => {
      const b = document.createElement('button');
      b.className = 'tbtn';
      b.dataset.act = id;
      b.innerHTML = `${ICONS[id] || ''}<span>${label}</span>`;
      b.setAttribute('aria-label', label);
      parent.appendChild(b);
      return b;
    };
    this.buttons = {};
    for (const d of topBtns) this.buttons[d[0]] = mk(el.querySelector('.tbtns.top'), d);
    for (const d of sideBtns) this.buttons[d[0]] = mk(el.querySelector('.tbtns.side'), d);

    this.trimEls = { left: el.querySelector('.ttrims.left'), right: el.querySelector('.ttrims.right') };
    window.addEventListener('resize', () => this.applyLayout());
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('lostpointercapture', (e) => this.onUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Aplica tamaño, opacidad, posición y etiquetas según la configuración y el modo. */
  applyLayout() {
    const s = this.s;
    // estilo PicaSim: paneles cuadrados grandes proporcionales a la pantalla; estilo clásico: círculos
    this.picasim = (s.style || 'picasim') === 'picasim';
    const base = this.picasim ? Math.min(window.innerHeight * 0.46, window.innerWidth * 0.26, 240) : 150;
    const size = Math.round(base * (s.size || 1));
    this.stickSize = size;
    this.el.classList.toggle('picasim', this.picasim);
    this.el.style.setProperty('--stick-size', `${size}px`);
    this.el.style.setProperty('--touch-opacity', s.opacity ?? 0.65);
    for (const side of ['left', 'right']) {
      const st = this.sticks[side];
      st.style.left = `${(s[side]?.x ?? (side === 'left' ? 0.16 : 0.84)) * 100}%`;
      // el panel y sus trims deben caber completos en pantalla (también en móviles bajos)
      let y = s[side]?.y ?? 0.72;
      const half = (size / 2 + (s.showTrims === false ? 8 : 32)) / Math.max(1, window.innerHeight);
      y = Math.min(y, 1 - half);
      st.style.top = `${y * 100}%`;
      const map = MODE_MAP[this.modeRef()] || MODE_MAP[2];
      const names = { aileron: L('Alerones', 'Ailerons'), elevator: L('Profundidad', 'Elevator'), rudder: L('Timón', 'Rudder'), throttle: L('Motor', 'Throttle') };
      st.querySelector('.tl-y').textContent = names[map[side].y];
      st.querySelector('.tl-x').textContent = names[map[side].x];
      this.buildTrims(side, map[side]);
    }
    this.updateKnobs();
  }

  /** Botones de trim alrededor de cada stick (como los trims digitales de una emisora). */
  buildTrims(side, chans) {
    const box = this.trimEls?.[side];
    if (!box) return;
    box.replaceChildren();
    box.classList.toggle('hidden', this.s.showTrims === false);
    const st = this.sticks[side];
    box.style.left = st.style.left;
    box.style.top = st.style.top;
    const add = (cls, act, label) => {
      if (!act) return;
      const b = document.createElement('button');
      b.className = `ttrim ${cls}`;
      b.dataset.act = act;
      b.textContent = label;
      b.setAttribute('aria-label', act);
      box.appendChild(b);
    };
    const yTrim = { elevator: ['trimElevatorDown', 'trimElevatorUp'] }[chans.y];
    const xTrim = { aileron: ['trimAileronLeft', 'trimAileronRight'], rudder: ['trimRudderLeft', 'trimRudderRight'] }[chans.x];
    if (yTrim) { add('up', yTrim[0], '▲'); add('down', yTrim[1], '▼'); }
    if (xTrim) { add('left', xTrim[0], '◀'); add('right', xTrim[1], '▶'); }
  }

  setVisible(v) {
    this.visible = v;
    this.el.classList.toggle('hidden', !v);
    if (!v) this.releaseAll();
  }

  /** Muestra sólo los botones pertinentes para la aeronave actual. */
  setCaps(caps) {
    this.caps = caps;
    const show = (id, v) => this.buttons[id]?.classList.toggle('hidden', !v);
    show('flaps', caps.flaps);
    show('gear', caps.gear);
    show('airbrake', caps.airbrake);
    show('brake', caps.brake);
    show('launch', caps.launch);
  }

  isThrottleStick(side) {
    const map = MODE_MAP[this.modeRef()] || MODE_MAP[2];
    return map[side].y === 'throttle';
  }

  onDown(e) {
    const btn = e.target.closest('.tbtn, .ttrim, [data-act="editDone"]');
    if (btn) {
      e.preventDefault();
      const act = btn.dataset.act;
      if (act === 'editDone') { this.setEditing(false); return; }
      if (act === 'brake' || act === 'airbrake') { this.values[act] = 1; btn.classList.add('on'); this.capture(btn, e.pointerId); btn.dataset.pid = e.pointerId; }
      else this.onAction(act === 'flaps' ? 'flaps' : act, 'touch');
      if (this.s.haptics && navigator.vibrate) navigator.vibrate(12);
      return;
    }
    const stickEl = e.target.closest('.tstick');
    const side = stickEl ? stickEl.dataset.stick : this.zoneSide(e);
    const inZone = this.picasim && e.clientY > window.innerHeight * 0.2;
    if (side && !this.stickState[side].id && (stickEl || inZone || this.nearStick(side, e))) {
      e.preventDefault();
      this.capture(this.el, e.pointerId);
      const st = this.stickState[side];
      st.id = e.pointerId;
      if (this.editing) {
        st.editOffset = this.stickCenter(side);
        st.editStart = { x: e.clientX, y: e.clientY };
        return;
      }
      st.origin = this.stickCenter(side);
      // el eje del acelerador es relativo al toque (no salta al apoyar el dedo)
      st.thrStart = { y: e.clientY, v: st.y };
      this.moveStick(side, e);
      return;
    }
    // resto de la pantalla: gestos de cámara
    this.camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.capture(this.el, e.pointerId);
  }

  /** Captura del puntero tolerante a fallos (puntero ya liberado o navegador sin soporte). */
  capture(el, id) {
    try { el.setPointerCapture(id); } catch { /* el seguimiento continúa por eventos del contenedor */ }
  }

  zoneSide(e) {
    return e.clientX < window.innerWidth / 2 ? 'left' : 'right';
  }

  nearStick(side, e) {
    const c = this.stickCenter(side);
    const R = this.stickSize || 150;
    return Math.hypot(e.clientX - c.x, e.clientY - c.y) < R * 0.9;
  }

  stickCenter(side) {
    const r = this.sticks[side].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  moveStick(side, e) {
    const st = this.stickState[side];
    const R = (this.stickSize || 150) / 2;
    const dx = (e.clientX - st.origin.x) / R;
    const dy = (e.clientY - st.origin.y) / R;
    st.x = clamp(dx, -1, 1);
    if (this.isThrottleStick(side) && st.thrStart) {
      st.y = clamp(st.thrStart.v - (e.clientY - st.thrStart.y) / R, -1, 1);
      this.throttleTouched = true;
    } else st.y = clamp(-dy, -1, 1);
    this.updateKnobs();
  }

  onMove(e) {
    for (const side of ['left', 'right']) {
      const st = this.stickState[side];
      if (st.id !== e.pointerId) continue;
      if (this.editing) {
        const nx = (st.editOffset.x + (e.clientX - st.editStart.x)) / window.innerWidth;
        const ny = (st.editOffset.y + (e.clientY - st.editStart.y)) / window.innerHeight;
        this.s[side] = { x: clamp(nx, 0.08, 0.92), y: clamp(ny, 0.2, 0.92) };
        this.applyLayout();
      } else this.moveStick(side, e);
      return;
    }
    if (this.camPointers.has(e.pointerId)) {
      const prev = this.camPointers.get(e.pointerId);
      const pts = [...this.camPointers.values()];
      if (this.camPointers.size === 2) {
        const other = pts.find((p) => p !== prev);
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (d0 > 10) this.camera?.zoomBy(d1 / d0);
      } else this.camera?.drag(e.clientX - prev.x, e.clientY - prev.y);
      this.camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  onUp(e) {
    for (const side of ['left', 'right']) {
      const st = this.stickState[side];
      if (st.id !== e.pointerId) continue;
      st.id = null;
      if (this.editing) return;
      // retorno al centro configurable (el eje del acelerador no se centra salvo que se pida)
      if (this.s.sticksSelfCenter !== false) st.x = 0;
      if (this.isThrottleStick(side)) { if (this.s.throttleSelfCenter) st.y = 0; }
      else if (this.s.sticksSelfCenter !== false) st.y = 0;
      this.updateKnobs();
    }
    for (const b of this.el.querySelectorAll('.tbtn.on')) {
      if (Number(b.dataset.pid) === e.pointerId) { this.values[b.dataset.act] = 0; b.classList.remove('on'); }
    }
    this.camPointers.delete(e.pointerId);
  }

  releaseAll() {
    for (const side of ['left', 'right']) {
      const st = this.stickState[side];
      st.id = null;
      st.x = 0;
      if (!this.isThrottleStick(side)) st.y = 0;
    }
    this.values.brake = this.values.airbrake = 0;
    for (const b of this.el.querySelectorAll('.tbtn.on')) b.classList.remove('on');
    this.camPointers.clear();
    this.updateKnobs();
  }

  updateKnobs() {
    for (const side of ['left', 'right']) {
      const st = this.stickState[side];
      const k = this.sticks[side].querySelector('.tstick-knob');
      // el knob mide la mitad de la base: desplazarlo un 100% de su tamaño lo lleva al borde
      // recorrido del knob hasta el borde: 100 % de su tamaño (círculo, knob = ½ base) o 117 % (cuadrado, knob = 0,3 base)
      const travel = this.picasim ? 117 : 100;
      k.style.transform = `translate(-50%, -50%) translate(${st.x * travel}%, ${-st.y * travel}%)`;
    }
  }

  setEditing(v) {
    this.editing = v;
    this.el.classList.toggle('editing', v);
    this.el.querySelector('.tedit-bar').classList.toggle('hidden', !v);
    if (!v) this.onAction('touchLayoutSaved');
  }

  /** Mantiene el acelerador visual sincronizado cuando otra fuente lo cambia. */
  syncThrottle(thr) {
    for (const side of ['left', 'right']) {
      if (this.isThrottleStick(side) && this.stickState[side].id == null) this.stickState[side].y = thr * 2 - 1;
    }
    this.updateKnobs();
  }

  update() {
    const map = MODE_MAP[this.modeRef()] || MODE_MAP[2];
    const v = this.values;
    v.aileron = v.rudder = v.elevator = 0;
    for (const side of ['left', 'right']) {
      const st = this.stickState[side];
      for (const axis of ['x', 'y']) {
        const ch = map[side][axis];
        const val = st[axis];
        if (ch === 'throttle') v.throttle = clamp((val + 1) / 2, 0, 1);
        else if (ch === 'elevator') v.elevator = -val; // stick hacia abajo = tirar = morro arriba
        else v[ch] = val;
      }
    }
  }

  dispose() {
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.blur);
    this.el.remove();
  }
}
