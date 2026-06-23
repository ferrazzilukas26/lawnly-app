// Shared helpers for Lawnly Vercel Functions: Neon SQL, JWT (HMAC, no deps),
// password hashing (scrypt, no deps), request helpers.
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

export const sql = neon(process.env.DATABASE_URL);

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
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
