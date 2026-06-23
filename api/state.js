// Lawnly per-user state — Vercel Function. One JSONB blob per user in Neon `app_state`.
//   GET   (Bearer token)            -> { data: <blob>|null }
//   PUT   (Bearer token) { data }   -> { ok:true }
import { sql, verifyToken, bearer, readBody } from './_db.js';

export default async function handler(req, res) {
  const payload = verifyToken(bearer(req));
  if (!payload) { res.status(401).json({ error: { message: 'unauthorized' } }); return; }
  const uid = payload.uid;

  try {
    if (req.method === 'GET') {
      const rows = await sql`select data from app_state where user_id = ${uid}`;
      res.status(200).json({ data: rows.length ? rows[0].data : null });
      return;
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      const data = body && body.data !== undefined ? body.data : {};
      await sql`
        insert into app_state (user_id, data, updated_at)
        values (${uid}, ${JSON.stringify(data)}::jsonb, now())
        on conflict (user_id) do update set data = excluded.data, updated_at = now()
      `;
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: { message: 'method not allowed' } });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
}
