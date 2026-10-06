import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

test('premium: el código de descuento es de un solo uso y la licencia emitida es válida', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcfs-'));
  process.env.LICENSE_DB = path.join(dir, 'lic.json');
  process.env.LICENSE_SECRET = 'test-secret';
  delete process.env.STRIPE_SECRET_KEY;
  const { createPremiumApi } = await import('../server/premium.js');
  const api = createPremiumApi(dir);
  const srv = http.createServer(async (req, res) => { if (!(await api(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}/api/premium`;
  const post = (op, body) => fetch(`${base}/${op}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const st = await fetch(`${base}/status`).then((r) => r.json());
    assert.equal(st.server, true);
    assert.equal(st.payments, false);
    assert.equal(st.priceUsd, 5);
    assert.deepEqual(await post('redeem', { code: 'otro' }), { ok: false, error: 'invalid' });
    const ok = await post('redeem', { code: 'Kest1234Rend' });
    assert.equal(ok.ok, true);
    assert.deepEqual(await post('redeem', { code: 'Kest1234Rend' }), { ok: false, error: 'used' });
    assert.equal((await post('verify', { token: ok.token })).ok, true);
    assert.equal((await post('verify', { token: 'x.y' })).ok, false);
    const ck = await fetch(`${base}/checkout`, { method: 'POST' });
    assert.equal(ck.status, 503);
    // el registro de usados sobrevive a un reinicio (nueva instancia de la API)
    const api2 = createPremiumApi(dir);
    const srv2 = http.createServer(async (req, res) => { if (!(await api2(req, res))) { res.writeHead(404); res.end(); } });
    await new Promise((r) => srv2.listen(0, r));
    const r2 = await fetch(`http://127.0.0.1:${srv2.address().port}/api/premium/redeem`, { method: 'POST', body: JSON.stringify({ code: 'Kest1234Rend' }) }).then((r) => r.json());
    srv2.close();
    assert.deepEqual(r2, { ok: false, error: 'used' });
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
