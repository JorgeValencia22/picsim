/** Estadísticas: totales, gráficos de uso, maniobras, historial y repeticiones guardadas. */
import { h, icon } from './dom.js';
import { Screen } from './UIManager.js';
import { L, T, fmtTime, fmtDist, fmtSpeed, fmtAlt } from '../core/i18n.js';
import { MANEUVERS } from '../gameplay/ManeuverDetector.js';

function bars(items, fmt) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return h('div', { class: 'bars' }, items.length ? items.map((i) => h('div', { class: 'bar-row' },
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, i.label),
    h('div', { class: 'b' }, h('i', { style: { width: `${(i.value / max) * 100}%` } })),
    h('span', { class: 'v' }, fmt(i.value)))) : h('p', { class: 'note' }, L('Sin datos todavía.', 'No data yet.')));
}

export class StatisticsScreen extends Screen {
  onShow() { this.loadReplays(); }

  async loadReplays() {
    const list = await this.app.replayStore.list();
    const box = this.el?.querySelector('.replay-list');
    if (!box) return;
    box.replaceChildren(...(list.length ? list.map((r) => h('div', { class: 'bar-row', style: { gridTemplateColumns: '1fr auto auto' } },
      h('span', {}, `${r.meta.aircraftName} · ${r.meta.envName} · ${new Date(r.meta.date).toLocaleString()}`),
      h('span', { class: 'v' }, fmtTime(r.meta.duration)),
      h('span', { style: { display: 'flex', gap: '6px' } },
        h('button', { class: 'btn small', onClick: async () => { const full = await this.app.replayStore.get(r.id); if (full) this.app.watchReplay(full); } }, h('span', { html: icon('play') }).firstChild, L('Ver', 'Watch')),
        h('button', { class: 'btn small icon ghost', 'aria-label': L('Borrar', 'Delete'), onClick: async () => { await this.app.replayStore.remove(r.id); this.loadReplays(); }, html: icon('trash') })))) : [h('p', { class: 'note' }, L('Las repeticiones de tus vuelos (más de 8 s) se guardan automáticamente en este dispositivo.', 'Replays of your flights (over 8 s) are saved automatically on this device.'))]));
  }

  build() {
    const d = this.app.stats.data;
    const tile = (v, l) => h('div', { class: 'tile' }, h('b', {}, v), h('span', {}, l));
    const acItems = Object.values(d.aircraft).sort((a, b) => b.time - a.time).slice(0, 8).map((x) => ({ label: x.name, value: x.time }));
    const envItems = Object.values(d.environments).sort((a, b) => b.time - a.time).map((x) => ({ label: x.name, value: x.time }));
    const manItems = Object.entries(d.maneuvers).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: T(MANEUVERS[k]) || k, value: v }));
    const hist = d.history.slice(0, 15);
    const totalMan = Object.values(d.maneuvers).reduce((a, b) => a + b, 0);
    // gráfico de los últimos vuelos (duración)
    const recent = [...hist].reverse();
    const maxT = Math.max(60, ...recent.map((x) => x.time));
    const chart = h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '4px', height: '90px', padding: '6px 0', borderBottom: '1px solid var(--line)' } },
      recent.map((x) => h('div', { title: `${x.aircraft} · ${fmtTime(x.time)}`, style: { flex: 1, height: `${Math.max(4, (x.time / maxT) * 100)}%`, background: x.crashed ? 'var(--danger)' : 'linear-gradient(180deg, #ffc07a, var(--accent))', borderRadius: '3px 3px 0 0', opacity: 0.85 } })));
    return h('div', { class: 'screen dim' },
      this.head(L('Estadísticas', 'Statistics'), L('Registro local de tu actividad de vuelo', 'Local record of your flying activity')),
      h('div', { class: 'scroll', style: { flex: 1 } },
        h('div', { class: 'stat-tiles' },
          tile((d.flightTime / 3600).toFixed(1) + ' h', L('Horas de vuelo', 'Flight hours')),
          tile(fmtTime(d.airTime), L('Tiempo en el aire', 'Airtime')),
          tile(String(d.flights), L('Vuelos completados', 'Flights')),
          tile(fmtDist(d.distance), L('Distancia recorrida', 'Distance flown')),
          tile(String(d.landings), L('Aterrizajes', 'Landings')),
          tile(String(d.perfectLandings), L('Aterrizajes perfectos', 'Perfect landings')),
          tile(String(d.crashes), L('Accidentes', 'Crashes')),
          tile(String(d.collisions), L('Colisiones', 'Collisions')),
          tile(String(totalMan), L('Maniobras', 'Manoeuvres')),
          tile(String(d.bestLanding), L('Mejor aterrizaje', 'Best landing')),
          tile(fmtTime(d.longestFlight), L('Vuelo más largo', 'Longest flight')),
          tile(fmtSpeed(d.maxSpeed), L('Velocidad máxima', 'Top speed')),
          tile(fmtAlt(d.maxAltitude), L('Altura máxima', 'Max height'))),
        h('div', { class: 'section-title' }, L('Últimos vuelos (duración)', 'Recent flights (duration)')), chart,
        h('div', { class: 'two-col', style: { marginTop: '6px' } },
          h('div', {}, h('div', { class: 'section-title' }, L('Aeronaves más utilizadas', 'Most flown aircraft')), bars(acItems, fmtTime)),
          h('div', {}, h('div', { class: 'section-title' }, L('Escenarios más utilizados', 'Most used scenarios')), bars(envItems, fmtTime))),
        h('div', { class: 'section-title' }, L('Maniobras realizadas', 'Manoeuvres performed')), bars(manItems, (v) => String(v)),
        h('div', { class: 'section-title' }, L('Historial', 'History')),
        hist.length ? h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'history' },
          h('thead', {}, h('tr', {}, [L('Fecha', 'Date'), L('Aeronave', 'Aircraft'), L('Escenario', 'Scenario'), L('Duración', 'Duration'), L('Aterrizajes', 'Landings'), L('Mejor', 'Best'), L('Estado', 'Status')].map((x) => h('th', {}, x)))),
          h('tbody', {}, hist.map((x) => h('tr', {},
            h('td', {}, new Date(x.date).toLocaleDateString()), h('td', {}, x.aircraft), h('td', {}, x.env), h('td', { class: 'mono' }, fmtTime(x.time)),
            h('td', {}, String(x.landings)), h('td', {}, x.bestLanding ? String(x.bestLanding) : '—'), h('td', {}, x.crashed ? L('Accidente', 'Crash') : 'OK')))))) : h('p', { class: 'note' }, L('Aún no hay vuelos registrados.', 'No flights recorded yet.')),
        h('div', { class: 'section-title' }, L('Repeticiones guardadas', 'Saved replays')),
        h('div', { class: 'replay-list bars' }, h('p', { class: 'note' }, L('Cargando…', 'Loading…'))),
        h('div', { style: { marginTop: '18px' } }, h('button', { class: 'btn small danger', onClick: () => this.app.ui.modal({
          title: L('Restablecer estadísticas', 'Reset statistics'), text: L('Se borrarán todas las estadísticas y el historial. No afecta a récords ni repeticiones.', 'All statistics and history will be erased. Records and replays are kept.'),
          actions: [{ label: L('Cancelar', 'Cancel') }, { label: L('Restablecer', 'Reset'), kind: 'danger', onClick: () => { this.app.stats.reset(); this.refresh(); this.onShow(); } }],
        }) }, h('span', { html: icon('trash') }).firstChild, L('Restablecer estadísticas', 'Reset statistics')))));
  }
}
