// Sign-in (v0.13.0): email + 6-digit code through Supabase Auth, and the signed-in farm for each request.
// The server talks to Supabase Auth itself, so the browser never holds a Supabase key. The code arrives
// by email (Supabase sends it through the SMTP set in its dashboard); there is no link and no redirect.
// Without Supabase (local runs) any email signs in with the code 000000, so the app can be tried offline.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { env } from './env.js';

const BASE = env('SUPABASE_URL').replace(/\/+$/, '');
const KEY = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
const live = () => Boolean(BASE && KEY);
export const DEV_CODE = '000000';

// ---------- the farm of the current request ----------
const ctx = new AsyncLocalStorage();
export const runAs = (user, fn) => ctx.run({ user }, fn);
// The signed-in user of this request, or null in background jobs (the alert engine sees every farm).
export const currentUser = () => ctx.getStore()?.user || null;
export const currentOwner = () => currentUser()?.id || null;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
export function cleanEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  if (!EMAIL.test(s)) throw new Error('Enter a valid email');
  return s;
}
export function cleanCode(c) {
  const s = String(c || '').replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(s)) throw new Error('Enter the code from the email');
  return s;
}

function headers(extra = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  return h;
}
async function call(path, body, extra = {}) {
  const res = await fetch(`${BASE}/auth/v1/${path}`, { method: 'POST', headers: headers(extra), body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
  const text = await res.text().catch(() => '');
  let j = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch {}
  if (!res.ok) {
    const msg = j.msg || j.message || j.error_description || j.error || `HTTP ${res.status}`;
    const e = new Error(friendly(msg, res.status));
    e.status = res.status;
    throw e;
  }
  return j;
}
// Supabase's messages, in words a farmer (or a judge) can act on.
export function friendly(msg, status) {
  const m = String(msg || '');
  if (status === 429 || /rate limit|too many|seconds/i.test(m)) return 'Please wait a minute before asking for another code';
  if (/expired|invalid/i.test(m) && /token|otp|code/i.test(m)) return 'That code is wrong or has expired. Ask for a new one';
  if (/not authorized|smtp|sending/i.test(m)) return 'The sign-in email could not be sent right now. Try again in a few minutes';
  return m.slice(0, 200);
}
const session = (j, email) => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000, email: j.user?.email || email });

// A stable id for an email in local runs (looks like a UUID, so the store treats it like a real one).
export function devId(email) {
  const h = createHash('sha256').update(`ks-dev:${email}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function sendCode(email) {
  const e = cleanEmail(email);
  if (!live()) return { sent: true, dev: true };
  await call('otp', { email: e, create_user: true });
  return { sent: true };
}

export async function verifyCode(email, code) {
  const e = cleanEmail(email);
  const c = cleanCode(code);
  if (!live()) {
    if (c !== DEV_CODE) throw new Error('That code is wrong or has expired. Ask for a new one');
    return { access_token: `dev.${Buffer.from(e).toString('base64url')}`, refresh_token: `devr.${Buffer.from(e).toString('base64url')}`, expires_at: Date.now() + 3600e3, email: e };
  }
  const j = await call('verify', { type: 'email', email: e, token: c });
  return session(j, e);
}

export async function refreshSession(refreshToken) {
  const r = String(refreshToken || '');
  if (!r) throw new Error('Sign in again');
  if (!live()) {
    if (!r.startsWith('devr.')) throw new Error('Sign in again');
    const e = Buffer.from(r.slice(5), 'base64url').toString();
    return { access_token: `dev.${r.slice(5)}`, refresh_token: r, expires_at: Date.now() + 3600e3, email: e };
  }
  const j = await call('token?grant_type=refresh_token', { refresh_token: r });
  return session(j);
}

export async function signOut(token) {
  if (!live() || !token) return { ok: true };
  await call('logout', {}, { Authorization: `Bearer ${token}` }).catch(() => null);
  tokens.delete(token);
  return { ok: true };
}

// ---------- who is calling ----------
// Each access token is checked with Supabase once and remembered for up to 5 minutes (never past its expiry).
const tokens = new Map();
export async function userFromToken(token) {
  const t = String(token || '');
  if (!t || t.length > 4000) return null;
  if (!live()) {
    if (!t.startsWith('dev.')) return null;
    const email = Buffer.from(t.slice(4), 'base64url').toString();
    return EMAIL.test(email) ? { id: devId(email), email } : null;
  }
  const hit = tokens.get(t);
  if (hit && hit.until > Date.now()) return hit.user;
  const res = await fetch(`${BASE}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!res?.ok) {
    tokens.delete(t);
    return null;
  }
  const j = await res.json().catch(() => null);
  if (!j?.id) return null;
  const user = { id: j.id, email: j.email || '' };
  let until = Date.now() + 5 * 60 * 1000;
  try {
    const exp = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).exp * 1000;
    if (exp) until = Math.min(until, exp);
  } catch {}
  tokens.set(t, { user, until });
  if (tokens.size > 2000) tokens.delete(tokens.keys().next().value);
  return user;
}

// ---------- daily limits per farm ----------
// Costly steps (satellite scans, camera checks, Sathi answers, shop searches) are capped per farm per day,
// so a stranger with an account cannot run up the API bills. Counts live in memory and reset each day.
export const LIMITS = { scan: 12, check: 12, ask: 80, shops: 40 };
const counts = new Map();
export function useLimit(kind, owner = currentOwner()) {
  if (!owner || !LIMITS[kind]) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}|${owner}|${kind}`;
  const n = (counts.get(key) || 0) + 1;
  if (n > LIMITS[kind]) {
    const e = new Error(`Daily limit reached for this farm (${LIMITS[kind]} ${kind === 'ask' ? 'Sathi answers' : kind === 'scan' ? 'field scans' : kind === 'check' ? 'camera checks' : 'shop searches'}). It resets tomorrow`);
    e.limit = true;
    throw e;
  }
  counts.set(key, n);
  if (counts.size > 20000) for (const k of counts.keys()) if (!k.startsWith(day)) counts.delete(k);
}
