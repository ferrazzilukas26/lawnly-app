// Lawnly auth — Vercel Function. Email+password against Neon `users`, issues JWT.
//   POST { action:'signup'|'login', email, password }  ->  { token, user:{id,email} } | { error:{message} }
import { sql, signToken, hashPassword, verifyPassword, readBody } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: { message: 'POST only' } }); return; }
  const { action, email, password } = await readBody(req);
  const em = (email || '').trim().toLowerCase();
  if (!em || !password) { res.status(400).json({ error: { message: 'Inserisci email e password.' } }); return; }

  try {
    if (action === 'signup') {
      if (password.length < 8) { res.status(400).json({ error: { message: 'Password minimo 8 caratteri.' } }); return; }
      const ex = await sql`select id from users where email = ${em}`;
      if (ex.length) { res.status(409).json({ error: { message: 'Email già registrata. Usa il login.' } }); return; }
      const rows = await sql`insert into users (email, pass_hash) values (${em}, ${hashPassword(password)}) returning id, email`;
      const u = rows[0];
      res.status(200).json({ token: signToken({ uid: u.id, email: u.email }), user: { id: u.id, email: u.email } });
      return;
    }
    // login (default)
    const rows = await sql`select id, email, pass_hash from users where email = ${em}`;
    if (!rows.length || !verifyPassword(password, rows[0].pass_hash)) {
      res.status(401).json({ error: { message: 'Email o password non corretti.' } });
      return;
    }
    const u = rows[0];
    res.status(200).json({ token: signToken({ uid: u.id, email: u.email }), user: { id: u.id, email: u.email } });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
}
