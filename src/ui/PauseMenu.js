/** Menú de pausa: continuar, reiniciar, cambiar aeronave/escenario/clima, configuración, repetición y salir. */
import { h, icon } from './dom.js';
import { L } from '../core/i18n.js';

export class PauseMenu {
  constructor(app) {
    this.app = app;
    this.el = null;
  }

  get open() { return !!this.el; }

  show() {
    if (this.el) return;
    const a = this.app;
    const b = (ic, label, fn, cls = '') => h('button', { class: `btn ${cls}`, onClick: fn }, h('span', { html: icon(ic) }).firstChild, label);
    const mission = a.sim.mission;
    this.el = h('div', { class: 'pause-menu', role: 'dialog', 'aria-label': L('Pausa', 'Pause') },
      h('div', { class: 'pause-card panel' },
        h('h2', {}, L('Pausa', 'Paused')),
        b('play', L('Continuar', 'Resume'), () => a.resume(), 'primary'),
        b('reset', L('Reiniciar aeronave', 'Reset aircraft'), () => { a.resume(); a.sim.resetAircraft(); }),
        mission ? null : h('div', { class: 'row2' },
          b('plane', L('Cambiar aeronave', 'Change aircraft'), () => a.openFlightMenu('aircraft', true)),
          b('map', L('Cambiar escenario', 'Change scenario'), () => a.openFlightMenu('scenario', true))),
        mission ? null : b('cloud', L('Clima y hora', 'Weather & time'), () => a.openFlightMenu('weather', true)),
        b('settings', L('Configuración', 'Settings'), () => a.openSettings()),
        b('replay', L('Ver repetición de este vuelo', 'Watch replay of this flight'), () => a.replayCurrentFlight()),
        document.body.classList.contains('touch') ? b('touch', L('Editar controles táctiles', 'Edit touch controls'), () => { a.resume(); a.editTouchLayout(); }) : null,
        b('fullscreen', L('Pantalla completa', 'Fullscreen'), () => a.toggleFullscreen()),
        b('exit', mission ? L('Abandonar y volver al menú', 'Quit to menu') : L('Salir al menú principal', 'Exit to main menu'), () => a.exitToMenu(), 'danger')));
    a.uiRoot.append(this.el);
    this.el.querySelector('.btn')?.focus();
  }

  hide() {
    this.el?.remove();
    this.el = null;
  }
}
