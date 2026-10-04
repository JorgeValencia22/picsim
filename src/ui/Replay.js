/**
 * Controles de repetición y modo espectador: reproducir/pausar, retroceder/avanzar 5 s,
 * barra de tiempo, velocidad (0,25×–4×), cambio de cámara, reinicio y salida.
 */
import { h, icon } from './dom.js';
import { L, fmtTime } from '../core/i18n.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const CAMS = ['chase', 'pilot', 'cinematic', 'onboard', 'free'];

export class ReplayUI {
  constructor(app) {
    this.app = app;
    this.el = null;
  }

  show(player, meta) {
    this.hide();
    this.player = player;
    const a = this.app;
    const btn = (ic, label, fn) => h('button', { class: 'btn small icon', 'aria-label': label, title: label, onClick: fn, html: icon(ic) });
    this.playBtn = btn('pause', L('Reproducir / pausa', 'Play / pause'), () => { player.playing = !player.playing; if (player.playing && player.time >= player.duration) player.restart(); });
    this.slider = h('input', { type: 'range', min: 0, max: player.duration, step: 0.05, value: 0, 'aria-label': L('Tiempo', 'Time') });
    this.slider.addEventListener('input', () => { player.seek(Number(this.slider.value)); this.dragging = true; });
    this.slider.addEventListener('change', () => { this.dragging = false; });
    this.timeEl = h('span', { class: 'time' }, '0:00');
    this.speedBtn = h('button', { class: 'btn small', onClick: () => { const i = (SPEEDS.indexOf(player.speed) + 1) % SPEEDS.length; player.speed = SPEEDS[i]; this.speedBtn.textContent = `${player.speed}×`; } }, '1×');
    this.camBtn = h('button', { class: 'btn small', onClick: () => { const i = (CAMS.indexOf(a.sim.cameras.mode) + 1) % CAMS.length; a.sim.cameras.setMode(CAMS[i]); this.camBtn.lastChild.textContent = this.camName(); } }, h('span', { html: icon('camera') }).firstChild, h('span', {}, this.camName()));
    this.el = h('div', {},
      h('div', { class: 'replay-tag hud-box' }, h('b', {}, L('REPETICIÓN', 'REPLAY')), ` · ${meta.aircraftName} · ${meta.envName}`),
      h('div', { class: 'replay-bar panel' },
        h('div', { class: 'row' }, this.timeEl, this.slider),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          btn('reset', L('Reiniciar', 'Restart'), () => player.restart()),
          btn('rew', L('Retroceder 5 s', 'Back 5 s'), () => player.seek(player.time - 5)),
          this.playBtn,
          btn('skip', L('Avanzar 5 s', 'Forward 5 s'), () => player.seek(player.time + 5)),
          this.speedBtn, this.camBtn,
          h('button', { class: 'btn small danger', onClick: () => a.exitReplay() }, h('span', { html: icon('exit') }).firstChild, L('Salir', 'Exit')))));
    a.uiRoot.append(this.el);
  }

  camName() {
    const n = { chase: L('Seguimiento', 'Chase'), pilot: L('Piloto', 'Pilot'), cinematic: L('Cine', 'Cinematic'), onboard: L('A bordo', 'Onboard'), free: L('Libre', 'Free') };
    return n[this.app.sim.cameras.mode] || '';
  }

  update() {
    const p = this.player;
    if (!this.el || !p) return;
    if (!this.dragging) this.slider.value = p.time;
    this.timeEl.textContent = `${fmtTime(p.time)} / ${fmtTime(p.duration)}`;
    const want = p.playing ? 'pause' : 'play';
    if (this.playBtn.dataset.icon !== want) { this.playBtn.innerHTML = icon(want); this.playBtn.dataset.icon = want; }
  }

  hide() {
    this.el?.remove();
    this.el = null;
    this.player = null;
  }
}
