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
// v0.14.0: a request runs in one scope:
//   own   a person's own farm (their rows only)
//   admin an admin's own farm plus the demo places (demo lands and the demo shed, rows with no owner)
//   demo  anyone watching the demo farm: the demo places only, read only
//   view  an admin looking at someone else's farm, read only
// Background jobs (the alert engine) run with no scope and see every farm.
const ctx = new AsyncLocalStorage();
export const ADMINS = () =>
  env('ADMIN_EMAILS')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
export const isAdmin = (user) => Boolean(user?.email && ADMINS().includes(String(user.email).toLowerCase()));
export function scopeFor(user, view) {
  if (!user) return null;
  const admin = isAdmin(user);
  if (view === 'demo') return { mode: 'demo', owner: null, readOnly: !admin, admin };
  const m = /^farm:([0-9a-f-]{36})$/i.exec(String(view || ''));
  if (m && admin && m[1] !== user.id) return { mode: 'view', owner: m[1].toLowerCase(), readOnly: true, admin };
  return { mode: admin ? 'admin' : 'own', owner: user.id, readOnly: false, admin };
}
export const runAs = (user, fn, scope = scopeFor(user)) => ctx.run({ user, scope }, fn);
// The signed-in user of this request, or null in background jobs (the alert engine sees every farm).
export const currentUser = () => ctx.getStore()?.user || null;
export const currentScope = () => ctx.getStore()?.scope || null;
// Whose rows this request reads and writes (null: the demo places, or every farm in background jobs).
export const currentOwner = () => currentScope()?.owner || null;

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

// Every account (admin farm list). Supabase Auth admin API with the server key; local runs list who was seen.
export async function listUsers() {
  if (!live()) return [...seenUsers].map(([id, u]) => ({ id, email: u.email, lastSignIn: new Date(u.at).toISOString() }));
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${BASE}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: { apikey: KEY, ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}) }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Could not list accounts (HTTP ${res.status})`);
    const j = await res.json();
    const users = j.users || [];
    out.push(...users.map((u) => ({ id: u.id, email: u.email || '', lastSignIn: u.last_sign_in_at || null, createdAt: u.created_at || null })));
    if (users.length < 200) break;
  }
  return out;
}

export async function signOut(token) {
  if (!live() || !token) return { ok: true };
  await call('logout', {}, { Authorization: `Bearer ${token}` }).catch(() => null);
  tokens.delete(token);
  return { ok: true };
}

// ---------- who is calling ----------
// Last time each person used the app (since the server started), for the admin's farm list.
export const seenUsers = new Map();
const seen = (user) => {
  if (user) seenUsers.set(user.id, { email: user.email, at: Date.now() });
  return user;
};
// Each access token is checked with Supabase once and remembered for up to 5 minutes (never past its expiry).
const tokens = new Map();
export async function userFromToken(token) {
  const t = String(token || '');
  if (!t || t.length > 4000) return null;
  if (!live()) {
    if (!t.startsWith('dev.')) return null;
    const email = Buffer.from(t.slice(4), 'base64url').toString();
    return EMAIL.test(email) ? seen({ id: devId(email), email }) : null;
  }
  const hit = tokens.get(t);
  if (hit && hit.until > Date.now()) return seen(hit.user);
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
  return seen(user);
}

// ---------- daily limits per farm ----------
// Costly steps (satellite scans, camera checks, Sathi answers, shop searches) are capped per farm per day,
// so a stranger with an account cannot run up the API bills. Counts live in memory and reset each day.
export const LIMITS = { scan: 12, check: 12, ask: 80, shops: 40, demoCall: 10 };
const LIMIT_NAME = { ask: 'Sathi answers', scan: 'field scans', check: 'camera checks', shops: 'shop searches', demoCall: 'demo calls' };
// Today's totals across all farms, and the busiest farm (the admin Settings tab).
export function usageToday() {
  const day = new Date().toISOString().slice(0, 10);
  const total = {};
  const top = {};
  for (const [k, n] of counts) {
    const [d, owner, kind] = k.split('|');
    if (d !== day) continue;
    total[kind] = (total[kind] || 0) + n;
    if (!top[kind] || n > top[kind].n) top[kind] = { owner, n };
  }
  return { day, total, top, limits: LIMITS };
}
const counts = new Map();
export function useLimit(kind, owner = currentUser()?.id) {
  if (!owner || !LIMITS[kind] || currentScope()?.admin) return; // admins have no daily limits
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}|${owner}|${kind}`;
  const n = (counts.get(key) || 0) + 1;
  if (n > LIMITS[kind]) {
    const e = new Error(`Daily limit reached for this farm (${LIMITS[kind]} ${LIMIT_NAME[kind]}). It resets tomorrow`);
    e.limit = true;
    throw e;
  }
  counts.set(key, n);
  if (counts.size > 20000) for (const k of counts.keys()) if (!k.startsWith(day)) counts.delete(k);
}
