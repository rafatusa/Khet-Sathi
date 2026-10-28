// v0.19.0: the last good answer from an outside source (weather, satellite, a Sathi answer), served with its
// time when that source does not answer, so a card shows earlier data with a note instead of an error.
// Kept in memory; for the demo places also in storage (keep/…json), so a restart does not lose them.
import { putFile, getFile } from './store.js';

const mem = new Map();
const savedAt = new Map();
const SAVE_EVERY = 30 * 60 * 1000;
const fileOf = (key) => `keep/${String(key).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)}.json`;

export function remember(key, value, { persist = false, now = Date.now() } = {}) {
  const rec = { at: now, value };
  mem.set(key, rec);
  if (mem.size > 2000) mem.delete(mem.keys().next().value);
  if (persist && now - (savedAt.get(key) || 0) > SAVE_EVERY) {
    savedAt.set(key, now);
    putFile(fileOf(key), Buffer.from(JSON.stringify(rec)), 'application/json', undefined, 'no-cache').catch(() => savedAt.delete(key));
  }
  return rec;
}

// Returns { at, value } or null. maxAgeMs: older copies are not served (default 3 days).
export async function recall(key, { maxAgeMs = 3 * 864e5, persist = false, now = Date.now() } = {}) {
  let rec = mem.get(key) || null;
  if (!rec && persist) {
    const f = await getFile(fileOf(key)).catch(() => null);
    if (f?.buffer) {
      try {
        rec = JSON.parse(Buffer.from(f.buffer).toString('utf8'));
        if (rec && Number.isFinite(rec.at)) mem.set(key, rec);
        else rec = null;
      } catch {
        rec = null;
      }
    }
  }
  if (!rec || now - rec.at > maxAgeMs) return null;
  return rec;
}

// Runs fn(); a good answer is remembered, a failure (or an answer `ok` rejects) returns the kept copy as
// { value, staleAt }. With nothing kept, the failure is passed on as before.
export async function withKeep(key, fn, { persist = false, ok = (v) => v != null, maxAgeMs } = {}) {
  let err = null;
  try {
    const value = await fn();
    if (ok(value)) {
      remember(key, value, { persist });
      return { value, staleAt: null };
    }
    err = new Error('No usable answer');
  } catch (e) {
    err = e;
  }
  const kept = await recall(key, { persist, maxAgeMs });
  if (kept) return { value: kept.value, staleAt: new Date(kept.at).toISOString(), reason: err?.message || null };
  throw err;
}

export function _resetKeep() {
  mem.clear();
  savedAt.clear();
}
