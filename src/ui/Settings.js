/**
 * Configuración: gráficos, controles (teclado, ratón, joystick/emisora con calibración en vivo,
 * táctil), física, audio, interfaz, cámara y datos. Todo se guarda al instante.
 */
import { h, icon, field, select, range, toggle, segmented } from './dom.js';
import { Screen } from './UIManager.js';
import { L, T } from '../core/i18n.js';
import { GRAPHICS_PRESETS, ACTION_LABELS, defaultSettings, AXIS_FUNCTIONS } from '../data/settings.js';
import { transmitterAxisMap, gamepadAxisMapForMode } from '../controls/RadioController.js';
import { GamepadControls } from '../controls/GamepadControls.js';

const pct = (v) => `${Math.round(v * 100)}%`;

export class SettingsScreen extends Screen {
  constructor(app, opts = {}) {
    super(app);
    this.cat = opts.cat || 'graphics';
    this.monitorRaf = null;
  }

  onShow() { this.startMonitor(); }
  onHide() { this.stopMonitor(); }
  destroy() { this.stopMonitor(); }

  build() {
    const cats = [
      ['graphics', L('Gráficos', 'Graphics'), 'eye'], ['controls', L('Controles', 'Controls'), 'gamepad'], ['physics', L('Física', 'Physics'), 'physics'],
      ['audio', 'Audio', 'sound'], ['ui', L('Interfaz', 'Interface'), 'settings'], ['camera', L('Cámara', 'Camera'), 'camera'], ['data', L('Datos', 'Data'), 'data'],
    ];
    this.body = h('div', { class: 'settings-body' }, this.catBody());
    return h('div', { class: 'screen dim' },
      this.head(L('Configuración', 'Settings'), L('Los cambios se guardan automáticamente', 'Changes are saved automatically')),
      h('div', { class: 'settings-grid' },
        h('div', { class: 'panel cat-list', role: 'tablist' }, cats.map(([id, label, ic]) => h('button', {
          class: this.cat === id ? 'on' : '', role: 'tab',
          onClick: (e) => { this.cat = id; for (const b of e.currentTarget.parentNode.children) b.classList.remove('on'); e.currentTarget.classList.add('on'); this.body.replaceChildren(this.catBody()); this.startMonitor(); },
        }, h('span', { html: icon(ic) }).firstChild, label))),
        h('div', { class: 'panel', style: { minHeight: 0, display: 'flex' } }, this.body)));
  }

  catBody() {
    switch (this.cat) {
      case 'controls': return this.controls();
      case 'physics': return this.physics();
      case 'audio': return this.audio();
      case 'ui': return this.interface();
      case 'camera': return this.camera();
      case 'data': return this.data();
      default: return this.graphics();
    }
  }

  save(section) { this.app.saveSettings(section); }

  /* ─────────── gráficos ─────────── */
  graphics() {
    const a = this.app, g = a.settings.graphics;
    const apply = (rebuild = false) => { a.applyGraphics(rebuild); };
    const set = (k, rebuild = false) => (v) => { g[k] = v; g.preset = 'custom'; this.save('graphics'); apply(rebuild); };
    const wrap = h('div', {});
    const draw = () => wrap.replaceChildren(
      h('div', { class: 'section-title' }, L('Perfil gráfico', 'Graphics profile')),
      field(L('Calidad', 'Quality'), segmented([...Object.entries(GRAPHICS_PRESETS).map(([k, v]) => ({ value: k, label: T(v.label) })), ...(g.preset === 'custom' ? [{ value: 'custom', label: L('Personal', 'Custom') }] : [])], g.preset, (v) => {
        if (v === 'custom') return;
        Object.assign(g, structuredClone(GRAPHICS_PRESETS[v]), { preset: v });
        delete g.label;
        this.save('graphics');
        apply(true);
        draw();
      }), L('Muy bajo para móviles modestos; Ultra para equipos potentes', 'Very low for modest phones; Ultra for powerful PCs')),
      h('div', { class: 'section-title' }, L('Renderizado', 'Rendering')),
      field(L('Resolución de renderizado', 'Render resolution'), range(0.5, 1.5, 0.05, g.resolutionScale, set('resolutionScale'), pct)),
      field(L('Resolución dinámica', 'Dynamic resolution'), toggle(g.dynamicResolution, set('dynamicResolution')), L('Baja la resolución si no se alcanzan los FPS objetivo', 'Lowers resolution when the target FPS is not reached')),
      field(L('FPS objetivo', 'Target FPS'), segmented([{ value: 30, label: '30' }, { value: 60, label: '60' }, { value: 0, label: L('Sin límite', 'Unlimited') }], g.targetFps, (v) => set('targetFps')(Number(v)))),
      field(L('Sombras', 'Shadows'), segmented([{ value: 'off', label: L('No', 'Off') }, { value: 'low', label: L('Bajas', 'Low') }, { value: 'medium', label: L('Medias', 'Medium') }, { value: 'high', label: L('Altas', 'High') }, { value: 'ultra', label: 'Ultra' }], g.shadows, set('shadows', true))),
      field(L('Antialiasing', 'Antialiasing'), toggle(g.antialias, set('antialias')), L('Recrea el contexto gráfico', 'Recreates the graphics context')),
      field(L('Distancia de dibujado', 'Draw distance'), range(1000, 6000, 100, g.drawDistance, set('drawDistance'), (v) => `${(v / 1000).toFixed(1)} km`)),
      field(L('Detalle del terreno', 'Terrain detail'), segmented([{ value: 0, label: L('Bajo', 'Low') }, { value: 1, label: L('Medio', 'Medium') }, { value: 2, label: L('Alto', 'High') }], g.terrainDetail, (v) => set('terrainDetail', true)(Number(v)))),
      field(L('Densidad de vegetación', 'Vegetation density'), range(0.1, 1, 0.05, g.vegetation, set('vegetation', true), pct), L('Sólo reduce árboles lejanos', 'Only thins distant trees')),
      field(L('Calidad de texturas', 'Texture quality'), segmented([{ value: 0.5, label: L('Baja', 'Low') }, { value: 1, label: L('Media', 'Medium') }, { value: 1.5, label: L('Alta', 'High') }, { value: 2, label: 'Ultra' }], g.textureQuality, (v) => set('textureQuality', true)(Number(v)))),
      field(L('Efectos ambientales', 'Ambient effects'), range(0.3, 1.6, 0.1, g.effects, set('effects'), pct), L('Partículas, lluvia y aves', 'Particles, rain and birds')),
      field(L('Nubes', 'Clouds'), range(0, 1.2, 0.1, g.clouds, set('clouds'), pct)),
      field(L('Reflejos del entorno', 'Environment reflections'), toggle(g.envMap, set('envMap'))),
      field(L('Mostrar FPS y rendimiento', 'Show FPS and performance'), toggle(g.showFps, (v) => { g.showFps = v; this.save('graphics'); })));
    draw();
    return wrap;
  }

  /* ─────────── controles ─────────── */
  controls() {
    const a = this.app, c = a.settings.controls;
    const sv = () => this.save('controls');
    const kb = c.keyboard;
    const bindRows = Object.keys(ACTION_LABELS).map((action) => {
      const keys = kb.bindings[action] || ['', ''];
      const btn = (slot) => {
        const b = h('button', { class: 'keybind', 'aria-label': `${T(ACTION_LABELS[action])} ${slot + 1}` }, keys[slot] || '—');
        b.addEventListener('click', () => {
          b.classList.add('capturing');
          b.textContent = L('Pulsa…', 'Press…');
          a.input.keyboard.capture((code) => {
            b.classList.remove('capturing');
            if (code === 'Escape') code = '';
            // evita duplicados
            for (const k of Object.keys(kb.bindings)) kb.bindings[k] = kb.bindings[k].map((x) => (x === code && code ? '' : x));
            kb.bindings[action] = [...(kb.bindings[action] || ['', ''])];
            kb.bindings[action][slot] = code;
            sv();
            this.body.replaceChildren(this.controls());
          });
        });
        return b;
      };
      return field(T(ACTION_LABELS[action]), h('div', { style: { display: 'flex', gap: '6px' } }, btn(0), btn(1)));
    });

    const pad = a.input.gamepad.pad();
    const gp = c.gamepad;
    const tx = pad ? a.input.gamepad.transmitter : null;
    const axisOpts = [{ value: -1, label: L('Ninguno', 'None') }, ...Array.from({ length: Math.max(8, pad?.axes.length || 0) }, (_, i) => ({ value: i, label: `${L('Eje', 'Axis')} ${i}` }))];
    const fnNames = { aileron: L('Alerones', 'Ailerons'), elevator: L('Profundidad', 'Elevator'), rudder: L('Timón', 'Rudder'), throttle: L('Acelerador', 'Throttle'), flap: 'Flaps', airbrake: L('Aerofrenos', 'Airbrakes') };
    const axisRows = AXIS_FUNCTIONS.map((fn) => {
      const cfg = gp.axes[fn];
      return field(fnNames[fn], h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        h('div', { style: { width: '110px' } }, select(axisOpts, cfg.index, (v) => { cfg.index = Number(v); sv(); })),
        h('span', { style: { fontSize: '.8em', color: 'var(--muted)' } }, L('Inv.', 'Inv.')), toggle(cfg.invert, (v) => { cfg.invert = v; sv(); }),
        h('div', { style: { width: '120px', display: 'flex', alignItems: 'center', gap: '6px' } }, ...range(0, 0.3, 0.01, cfg.deadzone, (v) => { cfg.deadzone = v; sv(); }, (v) => `${Math.round(v * 100)}%`))),
        L('Zona muerta a la derecha', 'Deadzone on the right'));
    });
    const btnNames = { camera: L('Cámara', 'Camera'), reset: L('Reiniciar', 'Reset'), launch: L('Lanzar', 'Launch'), flaps: 'Flaps', pause: L('Pausa', 'Pause'), gear: L('Tren', 'Gear') };
    const buttonRows = Object.keys(btnNames).map((act) => {
      const b = h('button', { class: 'keybind' }, gp.buttons[act] != null && gp.buttons[act] >= 0 ? `B${gp.buttons[act]}` : '—');
      b.addEventListener('click', () => {
        b.classList.add('capturing');
        b.textContent = L('Pulsa un botón…', 'Press a button…');
        const off = a.bus.on('padButton', (i) => { off(); gp.buttons[act] = i; sv(); b.classList.remove('capturing'); b.textContent = `B${i}`; });
        setTimeout(() => { if (b.classList.contains('capturing')) { off(); b.classList.remove('capturing'); b.textContent = gp.buttons[act] >= 0 ? `B${gp.buttons[act]}` : '—'; } }, 6000);
      });
      return field(btnNames[act], b);
    });
    this.monitorEl = h('div', { class: 'axis-monitor' });
    let calibrating = false;
    const calBtn = h('button', { class: 'btn small' }, L('Calibrar extremos', 'Calibrate range'));
    calBtn.addEventListener('click', () => {
      if (!calibrating) { a.input.gamepad.startCalibration(); calibrating = true; calBtn.textContent = L('Terminar calibración', 'Finish calibration'); a.ui.toast(L('Mueve todos los sticks hasta sus extremos', 'Move every stick to its limits'), 'info', 4000); }
      else { a.input.gamepad.finishCalibration(); calibrating = false; calBtn.textContent = L('Calibrar extremos', 'Calibrate range'); sv(); a.ui.toast(L('Calibración guardada', 'Calibration saved'), 'ok'); }
    });
    const t = c.touch;
    return h('div', {},
      h('div', { class: 'section-title' }, L('Emisora virtual', 'Virtual transmitter')),
      field(L('Modo de emisora', 'Transmitter mode'), segmented([1, 2, 3, 4].map((m) => ({ value: m, label: `Mode ${m}` })), c.mode, (v) => { c.mode = Number(v); a.input.touch.applyLayout(); sv(); }),
        L('Mode 1: profundidad izq. / motor der. · Mode 2: motor izq. / profundidad der.', 'Mode 1: elevator left / throttle right · Mode 2: throttle left / elevator right')),
      ...['aileron', 'elevator', 'rudder'].map((ch) => field(`${L('Recorrido', 'Rate')} · ${fnNames[ch]}`, range(0.3, 1, 0.05, c.rates[ch], (v) => { c.rates[ch] = v; sv(); }, pct))),
      ...['aileron', 'elevator', 'rudder'].map((ch) => field(`${L('Exponencial', 'Expo')} · ${fnNames[ch]}`, range(0, 0.8, 0.05, c.expo[ch], (v) => { c.expo[ch] = v; sv(); }, pct), L('Suaviza el centro del stick', 'Softens the stick centre'))),
      field(L('Dual rate «bajo»', 'Low dual rate'), range(0.3, 0.9, 0.05, c.lowRate ?? 0.6, (v) => { c.lowRate = v; sv(); }, pct), L('Recorrido con el interruptor en bajo (tecla Y o botón D/R)', 'Throw with the switch on low (Y key or D/R button)')),
      field(L('Mezcla alerón → timón', 'Aileron → rudder mix'), range(0, 0.6, 0.05, c.mixAileronRudder, (v) => { c.mixAileronRudder = v; sv(); }, pct), L('Coordina los virajes automáticamente', 'Coordinates turns automatically')),

      h('div', { class: 'section-title' }, L('Teclado', 'Keyboard')),
      field(L('Velocidad de desplazamiento analógico', 'Analog travel speed'), range(1, 8, 0.2, kb.analogRate, (v) => { kb.analogRate = v; sv(); }, (v) => `${v.toFixed(1)}/s`)),
      field(L('Velocidad de retorno al centro', 'Return-to-centre speed'), range(1, 12, 0.5, kb.returnRate, (v) => { kb.returnRate = v; sv(); }, (v) => `${v.toFixed(1)}/s`)),
      field(L('Velocidad del acelerador', 'Throttle speed'), range(0.2, 1.5, 0.05, kb.throttleRate, (v) => { kb.throttleRate = v; sv(); }, (v) => `${Math.round(v * 100)}%/s`)),
      ...bindRows,
      h('div', { style: { margin: '8px 0' } }, h('button', { class: 'btn small ghost', onClick: () => { kb.bindings = structuredClone(defaultSettings().controls.keyboard.bindings); a.input.keyboard.settings = kb; sv(); this.body.replaceChildren(this.controls()); } }, L('Restablecer teclas', 'Reset keys'))),

      h('div', { class: 'section-title' }, L('Ratón', 'Mouse')),
      field(L('Vuelo con ratón', 'Mouse flight'), toggle(c.mouse.flight, (v) => { c.mouse.flight = v; sv(); }), L('Clic en la escena para capturar el puntero; Esc para soltarlo. Arrastrar mueve la cámara cuando está desactivado.', 'Click the scene to capture the pointer; Esc to release. Dragging moves the camera when disabled.')),
      field(L('Sensibilidad', 'Sensitivity'), range(0.3, 3, 0.1, c.mouse.sensitivity, (v) => { c.mouse.sensitivity = v; sv(); }, (v) => v.toFixed(1))),
      field(L('Invertir eje vertical', 'Invert vertical axis'), toggle(c.mouse.invertY, (v) => { c.mouse.invertY = v; sv(); })),

      h('div', { class: 'section-title' }, L('Joystick, gamepad y emisora RC (USB)', 'Joystick, gamepad and RC radio (USB)')),
      field(L('Activar', 'Enable'), toggle(gp.enabled, (v) => { gp.enabled = v; sv(); }), pad ? `${L('Detectado', 'Detected')}: ${pad.id.slice(0, 48)}${tx ? ` · ${tx.brand}` : ''}` : L('Conecta el dispositivo y pulsa cualquier botón', 'Connect the device and press any button')),
      field(L('Asignación rápida', 'Quick mapping'), h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        h('button', { class: 'btn small', onClick: () => { gp.axes = gamepadAxisMapForMode(c.mode); sv(); this.body.replaceChildren(this.controls()); } }, L(`Mando (Mode ${c.mode})`, `Gamepad (Mode ${c.mode})`)),
        h('button', { class: 'btn small', onClick: () => { gp.axes = transmitterAxisMap('AETR'); sv(); this.body.replaceChildren(this.controls()); } }, L('Emisora AETR', 'Radio AETR')),
        h('button', { class: 'btn small', onClick: () => { gp.axes = transmitterAxisMap('TAER'); sv(); this.body.replaceChildren(this.controls()); } }, L('Emisora TAER', 'Radio TAER')))),
      ...axisRows,
      h('div', { class: 'section-title' }, L('Calibración y monitor de ejes', 'Calibration and axis monitor')),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '6px 0 10px' } }, calBtn,
        h('button', { class: 'btn small', onClick: () => { a.input.gamepad.captureCenters(); sv(); a.ui.toast(L('Centros fijados', 'Centres captured'), 'ok'); } }, L('Fijar centros', 'Capture centres'))),
      this.monitorEl,
      h('div', { class: 'section-title' }, L('Botones del mando', 'Controller buttons')),
      ...buttonRows,

      h('div', { class: 'section-title' }, L('Controles táctiles', 'Touch controls')),
      field(L('Mostrar', 'Show'), segmented([{ value: 'auto', label: L('Automático', 'Auto') }, { value: 'on', label: L('Siempre', 'Always') }, { value: 'off', label: L('Nunca', 'Never') }], t.enabled, (v) => { t.enabled = v; sv(); a.input.updateTouchVisibility(); })),
      field(L('Estilo de sticks', 'Stick style'), segmented([{ value: 'picasim', label: L('Paneles cuadrados', 'Square pads') }, { value: 'round', label: L('Circulares', 'Round') }], t.style || 'picasim', (v) => { t.style = v; a.input.touch.applyLayout(); sv(); }), L('Paneles grandes tipo cardán de emisora; se controlan desde toda la mitad de la pantalla', 'Large transmitter-gimbal pads; control from anywhere on each half of the screen')),
      field(L('Botones de trim', 'Trim buttons'), toggle(t.showTrims !== false, (v) => { t.showTrims = v; a.input.touch.applyLayout(); sv(); })),
      field(L('Tamaño de los sticks', 'Stick size'), range(0.6, 1.6, 0.05, t.size, (v) => { t.size = v; a.input.touch.applyLayout(); sv(); }, pct)),
      field(L('Opacidad', 'Opacity'), range(0.2, 1, 0.05, t.opacity, (v) => { t.opacity = v; a.input.touch.applyLayout(); sv(); }, pct)),
      field(L('Retorno al centro de los sticks', 'Sticks return to centre'), toggle(t.sticksSelfCenter, (v) => { t.sticksSelfCenter = v; sv(); })),
      field(L('Acelerador con retorno al centro', 'Self-centring throttle'), toggle(t.throttleSelfCenter, (v) => { t.throttleSelfCenter = v; sv(); })),
      field(L('Vibración al pulsar', 'Haptic feedback'), toggle(t.haptics, (v) => { t.haptics = v; sv(); })),
      field(L('Distribución', 'Layout'), h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        h('button', { class: 'btn small', onClick: () => a.editTouchLayout() }, L('Editar posición', 'Edit position')),
        h('button', { class: 'btn small ghost', onClick: () => { t.left = { x: 0.16, y: 0.72 }; t.right = { x: 0.84, y: 0.72 }; a.input.touch.applyLayout(); sv(); } }, L('Restablecer', 'Reset'))), L('Arrastra los sticks durante el vuelo', 'Drag the sticks while flying')));
  }

  startMonitor() {
    this.stopMonitor();
    if (this.cat !== 'controls') return;
    const loop = () => {
      this.monitorRaf = requestAnimationFrame(loop);
      const el = this.monitorEl;
      if (!el || !el.isConnected) return;
      const g = this.app.input.gamepad;
      const pad = g.pad();
      if (!pad) { if (!el.dataset.empty) { el.replaceChildren(h('p', { class: 'note' }, L('Sin dispositivo conectado.', 'No device connected.'))); el.dataset.empty = '1'; } return; }
      delete el.dataset.empty;
      const axes = Array.from(pad.axes);
      const fnOf = (i) => Object.entries(this.app.settings.controls.gamepad.axes).filter(([, c]) => c.index === i).map(([f]) => f).join(', ');
      if (el.childElementCount !== axes.length) {
        el.replaceChildren(...axes.map((_, i) => h('div', { class: 'axis-mon' }, h('span', {}, `${L('Eje', 'Axis')} ${i}`), h('div', { class: 'axis-bar' }, h('i')), h('span', { class: 'mono', style: { fontSize: '.85em' } }, ''))));
      }
      axes.forEach((v, i) => {
        const row = el.children[i];
        row.children[1].firstChild.style.left = `${(v + 1) * 50}%`;
        row.children[2].textContent = `${v.toFixed(2)}`;
        row.title = fnOf(i);
        row.children[0].textContent = `${L('Eje', 'Axis')} ${i}${fnOf(i) ? ' ·' : ''}`;
      });
    };
    loop();
  }

  stopMonitor() {
    if (this.monitorRaf) cancelAnimationFrame(this.monitorRaf);
    this.monitorRaf = null;
  }

  /* ─────────── física ─────────── */
  physics() {
    const p = this.app.settings.physics;
    const sv = () => this.save('physics');
    const set = (k) => (v) => { p[k] = v; sv(); };
    return h('div', {},
      h('div', { class: 'section-title' }, L('Asistencias', 'Assists')),
      field(L('Ayudas de vuelo', 'Flight assists'), segmented([{ value: 'expert', label: L('Sin ayudas (real)', 'No assists (real)') }, { value: 'intermediate', label: L('Giróscopo', 'Gyro') }, { value: 'beginner', label: L('Estabilizador', 'Stabiliser') }], p.assist, set('assist'))),
      field(L('Limitar alabeo y cabeceo (principiante)', 'Limit bank and pitch (beginner)'), toggle(p.limitAttitude, set('limitAttitude')), L('Desactivado: movimiento libre (toneles y loopings) con auto-nivelado al soltar el stick', 'Off: free movement (rolls and loops) with auto-level when the stick is released')),
      field(L('Alabeo máximo (si se limita)', 'Max bank (when limited)'), range(20, 75, 5, p.maxBank, set('maxBank'), (v) => `${v}°`)),
      field(L('Cabeceo máximo (si se limita)', 'Max pitch (when limited)'), range(15, 45, 5, p.maxPitch, set('maxPitch'), (v) => `${v}°`)),
      field(L('Auto-nivelado (intermedio)', 'Auto-level (intermediate)'), toggle(p.autoLevel, set('autoLevel'))),
      field(L('Limitar alabeo (intermedio)', 'Limit bank (intermediate)'), toggle(p.limitBank, set('limitBank'))),
      field(L('Ayuda al aterrizaje', 'Landing aid'), toggle(p.landingAid, set('landingAid')), L('Redondeo automático en principiante', 'Automatic flare in beginner mode')),
      field(L('Control de velocidad', 'Speed hold'), toggle(p.speedHold, set('speedHold'))),
      h('div', { class: 'section-title' }, L('Simulación', 'Simulation')),
      field(L('Modelo aerodinámico', 'Aerodynamic model'), segmented([{ value: 'realistic', label: L('Realista', 'Realistic') }, { value: 'expert', label: L('Experto', 'Expert') }, { value: 'casual', label: 'Casual' }, { value: 'arcade', label: 'Arcade' }], p.fidelity, set('fidelity')),
        L('Arcade: más amortiguación, sin par motor ni efectos giroscópicos, poca turbulencia y daños tolerantes. Experto: máxima fidelidad.', 'Arcade: extra damping, no torque or gyroscopic effects, little turbulence and forgiving damage. Expert: maximum fidelity.')),
      field(L('Daños', 'Damage'), toggle(p.damage, set('damage'))),
      field(L('Radio de vuelo (alcance de radio)', 'Flight radius (radio range)'), range(300, 1500, 50, p.flightRadius, set('flightRadius'), (v) => `${v} m`)),
      field(L('Pérdida de señal (failsafe)', 'Signal loss (failsafe)'), toggle(p.signalLoss, set('signalLoss')), L('Fuera de alcance se corta el motor', 'Out of range the motor is cut')));
  }

  /* ─────────── audio ─────────── */
  audio() {
    const s = this.app.settings.audio;
    const set = (k) => (v) => { s[k] = v; this.save('audio'); this.app.audio.applyVolumes(); };
    return h('div', {},
      h('div', { class: 'section-title' }, L('Volumen', 'Volume')),
      field(L('General', 'Master'), range(0, 1, 0.05, s.master, set('master'), pct)),
      field(L('Motor', 'Engine'), range(0, 1, 0.05, s.engine, set('engine'), pct)),
      field(L('Ambiente', 'Ambience'), range(0, 1, 0.05, s.ambient, set('ambient'), pct)),
      field(L('Efectos', 'Effects'), range(0, 1, 0.05, s.effects, set('effects'), pct)),
      field(L('Interfaz', 'Interface'), range(0, 1, 0.05, s.ui, set('ui'), pct)),
      h('div', { class: 'section-title' }, L('Opciones', 'Options')),
      field(L('Audio espacial (HRTF)', 'Spatial audio (HRTF)'), toggle(s.spatial, set('spatial'))),
      field(L('Vario sonoro en planeadores', 'Audio vario for gliders'), toggle(s.vario !== false, set('vario'))),
      field(L('Silenciar', 'Mute'), toggle(s.muted, set('muted'))));
  }

  /* ─────────── interfaz ─────────── */
  interface() {
    const a = this.app, u = a.settings.ui;
    const set = (k, after) => (v) => { u[k] = v; this.save('ui'); after?.(); };
    return h('div', {},
      h('div', { class: 'section-title' }, L('General', 'General')),
      field(L('Idioma', 'Language'), segmented([{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }], u.language, set('language', () => a.applyLanguage()))),
      field(L('Unidades', 'Units'), segmented([{ value: 'metric', label: L('Métricas', 'Metric') }, { value: 'imperial', label: L('Imperiales', 'Imperial') }], u.units, set('units', () => a.applyUiPrefs()))),
      field(L('Escala de la interfaz', 'Interface scale'), range(0.8, 1.4, 0.05, u.uiScale, set('uiScale', () => a.applyUiPrefs()), pct)),
      field(L('Alto contraste', 'High contrast'), toggle(u.highContrast, set('highContrast', () => a.applyUiPrefs()))),
      field(L('Reducir movimiento y efectos', 'Reduce motion and effects'), toggle(u.reduceMotion, set('reduceMotion', () => a.applyUiPrefs())), L('Desactiva animaciones, vibración de cámara y suaviza el zoom', 'Disables animations and camera shake, smooths zoom')),
      h('div', { class: 'section-title' }, 'HUD'),
      field(L('Mostrar HUD', 'Show HUD'), toggle(u.hud, set('hud', () => a.applyUiPrefs()))),
      field(L('Tamaño del HUD', 'HUD size'), range(0.7, 1.4, 0.05, u.hudScale, set('hudScale', () => a.applyUiPrefs()), pct)),
      field(L('Opacidad del HUD', 'HUD opacity'), range(0.4, 1, 0.05, u.hudOpacity, set('hudOpacity', () => a.applyUiPrefs()), pct)),
      field(L('Instrumentos', 'Instruments'), toggle(u.instruments, set('instruments', () => a.applyUiPrefs()))),
      field(L('Indicador de maniobras', 'Manoeuvre indicator'), toggle(u.maneuverPopup, set('maneuverPopup'))),
      field(L('Instructor visual', 'Visual instructor'), toggle(u.instructor, set('instructor')), L('Muestra el stick a mover en las lecciones', 'Shows which stick to move in lessons')));
  }

  /* ─────────── cámara ─────────── */
  camera() {
    const c = this.app.settings.camera;
    const set = (k) => (v) => { c[k] = v; this.save('camera'); };
    return h('div', {},
      field(L('Cámara por defecto', 'Default camera'), segmented([{ value: 'pilot', label: L('Piloto', 'Pilot') }, { value: 'chase', label: L('Seguimiento', 'Chase') }, { value: 'cinematic', label: L('Cine', 'Cinematic') }, { value: 'onboard', label: L('A bordo', 'Onboard') }, { value: 'free', label: L('Libre', 'Free') }], c.default, set('default'))),
      field(L('Campo de visión', 'Field of view'), range(35, 85, 1, c.fov, set('fov'), (v) => `${v}°`)),
      field(L('Auto-zoom (piloto)', 'Auto-zoom (pilot)'), toggle(c.autoZoom, set('autoZoom')), L('Mantiene el avión visible a cualquier distancia', 'Keeps the aircraft visible at any distance')),
      field(L('Distancia de seguimiento', 'Chase distance'), range(0.5, 2.5, 0.05, c.chaseDistance, set('chaseDistance'), pct)),
      field(L('Altura de seguimiento', 'Chase height'), range(0, 1, 0.05, c.chaseHeight, set('chaseHeight'), pct)),
      field(L('Suavidad', 'Smoothing'), range(0, 1, 0.05, c.smoothing, set('smoothing'), pct)),
      field(L('Sensibilidad (ratón / táctil)', 'Sensitivity (mouse / touch)'), range(0.3, 2.5, 0.1, c.sensitivity, set('sensitivity'), (v) => v.toFixed(1))),
      field(L('Vibración de la cámara a bordo', 'Onboard camera shake'), toggle(c.shake, set('shake'))));
  }

  /* ─────────── datos ─────────── */
  data() {
    const a = this.app;
    const confirm = (title, text, fn) => a.ui.modal({ title, text, actions: [{ label: L('Cancelar', 'Cancel') }, { label: L('Confirmar', 'Confirm'), kind: 'danger', onClick: fn }] });
    const row = (label, hint, btnLabel, fn) => field(label, h('button', { class: 'btn small danger', onClick: fn }, btnLabel), hint);
    return h('div', {},
      h('div', { class: 'section-title' }, L('Datos guardados en este dispositivo', 'Data stored on this device')),
      row(L('Configuración', 'Settings'), L('Vuelve a los valores por defecto', 'Restore defaults'), L('Restablecer', 'Reset'), () => confirm(L('Restablecer configuración', 'Reset settings'), L('Se perderán todos los ajustes.', 'All settings will be lost.'), () => { a.resetSettings(); })),
      row(L('Estadísticas', 'Statistics'), L('Horas, historial y contadores', 'Hours, history and counters'), L('Restablecer', 'Reset'), () => confirm(L('Restablecer estadísticas', 'Reset statistics'), '', () => { a.stats.reset(); a.ui.toast(L('Estadísticas borradas', 'Statistics cleared'), 'ok'); })),
      row(L('Récords', 'Records'), L('Mejores puntuaciones de lecciones y desafíos', 'Best scores for lessons and challenges'), L('Borrar', 'Clear'), () => confirm(L('Borrar récords', 'Clear records'), '', () => { a.storage.remove('lessonRecords'); a.storage.remove('challengeRecords'); a.ui.toast(L('Récords borrados', 'Records cleared'), 'ok'); })),
      row(L('Repeticiones', 'Replays'), L('Vuelos grabados (IndexedDB)', 'Recorded flights (IndexedDB)'), L('Borrar', 'Clear'), () => confirm(L('Borrar repeticiones', 'Clear replays'), '', async () => { await a.replayStore.clear(); a.ui.toast(L('Repeticiones borradas', 'Replays cleared'), 'ok'); })),
      row(L('Decoraciones y aeronaves personalizadas', 'Liveries and custom aircraft'), '', L('Borrar', 'Clear'), () => confirm(L('Borrar personalizaciones', 'Clear customisations'), '', () => { a.storage.remove('liveries'); a.storage.remove('customAircraft'); a.registry.cache.clear(); a.ui.toast(L('Personalizaciones borradas', 'Customisations cleared'), 'ok'); })),
      h('p', { class: 'note' }, a.storage.available ? L('Los datos se guardan en el almacenamiento local del navegador.', 'Data is saved in the browser local storage.') : L('El almacenamiento local no está disponible (modo privado): los ajustes se perderán al cerrar.', 'Local storage is unavailable (private mode): settings will be lost on close.')));
  }
}
