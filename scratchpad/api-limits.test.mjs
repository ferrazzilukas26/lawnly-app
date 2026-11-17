// Limiti di spesa e accesso delle API, contro un branch Neon USA-E-GETTA (mai la produzione):
//   DATABASE_URL=<branch> JWT_SECRET=test node scratchpad/api-limits.test.mjs
// Anthropic e meteo sono intercettati: nessuna chiamata a pagamento.
import assert from 'node:assert/strict';

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) { console.log('SKIP: servono DATABASE_URL (branch di test) e JWT_SECRET'); process.exit(0); }
if (/rapid-waterfall/.test(process.env.DATABASE_URL)) throw new Error('questo è il branch di produzione');
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.AI_GLOBAL_DAILY_LIMIT = '1000';

const realFetch = globalThis.fetch;
const outbound = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com/')) {
    outbound.push({ url: u, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
  }
  if (u.startsWith('https://api.open-meteo.com/')) { outbound.push({ url: u }); return new Response('{"ok":1}', { status: 200 }); }
  return realFetch(url, opts); // Neon
};

const { sql } = await import('../api/_db.js');
const ai = (await import('../api/ai.js')).default;
const auth = (await import('../api/auth.js')).default;

async function call(handler, { method = 'POST', body = {}, token, ip = '203.0.113.7' } = {}) {
  const headers = { 'x-real-ip': ip };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = { code: 200, payload: null, h: {},
    status(c) { this.code = c; return this; }, json(p) { this.payload = p; return this; },
    send(p) { this.payload = p; return this; }, end() { return this; },
    setHeader(k, v) { this.h[k] = v; return this; }, getHeader(k) { return this.h[k]; } };
  await handler({ method, headers, body, query: {} }, res);
  return res;
}

const run = Date.now().toString(36);
const ipA = '198.51.100.' + (Date.now() % 250);
const emails = [];
try {
  // --- registrazione: formato email e limite per rete
  assert.equal((await call(auth, { body: { action: 'signup', email: 'non-una-email', password: 'password123' }, ip: ipA })).code, 400);
  let token, uid;
  for (let i = 0; i < 10; i++) {
    const email = `limiti-${run}-${i}@example.invalid`; emails.push(email);
    const r = await call(auth, { body: { action: 'signup', email, password: 'password123' }, ip: ipA });
    assert.equal(r.code, 200, `registrazione ${i}: ${JSON.stringify(r.payload)}`);
    if (i === 0) { token = r.payload.token; uid = r.payload.user.id; }
  }
  const dup = await call(auth, { body: { action: 'signup', email: emails[0], password: 'password123' }, ip: '192.0.2.200' });
  assert.equal(dup.code, 409, 'email già usata');
  const over = await call(auth, { body: { action: 'signup', email: `limiti-${run}-x@example.invalid`, password: 'password123' }, ip: ipA });
  assert.equal(over.code, 429, '11a registrazione dalla stessa rete');
  emails.push(`limiti-${run}-x@example.invalid`);
  const [ipRows] = await sql`select count(*)::int as n from lawnly_auth_attempts where email like ${'%' + ipA + '%'}`;
  assert.equal(ipRows.n, 0, "l'IP non deve comparire in chiaro");

  // --- proxy meteo: login obbligatorio, coordinate a 2 decimali
  const wxUrl = 'https://api.open-meteo.com/v1/forecast?latitude=45.604095&longitude=11.910203&current=temperature_2m';
  assert.equal((await call(ai, { body: { action: 'wx-proxy', url: wxUrl } })).code, 401);
  const wx = await call(ai, { body: { action: 'wx-proxy', url: wxUrl }, token });
  assert.equal(wx.code, 200);
  const sent = new URL(outbound.at(-1).url);
  assert.equal(sent.searchParams.get('latitude'), '45.60');
  assert.equal(sent.searchParams.get('longitude'), '11.91');

  // --- AI: login, dimensioni, max_tokens
  const msg = (content) => ({ messages: [{ role: 'user', content }], max_tokens: 99999 });
  assert.equal((await call(ai, { body: msg('ciao') })).code, 401);
  const okCall = await call(ai, { body: msg('ciao'), token });
  assert.equal(okCall.code, 200, JSON.stringify(okCall.payload));
  assert.equal(outbound.at(-1).body.max_tokens, 4096, 'max_tokens limitato');
  assert.equal((await call(ai, { body: msg('x'.repeat(100001)), token })).code, 413, 'testo troppo lungo');
  const img = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } };
  assert.equal((await call(ai, { body: msg([img, img, img, img, img]), token })).code, 413, 'troppe immagini');

  // --- quota per utente
  const day = new Date().toISOString().slice(0, 10);
  await sql`update lawnly_ai_usage set n = 40 where user_id = ${String(uid)} and day = ${day}`;
  const q1 = await call(ai, { body: msg('ciao'), token });
  assert.equal(q1.code, 429); assert.match(q1.payload.error.message, /40 domande/);

  // --- tetto globale (riga fittizia di un altro "utente" nello stesso giorno)
  await sql`update lawnly_ai_usage set n = 0 where user_id = ${String(uid)} and day = ${day}`;
  await sql`insert into lawnly_ai_usage (user_id, day, n) values (${'test-globale-' + run}, ${day}, 1000)`;
  const q2 = await call(ai, { body: msg('ciao'), token });
  assert.equal(q2.code, 429); assert.match(q2.payload.error.message, /limite di oggi/);

  assert.equal(outbound.filter(o => o.url.includes('anthropic')).length, 1, 'solo la chiamata valida è arrivata ad Anthropic');
  console.log('OK: registrazione (formato, limite per rete, IP non in chiaro), meteo (login, coordinate ~1 km), AI (login, testo, immagini, max_tokens, quota utente, tetto globale)');
} finally {
  await sql`delete from lawnly_ai_usage where user_id like ${'test-globale-%'}`;
  for (const e of emails) {
    const [u] = await sql`select id from users where email = ${e}`;
    if (u) { await sql`delete from lawnly_ai_usage where user_id = ${String(u.id)}`; await sql`delete from users where id = ${u.id}`; }
  }
}
