/** Lista de lecciones del modo entrenamiento con progreso y mejor puntuación. */
import { h, icon, dots } from './dom.js';
import { Screen } from './UIManager.js';
import { L, T } from '../core/i18n.js';
import { LESSONS } from '../gameplay/Missions.js';

export class TrainingScreen extends Screen {
  build() {
    const a = this.app;
    const rec = a.stats.records('lesson');
    const done = LESSONS.filter((l) => rec[l.id]).length;
    return h('div', { class: 'screen dim' },
      this.head(L('Entrenamiento', 'Training'), L(`Aprende paso a paso · ${done}/${LESSONS.length} lecciones completadas`, `Learn step by step · ${done}/${LESSONS.length} lessons completed`)),
      h('div', { class: 'scroll', style: { flex: 1 } },
        h('div', { class: 'card-list' }, LESSONS.map((l, i) => {
          const r = rec[l.id];
          const spec = a.registry.get(l.setup.aircraft);
          return h('button', { class: 'mission-card', onClick: () => a.startMission(l) },
            h('div', { class: 'row' }, h('span', { class: 'chip accent' }, `${i + 1}`), h('span', { class: 'chip' }, L('Dificultad ', 'Difficulty '), dots(l.difficulty)), r ? h('span', { class: 'stars' }, '★'.repeat(r.stars || 1) + '☆'.repeat(3 - (r.stars || 1))) : null),
            h('h3', {}, T(l.title)),
            h('p', {}, T(l.desc)),
            h('div', { class: 'row', style: { color: 'var(--muted)', fontSize: '.8em' } }, h('span', { html: icon('plane') }).firstChild, spec.name, ` · ${l.steps.length} ${L('objetivos', 'objectives')}`, r ? ` · ${L('mejor', 'best')}: ${r.score}` : ''));
        })),
        h('p', { class: 'note', style: { marginTop: '16px' } }, L('El instructor muestra en pantalla qué stick mover según tu modo de emisora. Nunca toma el control: sólo las asistencias que elijas modifican tus órdenes.', 'The instructor shows on screen which stick to move for your transmitter mode. It never takes control: only the assists you choose modify your inputs.'))));
  }
}
