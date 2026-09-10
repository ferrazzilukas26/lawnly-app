// Shared helpers for Lawnly Vercel Functions: Neon SQL, JWT (HMAC, no deps),
// password hashing (scrypt, no deps), request helpers.
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

export const sql = neon(process.env.DATABASE_URL);

// Nessun fallback: con un segreto noto chiunque puo' firmarsi un token valido.
// Verificato su produzione (un token firmato col vecchio fallback riceve 401), quindi
// JWT_SECRET e' configurato: toglierlo non slogga nessuno.
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET non configurato');
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS };
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

export function verifyToken(tok) {
  if (!tok) return null;
  const [h, p, s] = tok.split('.');
  if (!h || !p || !s) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

export const passFp = (hash) => crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 16);

// Token valido E account ancora esistente con la stessa password: dopo un reset o una cancellazione
// i token già emessi smettono di funzionare. I token senza `pv` (emessi prima di questa versione)
// restano validi fino alla scadenza. ponytail: una query in più per ogni richiesta autenticata.
export async function authUser(req) {
  const p = verifyToken(bearer(req));
  if (!p?.uid) return null;
  const [u] = await sql`select pass_hash from users where id = ${p.uid}`;
  if (!u || (p.pv && p.pv !== passFp(u.pass_hash))) return null;
  return p;
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [s, h] = (stored || '').split(':');
  if (!s || !h) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  const hb = Buffer.from(h, 'hex');
  return hash.length === hb.length && crypto.timingSafeEqual(hash, hb);
}

export function bearer(req) {
  const a = req.headers.authorization || req.headers.Authorization || '';
  return a.startsWith('Bearer ') ? a.slice(7) : null;
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export function cors(req, res) {
  const origin = req.headers.origin;
  if (['capacitor://localhost', 'https://localhost', 'http://localhost', 'https://lawnly-app.vercel.app'].includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  const vary = res.getHeader('Vary');
  res.setHeader('Vary', vary ? `${vary}, Origin` : 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

let _accountReady = false;
export async function ensureAccountTables() {
  if (_accountReady) return;
  const [column] = await sql`select data_type from information_schema.columns
    where table_schema = current_schema() and table_name = 'users' and column_name = 'id'`;
  // Il tipo arriva dallo schema, ma solo tipi esplicitamente consentiti entrano nel DDL.
  const type = column?.data_type;
  if (!['smallint', 'integer', 'bigint', 'text', 'uuid', 'character varying'].includes(type)) {
    throw new Error('Tipo users.id non supportato');
  }
  await sql(`create table if not exists lawnly_password_resets (
    id serial primary key, user_id ${type} not null references users(id),
    code_hash text not null, attempts int default 0, expires_at timestamptz not null,
    used boolean default false, created_at timestamptz default now()
  )`);
  await sql`create table if not exists lawnly_auth_attempts (
    id bigserial, email text, ok boolean, created_at timestamptz default now()
  )`;
  await sql`alter table lawnly_auth_attempts add column if not exists id bigserial`;
  await sql(`create table if not exists lawnly_affiliate_clicks (
    id serial primary key, user_id ${type} references users(id), product_id text,
    url text, created_at timestamptz default now()
  )`);
  _accountReady = true;
}
