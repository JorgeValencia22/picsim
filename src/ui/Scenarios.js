/** Catálogo de escenarios con descripción, características y acceso directo al vuelo. */
import { h, icon, envArt } from './dom.js';
import { Screen } from './UIManager.js';
import { L, T } from '../core/i18n.js';
import { ENVIRONMENTS, environmentMeta } from '../data/environmentData.js';

export class ScenariosScreen extends Screen {
  build() {
    const a = this.app;
    return h('div', { class: 'screen dim' },
      this.head(L('Escenarios', 'Scenarios'), L('Seis entornos originales generados proceduralmente', 'Six original procedurally generated environments')),
      h('div', { class: 'scroll', style: { flex: 1 } },
        h('div', { class: 'env-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' } }, ENVIRONMENTS.map((e) => {
          const m = environmentMeta(e.id);
          return h('div', { class: 'env-card panel' },
            h('div', { class: 'art', style: { height: '130px' }, html: envArt(e.icon, m.gradient) }),
            h('div', { class: 'body' },
              h('b', { style: { fontSize: '1.1em' } }, T(m.name)),
              h('p', {}, T(m.desc)),
              h('div', { class: 'tags' }, T(m.tags).map((t) => h('span', { class: 'chip' }, t)), h('span', { class: 'chip cyan' }, `${(m.size / 1000).toFixed(1)} × ${(m.size / 1000).toFixed(1)} km`), h('span', { class: 'chip' }, `${m.elevation} m s.n.m.`)),
              h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary small', onClick: () => { a.settings.flight.environment = e.id; a.saveSettings('flight'); a.openFlightMenu('scenario'); } }, h('span', { html: icon('fly') }).firstChild, L('Volar aquí', 'Fly here')))));
        }))));
  }
}
