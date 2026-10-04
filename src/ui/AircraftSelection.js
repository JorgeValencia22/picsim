/**
 * Hangar: catálogo de aeronaves con vista 3D, ficha técnica, personalización visual
 * (varias decoraciones guardables por avión) y editor de parámetros físicos con
 * advertencias de estabilidad. Los cambios visuales no alteran la aerodinámica.
 */
import { h, icon, dots, field, select, range, segmented } from './dom.js';
import { Screen } from './UIManager.js';
import { L, T } from '../core/i18n.js';
import { CATEGORIES, AIRFOILS } from '../data/aircraftData.js';
import { buildFullSpec, AircraftRegistry, EDITOR_LIMITS } from '../aircraft/AircraftRegistry.js';
import { specTable } from './specSheet.js';
import { fmtSpeed } from '../core/i18n.js';

const PATTERNS = ['stripe', 'checker', 'sunburst', 'tips', 'lightning', 'swoosh', 'camo', 'invasion', 'arrow', 'zigzag'];
const PATTERN_LABELS = { stripe: ['Franjas', 'Stripes'], checker: ['Damero', 'Checker'], sunburst: ['Rayos de sol', 'Sunburst'], tips: ['Puntas', 'Tips'], lightning: ['Rayo', 'Lightning'], swoosh: ['Curva', 'Swoosh'], camo: ['Camuflaje', 'Camo'], invasion: ['Bandas de invasión', 'Invasion stripes'], arrow: ['Flecha', 'Arrow'], zigzag: ['Zigzag', 'Zigzag'] };

export class AircraftSelection extends Screen {
  constructor(app) {
    super(app);
    this.sel = app.registry.exists(app.settings.flight.aircraft) ? app.settings.flight.aircraft : 'skylark';
    this.filter = 'all';
    this.tab = 'spec';
    this.editMods = null;
  }

  onShow() {
    const wrap = this.el.querySelector('.preview-wrap');
    this.app.preview.mount(wrap);
    this.showPreview();
  }

  onHide() { this.app.preview.unmount(); }

  /* ── decoraciones ── */
  liveries() {
    const all = this.app.storage.get('liveries', {});
    return all[this.sel] || { slots: [], active: -1 };
  }

  saveLiveries(entry) {
    const all = this.app.storage.get('liveries', {});
    all[this.sel] = entry;
    this.app.storage.set('liveries', all);
  }

  currentLivery() {
    const e = this.liveries();
    const spec = this.app.registry.get(this.sel);
    if (this.draftLivery) return this.draftLivery;
    if (e.active >= 0 && e.slots[e.active]) return { ...spec.paint, ...e.slots[e.active].livery };
    return { ...spec.paint, registration: '', propColor: '#1a1a1a', wheelColor: '#d8d8d8' };
  }

  showPreview(specOverride) {
    const spec = specOverride || this.app.registry.get(this.sel);
    this.app.preview.setAircraft(spec, this.currentLivery());
  }

  build() {
    const a = this.app;
    const list = a.registry.list();
    const grid = h('div', { class: 'ac-grid' });
    const drawGrid = () => {
      grid.replaceChildren(...list.filter((x) => this.filter === 'all' || x.category === this.filter || (this.filter === 'custom' && x.custom)).map((x) => h('button', {
        class: `ac-card${x.id === this.sel ? ' on' : ''}`,
        onClick: () => { this.sel = x.id; this.draftLivery = null; this.editMods = null; this.refreshDetail(); drawGrid(); },
      }, h('span', { class: 'c' }, x.custom ? L('Personalizada', 'Custom') : T(CATEGORIES[x.category])), h('span', { class: 'n' }, x.name), dots(x.difficulty))));
    };
    drawGrid();
    const cats = [['all', L('Todas', 'All')], ...Object.entries(CATEGORIES).map(([k, v]) => [k, T(v)])];
    if (list.some((x) => x.custom)) cats.push(['custom', L('Personalizadas', 'Custom')]);
    const chips = h('div', { class: 'filter-row' }, cats.map(([k, label]) => h('button', { class: `chip${this.filter === k ? ' on' : ''}`, onClick: (e) => { this.filter = k; for (const c of chips.children) c.classList.remove('on'); e.target.classList.add('on'); drawGrid(); } }, label)));
    this.detail = h('div', { class: 'detail-wrap' });
    const el = h('div', { class: 'screen dim' },
      this.head(L('Aeronaves', 'Aircraft'), L(`${list.length} modelos · ficha técnica, decoración y editor`, `${list.length} models · specs, livery and editor`), [
        h('button', { class: 'btn primary', onClick: () => { a.settings.flight.aircraft = this.sel; a.saveSettings('flight'); a.openFlightMenu(); } }, h('span', { html: icon('fly') }).firstChild, L('Volar con este', 'Fly this one')),
      ]),
      h('div', { class: 'hangar-grid' },
        h('div', { class: 'panel hangar-list' }, chips, h('div', { class: 'scroll', style: { flex: 1 } }, grid)),
        h('div', { class: 'panel hangar-detail' },
          h('div', { class: 'preview-wrap' }, h('div', { class: 'preview-hint' }, L('Arrastra para girar · rueda/pellizco para zoom', 'Drag to rotate · wheel/pinch to zoom'))),
          this.detail)));
    this.drawDetail();
    return el;
  }

  refreshDetail() {
    this.drawDetail();
    this.showPreview();
  }

  drawDetail() {
    const spec = this.app.registry.get(this.sel);
    const tabs = [['spec', L('Ficha técnica', 'Specifications')], ['paint', L('Personalizar', 'Customise')], ['editor', L('Editor', 'Editor')]];
    const body = h('div', { class: 'detail-tabs-body' });
    const draw = () => body.replaceChildren(this.tab === 'paint' ? this.paintTab(spec) : this.tab === 'editor' ? this.editorTab(spec) : h('div', {}, h('p', { style: { color: 'var(--muted)', lineHeight: 1.5 } }, T(spec.desc)), specTable(spec)));
    draw();
    this.detail.replaceChildren(
      h('div', { style: { padding: '12px 16px 0' } }, h('h3', { style: { margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.45em', letterSpacing: '.04em' } }, spec.name)),
      h('div', { class: 'tabs' }, tabs.map(([id, label]) => h('button', { class: `tab${this.tab === id ? ' on' : ''}`, onClick: (e) => { this.tab = id; for (const t of e.target.parentNode.children) t.classList.remove('on'); e.target.classList.add('on'); draw(); if (id !== 'editor') this.showPreview(); } }, label))),
      body);
  }

  /* ─────────────── personalización ─────────────── */
  paintTab(spec) {
    const entry = this.liveries();
    const lv = this.currentLivery();
    this.draftLivery = { ...lv };
    const update = () => {
      clearTimeout(this.paintTimer);
      this.paintTimer = setTimeout(() => this.app.preview.setAircraft(spec, this.draftLivery), 140);
    };
    const color = (key, label) => {
      const inp = h('input', { type: 'color', value: this.draftLivery[key] || '#ffffff', 'aria-label': label });
      inp.addEventListener('input', () => { this.draftLivery[key] = inp.value; update(); });
      return field(label, inp);
    };
    const slots = h('div', { class: 'livery-slots' },
      h('button', { class: `chip${entry.active < 0 ? ' on accent' : ''}`, onClick: () => { entry.active = -1; this.saveLiveries(entry); this.draftLivery = null; this.drawDetail(); this.showPreview(); } }, L('Original', 'Original')),
      entry.slots.map((s, i) => h('button', { class: `chip${entry.active === i ? ' on accent' : ''}`, onClick: () => { entry.active = i; this.saveLiveries(entry); this.draftLivery = null; this.drawDetail(); this.showPreview(); } }, s.name)));
    const reg = h('input', { type: 'text', maxlength: 8, value: this.draftLivery.registration || '', placeholder: 'CC-RC1' });
    reg.addEventListener('input', () => { this.draftLivery.registration = reg.value.toUpperCase(); update(); });
    const nameIn = h('input', { type: 'text', maxlength: 20, value: entry.active >= 0 ? entry.slots[entry.active]?.name : L('Mi decoración', 'My livery') });
    return h('div', {},
      h('div', { class: 'section-title' }, L('Decoraciones guardadas', 'Saved liveries')), slots,
      h('div', { class: 'section-title' }, L('Colores', 'Colours')),
      color('primary', L('Fuselaje', 'Fuselage')),
      color('wingColor', L('Alas', 'Wings')),
      color('tailColor', L('Estabilizadores', 'Tail')),
      color('secondary', L('Color secundario', 'Secondary colour')),
      color('accent', L('Detalles', 'Accents')),
      color('propColor', L('Hélice', 'Propeller')),
      color('spinnerColor', L('Cono de hélice', 'Spinner')),
      color('wheelColor', L('Llantas', 'Wheels')),
      h('div', { class: 'section-title' }, L('Diseño', 'Design')),
      field(L('Diseño decorativo', 'Pattern'), select(PATTERNS.map((p) => ({ value: p, label: L(...PATTERN_LABELS[p]) })), this.draftLivery.pattern, (v) => { this.draftLivery.pattern = v; update(); })),
      field(L('Acabado', 'Finish'), segmented([{ value: 'gloss', label: L('Brillo', 'Gloss') }, { value: 'matte', label: L('Mate', 'Matte') }, { value: 'metallic', label: L('Metalizado', 'Metallic') }], this.draftLivery.finish, (v) => { this.draftLivery.finish = v; update(); })),
      field(L('Identificación / matrícula', 'Registration'), reg),
      field(L('Nombre de la decoración', 'Livery name'), nameIn),
      h('div', { class: 'note' }, L('La decoración es sólo visual: no modifica masa ni aerodinámica.', 'Liveries are purely visual: they do not change mass or aerodynamics.')),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } },
        h('button', { class: 'btn primary small', onClick: () => {
          const e = this.liveries();
          e.slots.push({ name: nameIn.value || L('Decoración', 'Livery'), livery: { ...this.draftLivery } });
          e.active = e.slots.length - 1;
          this.saveLiveries(e);
          this.draftLivery = null;
          this.app.ui.toast(L('Decoración guardada', 'Livery saved'), 'ok');
          this.drawDetail();
        } }, h('span', { html: icon('plus') }).firstChild, L('Guardar como nueva', 'Save as new')),
        entry.active >= 0 ? h('button', { class: 'btn small', onClick: () => {
          const e = this.liveries();
          e.slots[e.active] = { name: nameIn.value || e.slots[e.active].name, livery: { ...this.draftLivery } };
          this.saveLiveries(e);
          this.draftLivery = null;
          this.app.ui.toast(L('Decoración actualizada', 'Livery updated'), 'ok');
          this.drawDetail();
        } }, h('span', { html: icon('save') }).firstChild, L('Guardar', 'Save')) : null,
        entry.active >= 0 ? h('button', { class: 'btn small danger', onClick: () => {
          const e = this.liveries();
          e.slots.splice(e.active, 1);
          e.active = -1;
          this.saveLiveries(e);
          this.draftLivery = null;
          this.drawDetail();
          this.showPreview();
        } }, h('span', { html: icon('trash') }).firstChild, L('Borrar', 'Delete')) : null,
        h('button', { class: 'btn small ghost', onClick: () => { this.draftLivery = { ...spec.paint, propColor: '#1a1a1a', wheelColor: '#d8d8d8', registration: '' }; this.drawDetail(); this.showPreview(); } }, L('Restablecer original', 'Reset to original'))));
  }

  /* ─────────────── editor de aeronaves ─────────────── */
  editorTab(spec) {
    const a = this.app;
    const custom = a.registry.customList().find((c) => c.id === this.sel);
    const baseId = custom ? custom.baseId : this.sel;
    const baseEntry = a.registry.baseEntry(baseId);
    this.editMods ??= { massScale: 1, cgShift: 0, chordScale: 1, powerScale: 1, throwScale: 1, dragScale: 1, inertiaScale: 1, servoScale: 1, ...(custom?.mods || {}) };
    const m = this.editMods;
    const out = h('div', {});
    let previewTimer = 0;
    const recompute = () => {
      const full = buildFullSpec({ ...baseEntry }, m);
      const warns = AircraftRegistry.analyse(full);
      out.replaceChildren(
        h('div', { class: 'quick-specs' },
          ...[[fmtSpeed(full.perf.stallSpeed), L('Pérdida', 'Stall')], [fmtSpeed(full.perf.maxSpeed), L('Máxima', 'Max')], [`${(full.staticMargin * 100).toFixed(0)}%`, L('Margen estático', 'Static margin')], [full.perf.thrustWeight ? full.perf.thrustWeight.toFixed(2) : `${full.perf.bestLD.toFixed(0)}:1`, full.perf.thrustWeight ? 'T/W' : 'L/D']]
            .map(([v, l]) => h('div', { class: 'qs' }, h('b', {}, v), h('span', {}, l)))),
        h('div', { class: 'warnings' }, warns.length ? warns.map((w) => h('div', { class: w.level }, T(w))) : h('div', { class: 'ok' }, L('Configuración estable y realista.', 'Stable, realistic configuration.'))));
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => this.showPreview(full), 200);
    };
    const lim = EDITOR_LIMITS;
    const pct = (v) => `${Math.round(v * 100)}%`;
    const slider = (key, label, hint, fmt = pct, step = 0.01) => field(label, range(lim[key][0], lim[key][1], step, m[key] ?? 1, (v) => { m[key] = v; recompute(); }, fmt), hint);
    const nameIn = h('input', { type: 'text', maxlength: 28, value: custom ? custom.name : `${baseEntry.name} (${L('mod', 'mod')})` });
    const wrap = h('div', {},
      h('p', { class: 'note', style: { marginTop: '10px' } }, L('Modifica los parámetros físicos. Las aeronaves personalizadas se guardan aparte y nunca sobrescriben las originales.', 'Edit physical parameters. Custom aircraft are saved separately and never overwrite the originals.')),
      out,
      slider('massScale', L('Masa', 'Mass'), `${(baseEntry.mass * m.massScale).toFixed(2)} kg`),
      field(L('Centro de gravedad', 'Centre of gravity'), range(lim.cgShift[0], lim.cgShift[1], 0.01, m.cgShift, (v) => { m.cgShift = v; recompute(); }, (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}% CMA`), L('Positivo = más atrás (menos estable)', 'Positive = further aft (less stable)')),
      slider('chordScale', L('Superficie alar (cuerda)', 'Wing area (chord)')),
      field(L('Perfil aerodinámico', 'Airfoil'), select(Object.entries(AIRFOILS).map(([k, v]) => ({ value: k, label: v.name })), m.airfoil || baseEntry.airfoil, (v) => { m.airfoil = v; recompute(); })),
      baseEntry.prop.type !== 'none' ? slider('powerScale', L('Potencia / empuje', 'Power / thrust')) : null,
      slider('throwScale', L('Recorrido de los mandos', 'Control throws')),
      baseEntry.flaps ? field(L('Deflexión máxima de flaps', 'Max flap deflection'), range(lim.flapMax[0], lim.flapMax[1], 1, m.flapMax ?? baseEntry.flaps.max, (v) => { m.flapMax = v; recompute(); }, (v) => `${v}°`)) : null,
      slider('dragScale', L('Resistencia parásita', 'Parasite drag')),
      slider('inertiaScale', L('Inercia', 'Inertia')),
      slider('servoScale', L('Velocidad de servos', 'Servo speed')),
      field(L('Nombre', 'Name'), nameIn),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } },
        h('button', { class: 'btn primary small', onClick: () => {
          const id = a.registry.saveCustom({ id: custom?.id, baseId, name: nameIn.value || `${baseEntry.name} mod`, mods: { ...m } });
          this.sel = id;
          this.editMods = null;
          a.ui.toast(L('Aeronave personalizada guardada', 'Custom aircraft saved'), 'ok');
          this.refresh();
          this.onShow();
        } }, h('span', { html: icon('save') }).firstChild, custom ? L('Guardar cambios', 'Save changes') : L('Guardar como personalizada', 'Save as custom')),
        h('button', { class: 'btn small ghost', onClick: () => { this.editMods = null; this.drawDetail(); this.showPreview(); } }, L('Restablecer valores', 'Reset values')),
        custom ? h('button', { class: 'btn small danger', onClick: () => { a.registry.deleteCustom(custom.id); this.sel = baseId; this.editMods = null; this.refresh(); this.onShow(); } }, h('span', { html: icon('trash') }).firstChild, L('Eliminar', 'Delete')) : null));
    recompute();
    return wrap;
  }
}
