/**
 * Gestor de interfaz: pila de pantallas con navegación consistente (volver/cerrar),
 * avisos (toasts), modales, pantalla de carga y sonidos de interfaz.
 */
import { h, clear } from './dom.js';
import { onLanguageChange } from '../core/i18n.js';

export class UIManager {
  constructor(root, audio) {
    this.root = root;
    this.audio = audio;
    this.stack = [];
    this.layer = h('div', { class: 'screens' });
    this.toastWrap = h('div', { class: 'toasts', 'aria-live': 'polite' });
    root.append(this.layer, this.toastWrap);
    // sonidos de interfaz en botones (delegación)
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.classList.contains('tbtn')) return;
      this.audio?.play(b.dataset.sound || 'click');
    });
    onLanguageChange(() => this.current?.refresh?.());
  }

  get current() { return this.stack[this.stack.length - 1] || null; }

  /** Muestra una pantalla encima de la actual. */
  push(screen) {
    this.current?.el.classList.add('hidden');
    this.current?.onHide?.();
    this.stack.push(screen);
    screen.ui = this;
    if (!screen.el) screen.render();
    this.layer.append(screen.el);
    screen.el.classList.remove('hidden');
    screen.onShow?.();
    this.focusFirst(screen.el);
  }

  /** Sustituye toda la pila por una pantalla. */
  replace(screen) {
    while (this.stack.length) this.popSilent();
    if (screen) this.push(screen);
  }

  popSilent() {
    const s = this.stack.pop();
    if (!s) return;
    s.onHide?.();
    s.destroy?.();
    s.el?.remove();
  }

  /** Vuelve a la pantalla anterior. */
  back() {
    if (this.stack.length <= 1) {
      // durante el vuelo las pantallas se abren sobre la pausa: al cerrar la última se vuelve a ella
      if (this.onEmpty && this.stack.length === 1) { this.popSilent(); this.onEmpty(); return true; }
      return false;
    }
    this.popSilent();
    const c = this.current;
    if (c) { c.el.classList.remove('hidden'); c.onShow?.(); this.focusFirst(c.el); }
    return true;
  }

  clearScreens() { this.replace(null); }

  focusFirst(el) {
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    const f = el.querySelector('[autofocus], .menu-item, button');
    f?.focus({ preventScroll: true });
  }

  toast(text, kind = 'info', ms = 2600) {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toastWrap.append(t);
    while (this.toastWrap.children.length > 4) this.toastWrap.firstChild.remove();
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, ms);
    setTimeout(() => t.remove(), ms + 350);
  }

  /** Ventana modal. actions: [{ label, kind, onClick, close=true }] */
  modal({ title, text, content, actions = [], dismissable = true, className = '' }) {
    const back = h('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' });
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);
    const box = h('div', { class: `modal panel ${className}` },
      title ? h('h2', {}, title) : null,
      text ? h('p', {}, text) : null,
      content || null,
      actions.length ? h('div', { class: 'actions' }, actions.map((a) => h('button', {
        class: `btn ${a.kind || ''}`,
        onClick: () => { if (a.close !== false) close(); a.onClick?.(); },
      }, a.label))) : null);
    back.append(box);
    if (dismissable) back.addEventListener('click', (e) => { if (e.target === back) close(); });
    this.root.append(back);
    box.querySelector('.btn.primary, .btn')?.focus();
    return close;
  }

  /* pantalla de carga */
  loading(show, progress = 0, text = '') {
    const el = document.getElementById('loading');
    if (!el) return;
    if (show) {
      el.classList.remove('hidden', 'fade');
      document.getElementById('loading-fill').style.width = `${Math.round(progress * 100)}%`;
      document.getElementById('loading-text').textContent = text;
    } else {
      el.classList.add('fade');
      setTimeout(() => el.classList.add('hidden'), 420);
    }
  }
}

/** Clase base de pantalla. */
export class Screen {
  constructor(app) { this.app = app; this.el = null; }
  render() {
    const el = this.el;
    this.el = this.build();
    if (el && el.parentNode) el.replaceWith(this.el);
    return this.el;
  }
  refresh() {
    const hidden = this.el?.classList.contains('hidden');
    this.render();
    if (hidden) this.el.classList.add('hidden');
  }
  build() { return h('div'); }
  head(title, sub, extra = []) {
    return h('div', { class: 'screen-head' },
      h('button', { class: 'btn icon ghost', 'aria-label': 'Volver', 'data-sound': 'back', onClick: () => this.ui.back(), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>' }),
      h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null),
      h('div', { class: 'spacer' }),
      extra);
  }
}

export { clear };
