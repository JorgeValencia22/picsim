/**
 * Mejora de pago «Render realista» (5 USD). Es SOLO visual: no cambia la física ni la
 * sensación de vuelo.
 *
 * Dos modos según dónde se aloje el juego:
 * - Con servidor (node server.js, p. ej. Render como servicio web): la compra pasa por Stripe
 *   Checkout y el código de descuento se canjea en el servidor, que lo marca como usado para
 *   siempre y en cualquier dispositivo (un solo uso real). La licencia queda firmada.
 * - Sin servidor (hosting estático como GitHub Pages): no hay pagos; el código se comprueba por su
 *   SHA-256 y queda marcado como usado en este navegador. Esto NO impide reutilizarlo en otro
 *   dispositivo: un solo uso global exige el servidor.
 * El código nunca aparece en claro en el cliente: solo su huella SHA-256.
 */
export const PREMIUM_PRICE_USD = 5;
const CODE_HASHES = ['964686b43b88e25bed5d4854ec374aaf84597f8d69fb87a99c1b4fa0893d0a4e'];

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Premium {
  constructor(storage) {
    this.storage = storage;
    this.state = storage.get('premium', null);
    this.server = undefined; // undefined = sin comprobar; null = no hay servidor
  }

  get unlocked() { return !!this.state?.unlocked; }
  get method() { return this.state?.method || null; }

  /** Detecta si el juego se sirve con la API de licencias. */
  async probe() {
    if (this.server !== undefined) return this.server;
    // GitHub Pages es solo estático: no hay API que consultar
    if (location.hostname.endsWith('.github.io')) { this.server = null; return null; }
    try {
      const r = await fetch('api/premium/status', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      this.server = j?.server ? j : null;
    } catch {
      this.server = null;
    }
    return this.server;
  }

  grant(method, token) {
    this.state = { unlocked: true, method, token: token || null, at: new Date().toISOString() };
    this.storage.set('premium', this.state);
  }

  /** Canjea un código de descuento del 100 %. */
  async redeem(raw) {
    const code = String(raw || '').trim();
    if (!code) return { ok: false, error: 'empty' };
    if (this.unlocked) return { ok: true, already: true };
    const server = await this.probe();
    if (server) {
      try {
        const r = await fetch('api/premium/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        const j = await r.json();
        if (j.ok) { this.grant('code', j.token); return { ok: true }; }
        return { ok: false, error: j.error || 'invalid' };
      } catch {
        return { ok: false, error: 'network' };
      }
    }
    // sin servidor: un solo uso por navegador
    let h;
    try { h = await sha256(code); } catch { return { ok: false, error: 'insecure' }; }
    if (!CODE_HASHES.includes(h)) return { ok: false, error: 'invalid' };
    const used = this.storage.get('premium-used', []);
    if (used.includes(h)) return { ok: false, error: 'used' };
    used.push(h);
    this.storage.set('premium-used', used);
    this.grant('code-local', null);
    return { ok: true, local: true };
  }

  /** Inicia el pago (redirige a Stripe Checkout). */
  async buy() {
    const server = await this.probe();
    if (!server?.payments) return { ok: false, error: 'payments_disabled' };
    try {
      const r = await fetch('api/premium/checkout', { method: 'POST' });
      const j = await r.json();
      if (!j.ok || !j.url) return { ok: false, error: j.error || 'checkout' };
      location.href = j.url;
      return { ok: true };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  /** Al volver de Stripe: confirma el pago en el servidor y limpia la URL. */
  async handleReturn() {
    const params = new URLSearchParams(location.search);
    const session = params.get('premium_session');
    const cancelled = params.has('premium_cancel');
    if (!session && !cancelled) return null;
    params.delete('premium_session');
    params.delete('premium_cancel');
    history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    if (cancelled) return { ok: false, error: 'cancelled' };
    try {
      const r = await fetch(`api/premium/confirm?session_id=${encodeURIComponent(session)}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) { this.grant('stripe', j.token); return { ok: true }; }
      return { ok: false, error: j.error || 'unpaid' };
    } catch {
      return { ok: false, error: 'network' };
    }
  }
}
