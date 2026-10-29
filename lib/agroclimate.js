// v0.24.0: heat since sowing from NASA POWER (agro-climate, daily, no key). Crops ripen after a fairly steady
// amount of warmth ("growing degree days"), so this says better than the calendar alone when a field should be
// ripening. Used to tell ripening apart from a problem when the field camera sees the crop turn yellow.
// NASA POWER publishes with a delay of a few days; the last days before today are simply not counted yet.
export const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';

// Base temperature, upper cap (°C) and the warmth a typical variety needs from sowing to harvest.
// Rounded textbook values for South Asian varieties; the screen calls the result an estimate.
export const GDD_CROPS = {
  rice: { base: 10, cap: 35, need: 2000 },
  wheat: { base: 0, cap: 30, need: 2000 },
  barley: { base: 0, cap: 30, need: 1700 },
  maize: { base: 10, cap: 30, need: 1500 },
  potato: { base: 7, cap: 30, need: 1300 },
  mustard: { base: 5, cap: 30, need: 1200 },
  rapeseed: { base: 5, cap: 30, need: 1200 },
  lentil: { base: 5, cap: 30, need: 1300 },
  jute: { base: 10, cap: 35, need: 1800 },
};

const ymd = (iso) => String(iso).slice(0, 10).replace(/-/g, '');
const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

// Daily highs and lows from NASA POWER between two dates (YYYY-MM-DD), oldest first; missing days left out.
export async function powerDaily({ lat, lon, start, end, fetchImpl = fetch }) {
  const url = `${POWER_URL}?parameters=T2M_MAX,T2M_MIN&community=AG&longitude=${Number(lon).toFixed(4)}&latitude=${Number(lat).toFixed(4)}&start=${ymd(start)}&end=${ymd(end)}&format=JSON`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NASA POWER HTTP ${res.status}`);
  const j = await res.json();
  const p = j?.properties?.parameter || {};
  const hi = p.T2M_MAX || {};
  const lo = p.T2M_MIN || {};
  return Object.keys(hi)
    .filter((k) => hi[k] > -900 && lo[k] > -900)
    .sort()
    .map((k) => ({ date: iso(k), tMax: hi[k], tMin: lo[k] }));
}

// Growing degree days: each day's mean of the (capped) high and the (floored) low, above the base.
export function gddFrom(days, { base, cap }) {
  return Math.round(days.reduce((s, d) => s + Math.max(0, (Math.min(d.tMax, cap) + Math.max(d.tMin, base)) / 2 - base), 0));
}

// How far the crop is by warmth: growing, ripening (80% of the warmth it needs) or ready.
export function heatStage({ crop, days }) {
  const c = GDD_CROPS[crop];
  if (!c || !days?.length) return null;
  const gdd = gddFrom(days, c);
  const pct = Math.round((gdd / c.need) * 100);
  return { crop, gdd, need: c.need, pct, stage: pct >= 100 ? 'ready' : pct >= 80 ? 'ripening' : 'growing', through: days.at(-1).date, source: 'NASA POWER' };
}
