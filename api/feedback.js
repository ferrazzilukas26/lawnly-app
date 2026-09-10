// Lawnly feedback board — Vercel Function. Tabella lawnly_feedback su Neon (auto-create).
//   GET                       -> { items:[...], usage:[{email,updatedAt}] }
//   GET ?photo=<id>           -> l'immagine (binaria)
//   POST { author,type,section,rating,text,photo? } -> { ok, item }   photo = data URL jpeg/png/webp < 2MB
//   PATCH { id, status: 'aperto'|'in_lavorazione'|'risolto' } -> { ok }
import { sql, readBody } from './_db.js';

let _ready = false;
async function ensure() {
  if (_ready) return;
  await sql`create table if not exists lawnly_feedback (
    id serial primary key,
    author text not null,
    type text not null,
    section text,
    rating int,
    text text not null,
    status text not null default 'aperto',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`alter table lawnly_feedback add column if not exists photo text`;
  _ready = true;
}

const TYPES = new Set(['bug', 'miglioramento', 'valutazione']);
const STATUSES = new Set(['aperto', 'in_lavorazione', 'risolto']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    await ensure();
    if (req.method === 'GET') {
      // foto servita a parte (?photo=id): la lista resta leggera
      const pid = parseInt((req.query && req.query.photo) || '', 10);
      if (pid) {
        const r = await sql`select photo from lawnly_feedback where id = ${pid}`;
        const dataUrl = r[0] && r[0].photo;
        if (!dataUrl) return res.status(404).end();
        const [meta, b64] = dataUrl.split(',');
        res.setHeader('Content-Type', (meta.match(/^data:([^;]+)/) || [, 'image/jpeg'])[1]);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.status(200).send(Buffer.from(b64, 'base64'));
      }
      const items = await sql`select id, author, type, section, rating, text, status, created_at, updated_at,
        (photo is not null) as has_photo from lawnly_feedback order by created_at desc limit 500`;
      // analytics base: chi usa l'app e quando (ultima sync per utente)
      let usage = [];
      try {
        const rows = await sql`select u.email, s.updated_at from users u
          left join app_state s on s.user_id = u.id order by s.updated_at desc nulls last limit 50`;
        // endpoint pubblico: fuori le email, resta il segnale che serve (chi e' attivo e quando)
        usage = rows.map((r, i) => ({
          label: 'Tester ' + (i + 1) + ' · ' + String(r.email || '').slice(0, 2) + '…',
          updated_at: r.updated_at,
        }));
      } catch {}
      return res.status(200).json({ items, usage });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const author = String(b.author || '').trim().slice(0, 60);
      const type = String(b.type || '').trim();
      const section = String(b.section || '').trim().slice(0, 60) || null;
      const rating = b.rating != null ? Math.max(1, Math.min(5, parseInt(b.rating, 10) || 0)) || null : null;
      const text = String(b.text || '').trim().slice(0, 4000);
      const photo = /^data:image\/(jpeg|png|webp);base64,/.test(b.photo || '') && b.photo.length < 2e6 ? b.photo : null;
      if (!author || !text || !TYPES.has(type)) return res.status(400).json({ error: 'author, type valido e text obbligatori' });
      const rows = await sql`insert into lawnly_feedback (author, type, section, rating, text, photo)
        values (${author}, ${type}, ${section}, ${rating}, ${text}, ${photo}) returning id, author, type, section, rating, text, status, created_at`;
      return res.status(200).json({ ok: true, item: rows[0] });
    }
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      const id = parseInt(b.id, 10);
      const status = String(b.status || '');
      if (!id || !STATUSES.has(status)) return res.status(400).json({ error: 'id e status validi obbligatori' });
      await sql`update lawnly_feedback set status = ${status}, updated_at = now() where id = ${id}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
