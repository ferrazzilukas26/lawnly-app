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

const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ---- Weather CORS proxy (unchanged behaviour) ----
async function wxProxy(url, res) {
  if (!/^https?:\/\//i.test(url || '')) { res.status(400).json({ error: { message: 'bad url' } }); return; }
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

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY missing' } }); return; }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = body.system || '';
  const maxTokens = Math.min(Number(body.max_tokens) || 1500, 8192);
  if (!messages.length) { res.status(400).json({ error: { message: 'messages required' } }); return; }

  try {
    const payload = { model: AI_MODEL, max_tokens: maxTokens, messages };
    if (system) payload.system = system;
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
