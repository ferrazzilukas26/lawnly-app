// Autenticazione, recupero password e cancellazione account.
import crypto from 'crypto';
import { cors, sql, signToken, verifyToken, bearer, hashPassword, verifyPassword, readBody, ensureAccountTables, passFp } from './_db.js';

const codeHash = code => crypto.createHash('sha256').update(code).digest('hex');
// pv lega il token alla password: dopo un reset i token vecchi non valgono più (authUser in _db.js)
const session = u => ({ token: signToken({ uid: u.id, email: u.email, pv: passFp(u.pass_hash) }), user: { id: u.id, email: u.email } });

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const fail = (status, message) => res.status(status).json({ error: { message } });
  if (req.method !== 'POST') return fail(405, 'POST only');
  const body = await readBody(req) || {};
  const { action = 'login', password } = body;
  const em = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  try {
    if (action === 'delete') {
      const payload = verifyToken(bearer(req));
      if (!payload?.uid) return fail(401, 'Login richiesto.');
      const [u] = await sql`select id, email, pass_hash from users where id = ${payload.uid}`;
      if (!u || typeof password !== 'string' || !verifyPassword(password, u.pass_hash)) return fail(401, 'Password non corretta.');
      await ensureAccountTables();
      const [tables] = await sql`select to_regclass('lawnly_ai_usage') as ai, to_regclass('app_state') as state`;
      await sql.transaction([
        sql`select id from users where id = ${u.id} for update`,
        ...(tables.state ? [sql`delete from app_state where user_id = ${u.id}`] : []),
        ...(tables.ai ? [sql`delete from lawnly_ai_usage where user_id = ${String(u.id)}`] : []),
        sql`delete from lawnly_password_resets where user_id = ${u.id}`,
        sql`delete from lawnly_affiliate_clicks where user_id = ${u.id}`,
        sql`delete from lawnly_auth_attempts where email = ${u.email}`,
        sql`delete from users where id = ${u.id}`,
      ]);
      return res.status(200).json({ ok: true });
    }
    if (action === 'reset-request') {
      if (!process.env.RESEND_API_KEY) return fail(503, 'Recupero password non ancora attivo.');
      if (!em) return fail(400, 'Inserisci email.');
      await ensureAccountTables();
      const [u] = await sql`select id from users where email = ${em}`;
      if (u) {
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        // Il lock sull'utente serializza richieste contemporanee e il limite orario.
        const [, , inserted] = await sql.transaction([
          sql`select id from users where id = ${u.id} for update`,
          sql`update lawnly_password_resets set used = true where user_id = ${u.id} and not used
            and (select count(*) from lawnly_password_resets where user_id = ${u.id}
              and created_at > now() - interval '1 hour') < 3`,
          sql`insert into lawnly_password_resets (user_id, code_hash, expires_at)
            select id, ${codeHash(code)}, now() + interval '30 minutes' from users where id = ${u.id}
            and (select count(*) from lawnly_password_resets where user_id = ${u.id}
              and created_at > now() - interval '1 hour') < 3 returning id`,
        ]);
        if (inserted.length) {
          try {
            const response = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: process.env.MAIL_FROM || 'Lawnly <noreply@lawnly.app>', to: [em],
                subject: 'Lawnly: codice per recuperare la password',
                text: `Il tuo codice per recuperare la password è ${code}. Scade tra 30 minuti. Se non hai richiesto il recupero, ignora questa email.` }),
            });
            if (!response.ok) console.warn('[auth] invio recupero fallito:', response.status);
          } catch { console.warn('[auth] invio recupero fallito'); }
        }
      }
      return res.status(200).json({ ok: true });
    }
    if (action === 'reset-confirm') {
      if (!em || typeof body.code !== 'string') return fail(400, 'Codice non valido o scaduto.');
      if (typeof password !== 'string' || password.length < 8) return fail(400, 'Password minimo 8 caratteri.');
      await ensureAccountTables();
      const hash = codeHash(body.code);
      // Verifica e consumo nella stessa transazione: un codice non può essere riutilizzato.
      const [, attempts, users] = await sql.transaction([
        sql`select id from users where email = ${em} for update`,
        sql`with latest as materialized (select r.id, r.attempts from lawnly_password_resets r join users u on u.id = r.user_id
            where u.email = ${em} and not r.used and r.expires_at > now() order by r.id desc limit 1)
          update lawnly_password_resets r set attempts = r.attempts +
            case when r.attempts >= 5 or r.code_hash = ${hash} then 0 else 1 end
          from latest where r.id = latest.id returning latest.attempts`,
        sql`update users set pass_hash = ${hashPassword(password)} where email = ${em} and exists (
          select 1 from lawnly_password_resets where user_id = users.id and not used and expires_at > now()
          and attempts < 5 and code_hash = ${hash}
          and id = (select id from lawnly_password_resets where user_id = users.id and not used
            and expires_at > now() order by id desc limit 1)) returning id, email, pass_hash`,
        sql`update lawnly_password_resets set used = true where user_id = (select id from users where email = ${em})
          and not used and expires_at > now() and attempts < 5 and code_hash = ${hash}`,
      ]);
      if (users.length) return res.status(200).json(session(users[0]));
      const attempt = attempts[0];
      if (attempt && attempt.attempts >= 5) return fail(429, 'Troppi tentativi. Richiedi un nuovo codice.');
      return fail(400, 'Codice non valido o scaduto.');
    }
    if (action !== 'signup' && action !== 'login') return fail(400, 'Azione non valida.');
    if (!em || typeof password !== 'string' || !password) return fail(400, 'Inserisci email e password.');
    if (action === 'signup') {
      if (password.length < 8) return fail(400, 'Password minimo 8 caratteri.');
      const ex = await sql`select id from users where email = ${em}`;
      if (ex.length) return fail(409, 'Email già registrata. Usa il login.');
      const [u] = await sql`insert into users (email, pass_hash) values (${em}, ${hashPassword(password)}) returning id, email, pass_hash`;
      return res.status(200).json(session(u));
    }
    await ensureAccountTables();
    // il tentativo si prenota PRIMA di contare: richieste parallele si vedono a vicenda
    const [att] = await sql`insert into lawnly_auth_attempts (email, ok) values (${em}, false) returning id`;
    const [count] = await sql`select count(*)::int as n from lawnly_auth_attempts
      where email = ${em} and not ok and created_at > now() - interval '15 minutes'`;
    if (count.n > 10) return fail(429, 'Troppi tentativi. Riprova tra 15 minuti.');
    const [u] = await sql`select id, email, pass_hash from users where email = ${em}`;
    const ok = !!u && verifyPassword(password, u.pass_hash);
    if (ok) await sql`update lawnly_auth_attempts set ok = true where id = ${att.id}`;
    await sql`delete from lawnly_auth_attempts where created_at < now() - interval '30 days'`; // conservazione promessa in privacy.html
    if (!ok) return fail(401, 'Email o password non corretti.');
    return res.status(200).json(session(u));
  } catch (e) {
    return fail(500, e.message);
  }
}
