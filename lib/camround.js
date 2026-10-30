// v0.27.7: Sathi checks today's shed camera on her own, every few hours in daylight (the shed is in
// Bangladesh: Asia/Dhaka, UTC+6 all year). SAM 3.1 counts the hens and finds still ones; Muse Spark watches
// the clip. A hen that stops moving raises the usual camera warning, which wakes Sathi.
export const DAY_START = 6; // first check from 06:00
export const DAY_END = 18; // no checks from 18:00 (hens rest at night)
const OFFSET_MS = 6 * 3600 * 1000; // Asia/Dhaka

const dhakaHour = (ms) => new Date(ms + OFFSET_MS).getUTCHours();

// Is a check due now? hour is the shed's local hour; lastAt is the last check (ISO) by anyone.
export function dueCameraCheck({ hour, lastAt, now = Date.now(), everyMs }) {
  if (hour < DAY_START || hour >= DAY_END) return false;
  const last = Date.parse(lastAt || '');
  return !Number.isFinite(last) || now - last >= everyMs - 60 * 1000;
}

// When Sathi looks next: everyMs after the last check, moved to 06:00 if that falls in the night.
export function nextCheckAt({ lastAt, now = Date.now(), everyMs }) {
  const last = Date.parse(lastAt || '');
  let at = Number.isFinite(last) ? Math.max(last + everyMs, now) : now;
  const h = dhakaHour(at);
  if (h < DAY_START || h >= DAY_END) {
    const local = new Date(at + OFFSET_MS);
    const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + (h >= DAY_END ? 24 * 3600 * 1000 : 0);
    at = day + DAY_START * 3600 * 1000 - OFFSET_MS;
  }
  return new Date(at).toISOString();
}
