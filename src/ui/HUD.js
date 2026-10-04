/**
 * HUD de vuelo: identificación, tiempo, señal, viento, telemetría, estado de flaps/tren,
 * aviso de pérdida, indicaciones de lanzamiento, panel de misión con instructor visual
 * (stick a mover según el modo de emisora), maniobras reconocidas, resultado de aterrizajes
 * e instrumentos. Se puede ocultar por completo.
 */
import { h } from './dom.js';
import { Instruments } from './Instruments.js';
import { L, T, fmtSpeed, fmtAlt, fmtVs, fmtDist, fmtTime } from '../core/i18n.js';
import { MODE_MAP } from '../controls/TouchControls.js';
import { RAD, clamp } from '../utils/math3d.js';

const ASSIST_NAMES = { beginner: ['Principiante', 'Beginner'], intermediate: ['Intermedio', 'Intermediate'], expert: ['Experto', 'Expert'] };
const CAM_NAMES = { pilot: ['Piloto', 'Pilot'], chase: ['Seguimiento', 'Chase'], cinematic: ['Cinematográfica', 'Cinematic'], onboard: ['A bordo', 'Onboard'], free: ['Libre', 'Free'] };

export class HUD {
  constructor(app) {
    this.app = app;
    this.el = null;
    this.acc = 0;
    this.instAcc = 0;
  }

  build() {
    this.el?.remove();
    const tv = (key, label, opt = false) => {
      const b = h('b', {}, '—');
      const base = opt ? 'tv opt' : 'tv';
      const box = h('div', { class: base }, b, h('span', {}, label));
      this.t[key] = { b, box, base };
      return box;
    };
    this.t = {};
    this.thrBar = h('i', { style: { width: '0%' } });
    this.battBar = h('i', { style: { width: '100%' } });
    this.battWrap = h('div', { class: 'gauge-bar batt' }, this.battBar);
    const thrBox = tv('thr', L('Acelerador', 'Throttle'));
    thrBox.append(h('div', { class: 'gauge-bar' }, this.thrBar));
    const battBox = tv('batt', L('Batería', 'Battery'));
    battBox.append(this.battWrap);
    this.titleEl = h('span', {});
    this.chipsEl = h('span', { style: { display: 'inline-flex', gap: '4px' } });
    this.subEl = h('div', { class: 'hud-sub' });
    this.signalEl = h('span', { class: 'signal', title: L('Señal de radio', 'Radio signal') }, h('i'), h('i'), h('i'), h('i'));
    this.windArrow = h('span', { html: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1.5"/><path d="M20 6 L27 22 L20 18 L13 22 Z" fill="#3ec6ff"/></svg>' }).firstChild;
    this.windText = h('div', { class: 'wv' });
    this.perfEl = h('div', { class: 'perf-box hud-box hidden' });
    this.stallEl = h('div', { class: 'hud-stall hidden' }, L('PÉRDIDA', 'STALL'));
    this.centerEl = h('div', { class: 'hud-center-msg' });
    this.launchEl = h('div', { class: 'launch-hint hud-box hidden' });
    this.missionEl = h('div', { class: 'mission-panel hud-box hidden' });
    this.instEl = h('div', { class: 'hud-instruments hud-box' });
    this.instruments = new Instruments(this.instEl);
    this.landingEl = h('div', {});
    this.el = h('div', { class: 'hud' },
      h('div', { class: 'hud-top' },
        h('div', { class: 'hud-box' }, h('div', { class: 'hud-title' }, this.titleEl, this.chipsEl), this.subEl),
        h('div', { class: 'hud-right' },
          h('div', { class: 'hud-box wind-ind' }, this.windArrow, this.windText),
          this.perfEl)),
      h('div', { class: 'hud-tele hud-box' },
        tv('spd', L('Velocidad', 'Airspeed')), tv('alt', L('Altura', 'Height')), tv('vs', L('V. vertical', 'V. speed')),
        tv('hdg', L('Rumbo', 'Heading'), true), tv('dist', L('Distancia', 'Distance')), tv('rpm', 'RPM', true),
        thrBox, battBox, tv('cfg', L('Configuración', 'Config'), true)),
      this.instEl, this.stallEl, this.centerEl, this.launchEl, this.missionEl, this.landingEl);
    this.app.uiRoot.prepend(this.el);
    this.applyPrefs();
    return this.el;
  }

  applyPrefs() {
    if (!this.el) return;
    const u = this.app.settings.ui;
    this.el.classList.toggle('hidden', !u.hud);
    this.el.style.setProperty('--hud-scale', u.hudScale);
    this.el.style.setProperty('--hud-opacity', u.hudOpacity);
    this.instEl.classList.toggle('hidden', !u.instruments);
  }

  setAircraft(spec) {
    if (!this.el) this.build();
    this.spec = spec;
    this.titleEl.textContent = spec.name;
    this.instruments.setAircraft(spec);
    const p = spec.prop.type;
    this.t.batt.box.querySelector('span').textContent = p === 'electric' || p === 'edf' ? L('Batería', 'Battery') : L('Combustible', 'Fuel');
    this.t.batt.box.classList.toggle('hidden', p === 'none');
    this.t.thr.box.classList.toggle('hidden', p === 'none');
    this.t.rpm.box.classList.toggle('hidden', p === 'none');
    this.missionEl.classList.add('hidden');
    this.landingEl.replaceChildren();
  }

  show(v) { this.el?.classList.toggle('hidden', !v || !this.app.settings.ui.hud); }

  /* ── mensajes ── */
  maneuver(m) {
    const pop = h('div', { class: 'maneuver-pop' }, h('b', {}, m.name), m.score != null ? h('span', {}, `${L('Ejecución', 'Execution')} ${m.score.toFixed(1)} / 10`) : null);
    this.centerEl.replaceChildren(pop);
    clearTimeout(this.manT);
    this.manT = setTimeout(() => pop.remove(), 2600);
  }

  landing(r) {
    const d = (k, v) => h('span', {}, k, h('b', {}, v));
    const card = h('div', { class: 'landing-card hud-box' },
      h('div', { style: { fontSize: '.72em', color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase' } }, L('Aterrizaje', 'Landing')),
      h('h3', {}, T(r.grade)),
      h('div', { class: 'score' }, String(r.score)),
      h('div', { class: 'det' },
        d(L('Contacto ', 'Touchdown '), `${r.vs.toFixed(2)} m/s`),
        d(L('Velocidad ', 'Speed '), `${(r.speedRatio).toFixed(2)}×Vs`),
        d(L('Alineación ', 'Alignment '), r.alignErr != null ? `${r.alignErr.toFixed(0)}°` : '—'),
        d(L('Alabeo ', 'Bank '), `${r.bank.toFixed(0)}°`),
        d(L('Rebotes ', 'Bounces '), String(r.bounces)),
        d(r.targetDist != null ? L('A la diana ', 'To target ') : L('En pista ', 'On runway '), r.targetDist != null ? `${r.targetDist.toFixed(1)} m` : (r.onRunway ? L('sí', 'yes') : 'no'))));
    this.landingEl.replaceChildren(card);
    clearTimeout(this.landT);
    this.landT = setTimeout(() => card.remove(), 5500);
  }

  /** Diagrama de emisora con el stick y la dirección a mover. */
  txDiagram(stick) {
    const mode = this.app.settings.controls.mode;
    const map = MODE_MAP[mode] || MODE_MAP[2];
    const [ch, dir] = stick;
    const sides = ['left', 'right'].map((side) => {
      const axis = map[side].x === ch ? 'x' : map[side].y === ch ? 'y' : null;
      let tx = 0, ty = 0;
      if (axis === 'x') tx = dir * 28;
      if (axis === 'y') ty = ch === 'elevator' ? dir * 28 : -dir * 28; // tirar = stick hacia abajo
      return h('div', { class: `tx-stick${axis ? ' active' : ''}` }, h('i', { style: { transform: `translate(calc(-50% + ${tx * 0.6}px), calc(-50% + ${ty * 0.6}px))`, background: axis ? 'var(--accent)' : 'rgba(255,255,255,.3)' } }));
    });
    return h('div', { class: 'tx-diagram' }, sides);
  }

  updateMission(mission) {
    const el = this.missionEl;
    if (!mission || mission.finished) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const m = mission.m;
    if (mission.isLesson) {
      const step = mission.currentStep;
      if (this.lastStep !== `${m.id}-${mission.step}`) {
        this.lastStep = `${m.id}-${mission.step}`;
        this.progEl = h('i', { style: { width: '0%' } });
        el.replaceChildren(
          h('div', { class: 'mtitle' }, `${T(m.title)} · ${mission.step + 1}/${m.steps.length}`),
          h('div', { class: 'mtext' }, T(step.text)),
          step.stick && this.app.settings.ui.instructor ? this.txDiagram(step.stick) : null,
          h('div', { class: 'mprog' }, this.progEl),
          this.metaEl = h('div', { class: 'mmeta' }));
      }
      this.progEl.style.width = `${Math.round((mission.progress || 0) * 100)}%`;
      this.metaEl.replaceChildren(h('span', {}, fmtTime(mission.time)), h('span', {}, mission.resets ? `${L('reinicios', 'resets')}: ${mission.resets}` : ''));
    } else {
      const st = mission.lastStatus || {};
      if (this.lastStep !== m.id) {
        this.lastStep = m.id;
        el.replaceChildren(h('div', { class: 'mtitle' }, L('Desafío', 'Challenge')), h('div', { class: 'mtext' }, T(m.title)), h('div', { class: 'mtext', style: { color: 'var(--muted)', fontSize: '.84em' } }, T(m.desc)), this.metaEl = h('div', { class: 'mmeta' }));
      }
      const left = m.timeLimit ? Math.max(0, m.timeLimit - mission.time) : null;
      this.metaEl.replaceChildren(h('span', { style: { color: st.warn ? 'var(--warn)' : '' } }, st.progressText || ''), h('span', {}, left != null ? `⏱ ${fmtTime(left)}` : fmtTime(mission.time)));
    }
  }

  /** Actualización por fotograma (texto a ~15 Hz, instrumentos a ~12 Hz). */
  update(dt, sim) {
    if (!this.el || this.el.classList.contains('hidden')) return;
    const ac = sim.aircraft;
    if (!ac) return;
    const t = ac.telemetry;
    this.stallEl.classList.toggle('hidden', !(t.stall > 0.3 && !t.onGround && t.agl > 2 && !ac.destroyed));
    this.acc += dt;
    this.instAcc += dt;
    if (this.acc < 1 / 15) return;
    this.acc = 0;
    const s = this.app.settings;
    const set = (k, v, cls = '') => { this.t[k].b.textContent = v; this.t[k].box.className = `${this.t[k].base} ${cls}`; };
    set('spd', fmtSpeed(t.airspeed), t.airspeed < ac.spec.perf.stallSpeed * 1.1 && !t.onGround ? 'warn' : '');
    set('alt', fmtAlt(t.agl));
    set('vs', fmtVs(t.vs), t.vs < -6 && t.agl < 30 ? 'danger' : '');
    set('hdg', `${String(Math.round(t.heading * RAD) % 360).padStart(3, '0')}°`);
    const env = sim.env;
    const dist = Math.hypot(ac.pos.x - env.pilot.x, ac.pos.z - env.pilot.z);
    set('dist', fmtDist(dist), sim.signal < 0.5 ? 'warn' : '');
    const e = ac.engine;
    set('rpm', e.type === 'turbine' ? `${Math.round(e.r * 100)}% N1` : `${(e.rpm / 1000).toFixed(1)}k`, !e.running && e.type !== 'none' ? 'danger' : '');
    set('thr', `${Math.round(ac.cmd.throttle * 100)}%`);
    this.thrBar.style.width = `${ac.cmd.throttle * 100}%`;
    const rem = e.remaining;
    set('batt', e.isElectric ? `${Math.round(rem * 100)}% · ${e.voltage.toFixed(1)}V` : `${Math.round(rem * 100)}%`, rem < 0.15 ? 'danger' : rem < 0.3 ? 'warn' : '');
    this.battBar.style.width = `${rem * 100}%`;
    this.battWrap.classList.toggle('low', rem < 0.2);
    const cfgParts = [];
    if (ac.spec.hasFlaps) cfgParts.push(`F${Math.round(ac.defl.flap * 100)}`);
    if (ac.spec.retract) cfgParts.push(ac.gearPos > 0.95 ? L('Tren ↓', 'Gear ↓') : ac.gearPos < 0.05 ? L('Tren ↑', 'Gear ↑') : L('Tren …', 'Gear …'));
    if (ac.spec.hasSpoilers && ac.defl.airbrake > 0.05) cfgParts.push(L('Frenos aire', 'Airbrake'));
    if (ac.cmd.brake > 0.5 && t.wheelsOnGround) cfgParts.push(L('Freno', 'Brake'));
    set('cfg', cfgParts.join(' · ') || '—');
    // cabecera
    this.chipsEl.replaceChildren(...[
      h('span', { class: 'chip accent' }, L(...ASSIST_NAMES[s.physics.assist])),
      h('span', { class: 'chip' }, L(...CAM_NAMES[sim.cameras.mode])),
      sim.cameras.mode === 'pilot' && !sim.cameras.tracking ? h('span', { class: 'chip' }, L('Sin seguimiento', 'No tracking')) : null].filter(Boolean));
    this.subEl.replaceChildren(h('span', {}, `⏱ ${fmtTime(sim.flightTime || 0)}`), h('span', {}, `${L('Pista', 'RWY')} ${env.runways[0]?.name || ''}`), this.signalEl);
    const bars = Math.ceil(sim.signal * 4);
    [...this.signalEl.children].forEach((b, i) => b.classList.toggle('on', i < bars));
    this.signalEl.className = `signal${sim.failsafe ? ' lost' : sim.signal < 0.5 ? ' weak' : ''}`;
    // viento relativo a la vista
    const w = sim.weather;
    const camDir = sim.cameras.camera.getWorldDirection(this._v || (this._v = sim.cameras.camera.position.clone()));
    const camYaw = Math.atan2(camDir.x, -camDir.z);
    const windTo = Math.atan2(w.windDirX, -w.windDirZ);
    this.windArrow.style.transform = `rotate(${(windTo - camYaw) * RAD}deg)`;
    this.windArrow.style.opacity = w.cfg.windSpeed < 0.3 ? 0.3 : 1;
    this.windText.replaceChildren(document.createTextNode(fmtSpeed(t.windSpeed)), h('span', {}, `${L('desde', 'from')} ${Math.round(w.cfg.windDir)}°${t.windVertical > 0.4 ? ` · ↑${t.windVertical.toFixed(1)}` : ''}`));
    // indicaciones de lanzamiento (el botón táctil sólo aparece cuando hay algo que lanzar)
    this.app.input.touch.buttons.launch?.classList.toggle('hidden', !ac.held);
    if (ac.held) {
      const touch = document.body.classList.contains('touch');
      this.launchEl.classList.remove('hidden');
      this.launchEl.replaceChildren(sim.launchMode === 'bungee'
        ? h('span', {}, L('Goma tensada. ', 'Bungee tensioned. '), touch ? L('Pulsa «Lanzar»', 'Tap «Launch»') : h('span', {}, L('Pulsa ', 'Press '), h('kbd', {}, 'Espacio'), L(' para soltar', ' to release')))
        : h('span', {}, ac.engine.type !== 'none' ? L('Da motor y ', 'Add power and ') : '', touch ? L('pulsa «Lanzar»', 'tap «Launch»') : h('span', {}, L('pulsa ', 'press '), h('kbd', {}, 'Espacio')), L(' para lanzar a mano', ' to hand-launch')));
    } else this.launchEl.classList.add('hidden');
    // rendimiento
    this.perfEl.classList.toggle('hidden', !s.graphics.showFps);
    if (s.graphics.showFps) {
      const fs = sim.frameStats;
      const info = this.app.renderer.info;
      const mem = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : '—';
      this.perfEl.innerHTML = `${Math.round(this.app.fps)} FPS · ${fs.frameMs.toFixed(1)} ms<br>${L('Física', 'Physics')} ${fs.physicsSteps ?? 0}×240Hz · ${(fs.physicsCalcMs ?? 0).toFixed(2)} ms<br>${info.calls} draw · ${(info.triangles / 1000).toFixed(0)}k tri<br>${L('Memoria', 'Memory')} ${mem} · ${info.geometries} geo · ${info.textures} tex<br>${L('Resolución', 'Resolution')} ${Math.round(this.app.renderer.pixelRatio * 100)}%`;
    }
    this.updateMission(sim.mission);
    if (this.instAcc > 1 / 12 && s.ui.instruments) {
      this.instAcc = 0;
      this.instruments.draw(t, { rpmFrac: e.r, rpmMax: e.spec.rpm || 10000, turbine: e.type === 'turbine', remaining: rem, voltage: e.isElectric ? e.voltage : 0 });
    }
    void clamp;
  }

  destroy() {
    this.el?.remove();
    this.el = null;
  }
}
