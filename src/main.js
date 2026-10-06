/**
 * RC FLIGHT SIMULATOR — punto de entrada.
 * Crea los subsistemas, conecta eventos entre simulación e interfaz y ejecuta el bucle.
 */
import { Storage, ReplayStore } from './core/Storage.js';
import { EventBus } from './core/EventBus.js';
import { AudioEngine } from './core/AudioEngine.js';
import { Simulation } from './core/Simulation.js';
import { setLanguage, setUnits, L, T } from './core/i18n.js';
import { defaultSettings, deepMerge, migrateSettings } from './data/settings.js';
import { Premium } from './core/Premium.js';
import { AircraftRegistry } from './aircraft/AircraftRegistry.js';
import { Renderer } from './render/Renderer.js';
import { CameraManager } from './camera/CameraManager.js';
import { InputManager } from './controls/InputManager.js';
import { transmitterAxisMap } from './controls/RadioController.js';
import { Statistics } from './gameplay/Statistics.js';
import { LESSONS, CHALLENGES } from './gameplay/Missions.js';
import { defaultWeather } from './core/WeatherSystem.js';
import { UIManager } from './ui/UIManager.js';
import { MainMenu } from './ui/MainMenu.js';
import { FlightMenu } from './ui/FlightMenu.js';
import { AircraftSelection } from './ui/AircraftSelection.js';
import { ScenariosScreen } from './ui/Scenarios.js';
import { TrainingScreen } from './ui/Training.js';
import { ChallengesScreen, medalBadge } from './ui/Challenges.js';
import { SettingsScreen } from './ui/Settings.js';
import { StatisticsScreen } from './ui/Statistics.js';
import { CreditsScreen } from './ui/Credits.js';
import { PreviewRenderer } from './ui/PreviewRenderer.js';
import { HUD } from './ui/HUD.js';
import { PauseMenu } from './ui/PauseMenu.js';
import { ReplayUI } from './ui/Replay.js';
import { h } from './ui/dom.js';
import { OfflineAdapter } from './net/NetworkAdapter.js';
import { registerServiceWorker, lockBrowserGestures, WakeLock, trapBackButton, recommendedPreset, isMobile } from './core/Platform.js';
import { GRAPHICS_PRESETS } from './data/settings.js';

const CAM_LABELS = { pilot: ['Cámara de piloto', 'Pilot camera'], chase: ['Cámara de seguimiento', 'Chase camera'], cinematic: ['Cámara cinematográfica', 'Cinematic camera'], onboard: ['Cámara a bordo', 'Onboard camera'], free: ['Cámara libre (arrastra para mirar, rueda para avanzar)', 'Free camera (drag to look, wheel to move)'] };

class App {
  constructor() {
    this.uiRoot = document.getElementById('ui-root');
    this.storage = new Storage();
    const saved = this.storage.get('settings', null);
    this.settings = deepMerge(defaultSettings(), migrateSettings(saved || {}) || {});
    if (!saved) {
      const preset = recommendedPreset();
      Object.assign(this.settings.graphics, structuredClone(GRAPHICS_PRESETS[preset]), { preset });
      delete this.settings.graphics.label;
      if (isMobile()) { this.settings.graphics.dynamicResolution = true; this.settings.graphics.targetFps = 60; }
    }
    // mejora de pago «Render realista»: sin licencia nunca se activa
    this.premium = new Premium(this.storage);
    if (!this.premium.unlocked) this.settings.graphics.realistic = false;
    this.wakeLock = new WakeLock();
    this.bus = new EventBus();
    this.net = new OfflineAdapter();
    this.state = 'boot';
    this.fps = 60;
  }

  saveSettings() { this.storage.set('settings', this.settings); }

  async boot() {
    const setLoad = (p, t) => this.ui?.loading(true, p, t) ?? (() => {
      document.getElementById('loading-fill').style.width = `${p * 100}%`;
      document.getElementById('loading-text').textContent = t;
    })();
    this.applyLanguage(false);
    this.applyUiPrefs();
    registerServiceWorker();
    lockBrowserGestures();
    trapBackButton(() => this.onBack());
    setLoad(0.05, L('Iniciando motor gráfico…', 'Starting graphics engine…'));
    try {
      this.renderer = new Renderer(document.getElementById('app'), this.settings.graphics);
    } catch (e) {
      this.fatal(e.message);
      return;
    }
    this.audio = new AudioEngine(this.settings.audio);
    this.ui = new UIManager(this.uiRoot, this.audio);
    this.cameras = new CameraManager(this.settings.camera);
    this.renderer.setCamera(this.cameras.camera);
    this.registry = new AircraftRegistry(this.storage);
    this.stats = new Statistics(this.storage);
    this.replayStore = new ReplayStore();
    this.input = new InputManager(this.settings, this.uiRoot, this.cameras, (a, src) => this.onAction(a, src));
    this.input.attachCanvas(this.renderer.canvas);
    this.sim = new Simulation({
      settings: this.settings, storage: this.storage, registry: this.registry, renderer: this.renderer,
      cameras: this.cameras, input: this.input, audio: this.audio, bus: this.bus, stats: this.stats, replayStore: this.replayStore,
    });
    this.hud = new HUD(this);
    this.pause = new PauseMenu(this);
    this.replayUI = new ReplayUI(this);
    this.bindEvents();
    // el audio sólo puede arrancar tras un gesto del usuario
    const unlock = () => { this.audio.init(); this.audio.applyVolumes(); if (this.sim.aircraft) this.audio.setAircraft(this.sim.aircraft.spec); if (this.sim.env) this.audio.setAmbience(this.sim.env.ambience, this.sim.weather); };
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { once: true });
    this.last = performance.now();
    this.refreshMs = 1000 / 60;
    requestAnimationFrame((t) => this.loop(t));
    try {
      await this.sim.startMenuDemo();
    } catch (e) {
      console.error(e);
      this.fatal(`${L('Error al cargar el escenario', 'Error loading scenario')}: ${e.message}`);
      return;
    }
    this.state = 'menu';
    this.ui.replace(new MainMenu(this));
    this.ui.loading(false);
    this.checkPremiumReturn();
    document.getElementById('rotate-dismiss')?.addEventListener('click', () => document.getElementById('rotate-hint').classList.remove('enabled'));
  }

  /** Vuelta desde la pasarela de pago: confirma la compra y activa el render realista. */
  async checkPremiumReturn() {
    const r = await this.premium.handleReturn();
    if (!r) return;
    if (r.ok) {
      this.settings.graphics.realistic = true;
      this.saveSettings();
      this.applyGraphics(false);
      this.ui.toast(L('¡Compra completada! Render realista activado.', 'Purchase complete! Realistic render enabled.'), 'ok', 6000);
    } else if (r.error === 'cancelled') {
      this.ui.toast(L('Compra cancelada: no se ha realizado ningún cargo.', 'Purchase cancelled: you have not been charged.'), 'info', 5000);
    } else {
      this.ui.toast(L('No se pudo confirmar el pago. Si se cobró, contacta con soporte.', 'Could not confirm the payment. If you were charged, contact support.'), 'danger', 8000);
    }
  }

  fatal(msg) {
    const el = document.getElementById('loading-text');
    el.replaceChildren(h('div', { class: 'boot-error' }, msg, h('br'), L('Prueba con un navegador actualizado (Chrome, Edge, Firefox o Safari) con WebGL2 activado.', 'Try an up-to-date browser (Chrome, Edge, Firefox or Safari) with WebGL2 enabled.')));
  }

  /* ─────────────────────────── preferencias ─────────────────────────── */

  applyLanguage(refresh = true) {
    setLanguage(this.settings.ui.language);
    if (refresh && this.hud?.el && this.sim?.aircraft) { this.hud.build(); this.hud.setAircraft(this.sim.aircraft.spec); this.hud.show(this.state === 'flight'); }
    if (refresh && this.input) this.input.touch.applyLayout();
  }

  applyUiPrefs() {
    const u = this.settings.ui;
    setUnits(u.units);
    document.documentElement.style.setProperty('--ui-scale', u.uiScale);
    document.body.classList.toggle('high-contrast', !!u.highContrast);
    document.body.classList.toggle('reduce-motion', !!u.reduceMotion);
    this.hud?.applyPrefs();
    if (this.state !== 'flight') this.hud?.show(false);
  }

  applyGraphics(rebuild) {
    this.sim.applySettings({ graphics: true });
    if (rebuild) {
      clearTimeout(this.rebuildT);
      this.rebuildT = setTimeout(() => this.sim.rebuildEnvironmentVisuals(), 450);
    }
  }

  resetSettings() {
    this.storage.remove('settings');
    location.reload();
  }

  /* ─────────────────────────── eventos ─────────────────────────── */

  bindEvents() {
    const b = this.bus;
    b.on('message', (m) => this.ui.toast(m.text, m.kind));
    // trims guardados por aeronave (como la memoria de modelos de una emisora)
    b.on('aircraftChanged', (spec) => {
      const t = this.storage.get('trims', {})[spec.id] || { aileron: 0, elevator: 0, rudder: 0 };
      Object.assign(this.input.trim, t);
    });
    b.on('overstress', () => {});
    b.on('maneuver', (m) => this.hud.maneuver(m));
    b.on('landing', (r) => this.hud.landing(r));
    b.on('crash', (e) => {
      clearTimeout(this.crashT);
      this.crashT = setTimeout(() => this.showCrash(e), 1600);
    });
    b.on('missionComplete', (e) => setTimeout(() => this.showMissionResult(e), 900));
    window.addEventListener('beforeunload', (e) => {
      this.saveSettings();
      if (this.state === 'flight') { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'flight' && !this.sim.paused) this.openPause();
    });
  }

  onAction(action, src) {
    if (action === 'padButton') { this.bus.emit('padButton', src); return; }
    if (action === 'gamepadConnected') {
      const g = this.input.gamepad;
      if (g.transmitter && !this.settings.controls.gamepad.txConfigured) {
        this.settings.controls.gamepad.axes = transmitterAxisMap(g.transmitter.order);
        this.settings.controls.gamepad.txConfigured = true;
        this.saveSettings();
        this.ui.toast(L(`Emisora detectada (${g.transmitter.brand}). Canales ${g.transmitter.order} asignados; calíbrala en Configuración.`, `Radio detected (${g.transmitter.brand}). ${g.transmitter.order} channels mapped; calibrate it in Settings.`), 'ok', 5000);
      } else this.ui.toast(`${L('Mando conectado', 'Controller connected')}: ${src.id.slice(0, 40)}`, 'ok');
      return;
    }
    if (action === 'gamepadDisconnected') { this.ui.toast(L('Mando desconectado', 'Controller disconnected'), 'warn'); return; }
    if (action === 'trimChanged') {
      const id = this.sim.aircraft?.spec.id;
      if (id) { const all = this.storage.get('trims', {}); all[id] = { ...src }; this.storage.set('trims', all); }
      const f = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
      this.ui.toast(`Trim  A ${f(src.aileron)} · P ${f(src.elevator)} · T ${f(src.rudder)}`, 'info', 900);
      return;
    }
    if (action === 'dualRate') {
      this.ui.toast(this.input.dualRateLow ? L('Dual rate: BAJO', 'Dual rate: LOW') : L('Dual rate: ALTO', 'Dual rate: HIGH'), 'info', 1200);
      return;
    }
    if (action === 'touchLayoutSaved') { this.saveSettings(); this.ui.toast(L('Distribución guardada', 'Layout saved'), 'ok'); return; }

    if (this.state === 'replay') {
      if (action === 'pause' || action === 'launch') { const p = this.sim.player; if (p) p.playing = !p.playing; }
      if (action === 'camera') this.replayUI.camBtn?.click();
      if (action === 'zoomIn') this.cameras.zoomBy(1.15);
      if (action === 'zoomOut') this.cameras.zoomBy(1 / 1.15);
      return;
    }
    if (this.state !== 'flight') {
      if (action === 'pause' && this.ui.stack.length > 1) this.ui.back();
      return;
    }
    // durante el vuelo
    if (action === 'pause' || action === 'menu') {
      if (this.ui.stack.length) { this.ui.back(); return; }
      if (this.pause.open) this.resume(); else this.openPause();
      return;
    }
    if (this.sim.paused) return;
    const ac = this.sim.aircraft;
    switch (action) {
      case 'camera': {
        const m = this.cameras.cycle();
        this.ui.toast(L(...CAM_LABELS[m]), 'info', 1500);
        break;
      }
      case 'reset': this.sim.resetAircraft(); break;
      case 'hud': this.settings.ui.hud = !this.settings.ui.hud; this.hud.applyPrefs(); this.saveSettings(); break;
      case 'instruments': this.settings.ui.instruments = !this.settings.ui.instruments; this.hud.applyPrefs(); this.saveSettings(); break;
      case 'launch': if (!this.sim.launch() && ac?.engine.type !== 'none' && !ac.held) { /* sin efecto en vuelo */ } break;
      case 'zoomIn': this.cameras.zoomBy(1.15); break;
      case 'zoomOut': this.cameras.zoomBy(1 / 1.15); break;
      case 'cameraTrack': this.ui.toast(this.cameras.toggleTracking() ? L('Seguimiento activado', 'Tracking on') : L('Seguimiento desactivado: arrastra para mirar', 'Tracking off: drag to look'), 'info', 1600); break;
      case 'flaps':
        if (ac?.spec.hasFlaps) this.ui.toast(`Flaps ${Math.round(this.input.out.flap * 100)}%`, 'info', 1000);
        else this.ui.toast(L('Esta aeronave no tiene flaps', 'This aircraft has no flaps'), 'info', 1200);
        break;
      case 'gear':
        if (ac?.spec.retract) this.ui.toast(this.input.out.gearDown ? L('Tren abajo', 'Gear down') : L('Tren arriba', 'Gear up'), 'info', 1200);
        else { this.input.out.gearDown = true; this.ui.toast(L('Tren fijo', 'Fixed gear'), 'info', 1000); }
        break;
      default: break;
    }
  }

  /** Botón «atrás» del sistema (Android): pausa durante el vuelo o vuelve a la pantalla anterior. */
  onBack() {
    const modal = document.querySelector('.modal-backdrop');
    if (modal) { modal.remove(); return true; }
    if (this.state === 'replay') { this.exitReplay(); return true; }
    if (this.state === 'flight') {
      if (this.ui.stack.length) return this.ui.back();
      if (this.pause.open) this.resume(); else this.openPause();
      return true;
    }
    return this.ui.back();
  }

  /* ─────────────────────────── navegación ─────────────────────────── */

  openFlightMenu(tab = 'aircraft', inFlight = false) {
    if (inFlight) { this.pause.hide(); this.ui.push(new FlightMenu(this, { tab, inFlight: true })); return; }
    this.ui.push(new FlightMenu(this, { tab }));
  }

  get preview() {
    if (!this._preview) this._preview = new PreviewRenderer();
    return this._preview;
  }

  openHangar() { this.ui.push(new AircraftSelection(this)); }
  openScenarios() { this.ui.push(new ScenariosScreen(this)); }
  openTraining() { this.ui.push(new TrainingScreen(this)); }
  openChallenges() { this.ui.push(new ChallengesScreen(this)); }
  openStats() { this.ui.push(new StatisticsScreen(this)); }
  openCredits() { this.ui.push(new CreditsScreen(this)); }
  openSettings() {
    if (this.state === 'flight') this.pause.hide();
    this.ui.push(new SettingsScreen(this));
  }

  toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement) {
      d.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => this.ui.toast(L('Pantalla completa no disponible', 'Fullscreen unavailable'), 'warn'));
    } else d.exitFullscreen?.();
  }

  editTouchLayout() {
    if (this.state !== 'flight') { this.ui.toast(L('Inicia un vuelo para mover los sticks sobre la escena', 'Start a flight to move the sticks over the scene'), 'info', 3500); return; }
    this.ui.clearScreens();
    this.pause.hide();
    this.sim.setPaused(true);
    this.input.touch.setVisible(true);
    this.input.touch.setEditing(true);
    const orig = this.input.touch.onAction;
    this.input.touch.onAction = (a, s) => { orig(a, s); if (a === 'touchLayoutSaved') { this.input.touch.onAction = orig; this.input.updateTouchVisibility(true); this.sim.setPaused(false); } };
  }

  /* ─────────────────────────── vuelo ─────────────────────────── */

  async startFlight(cfg, mission = null) {
    if (this.state === 'flight') this.sim.endFlight();
    this.pause.hide();
    this.replayUI.hide();
    this.ui.onEmpty = null;
    this.ui.loading(true, 0.05, L('Preparando vuelo…', 'Preparing flight…'));
    this.state = 'loading';
    try {
      await this.sim.loadSession({ ...cfg, mission, mode: 'flight' }, (p, t) => this.ui.loading(true, p, t));
    } catch (e) {
      console.error(e);
      this.ui.loading(false);
      this.ui.toast(`${L('Error al cargar', 'Load error')}: ${e.message}`, 'danger', 6000);
      this.state = 'menu';
      return;
    }
    this.lastSession = { cfg, mission };
    this.ui.clearScreens();
    this.ui.onEmpty = () => this.openPause();
    this.cameras.setMode(cfg.camera || this.settings.camera.default || 'pilot');
    this.hud.build();
    this.hud.setAircraft(this.sim.aircraft.spec);
    this.hud.show(true);
    this.state = 'flight';
    this.wakeLock.acquire();
    document.body.classList.add('in-flight');
    this.input.updateTouchVisibility(true);
    document.body.classList.toggle('touch', this.input.touch.visible);
    const spec = this.sim.aircraft.spec;
    this.input.touch.setCaps({ flaps: spec.hasFlaps, gear: spec.retract, airbrake: spec.hasSpoilers, brake: spec.gearType === 'tricycle' || spec.gearType === 'taildragger' || spec.gearType === 'mono', launch: true });
    this.sim.setPaused(false);
    this.ui.loading(false);
    if (mission) this.showMissionIntro(mission);
  }

  startMission(m) {
    const s = m.setup;
    this.startFlight({ aircraft: s.aircraft, environment: s.environment, weather: { ...defaultWeather(), thermalHints: false, ...s.weather }, launch: s.launch, camera: this.settings.camera.default, air: s.air }, m);
  }

  showMissionIntro(m) {
    this.sim.setPaused(true);
    const rec = m.recommendAssist || m.setup.recommendAssist;
    const content = h('div', {},
      h('p', {}, T(m.desc)),
      m.kind === 'lesson' ? h('p', { style: { color: 'var(--text)' } }, `${m.steps.length} ${L('objetivos', 'objectives')} · ${this.registry.get(m.setup.aircraft).name}`) : h('p', { style: { color: 'var(--text)' } }, `${L('Medallas', 'Medals')}: ${m.medals.bronze} / ${m.medals.silver} / ${m.medals.gold} ${m.unit}${m.timeLimit ? ` · ${L('límite', 'limit')} ${Math.round(m.timeLimit / 60)} min` : ''}`),
      rec && rec !== this.settings.physics.assist ? h('p', { class: 'note' }, L(`Recomendado: asistencia «${rec}». Puedes cambiarla en Configuración → Física.`, `Recommended assist: «${rec}». Change it in Settings → Physics.`)) : null);
    this.ui.modal({ title: T(m.title), content, dismissable: false, actions: [{ label: L('Comenzar', 'Start'), kind: 'primary', onClick: () => this.sim.setPaused(false) }, { label: L('Volver', 'Back'), onClick: () => this.exitToMenu() }] });
  }

  showMissionResult({ mission, result, record }) {
    const m = mission.m;
    const isLesson = m.kind === 'lesson';
    const content = h('div', {},
      h('div', { style: { fontFamily: 'var(--font-mono)', fontSize: '2.6em', fontWeight: 700, color: 'var(--accent)' } }, `${result.score}${isLesson ? '' : ` ${m.unit}`}`),
      isLesson ? h('div', { class: 'stars', style: { fontSize: '1.8em' } }, '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars)) : h('div', { style: { display: 'flex', justifyContent: 'center', gap: '8px', alignItems: 'center', margin: '6px 0' } }, medalBadge(result.medal), result.medal ? { gold: L('Medalla de oro', 'Gold medal'), silver: L('Medalla de plata', 'Silver medal'), bronze: L('Medalla de bronce', 'Bronze medal') }[result.medal] : L('Sin medalla', 'No medal')),
      h('p', {}, record.better ? L('¡Nuevo récord personal!', 'New personal best!') : `${L('Récord', 'Best')}: ${record.prev?.score ?? '—'}`),
      result.extra?.altLost != null ? h('p', {}, `${L('Altura perdida en la pérdida', 'Height lost in the stall')}: ${result.extra.altLost.toFixed(1)} m`) : null,
      result.extra?.landing ? h('p', {}, `${L('Aterrizaje', 'Landing')}: ${result.extra.landing.score} — ${T(result.extra.landing.grade)}`) : null);
    const list = isLesson ? LESSONS : CHALLENGES;
    const next = list[list.indexOf(m) + 1];
    this.ui.modal({
      title: isLesson ? L('¡Lección completada!', 'Lesson complete!') : L('¡Desafío completado!', 'Challenge complete!'), content, dismissable: true,
      actions: [
        { label: L('Repetir', 'Retry'), onClick: () => this.startMission(m) },
        next ? { label: L('Siguiente', 'Next'), kind: 'primary', onClick: () => this.startMission(next) } : null,
        { label: L('Seguir volando', 'Keep flying') },
        { label: L('Menú', 'Menu'), onClick: () => this.exitToMenu() },
      ].filter(Boolean),
    });
  }

  showCrash(e) {
    // el aviso llega con retraso: se descarta si entretanto se reinició o se cambió de vuelo
    if (this.state !== 'flight' || !this.sim.crashed) return;
    const m = e.mission;
    const failedChallenge = m && !m.isLesson && m.failed;
    const reason = { water: L('La aeronave ha caído al agua.', 'The aircraft went into the water.'), impact: L('Impacto demasiado fuerte.', 'Impact too hard.'), structure: L('Fallo estructural tras los daños.', 'Structural failure after damage.'), collision: L('Colisión con un obstáculo.', 'Collision with an obstacle.') }[e.reason] || '';
    this.ui.modal({
      title: failedChallenge ? L('Desafío fallido', 'Challenge failed') : L('Aeronave destruida', 'Aircraft destroyed'), text: reason,
      actions: failedChallenge ? [
        { label: L('Reintentar', 'Retry'), kind: 'primary', onClick: () => this.startMission(m.m) },
        { label: L('Ver repetición', 'Watch replay'), onClick: () => this.replayCurrentFlight() },
        { label: L('Menú', 'Menu'), onClick: () => this.exitToMenu() },
      ] : [
        { label: L('Reiniciar', 'Reset'), kind: 'primary', onClick: () => this.sim.resetAircraft() },
        { label: L('Ver repetición', 'Watch replay'), onClick: () => this.replayCurrentFlight() },
        { label: L('Seguir mirando', 'Keep watching') },
        { label: L('Menú', 'Menu'), onClick: () => this.exitToMenu() },
      ],
    });
  }

  openPause() {
    if (this.state !== 'flight') return;
    this.sim.setPaused(true);
    this.input.touch.releaseAll();
    this.pause.show();
  }

  resume() {
    this.pause.hide();
    this.ui.clearScreens();
    this.sim.setPaused(false);
  }

  exitToMenu() {
    this.pause.hide();
    this.replayUI.hide();
    if (this.state === 'flight') this.sim.endFlight();
    this.sim.stopReplay(false);
    this.state = 'menu';
    this.wakeLock.release();
    this.ui.onEmpty = null;
    this.hud.show(false);
    document.body.classList.remove('in-flight', 'touch');
    this.input.updateTouchVisibility(false);
    this.sim.setPaused(false);
    this.ui.replace(new MainMenu(this));
    this.ui.loading(true, 0.3, L('Volviendo al menú…', 'Returning to menu…'));
    this.sim.startMenuDemo().then(() => this.ui.loading(false));
  }

  /* ─────────────────────────── repeticiones ─────────────────────────── */

  replayCurrentFlight() {
    const { replay } = this.sim.endFlight();
    const r = replay || this.sim.lastReplay;
    if (!r) { this.ui.toast(L('El vuelo es demasiado corto para una repetición', 'Flight too short for a replay'), 'warn'); return; }
    this.returnSession = this.lastSession;
    this.watchReplay(r, true);
  }

  async watchReplay(replay, fromFlight = false) {
    this.pause.hide();
    this.ui.onEmpty = null;
    this.ui.loading(true, 0.1, L('Cargando repetición…', 'Loading replay…'));
    this.state = 'loading';
    if (!fromFlight) this.returnSession = null;
    await this.sim.startReplay(replay, (p, t) => this.ui.loading(true, p, t));
    this.ui.clearScreens();
    this.hud.show(false);
    this.input.updateTouchVisibility(false);
    document.body.classList.remove('touch');
    this.state = 'replay';
    this.replayUI.show(this.sim.player, replay.meta);
    this.ui.loading(false);
  }

  exitReplay() {
    this.replayUI.hide();
    this.sim.stopReplay();
    if (this.returnSession) {
      const s = this.returnSession;
      this.returnSession = null;
      this.state = 'menu';
      if (s.mission) this.startMission(s.mission); else this.startFlight(s.cfg);
    } else this.exitToMenu();
  }

  /* ─────────────────────────── bucle ─────────────────────────── */

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    // ritmo de fotogramas: se mide el intervalo real de la pantalla y, si hay límite de FPS, se
    // dibuja cada N refrescos (cadencia constante). Antes se descartaba un fotograma cada vez que
    // el navegador llegaba unos microsegundos antes de tiempo, lo que producía tirones visibles.
    const raw = now - (this.lastTick ?? now);
    this.lastTick = now;
    if (raw > 2 && raw < 100) this.refreshMs += (raw - this.refreshMs) * 0.05;
    const target = this.settings.graphics.targetFps;
    if (target) {
      const every = Math.max(1, Math.round(1000 / target / this.refreshMs));
      this.tick = ((this.tick || 0) + 1) % every;
      if (this.tick !== 0) return;
    }
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.5) dt = 0.5;
    this.fps += ((1 / Math.max(dt, 1e-3)) - this.fps) * 0.05;
    if (this.state === 'boot' && !this.sim?.aircraft) return;
    try {
      this.sim.frame(dt);
      if (this.state === 'flight') this.hud.update(dt, this.sim);
      if (this.state === 'replay') this.replayUI.update();
      this.renderer.adaptResolution(dt);
    } catch (e) {
      console.error(e);
      if (!this.loopErrorShown) { this.loopErrorShown = true; this.ui?.toast(`${L('Error', 'Error')}: ${e.message}`, 'danger', 6000); }
    }
  }
}

const app = new App();
window.rcfs = app; // acceso para depuración y pruebas en el navegador
app.boot();
