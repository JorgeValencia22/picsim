/** Lista de desafíos con dificultad, límite de tiempo, medalla y récord personal. */
import { h, icon, dots } from './dom.js';
import { Screen } from './UIManager.js';
import { L, T, fmtTime } from '../core/i18n.js';
import { CHALLENGES } from '../gameplay/Missions.js';

export function medalBadge(medal) {
  const t = { gold: L('O', 'G'), silver: L('P', 'S'), bronze: 'B' };
  const tip = { gold: L('Oro', 'Gold'), silver: L('Plata', 'Silver'), bronze: L('Bronce', 'Bronze') };
  return h('span', { class: `medal ${medal || 'none'}`, title: medal ? tip[medal] : L('Sin medalla', 'No medal') }, medal ? t[medal] : '–');
}

export class ChallengesScreen extends Screen {
  build() {
    const a = this.app;
    const rec = a.stats.records('challenge');
    const sorted = [...CHALLENGES].sort((x, y) => x.difficulty - y.difficulty);
    return h('div', { class: 'screen dim' },
      this.head(L('Desafíos', 'Challenges'), L('Pruebas con puntuación, medallas y récord personal', 'Scored tests with medals and personal bests')),
      h('div', { class: 'scroll', style: { flex: 1 } },
        h('div', { class: 'card-list' }, sorted.map((c) => {
          const r = rec[c.id];
          const spec = a.registry.get(c.setup.aircraft);
          return h('button', { class: 'mission-card', onClick: () => a.startMission(c) },
            h('div', { class: 'row' }, medalBadge(r?.medal), h('span', { class: 'chip' }, L('Dificultad ', 'Difficulty '), dots(c.difficulty)), c.timeLimit ? h('span', { class: 'chip' }, `⏱ ${fmtTime(c.timeLimit)}`) : null),
            h('h3', {}, T(c.title)),
            h('p', {}, T(c.desc)),
            h('div', { class: 'row', style: { color: 'var(--muted)', fontSize: '.8em' } },
              h('span', { html: icon('plane') }).firstChild, spec.name,
              ` · ${L('medallas', 'medals')}: ${c.medals.bronze}/${c.medals.silver}/${c.medals.gold} ${c.unit}`,
              r ? ` · ${L('récord', 'best')}: ${r.score} ${c.unit}` : ''));
        }))));
  }
}
