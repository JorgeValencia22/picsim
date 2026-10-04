/** Menú principal sobre la escena 3D animada (vuelo de demostración real con piloto automático). */
import { h, icon } from './dom.js';
import { Screen } from './UIManager.js';
import { L } from '../core/i18n.js';
import { canFullscreen, isIOS, isStandalone } from '../core/Platform.js';

export const LOGO_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M8 38 L32 31 L56 38 L32 41 Z" fill="#ff8a1f"/>
  <path d="M29 18 h6 l2.5 30 h-11 Z" fill="#e9eef4"/>
  <path d="M24 49 h16 l-2 4 h-12 Z" fill="#e9eef4"/>
  <path d="M44 12 a14 14 0 0 1 8 8" stroke="#3ec6ff" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M44 5 a21 21 0 0 1 15 15" stroke="#3ec6ff" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.6"/></svg>`;

export class MainMenu extends Screen {
  build() {
    const a = this.app;
    const item = (ic, label, fn, primary = false) => h('button', { class: `menu-item${primary ? ' primary' : ''}`, onClick: fn, onMouseenter: () => a.audio.play('hover') }, h('span', { html: icon(ic) }).firstChild, h('span', {}, label));
    const last = a.settings.flight;
    const ac = a.registry.list().find((x) => x.id === last.aircraft);
    return h('div', { class: 'screen main-menu' },
      h('div', { class: 'logo' }, h('span', { html: LOGO_SVG }).firstChild, h('div', { class: 'wordmark' }, h('b', {}, 'RC FLIGHT'), h('span', {}, 'SIMULATOR'))),
      h('nav', { class: 'menu-list', 'aria-label': L('Menú principal', 'Main menu') },
        item('fly', L('Volar', 'Fly'), () => a.openFlightMenu(), true),
        item('plane', L('Aeronaves', 'Aircraft'), () => a.openHangar()),
        item('map', L('Escenarios', 'Scenarios'), () => a.openScenarios()),
        item('school', L('Entrenamiento', 'Training'), () => a.openTraining()),
        item('trophy', L('Desafíos', 'Challenges'), () => a.openChallenges()),
        item('settings', L('Configuración', 'Settings'), () => a.openSettings()),
        item('stats', L('Estadísticas', 'Statistics'), () => a.openStats()),
        item('info', L('Créditos', 'Credits'), () => a.openCredits())),
      h('div', { class: 'menu-quick' },
        canFullscreen() ? h('button', { class: 'btn small ghost', onClick: () => a.toggleFullscreen(), html: `${icon('fullscreen')}<span>${L('Pantalla completa', 'Fullscreen')}</span>` })
          : (isIOS() && !isStandalone() ? h('button', { class: 'btn small ghost', onClick: () => a.ui.modal({ title: L('Instalar en el iPhone', 'Install on iPhone'), text: L('Para jugar a pantalla completa: pulsa Compartir en Safari y elige «Añadir a pantalla de inicio». Se abrirá como una aplicación, en horizontal y sin barras.', 'To play full screen: tap Share in Safari and choose «Add to Home Screen». It will open like an app, in landscape, with no bars.'), actions: [{ label: 'OK', kind: 'primary' }] }), html: `${icon('fullscreen')}<span>${L('Pantalla completa', 'Full screen')}</span>` }) : null),
        h('button', { class: 'btn small ghost', onClick: () => { a.settings.ui.language = a.settings.ui.language === 'es' ? 'en' : 'es'; a.applyLanguage(); a.saveSettings('ui'); } }, a.settings.ui.language === 'es' ? 'English' : 'Español')),
      h('div', { class: 'menu-foot' },
        h('div', {}, L('Último vuelo: ', 'Last flight: '), h('b', {}, ac ? ac.name : '—')),
        h('div', {}, 'v1.0 · Three.js · WebGL2')));
  }
}
