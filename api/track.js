// Registro clic affiliati: solo account esistenti, un clic ogni 10 minuti per prodotto.
import { cors, sql, authUser, readBody, ensureAccountTables } from './_db.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const fail = (status, message) => res.status(status).json({ error: { message } });
  if (req.method !== 'POST') return fail(405, 'POST only');
  try {
    const { productId, url } = await readBody(req) || {};
    let target;
    try { target = new URL(url); } catch {}
    const hosts = (process.env.AFFILIATE_HOSTS || 'padanasementi.com').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
    if (typeof productId !== 'string' || !productId.trim() || productId.length > 80 || typeof url !== 'string' || url.length > 500
      || !target || target.protocol !== 'https:' || target.username || target.password
      || !hosts.some(h => target.hostname === h || target.hostname.endsWith('.' + h))) return fail(400, 'Prodotto o URL non valido.');
    // senza account valido il link si apre ma il clic non entra nel registro commissioni:
    // altrimenti chiunque potrebbe gonfiarlo con richieste anonime
    const user = await authUser(req);
    if (!user) return res.status(200).json({ ok: true, stored: false });
    await ensureAccountTables();
    await sql`insert into lawnly_affiliate_clicks (user_id, product_id, url)
      select ${user.uid}, ${productId}, ${url} where not exists (select 1 from lawnly_affiliate_clicks
        where user_id = ${user.uid} and product_id = ${productId} and created_at > now() - interval '10 minutes')`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return fail(500, e.message);
  }
}
