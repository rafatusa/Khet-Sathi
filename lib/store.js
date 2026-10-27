// Persistence: Supabase (Postgres via PostgREST + Storage) when configured,
// otherwise an in-memory store so the app still runs (data lost on restart).
import { randomUUID } from 'node:crypto';
import { env } from './env.js';

const BASE = env('SUPABASE_URL').replace(/\/+$/, '');
const KEY = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = 'land-images';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dbConfigured() {
  return Boolean(BASE && KEY);
}

export function isId(id) {
  return UUID.test(String(id || ''));
}

export function newId() {
  return randomUUID();
}

function headers(extra = {}) {
  const h = { apikey: KEY, ...extra };
  // Legacy service_role keys are JWTs and also go in Authorization.
  // New sb_secret_ keys are not JWTs and are sent only as apikey.
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

async function fail(res, what) {
  const text = await res.text().catch(() => '');
  let msg = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    msg = j.message || j.error || j.msg || msg;
  } catch {}
  throw new Error(`Supabase ${what} failed (HTTP ${res.status}): ${msg}`);
}

async function rest(method, path, body, prefer) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: headers({
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    }),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) await fail(res, `${method} ${path.split('?')[0]}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- in-memory fallback ----------
const mem = { lands: new Map(), files: new Map(), alerts: [], contacts: [] };

// ---------- lands ----------
const LIST_COLS = 'id,created_at,kind,name,lat,lon,acres,crop,lang,ground_m';

export async function createLand(row) {
  const full = { id: row.id || newId(), created_at: new Date().toISOString(), ...row };
  if (!dbConfigured()) {
    mem.lands.set(full.id, full);
    return full;
  }
  const [saved] = await rest('POST', 'lands', full, 'return=representation');
  return saved;
}

export async function listLands() {
  if (!dbConfigured()) {
    return [...mem.lands.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(({ id, created_at, kind, name, lat, lon, acres, crop, lang, ground_m }) => ({ id, created_at, kind, name, lat, lon, acres, crop, lang, ground_m }));
  }
  return rest('GET', `lands?select=${LIST_COLS}&order=created_at.desc&limit=50`);
}

export async function getLand(id) {
  if (!isId(id)) return null;
  if (!dbConfigured()) return mem.lands.get(id) || null;
  const rows = await rest('GET', `lands?select=*&id=eq.${id}&limit=1`);
  return rows?.[0] || null;
}

export async function updateLand(id, patch) {
  if (!isId(id)) throw new Error('Invalid land id');
  if (!dbConfigured()) {
    const cur = mem.lands.get(id);
    if (!cur) throw new Error('Land not found');
    const next = { ...cur, ...patch };
    mem.lands.set(id, next);
    return next;
  }
  const rows = await rest('PATCH', `lands?id=eq.${id}`, patch, 'return=representation');
  if (!rows?.length) throw new Error('Land not found');
  return rows[0];
}

// ---------- files (photos, satellite tiles) ----------
export async function putFile(path, buffer, contentType) {
  if (!dbConfigured()) {
    mem.files.set(path, { buffer, contentType });
    return path;
  }
  const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': contentType, 'x-upsert': 'true' }),
    body: buffer,
  });
  if (!res.ok) await fail(res, 'upload');
  return path;
}

export async function getFile(path) {
  if (!dbConfigured()) return mem.files.get(path) || null;
  const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${path}`, { headers: headers() });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) await fail(res, 'download');
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/jpeg' };
}

// ---------- alerts + contacts (read-only in this release) ----------
export async function listAlerts(limit = 5) {
  if (!dbConfigured()) return mem.alerts.slice(0, limit);
  return rest('GET', `alerts?select=*&read=eq.false&order=created_at.desc&limit=${Number(limit) || 5}`);
}

// ---------- health ----------
export async function pingDb() {
  if (!dbConfigured()) return { mode: 'memory', lands: mem.lands.size };
  const res = await fetch(`${BASE}/rest/v1/contacts?select=id`, {
    headers: headers({ Prefer: 'count=exact', Range: '0-0' }),
  });
  if (!res.ok) await fail(res, 'ping');
  const range = res.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  const lands = await rest('GET', 'lands?select=id&limit=1');
  const bucket = await fetch(`${BASE}/storage/v1/bucket/${BUCKET}`, { headers: headers() });
  return {
    mode: 'supabase',
    contacts: Number.isFinite(total) ? total : null,
    landsTable: Array.isArray(lands),
    bucket: bucket.ok,
  };
}
