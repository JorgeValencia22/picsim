/** Utilidades DOM e iconografía SVG coherente (trazo 1.8, 24×24). */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const ICONS = {
  fly: P('<path d="M2 13l8-2 4-7h2l-1.5 7.5L21 13l-6.5 1.5L16 22h-2l-4-7.5L2 13z"/>'),
  plane: P('<path d="M2 12h20M12 4l2 8-2 8M6 9v6M18 10v4"/>'),
  map: P('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  school: P('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>'),
  trophy: P('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  stats: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'),
  back: P('<path d="M15 18l-6-6 6-6"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  play: P('<path d="M7 4l13 8-13 8z"/>'),
  pause: P('<path d="M8 5v14M16 5v14"/>'),
  reset: P('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>'),
  camera: P('<path d="M4 7h3l2-2h6l2 2h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  cloud: P('<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z"/>'),
  wind: P('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  gamepad: P('<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3M15 12h.01M18 13h.01"/>'),
  keyboard: P('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  touch: P('<path d="M9 11V5a2 2 0 0 1 4 0v6M13 10a2 2 0 0 1 4 0v2M17 11a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L4 15a2 2 0 0 1 3.3-2.2L9 15"/>'),
  sound: P('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>'),
  eye: P('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  physics: P('<circle cx="12" cy="12" r="2"/><path d="M12 2c4 3 4 17 0 20M12 2c-4 3-4 17 0 20M2 12c3-4 17-4 20 0M2 12c3 4 17 4 20 0"/>'),
  data: P('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  replay: P('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M10 9l5 3-5 3z"/>'),
  paint: P('<path d="M12 22a10 10 0 1 1 10-10c0 2.5-2 3-3.5 3H16a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 22z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/>'),
  wrench: P('<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L4 12l8-8z"/>'),
  fullscreen: P('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  exit: P('<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>'),
  check: P('<path d="M5 12l5 5 9-10"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  save: P('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7M8 21v-7h8v7"/>'),
  skip: P('<path d="M5 5l9 7-9 7zM17 5v14"/>'),
  rew: P('<path d="M19 5l-9 7 9 7zM7 5v14"/>'),
};

export function icon(name) { return ICONS[name] || ''; }

/** Elemento con icono + texto. */
export function iconLabel(name, text) {
  const s = h('span', { html: icon(name) });
  return [s.firstChild, h('span', {}, text)];
}

/** Puntos de dificultad (1–5). */
export function dots(n, max = 5) {
  return h('span', { class: 'dots', title: `${n}/${max}` }, Array.from({ length: max }, (_, i) => h('i', { class: i < n ? 'f' : '' })));
}

/** Campo de formulario: etiqueta + control. */
export function field(label, control, hint) {
  return h('div', { class: 'field' },
    h('label', {}, label, hint ? h('span', { class: 'hint' }, hint) : null),
    h('div', { class: 'control' }, control));
}

export function select(options, value, onChange) {
  const s = h('select', { onChange: (e) => onChange(e.target.value) });
  for (const o of options) {
    const opt = h('option', { value: o.value }, o.label);
    if (String(o.value) === String(value)) opt.selected = true;
    s.append(opt);
  }
  return s;
}

export function range(min, max, step, value, onInput, fmt = (v) => v) {
  const out = h('span', { class: 'val' }, fmt(value));
  const r = h('input', { type: 'range', min, max, step, value, 'aria-valuetext': fmt(value) });
  r.addEventListener('input', () => { const v = Number(r.value); out.textContent = fmt(v); onInput(v); });
  return [r, out];
}

export function toggle(checked, onChange, label = '') {
  const inp = h('input', { type: 'checkbox', 'aria-label': label });
  inp.checked = !!checked;
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'toggle' }, inp, h('span'));
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  for (const o of options) {
    const b = h('button', { type: 'button', class: String(o.value) === String(value) ? 'on' : '', role: 'radio', 'aria-checked': String(o.value) === String(value) }, o.label);
    b.addEventListener('click', () => {
      for (const c of wrap.children) { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); }
      b.classList.add('on');
      b.setAttribute('aria-checked', 'true');
      onChange(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

/** Ilustración procedural de un escenario para su tarjeta. */
export function envArt(id, gradient) {
  const [a, b] = gradient || ['#4a6', '#cdb'];
  const shapes = {
    airfield: `<rect y="62" width="300" height="40" fill="#5f8f35"/><rect x="40" y="72" width="220" height="8" fill="#9cc56a" transform="skewX(-20)"/><path d="M0 62 Q60 48 120 58 T300 52 V62 H0Z" fill="#4c7a30"/><rect x="200" y="54" width="18" height="10" fill="#e8e2d0"/><path d="M196 54 h26 l-13 -6z" fill="#3d6b45"/>`,
    field: `<path d="M0 60 Q80 40 160 58 T300 50 V100 H0Z" fill="#7aa53e"/><path d="M0 75 Q100 62 200 76 T300 70 V100 H0Z" fill="#c9b35a"/><ellipse cx="220" cy="85" rx="34" ry="7" fill="#3b7fa0"/><circle cx="60" cy="52" r="8" fill="#3f6b2a"/><circle cx="74" cy="54" r="6" fill="#4b7a30"/>`,
    mountain: `<path d="M0 100 L0 70 L60 40 L110 62 L170 22 L230 55 L300 35 L300 100Z" fill="#4f6b58"/><path d="M0 100 L0 82 Q90 70 150 80 T300 76 V100Z" fill="#3c5a3e"/><path d="M170 22 l14 10 -10 2 -12 -4z" fill="#eef"/>`,
    coast: `<rect y="58" width="300" height="42" fill="#1d6a90"/><path d="M120 100 Q150 60 200 56 L300 50 V100Z" fill="#e6d29a"/><path d="M190 100 Q210 50 260 46 L300 44 V100Z" fill="#6f9a48"/><path d="M0 70 Q60 64 120 72" stroke="#fff" stroke-opacity=".4" fill="none"/>`,
    trophy: `<rect y="64" width="300" height="36" fill="#6a8a48"/><rect x="0" y="74" width="300" height="9" fill="#444b52"/><path d="M0 64 Q150 54 300 64" fill="#58773c"/><rect x="40" y="40" width="4" height="28" fill="#ff6d00"/><rect x="256" y="40" width="4" height="28" fill="#ff6d00"/><path d="M110 36 a40 18 0 0 1 80 0" stroke="#fff" stroke-width="2" fill="none" stroke-dasharray="4 4"/>`,
    town: `<path d="M0 66 Q80 56 150 64 T300 60 V100 H0Z" fill="#6f8f45"/><rect x="150" y="46" width="16" height="20" fill="#efe6d5"/><path d="M146 46 h24 l-12 -10z" fill="#8b3a2b"/><rect x="176" y="52" width="14" height="14" fill="#e6d2b5"/><rect x="198" y="30" width="7" height="36" fill="#efe6d5"/><path d="M196 30 h11 l-5.5 -9z" fill="#7b3f2a"/><rect x="214" y="50" width="20" height="16" fill="#d9c7a7"/><path d="M0 84 H300" stroke="#555" stroke-width="3"/>`,
  };
  return `<svg viewBox="0 0 300 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs><rect width="300" height="100" fill="url(#g-${id})"/><circle cx="250" cy="22" r="9" fill="#fff6d0" opacity=".85"/>${shapes[id] || shapes.airfield}</svg>`;
}
