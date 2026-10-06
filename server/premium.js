/**
 * API de la mejora de pago «Render realista» (solo servidor Node; sin dependencias).
 *
 *   GET  /api/premium/status            → { server: true, payments: bool, priceUsd }
 *   POST /api/premium/redeem   {code}   → canjea un código de descuento de UN SOLO USO global
 *   POST /api/premium/checkout          → crea una sesión de Stripe Checkout (5 USD) y devuelve su URL
 *   GET  /api/premium/confirm?session_id=… → comprueba con Stripe que el pago se completó
 *   POST /api/premium/verify   {token}  → valida una licencia emitida por este servidor
 *
 * Variables de entorno:
 *   STRIPE_SECRET_KEY   clave secreta de Stripe (sk_live_… o sk_test_…). Sin ella no hay pagos.
 *   LICENSE_SECRET      secreto para firmar las licencias (obligatorio en producción).
 *   LICENSE_DB          ruta del archivo donde se guardan códigos usados y pagos (por defecto data/licenses.json).
 *   PREMIUM_CODE_HASHES SHA-256 (hex, separados por comas) de códigos de descuento del 100 %.
 *   PUBLIC_URL          URL pública del juego (para volver de Stripe). Por defecto, la del propio host.
 *
 * Los códigos nunca se guardan en claro: solo su SHA-256. Un código canjeado queda marcado en
 * LICENSE_DB y no vuelve a aceptarse (en ningún dispositivo).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PRICE_USD = 5;
// SHA-256 del código de descuento del 100 % entregado al propietario (un solo uso)
const DEFAULT_CODE_HASHES = ['964686b43b88e25bed5d4854ec374aaf84597f8d69fb87a99c1b4fa0893d0a4e'];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createPremiumApi(root) {
  let dbPath = process.env.LICENSE_DB || path.join(root, 'data', 'licenses.json');
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.accessSync(path.dirname(dbPath), fs.constants.W_OK);
  } catch {
    const fallback = path.join(root, 'data', 'licenses.json');
    console.warn(`[premium] No se puede escribir en ${dbPath}; se usa ${fallback} (no persistente en planes sin disco).`);
    dbPath = fallback;
  }
  const codeHashes = (process.env.PREMIUM_CODE_HASHES || DEFAULT_CODE_HASHES.join(',')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  let secret = process.env.LICENSE_SECRET;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    console.warn('[premium] LICENSE_SECRET no definido: las licencias firmadas dejarán de validarse al reiniciar el servidor.');
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';

  const load = () => {
    try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch { return { usedCodes: {}, sessions: {}, licenses: {} }; }
  };
  const save = (db) => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const tmp = `${dbPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, dbPath); // escritura atómica
  };
  const sign = (id) => `${id}.${crypto.createHmac('sha256', secret).update(id).digest('hex').slice(0, 32)}`;
  const issue = (db, method, ref) => {
    const id = crypto.randomBytes(9).toString('base64url');
    db.licenses[id] = { method, ref, at: new Date().toISOString() };
    return sign(id);
  };
  const valid = (token) => {
    if (typeof token !== 'string' || !token.includes('.')) return false;
    const [id] = token.split('.');
    const expect = sign(id);
    return token.length === expect.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expect));
  };

  // límite de intentos por IP para el canje (evita probar códigos por fuerza bruta)
  const attempts = new Map();
  const limited = (ip) => {
    const now = Date.now();
    const a = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    a.push(now);
    attempts.set(ip, a);
    return a.length > 8;
  };

  const stripe = async (method, endpoint, form) => {
    const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
    return json;
  };

  const readBody = (req) => new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 4096) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
  const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  /** Devuelve true si la petición era de la API (y ya se respondió). */
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    if (!url.pathname.startsWith('/api/premium/')) return false;
    const op = url.pathname.slice('/api/premium/'.length);
    try {
      if (op === 'status' && req.method === 'GET') {
        send(res, 200, { server: true, payments: !!stripeKey, priceUsd: PRICE_USD });
      } else if (op === 'redeem' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || '?';
        if (limited(ip)) return send(res, 429, { ok: false, error: 'too_many_attempts' }), true;
        const { code } = await readBody(req);
        const h = sha256(String(code || '').trim());
        if (!codeHashes.includes(h)) return send(res, 200, { ok: false, error: 'invalid' }), true;
        const db = load();
        if (db.usedCodes[h]) return send(res, 200, { ok: false, error: 'used' }), true;
        db.usedCodes[h] = { at: new Date().toISOString() };
        const token = issue(db, 'code', h.slice(0, 12));
        save(db);
        send(res, 200, { ok: true, token });
      } else if (op === 'checkout' && req.method === 'POST') {
        if (!stripeKey) return send(res, 503, { ok: false, error: 'payments_disabled' }), true;
        const base = process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        const s = await stripe('POST', 'checkout/sessions', {
          mode: 'payment',
          'line_items[0][quantity]': '1',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': String(PRICE_USD * 100),
          'line_items[0][price_data][product_data][name]': 'RC Flight Simulator — Render realista',
          'line_items[0][price_data][product_data][description]': 'Mejora solo visual: no cambia la física ni la sensación de vuelo.',
          success_url: `${base}/?premium_session={CHECKOUT_SESSION_ID}`,
          cancel_url: `${base}/?premium_cancel=1`,
        });
        send(res, 200, { ok: true, url: s.url });
      } else if (op === 'confirm' && req.method === 'GET') {
        if (!stripeKey) return send(res, 503, { ok: false, error: 'payments_disabled' }), true;
        const id = url.searchParams.get('session_id') || '';
        if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return send(res, 400, { ok: false, error: 'bad_session' }), true;
        const s = await stripe('GET', `checkout/sessions/${id}`);
        if (s.payment_status !== 'paid') return send(res, 200, { ok: false, error: 'unpaid' }), true;
        const db = load();
        // una sesión pagada emite una sola licencia (recargar la página no genera más)
        if (!db.sessions[id]) { db.sessions[id] = { token: issue(db, 'stripe', id), at: new Date().toISOString() }; save(db); }
        send(res, 200, { ok: true, token: db.sessions[id].token });
      } else if (op === 'verify' && req.method === 'POST') {
        const { token } = await readBody(req);
        send(res, 200, { ok: valid(token) });
      } else {
        send(res, 404, { ok: false, error: 'not_found' });
      }
    } catch (e) {
      console.error('[premium]', e);
      send(res, 500, { ok: false, error: 'server_error' });
    }
    return true;
  };
}
