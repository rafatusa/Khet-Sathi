// Persistence: Supabase (Postgres via PostgREST + Storage) when configured,
// otherwise an in-memory store so the app still runs (data lost on restart).
import { randomUUID } from 'node:crypto';
import { env } from './env.js';
import { currentOwner } from './auth.js';

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
const mem = { lands: new Map(), files: new Map(), alerts: [], contacts: [], readings: [], rules: new Map(), deals: [] };

// ---------- whose rows (v0.13.0) ----------
// In a signed-in request every read and write is limited to that farm (owner_id). Background jobs
// (the alert engine) run with no owner and see every farm. Rows with no owner are the shared demo
// templates (demo lands), the demo shed and its alerts; older test rows before sign-in stay hidden.
const own = () => currentOwner();
const ownQ = () => (own() ? `&owner_id=eq.${own()}` : '');
const mine = (row) => !own() || row.owner_id === own();
const withOwner = (row) => (own() && !row.owner_id ? { ...row, owner_id: own() } : row);

// ---------- lands ----------
const LIST_COLS = 'id,created_at,kind,name,lat,lon,acres,crop,lang,ground_m,place,location_source';

export async function createLand(row) {
  const full = withOwner({ id: row.id || newId(), created_at: new Date().toISOString(), ...row });
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
      .filter((l) => (own() ? l.owner_id === own() : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(({ id, created_at, kind, name, lat, lon, acres, crop, lang, ground_m, place, location_source, place_info }) => ({ id, created_at, kind, name, lat, lon, acres, crop, lang, ground_m, place, location_source, place_info }));
  }
  // place_info (v0.11.0, SQL 005) names the village in the switcher; older databases list without it.
  try {
    return await rest('GET', `lands?select=${LIST_COLS},place_info${ownQ()}&order=created_at.desc&limit=50`);
  } catch (err) {
    if (/owner_id/.test(err.message)) throw new Error('Run SQL 007 in Supabase first (sign-in needs it)');
    return rest('GET', `lands?select=${LIST_COLS}${ownQ()}&order=created_at.desc&limit=50`);
  }
}

// The shared demo lands (no owner): each new farm gets its own copy of these.
export async function demoTemplates() {
  if (!dbConfigured()) return [...mem.lands.values()].filter((l) => !l.owner_id && l.location_source === 'demo');
  return rest('GET', 'lands?select=*&owner_id=is.null&location_source=eq.demo&order=created_at.desc&limit=10');
}

export async function getLand(id) {
  if (!isId(id)) return null;
  if (!dbConfigured()) {
    const l = mem.lands.get(id);
    return l && mine(l) ? l : null;
  }
  const rows = await rest('GET', `lands?select=*&id=eq.${id}${ownQ()}&limit=1`);
  return rows?.[0] || null;
}

export async function updateLand(id, patch) {
  if (!isId(id)) throw new Error('Invalid land id');
  if (!dbConfigured()) {
    const cur = mem.lands.get(id);
    if (!cur || !mine(cur)) throw new Error('Land not found');
    const next = { ...cur, ...patch };
    mem.lands.set(id, next);
    return next;
  }
  const rows = await rest('PATCH', `lands?id=eq.${id}${ownQ()}`, patch, 'return=representation');
  if (!rows?.length) throw new Error('Land not found');
  return rows[0];
}

// Deletes a land row. Its alerts go with it; deals keep their record with no land.
export async function deleteLand(id) {
  if (!isId(id)) throw new Error('Invalid land id');
  if (!dbConfigured()) {
    const l = mem.lands.get(id);
    return l && mine(l) ? mem.lands.delete(id) : false;
  }
  const rows = await rest('DELETE', `lands?id=eq.${id}${ownQ()}`, null, 'return=representation');
  return Boolean(rows?.length);
}

// ---------- files (photos, satellite tiles) ----------
// bucket: 'land-images' (photos, satellite) or 'shed-clips' (saved shed videos, v0.7.1).
export const CLIP_BUCKET = 'shed-clips';
// cacheControl: e.g. 'no-cache' for files that change often (the clip list), so storage never serves a stale copy.
export async function putFile(path, buffer, contentType, bucket = BUCKET, cacheControl = null) {
  if (!dbConfigured()) {
    mem.files.set(`${bucket}/${path}`, { buffer, contentType });
    return path;
  }
  const res = await fetch(`${BASE}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': contentType, 'x-upsert': 'true', ...(cacheControl ? { 'cache-control': cacheControl } : {}) }),
    body: buffer,
  });
  if (!res.ok) await fail(res, 'upload');
  return path;
}

// Removes stored pictures. Missing files are not an error.
export async function deleteFiles(paths, bucket = BUCKET) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return 0;
  if (!dbConfigured()) {
    let n = 0;
    list.forEach((p) => (n += mem.files.delete(`${bucket}/${p}`) ? 1 : 0));
    return n;
  }
  const res = await fetch(`${BASE}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: list }),
  });
  if (!res.ok) await fail(res, 'delete files');
  const removed = await res.json().catch(() => []);
  return Array.isArray(removed) ? removed.length : 0;
}

export async function getFile(path, bucket = BUCKET) {
  if (!dbConfigured()) return mem.files.get(`${bucket}/${path}`) || null;
  const res = await fetch(`${BASE}/storage/v1/object/${bucket}/${path}`, { headers: headers() });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) await fail(res, 'download');
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/jpeg' };
}

// ---------- alerts ----------
// title holds a language-neutral key (e.g. rain_skip); body holds its values as JSON.
export async function listAlerts(limit = 5) {
  const n = Number(limit) || 5;
  const seen = (a) => !own() || a.owner_id === own() || (!a.owner_id && !a.land_id);
  if (!dbConfigured()) return mem.alerts.filter((a) => !a.read && seen(a)).slice(0, n);
  const who = own() ? `&or=(owner_id.eq.${own()},and(owner_id.is.null,land_id.is.null))` : '';
  return rest('GET', `alerts?select=*&read=eq.false${who}&order=created_at.desc&limit=${n}`);
}

export async function recentAlerts(hours = 12) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  if (!dbConfigured()) return mem.alerts.filter((a) => a.created_at >= since);
  return rest('GET', `alerts?select=id,land_id,title,created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=500`);
}

export async function insertAlerts(rows) {
  if (!rows.length) return [];
  rows = rows.map(withOwner);
  if (!dbConfigured()) {
    const saved = rows.map((r) => ({ id: newId(), created_at: new Date().toISOString(), read: false, ...r }));
    mem.alerts.unshift(...saved);
    return saved;
  }
  return rest('POST', 'alerts', rows, 'return=representation');
}

export async function markAlertRead(id) {
  if (!isId(id)) throw new Error('Invalid alert id');
  if (!dbConfigured()) {
    const a = mem.alerts.find((x) => x.id === id && (!own() || x.owner_id === own() || (!x.owner_id && !x.land_id)));
    if (a) a.read = true;
    return Boolean(a);
  }
  const who = own() ? `&or=(owner_id.eq.${own()},and(owner_id.is.null,land_id.is.null))` : '';
  const rows = await rest('PATCH', `alerts?id=eq.${id}${who}`, { read: true }, 'return=representation');
  return Boolean(rows?.length);
}

// ---------- contacts (all simulated) ----------
const MEM_CONTACTS = [
  { id: 'mem-vet', role: 'vet', name: 'ডা. অমিত সেন (পশু চিকিৎসক)', phone: '+91 90000 00701', village: 'বোলপুর', simulated: true },
  { id: 'mem-shop-1', role: 'shop', name: 'রহমান স্টোর', phone: '+91 90000 00601', village: 'বোলপুর', details: { buys: ['eggs'], last_price_inr_per_tray: 180, usual_trays: 10 }, simulated: true },
  { id: 'mem-shop-2', role: 'shop', name: 'নিউ মা তারা ভ্যারাইটি', phone: '+91 90000 00602', village: 'বোলপুর', details: { buys: ['eggs'], last_price_inr_per_tray: 176, usual_trays: 6 }, simulated: true },
  { id: 'mem-shop-3', role: 'shop', name: 'হোটেল সোনার বাংলা', phone: '+91 90000 00603', village: 'শান্তিনিকেতন', details: { buys: ['eggs'], last_price_inr_per_tray: 188, usual_trays: 15 }, simulated: true },
];
export async function listContacts(role) {
  if (!['vendor', 'buyer', 'shop', 'vet', 'harvester', 'transport', 'tractor'].includes(role)) throw new Error('Unknown contact role');
  if (!dbConfigured()) return MEM_CONTACTS.filter((c) => c.role === role);
  return rest('GET', `contacts?select=id,role,name,phone,village,details,simulated&role=eq.${role}&order=name.asc&limit=20`);
}

// ---------- sheds (v0.11.0): poultry places the farmer switches to; the kit stays simulated ----------
// Before SQL 005 runs (no sheds table) the app still shows the one shed it has always had.
export const DEFAULT_SHED = { id: 'shed-default', name: 'ডেমো শেড', chickens: 300, lat: 23.64, lon: 87.73, lang: 'bn', created_at: '2026-10-21T00:00:00Z', demo: true, builtIn: true };
mem.sheds = [DEFAULT_SHED];

export async function listSheds() {
  if (!dbConfigured()) return mem.sheds.filter((s) => s.demo || !own() || s.owner_id === own());
  try {
    // The shared demo shed plus this farm's own sheds.
    const who = own() ? `&or=(owner_id.eq.${own()},and(owner_id.is.null,demo.eq.true))` : '';
    const rows = await rest('GET', `sheds?select=*${who}&order=created_at.asc&limit=20`);
    return rows?.length ? rows : [DEFAULT_SHED];
  } catch {
    return [DEFAULT_SHED];
  }
}

export async function createShed({ name, chickens, lat, lon, lang }) {
  const row = withOwner({ id: newId(), created_at: new Date().toISOString(), name, chickens, lat, lon, lang, demo: false });
  if (!dbConfigured()) {
    mem.sheds.push(row);
    return row;
  }
  try {
    const [saved] = await rest('POST', 'sheds', row, 'return=representation');
    return saved;
  } catch (err) {
    if (/sheds/.test(err.message) && /(does not exist|schema cache|404)/i.test(err.message)) throw new Error('Run SQL 005 in Supabase first to save sheds');
    throw err;
  }
}

// ---------- sell rules and deals (v0.8.0; shops and money are simulated) ----------
// One rule per kind ('eggs' now; crops later). Missing table or row: null, the caller uses defaults.
export async function getSellRule(kind = 'eggs') {
  if (!dbConfigured()) return mem.rules.get(`${own() || ''}|${kind}`) || null;
  const who = own() ? `&owner_id=eq.${own()}` : '&owner_id=is.null';
  const rows = await rest('GET', `sell_rules?select=*&kind=eq.${encodeURIComponent(kind)}${who}&limit=1`);
  return rows?.[0] || null;
}

export async function saveSellRule(rule) {
  const row = withOwner({ ...rule, updated_at: new Date().toISOString() });
  if (!dbConfigured()) {
    mem.rules.set(`${row.owner_id || ''}|${row.kind}`, row);
    return row;
  }
  const [saved] = await rest('POST', 'sell_rules?on_conflict=owner_id,kind', row, 'resolution=merge-duplicates,return=representation');
  return saved;
}

export async function listDeals(limit = 50) {
  if (!dbConfigured()) return mem.deals.filter(mine).slice(0, limit);
  return rest('GET', `deals?select=*${ownQ()}&order=created_at.desc&limit=${Number(limit) || 50}`);
}

export async function insertDeal(row) {
  const full = withOwner({ id: newId(), created_at: new Date().toISOString(), ...row });
  if (!dbConfigured()) {
    mem.deals.unshift(full);
    return full;
  }
  const [saved] = await rest('POST', 'deals', full, 'return=representation');
  return saved;
}

// ---------- sensor readings (simulated village kit) ----------
export async function insertReadings(rows) {
  if (!rows.length) return 0;
  if (!dbConfigured()) {
    const at = new Date().toISOString();
    mem.readings.unshift(...rows.map((r) => ({ at, ...r })));
    mem.readings.length = Math.min(mem.readings.length, 2000);
    return rows.length;
  }
  await rest('POST', 'sensor_readings', rows);
  return rows.length;
}

// Newest readings first, for the given devices.
export async function latestReadings(devices, limit = 200) {
  const list = (devices || []).filter((d) => /^[a-z0-9-]+$/i.test(d));
  if (!list.length) return [];
  if (!dbConfigured()) return mem.readings.filter((r) => list.includes(r.device)).slice(0, limit);
  const inList = list.map((d) => `"${d}"`).join(',');
  return rest('GET', `sensor_readings?select=device,area,metric,value,at&device=in.(${encodeURIComponent(inList)})&order=at.desc&limit=${Number(limit) || 200}`);
}

// One metric's history for one device, newest first (v0.11.0: eggs per day on the poultry Home).
export async function metricHistory(device, metric, limit = 1200) {
  if (!/^[a-z0-9-]+$/i.test(device) || !/^[a-z_]+$/.test(metric)) return [];
  if (!dbConfigured()) return mem.readings.filter((r) => r.device === device && r.metric === metric).slice(0, limit);
  return rest('GET', `sensor_readings?select=value,at&device=eq.${device}&metric=eq.${metric}&order=at.desc&limit=${Number(limit) || 1200}`);
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
