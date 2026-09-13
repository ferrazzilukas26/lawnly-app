// Byte foto separati dal blob app_state; accesso sempre autenticato e privato.
import crypto from 'crypto';
import { cors, sql, authUser, readBody } from './_db.js';

const MAX_BODY = 2500000;
function decodePhoto(data) {
  const m = typeof data === 'string' && data.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.toString('base64') !== m[2]) return null;
  const type = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6)) ? 'image/gif'
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  return type === m[1] ? { bytes, type } : null;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const fail = (status, message) => res.status(status).json({ error: { message } });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const user = await authUser(req);
    if (!user) return fail(401, 'Login richiesto.');
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return fail(405, 'Metodo non consentito.');
    await sql`create table if not exists lawnly_zone_photos (
      id text primary key, user_id text not null, zone_id text not null,
      data text not null, created_at timestamptz default now()
    )`;
    const uid = String(user.uid);
    if (req.method === 'POST') {
      if (Number(req.headers['content-length']) > MAX_BODY) return fail(413, 'Foto troppo grande (massimo 2,5 MB).');
      const body = await readBody(req) || {};
      if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) return fail(413, 'Foto troppo grande (massimo 2,5 MB).');
      const { zoneId, b64 } = body;
      if (typeof zoneId !== 'string' || !zoneId.trim() || zoneId.length > 200 || !decodePhoto(b64)) {
        return fail(400, 'Zona o immagine non valida (JPEG, PNG, WebP, GIF).');
      }
      // Migrazioni/retry della stessa foto non creano copie orfane.
      const id = crypto.createHash('sha256').update(JSON.stringify([uid, zoneId, b64])).digest('hex');
      await sql.transaction([
        sql`select id from users where id = ${user.uid} for update`,
        sql`insert into lawnly_zone_photos (id, user_id, zone_id, data)
          select ${id}, ${uid}, ${zoneId}, ${b64} where exists (select 1 from users where id = ${user.uid})
          on conflict (id) do nothing`,
      ]);
      return res.status(200).json({ id });
    }
    const id = req.query?.id;
    if (typeof id !== 'string' || !id || id.length > 128) return fail(400, 'ID foto non valido.');
    if (req.method === 'DELETE') {
      await sql`delete from lawnly_zone_photos where id = ${id} and user_id = ${uid}`;
      return res.status(200).json({ ok: true });
    }
    const [row] = await sql`select data from lawnly_zone_photos where id = ${id} and user_id = ${uid}`;
    if (!row) return fail(404, 'Foto non trovata.');
    const photo = decodePhoto(row.data);
    if (!photo) return fail(422, 'Immagine non leggibile.');
    res.setHeader('Content-Type', photo.type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=31536000');
    res.setHeader('Vary', [res.getHeader('Vary'), 'Authorization'].filter(Boolean).join(', '));
    return res.status(200).send(photo.bytes);
  } catch (e) {
    return fail(500, e.message);
  }
}
