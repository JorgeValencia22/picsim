/**
 * Preparación del vuelo: aeronave (con vista previa 3D), escenario, clima, hora, viento,
 * dificultad, tipo de control, modo de lanzamiento y cámara. También se usa desde la pausa
 * para cambiar de avión o escenario sin reiniciar la aplicación.
 */
import { h, icon, dots, field, select, range, toggle, segmented, envArt } from './dom.js';
import { Screen } from './UIManager.js';
import { L, T, fmtSpeed } from '../core/i18n.js';
import { CATEGORIES } from '../data/aircraftData.js';
import { ENVIRONMENTS, environmentMeta } from '../data/environmentData.js';
import { defaultWeather, randomWeather } from '../core/WeatherSystem.js';
import { quickSpecs } from './specSheet.js';
import { TouchControls } from '../controls/TouchControls.js';

export function timeLabel(hh) {
  if (hh < 5 || hh >= 20.5) return L('Noche', 'Night');
  if (hh < 7.5) return L('Amanecer', 'Dawn');
  if (hh < 11.5) return L('Mañana', 'Morning');
  if (hh < 14.5) return L('Mediodía', 'Midday');
  if (hh < 17.5) return L('Tarde', 'Afternoon');
  return L('Atardecer', 'Sunset');
}

export function compassLabel(deg) {
  const n = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const en = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return L(n[i], en[i]);
}

export const LAUNCH_LABELS = {
  runway: { es: 'Desde pista', en: 'Runway' },
  hand: { es: 'A mano', en: 'Hand launch' },
  bungee: { es: 'Goma (asistido)', en: 'Bungee (assisted)' },
  air: { es: 'En vuelo', en: 'In the air' },
  approach: { es: 'Aproximación', en: 'On approach' },
};

export class FlightMenu extends Screen {
  /**
   * @param {object} app
   * @param {object} opts { inFlight: bool, tab }
   */
  constructor(app, opts = {}) {
    super(app);
    this.opts = opts;
    const f = app.settings.flight;
    this.cfg = {
      aircraft: app.registry.exists(f.aircraft) ? f.aircraft : 'skylark',
      environment: f.environment || 'airfield',
      launch: f.launch || 'runway',
      weatherMode: f.weatherMode || 'manual',
      weather: { ...defaultWeather(), ...(f.weather || {}) },
      camera: app.settings.camera.default || 'pilot',
    };
    this.tab = opts.tab || 'aircraft';
    this.filter = 'all';
  }

  onShow() {
    const wrap = this.el.querySelector('.preview-wrap');
    if (wrap) {
      this.app.preview.mount(wrap);
      this.updatePreview();
    }
  }

  onHide() { this.app.preview.unmount(); }

  updatePreview() {
    const spec = this.app.registry.get(this.cfg.aircraft);
    this.app.preview.setAircraft(spec, this.app.sim.activeLivery(spec.id));
    const info = this.el.querySelector('.preview-info');
    if (info) info.replaceWith(this.previewInfo(spec));
    const sum = this.el.querySelector('.summary');
    if (sum) sum.textContent = this.summary();
  }

  previewInfo(spec) {
    return h('div', { class: 'preview-info' },
      h('h3', {}, spec.name),
      h('div', { class: 'meta' },
        h('span', { class: 'chip accent' }, T(CATEGORIES[spec.category])),
        h('span', { class: 'chip' }, L('Dificultad ', 'Difficulty '), dots(spec.difficulty)),
        h('span', { class: 'chip' }, `${spec.channels} ${L('canales', 'channels')}`)),
      quickSpecs(spec));
  }

  summary() {
    const spec = this.app.registry.get(this.cfg.aircraft);
    const env = environmentMeta(this.cfg.environment);
    const w = this.cfg.weatherMode === 'random' ? L('clima aleatorio', 'random weather') : `${fmtSpeed(this.cfg.weather.windSpeed)} ${compassLabel(this.cfg.weather.windDir)} · ${timeLabel(this.cfg.weather.timeOfDay)}`;
    return `${spec.name} · ${T(env.name)} · ${w} · ${T(LAUNCH_LABELS[this.cfg.launch])}`;
  }

  build() {
    const a = this.app;
    const spec = a.registry.get(this.cfg.aircraft);
    const tabs = [['aircraft', L('Aeronave', 'Aircraft')], ['scenario', L('Escenario', 'Scenario')], ['weather', L('Clima', 'Weather')], ['controls', L('Controles', 'Controls')], ['options', L('Opciones', 'Options')]];
    const body = h('div', { class: 'options-body' }, this.tabBody());
    const el = h('div', { class: 'screen dim' },
      this.head(this.opts.inFlight ? L('Cambiar vuelo', 'Change flight') : L('Preparar vuelo', 'Flight setup'), L('Elige aeronave, escenario y condiciones', 'Choose aircraft, scenario and conditions')),
      h('div', { class: 'setup-grid' },
        h('div', { class: 'panel preview-panel' },
          h('div', { class: 'preview-wrap' }, h('div', { class: 'preview-hint' }, L('Arrastra para girar · rueda/pellizco para zoom', 'Drag to rotate · wheel/pinch to zoom'))),
          this.previewInfo(spec)),
        h('div', { class: 'panel options-panel' },
          h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', {
            class: `tab${this.tab === id ? ' on' : ''}`, role: 'tab', 'aria-selected': this.tab === id,
            onClick: (e) => {
              this.tab = id;
              for (const t of e.target.parentNode.children) { t.classList.remove('on'); t.setAttribute('aria-selected', 'false'); }
              e.target.classList.add('on');
              e.target.setAttribute('aria-selected', 'true');
              body.replaceChildren(this.tabBody());
            },
          }, label))),
          body,
          h('div', { class: 'setup-foot' },
            h('div', { class: 'summary' }, this.summary()),
            h('button', { class: 'btn primary start', onClick: () => this.start() }, h('span', { html: icon('fly') }).firstChild, this.opts.inFlight ? L('Aplicar y volar', 'Apply & fly') : L('Iniciar vuelo', 'Start flight'))))));
    return el;
  }

  tabBody() {
    switch (this.tab) {
      case 'scenario': return this.scenarioTab();
      case 'weather': return this.weatherTab();
      case 'controls': return this.controlsTab();
      case 'options': return this.optionsTab();
      default: return this.aircraftTab();
    }
  }

  aircraftTab() {
    const a = this.app;
    const list = a.registry.list();
    const grid = h('div', { class: 'ac-grid' });
    const draw = () => {
      grid.replaceChildren(...list.filter((x) => this.filter === 'all' || x.category === this.filter || (this.filter === 'custom' && x.custom)).map((x) => h('button', {
        class: `ac-card${x.id === this.cfg.aircraft ? ' on' : ''}`,
        onClick: (e) => {
          this.cfg.aircraft = x.id;
          for (const c of grid.children) c.classList.remove('on');
          e.currentTarget.classList.add('on');
          const s = a.registry.get(x.id);
          if (!s.launch.includes(this.cfg.launch) && !(this.cfg.launch === 'air' || this.cfg.launch === 'approach')) this.cfg.launch = s.launch[0];
          this.updatePreview();
        },
      }, h('span', { class: 'c' }, x.custom ? L('Personalizada', 'Custom') : T(CATEGORIES[x.category])), h('span', { class: 'n' }, x.name), h('span', { class: 'swatch-row' }, h('i', { style: { background: x.paint.primary } }), h('i', { style: { background: x.paint.secondary } }), h('i', { style: { background: x.paint.accent } })), dots(x.difficulty))));
    };
    const cats = [['all', L('Todas', 'All')], ...Object.entries(CATEGORIES).map(([k, v]) => [k, T(v)])];
    if (list.some((x) => x.custom)) cats.push(['custom', L('Personalizadas', 'Custom')]);
    const chips = h('div', { class: 'filter-row' }, cats.map(([k, label]) => h('button', {
      class: `chip${this.filter === k ? ' on' : ''}`,
      onClick: (e) => { this.filter = k; for (const c of chips.children) c.classList.remove('on'); e.target.classList.add('on'); draw(); },
    }, label)));
    draw();
    return h('div', {}, chips, grid);
  }

  scenarioTab() {
    const grid = h('div', { class: 'env-grid', style: { marginTop: '12px' } });
    for (const e of ENVIRONMENTS) {
      const m = environmentMeta(e.id);
      grid.append(h('button', {
        class: `env-card${this.cfg.environment === e.id ? ' on' : ''}`,
        onClick: (ev) => {
          this.cfg.environment = e.id;
          for (const c of grid.children) c.classList.remove('on');
          ev.currentTarget.classList.add('on');
          if (m.windDefault && this.cfg.weatherMode === 'scenario') Object.assign(this.cfg.weather, m.windDefault);
          this.el.querySelector('.summary').textContent = this.summary();
        },
      }, h('div', { class: 'art', html: envArt(e.icon, m.gradient) }), h('div', { class: 'body' }, h('b', {}, T(m.name)), h('p', {}, T(m.desc)), h('div', { class: 'tags' }, T(m.tags).map((t) => h('span', { class: 'chip' }, t))))));
    }
    return grid;
  }

  weatherTab() {
    const w = this.cfg.weather;
    const set = (k) => (v) => { w[k] = v; this.el.querySelector('.summary').textContent = this.summary(); };
    const wrap = h('div', {});
    const manual = h('div', {});
    const drawManual = () => {
      manual.replaceChildren(
        h('div', { class: 'section-title' }, L('Cielo y luz', 'Sky and light')),
        field(L('Nubosidad', 'Cloud cover'), segmented([{ value: 'clear', label: L('Despejado', 'Clear') }, { value: 'partly', label: L('Parcial', 'Partly') }, { value: 'cloudy', label: L('Nublado', 'Cloudy') }, { value: 'overcast', label: L('Cubierto', 'Overcast') }], w.sky, set('sky'))),
        field(L('Hora del día', 'Time of day'), range(0, 24, 0.5, w.timeOfDay, set('timeOfDay'), (v) => `${String(Math.floor(v)).padStart(2, '0')}:${v % 1 ? '30' : '00'} · ${timeLabel(v)}`)),
        field(L('Temperatura', 'Temperature'), range(-10, 40, 1, w.temperature, set('temperature'), (v) => `${v} °C`), L('Afecta a la densidad del aire', 'Affects air density')),
        field(L('Niebla', 'Fog'), range(0, 1, 0.05, w.fog, set('fog'), (v) => `${Math.round(v * 100)}%`)),
        field(L('Lluvia', 'Rain'), range(0, 1, 0.05, w.rain, set('rain'), (v) => `${Math.round(v * 100)}%`)),
        h('div', { class: 'section-title' }, L('Viento', 'Wind')),
        field(L('Intensidad', 'Speed'), range(0, 14, 0.5, w.windSpeed, set('windSpeed'), (v) => `${v.toFixed(1)} m/s · ${fmtSpeed(v)}`)),
        field(L('Dirección (procedencia)', 'Direction (from)'), range(0, 350, 10, w.windDir, set('windDir'), (v) => `${v}° ${compassLabel(v)}`)),
        field(L('Ráfagas', 'Gusts'), range(0, 1, 0.05, w.gusts, set('gusts'), (v) => `${Math.round(v * 100)}%`)),
        field(L('Turbulencia', 'Turbulence'), range(0, 1, 0.05, w.turbulence, set('turbulence'), (v) => `${Math.round(v * 100)}%`)),
        field(L('Térmicas', 'Thermals'), range(0, 1, 0.05, w.thermals, set('thermals'), (v) => `${Math.round(v * 100)}%`), L('Corrientes ascendentes para planeadores', 'Rising air for gliders')),
        field(L('Indicadores de térmicas', 'Thermal indicators'), toggle(w.thermalHints, set('thermalHints')), L('Ayuda visual para principiantes', 'Visual aid for beginners')));
    };
    drawManual();
    wrap.append(
      h('div', { class: 'section-title' }, L('Modo', 'Mode')),
      field(L('Configuración del clima', 'Weather setup'), segmented([{ value: 'manual', label: L('Manual', 'Manual') }, { value: 'random', label: L('Aleatorio', 'Random') }, { value: 'scenario', label: L('Del escenario', 'Scenario default') }], this.cfg.weatherMode, (v) => {
        this.cfg.weatherMode = v;
        if (v === 'random') { Object.assign(w, randomWeather()); }
        if (v === 'scenario') { Object.assign(w, defaultWeather(), environmentMeta(this.cfg.environment).windDefault || {}); }
        drawManual();
        this.el.querySelector('.summary').textContent = this.summary();
      })),
      manual);
    return wrap;
  }

  controlsTab() {
    const a = this.app, s = a.settings;
    const pad = a.input.gamepad.pad();
    const cur = s.controls.touch.enabled === 'on' ? 'touch' : s.controls.mouse.flight ? 'mouse' : pad ? 'gamepad' : 'keyboard';
    return h('div', {},
      h('div', { class: 'section-title' }, L('Control', 'Control')),
      field(L('Tipo de control', 'Control type'), segmented([
        { value: 'keyboard', label: L('Teclado', 'Keyboard') }, { value: 'gamepad', label: L('Joystick / emisora', 'Joystick / radio') },
        { value: 'touch', label: L('Táctil', 'Touch') }, { value: 'mouse', label: L('Ratón', 'Mouse') }], cur, (v) => {
        s.controls.mouse.flight = v === 'mouse';
        s.controls.touch.enabled = v === 'touch' ? 'on' : (TouchControls.isTouchDevice() ? 'auto' : 'off');
        s.controls.gamepad.enabled = true;
        a.saveSettings('controls');
        if (v === 'gamepad' && !a.input.gamepad.pad()) a.ui.toast(L('Conecta el mando o la emisora y pulsa un botón para detectarlo', 'Connect the controller or radio and press a button to detect it'), 'warn', 4000);
      }), pad ? `${L('Detectado', 'Detected')}: ${pad.id.slice(0, 40)}` : L('Teclado siempre activo; los mandos se detectan al pulsar un botón', 'Keyboard always active; controllers are detected when a button is pressed')),
      field(L('Modo de emisora', 'Transmitter mode'), segmented([1, 2, 3, 4].map((m) => ({ value: m, label: `Mode ${m}` })), s.controls.mode, (v) => { s.controls.mode = Number(v); a.input.touch.applyLayout(); a.saveSettings('controls'); }), L('Mode 2: motor y timón a la izquierda', 'Mode 2: throttle and rudder on the left')),
      h('div', { class: 'section-title' }, L('Dificultad y realismo', 'Difficulty and realism')),
      field(L('Ayudas de vuelo', 'Flight assists'), segmented([{ value: 'expert', label: L('Sin ayudas (real)', 'No assists (real)') }, { value: 'intermediate', label: L('Giróscopo', 'Gyro') }, { value: 'beginner', label: L('Estabilizador', 'Stabiliser') }], s.physics.assist, (v) => { s.physics.assist = v; a.saveSettings('physics'); }),
        L('Sin ayudas: el avión responde sólo a su aerodinámica, como uno real (recomendado). Giróscopo: amortigua giros como un estabilizador AS3X. Estabilizador: además vuelve a nivelarse al soltar los sticks.', 'No assists: the aircraft responds only to its aerodynamics, like a real one (recommended). Gyro: damps rotations like an AS3X stabiliser. Stabiliser: also levels the wings when you release the sticks.')),
      field(L('Nivel de simulación', 'Simulation level'), segmented([{ value: 'realistic', label: L('Realista', 'Realistic') }, { value: 'expert', label: L('Experto', 'Expert') }, { value: 'casual', label: 'Casual' }, { value: 'arcade', label: 'Arcade' }], s.physics.fidelity, (v) => { s.physics.fidelity = v; a.saveSettings('physics'); }),
        L('Modifica turbulencia, par motor, efectos giroscópicos, amortiguación y tolerancia a daños', 'Changes turbulence, torque, gyroscopic effects, damping and damage tolerance')),
      field(L('Daños', 'Damage'), toggle(s.physics.damage, (v) => { s.physics.damage = v; a.saveSettings('physics'); })),
      field(L('Control de velocidad', 'Speed hold'), toggle(s.physics.speedHold, (v) => { s.physics.speedHold = v; a.saveSettings('physics'); }), L('El acelerador fija la velocidad deseada', 'Throttle sets the target airspeed')));
  }

  optionsTab() {
    const a = this.app;
    const spec = a.registry.get(this.cfg.aircraft);
    const avail = new Set([...spec.launch, 'air', 'approach']);
    if (spec.gearType === 'skid' || spec.gearType === 'mono') avail.delete('approach');
    if (!(spec.gearType === 'tricycle' || spec.gearType === 'taildragger')) avail.delete('runway');
    if (spec.mass > 3.2) avail.delete('hand');
    if (!avail.has(this.cfg.launch)) this.cfg.launch = [...avail][0];
    return h('div', {},
      h('div', { class: 'section-title' }, L('Lanzamiento', 'Launch')),
      field(L('Modo de lanzamiento', 'Launch mode'), segmented(['runway', 'hand', 'bungee', 'air', 'approach'].filter((k) => avail.has(k)).map((k) => ({ value: k, label: T(LAUNCH_LABELS[k]) })), this.cfg.launch, (v) => { this.cfg.launch = v; this.el.querySelector('.summary').textContent = this.summary(); }),
        L('Las opciones dependen del tren y la masa de la aeronave', 'Options depend on the aircraft gear and mass')),
      h('div', { class: 'section-title' }, L('Cámara', 'Camera')),
      field(L('Cámara inicial', 'Initial camera'), segmented([{ value: 'pilot', label: L('Piloto', 'Pilot') }, { value: 'chase', label: L('Seguimiento', 'Chase') }, { value: 'cinematic', label: L('Cine', 'Cinematic') }, { value: 'onboard', label: L('A bordo', 'Onboard') }, { value: 'free', label: L('Libre', 'Free') }], this.cfg.camera, (v) => { this.cfg.camera = v; a.settings.camera.default = v; a.saveSettings('camera'); })),
      field(L('Auto-zoom de la cámara de piloto', 'Pilot camera auto-zoom'), toggle(a.settings.camera.autoZoom, (v) => { a.settings.camera.autoZoom = v; a.saveSettings('camera'); })),
      field(L('Campo de visión', 'Field of view'), range(35, 85, 1, a.settings.camera.fov, (v) => { a.settings.camera.fov = v; a.saveSettings('camera'); }, (v) => `${v}°`)));
  }

  start() {
    const a = this.app;
    const f = a.settings.flight;
    f.aircraft = this.cfg.aircraft;
    f.environment = this.cfg.environment;
    f.launch = this.cfg.launch;
    f.weatherMode = this.cfg.weatherMode;
    f.weather = { ...this.cfg.weather };
    a.saveSettings('flight');
    const weather = this.cfg.weatherMode === 'random' ? randomWeather() : { ...this.cfg.weather };
    a.startFlight({ aircraft: this.cfg.aircraft, environment: this.cfg.environment, weather, launch: this.cfg.launch, camera: this.cfg.camera });
  }
}
