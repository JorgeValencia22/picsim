/**
 * Integración con la plataforma (Android, iOS, escritorio):
 * - Registro del service worker (PWA instalable y juego sin conexión).
 * - Bloqueo de gestos del navegador que interfieren con los sticks (pellizco y doble toque en iOS).
 * - Pantalla siempre encendida durante el vuelo (Screen Wake Lock).
 * - Botón «atrás» de Android: abre la pausa o vuelve a la pantalla anterior en vez de salir.
 * - Detección de dispositivo modesto para elegir el perfil gráfico en el primer arranque.
 */

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isMobile = () => isIOS() || isAndroid() || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
export const isStandalone = () => window.matchMedia?.('(display-mode: fullscreen)').matches || window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export const canFullscreen = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen) && !(isIOS() && /iPhone|iPod/.test(navigator.userAgent));

/** Perfil gráfico recomendado para el primer arranque. */
export function recommendedPreset() {
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  if (isMobile()) return mem <= 3 || cores <= 4 ? 'verylow' : 'low';
  if (mem <= 4 || cores <= 4) return 'low';
  return 'medium';
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;
  // en desarrollo local no se cachea para ver siempre los cambios
  if (local) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e)));
}

/** Evita el zoom por pellizco/doble toque de Safari y el menú contextual por pulsación larga. */
export function lockBrowserGestures() {
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 320 && !e.target.closest('input, select, textarea')) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && !e.target.closest('.scroll, .options-body, .settings-body, .detail-tabs-body')) e.preventDefault(); }, { passive: false });
}

/** Mantiene la pantalla encendida mientras se vuela (se libera al volver al menú). */
export class WakeLock {
  constructor() { this.lock = null; this.wanted = false; document.addEventListener('visibilitychange', () => { if (!document.hidden && this.wanted) this.acquire(); }); }
  async acquire() {
    this.wanted = true;
    try { if ('wakeLock' in navigator && !this.lock) { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } } catch { /* no disponible */ }
  }
  release() { this.wanted = false; this.lock?.release?.(); this.lock = null; }
}

/**
 * Captura el botón «atrás» (Android / gesto de retroceso) y lo convierte en una acción del juego.
 * @param {() => boolean} onBack  devuelve true si la acción se consumió
 */
export function trapBackButton(onBack) {
  if (!window.history?.pushState) return;
  history.pushState({ rcfs: 1 }, '');
  window.addEventListener('popstate', () => {
    onBack();
    history.pushState({ rcfs: 1 }, '');
  });
}
