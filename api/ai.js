// Lawnly AI proxy — Vercel Serverless Function.
// Anthropic-shaped contract used by the app (near-passthrough to the Messages API):
//   request:  { model, max_tokens, system, messages:[{role,content}] }
//   response: { content:[{ text }] }   |   { error:{ message } }
// Also handles the weather CORS proxy: { action:'wx-proxy', url }.
//
// Cheapest model by default (claude-haiku-4-5). The app's requested `model`
// field is ignored — every call uses AI_MODEL so cost stays bounded.
//
// Env vars (Vercel project settings, server-side only — never in the repo):
//   ANTHROPIC_API_KEY   (https://console.anthropic.com -> API keys)
//   AI_MODEL            optional, default 'claude-haiku-4-5'

import { sql, verifyToken, bearer, readBody } from './_db.js';

const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5';
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 40); // per utente, per giorno

// Host consentiti al proxy meteo: senza allowlist l'endpoint inoltra ovunque (SSRF).
const WX_HOSTS = new Set([
  'api.open-meteo.com', 'archive-api.open-meteo.com', 'air-quality-api.open-meteo.com',
  'geocoding-api.open-meteo.com', 'power.larc.nasa.gov', 'nominatim.openstreetmap.org',
]);

// Quota giornaliera server-side: il contatore client si azzera svuotando il browser.
let _usageReady = false;
async function overQuota(uid) {
  if (!_usageReady) {
    await sql`create table if not exists lawnly_ai_usage (
      user_id text not null, day date not null, n int not null default 0,
      primary key (user_id, day)
    )`;
    _usageReady = true;
  }
  const day = new Date().toISOString().slice(0, 10);
  const rows = await sql`insert into lawnly_ai_usage (user_id, day, n) values (${uid}, ${day}, 1)
    on conflict (user_id, day) do update set n = lawnly_ai_usage.n + 1 returning n`;
  return (rows[0]?.n || 0) > DAILY_LIMIT;
}

// ---- Weather CORS proxy (unchanged behaviour) ----
async function wxProxy(url, res) {
  let u;
  try { u = new URL(url || ''); } catch { u = null; }
  if (!u || u.protocol !== 'https:' || !WX_HOSTS.has(u.hostname)) {
    res.status(400).json({ error: { message: 'bad url' } }); return;
  }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'lawnly/1.0' } });
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: { message: 'wx-proxy: ' + e.message } });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: { message: 'POST only' } }); return; }
  const body = await readBody(req);

  if (body.action === 'wx-proxy') return wxProxy(body.url, res);

  // Da qui in poi si spende: serve un utente autenticato, con una quota giornaliera.
  const user = verifyToken(bearer(req));
  if (!user || !user.uid) { res.status(401).json({ error: { message: 'login richiesto' } }); return; }
  try {
    if (await overQuota(user.uid)) {
      res.status(429).json({ error: { message: 'Hai raggiunto il limite di ' + DAILY_LIMIT + ' domande al giorno. Riprova domani.' } });
      return;
    }
  } catch (e) { console.warn('[ai] quota non verificabile:', e.message); }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY missing' } }); return; }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = body.system || '';
  const maxTokens = Math.min(Number(body.max_tokens) || 1500, 8192);
  if (!messages.length) { res.status(400).json({ error: { message: 'messages required' } }); return; }

  try {
    const payload = { model: AI_MODEL, max_tokens: maxTokens, messages };
    // Prompt caching: system come blocco cacheabile (TTL ~5min). Chiamate successive
    // con lo stesso system pagano ~10% degli input token → costo minimo, qualità invariata.
    if (system) {
      const sysText = typeof system === 'string' ? system : String(system);
      payload.system = sysText.length > 800
        ? [{ type: 'text', text: sysText, cache_control: { type: 'ephemeral' } }]
        : sysText;
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: { message: d?.error?.message || `Anthropic HTTP ${r.status}` } });
      return;
    }
    const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || '';
    res.status(200).json({ content: [{ text }] });
  } catch (e) {
    res.status(502).json({ error: { message: e.message } });
  }
}
