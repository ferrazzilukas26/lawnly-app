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

import { cors, sql, readBody, authUser, verifyToken, bearer } from './_db.js';

const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5';
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 40); // per utente, per giorno
// Tetto per tutta l'app: la registrazione è aperta, quindi il limite per utente da solo non
// limita la spesa (cento account = cento quote).
const GLOBAL_DAILY_LIMIT = Number(process.env.AI_GLOBAL_DAILY_LIMIT || 1000);
// Una singola chiamata non può diventare arbitrariamente cara: testo (system + messaggi) e immagini.
const TEXT_MAX = 100000; // caratteri, ~25k token
const IMAGES_MAX = 4;
const MAX_TOKENS = 4096; // il client non chiede mai più di 4000

// Host consentiti al proxy meteo: senza allowlist l'endpoint inoltra ovunque (SSRF).
const WX_HOSTS = new Set([
  'api.open-meteo.com', 'archive-api.open-meteo.com', 'air-quality-api.open-meteo.com',
  'historical-forecast-api.open-meteo.com', // pioggia per modello (index.html, hrf): prima mancava e la chiamata falliva sempre
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
  if ((rows[0]?.n || 0) > DAILY_LIMIT) return 'user';
  // Ogni utente pesa al massimo DAILY_LIMIT: le richieste già respinte non devono consumare il tetto
  // di tutti (altrimenti un solo account che insiste blocca il Dottor Verde per l'intera app).
  const [all] = await sql`select coalesce(sum(least(n, ${DAILY_LIMIT})), 0)::int as n from lawnly_ai_usage where day = ${day}`;
  return all.n > GLOBAL_DAILY_LIMIT ? 'global' : null;
}

// Dimensione della richiesta: testo totale e numero di immagini.
function requestSize(system, messages) {
  let text = String(system || '').length, images = 0;
  for (const m of messages) {
    const parts = typeof m?.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m?.content) ? m.content : [];
    for (const p of parts) {
      if (p?.type === 'image') images++;
      else text += String(p?.text || '').length;
    }
  }
  return { text, images };
}

// Coordinate a 2 decimali (~1 km) prima di uscire verso i servizi meteo: bastano per il meteo
// locale e non identificano la casa. Vale per ogni chiamata, qualunque cosa mandi il client.
function coarse(u) {
  for (const k of ['latitude', 'longitude', 'lat', 'lon']) {
    const v = u.searchParams.get(k);
    if (v != null && v !== '' && Number.isFinite(Number(v))) u.searchParams.set(k, Number(v).toFixed(2));
  }
  return u.toString();
}

// ---- Weather CORS proxy ----
async function wxProxy(url, res) {
  let u;
  try { u = new URL(url || ''); } catch { u = null; }
  if (!u || u.protocol !== 'https:' || !WX_HOSTS.has(u.hostname)) {
    res.status(400).json({ error: { message: 'bad url' } }); return;
  }
  try {
    const r = await fetch(coarse(u), { headers: { 'User-Agent': 'lawnly/1.0' } });
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (e) {
    console.error('[wx-proxy]', e.message);
    res.status(502).json({ error: { message: 'Servizio meteo non raggiungibile.' } });
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: { message: 'POST only' } }); return; }
  const body = await readBody(req);

  // Il proxy meteo non è un servizio pubblico: l'app lo chiama solo dopo il login.
  // Basta la firma del token (niente query): il meteo fa molte chiamate per apertura.
  if (body.action === 'wx-proxy') {
    if (!verifyToken(bearer(req))?.uid) { res.status(401).json({ error: { message: 'login richiesto' } }); return; }
    return wxProxy(body.url, res);
  }

  // Segnalazione di una risposta IA dall'app (richiesta Google Play): finisce sulla bacheca feedback.
  // ponytail: nessun limite per utente oltre al login; aggiungerlo se arrivano abusi.
  if (body.action === 'report') {
    const u = verifyToken(bearer(req));
    if (!u?.uid) { res.status(401).json({ error: { message: 'login richiesto' } }); return; }
    const text = String(body.text || '').trim().slice(0, 1500);
    if (!text) { res.status(400).json({ error: { message: 'testo mancante' } }); return; }
    const reason = String(body.reason || '').trim().slice(0, 500);
    try {
      await sql`insert into lawnly_feedback (author, type, section, text)
        values (${'Utente app #' + u.uid}, 'bug', 'Risposta IA segnalata', ${(reason ? 'Motivo: ' + reason + '\n\n' : '') + 'Risposta: ' + text})`;
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[report]', e.message);
      res.status(500).json({ error: { message: 'Segnalazione non salvata.' } });
    }
    return;
  }

  // Da qui in poi si spende: serve un utente autenticato, con una quota giornaliera.
  const user = await authUser(req); // account esistente: un token di un account eliminato non spende quota AI
  if (!user || !user.uid) { res.status(401).json({ error: { message: 'login richiesto' } }); return; }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = body.system || '';
  const maxTokens = Math.min(Number(body.max_tokens) || 1500, MAX_TOKENS);
  if (!messages.length) { res.status(400).json({ error: { message: 'messages required' } }); return; }
  const size = requestSize(system, messages);
  if (size.text > TEXT_MAX || size.images > IMAGES_MAX) {
    res.status(413).json({ error: { message: 'Richiesta troppo lunga: accorcia il messaggio.' } }); return;
  }

  // Se la quota non si può verificare si rifiuta: un guasto del database non deve togliere il limite.
  let over;
  try { over = await overQuota(user.uid); }
  catch (e) {
    console.error('[ai] quota non verificabile:', e.message);
    res.status(503).json({ error: { message: 'Servizio momentaneamente non disponibile. Riprova tra poco.' } }); return;
  }
  if (over === 'user') {
    res.status(429).json({ error: { message: 'Hai raggiunto il limite di ' + DAILY_LIMIT + ' domande al giorno. Riprova domani.' } }); return;
  }
  if (over === 'global') {
    res.status(429).json({ error: { message: 'Il Dottor Verde ha raggiunto il limite di oggi. Riprova domani.' } }); return;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.error('[ai] ANTHROPIC_API_KEY mancante'); res.status(503).json({ error: { message: 'Servizio momentaneamente non disponibile.' } }); return; }

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
      console.error('[ai] Anthropic', r.status, d?.error?.message);
      res.status(502).json({ error: { message: 'Il Dottor Verde non risponde. Riprova tra poco.' } });
      return;
    }
    const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || '';
    res.status(200).json({ content: [{ text }] });
  } catch (e) {
    console.error('[ai]', e.message);
    res.status(502).json({ error: { message: 'Il Dottor Verde non risponde. Riprova tra poco.' } });
  }
}
