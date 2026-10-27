// Sowing windows from the FAO Crop Calendar for Bangladesh, by farming zone (AEZ).
// Fetched live once a day; the copy saved on Oct 27, 2026 is used if FAO is unreachable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FAO_URL = 'https://api-cropcalendar.apps.fao.org/api/v1/countries/BD/cropCalendar?language=en';
const SAVED = JSON.parse(readFileSync(fileURLToPath(new URL('./data/fao-bd-calendar.json', import.meta.url)), 'utf8'));
const TTL_MS = 24 * 60 * 60 * 1000;
let live = null;

export const DEMO_AEZ = { bogura: '4. Karatoya-Bangali Floodplain' };
const DEFAULT_BD_AEZ = '4. Karatoya-Bangali Floodplain';

export function inBangladesh(lat, lon) {
  return lat >= 20.5 && lat <= 26.7 && lon >= 88.0 && lon <= 92.7;
}

// Which FAO zone to use. FAO has no zone map, so only the demo plot is placed exactly.
export function aezFor(land) {
  if (land?.place && DEMO_AEZ[land.place]) return { aez: DEMO_AEZ[land.place], assumed: false };
  if (inBangladesh(Number(land?.lat), Number(land?.lon))) return { aez: DEFAULT_BD_AEZ, assumed: true };
  return { aez: null, assumed: false };
}

export function normalizeFao(json) {
  const out = [];
  for (const x of json || []) {
    for (const s of x.sessions || []) {
      out.push({
        crop: x.crop?.name,
        aez: x.aez?.name,
        season: s.additional_information || '',
        sow: [+s.early_sowing.month, +s.early_sowing.day, +s.later_sowing.month, +s.later_sowing.day],
        harvest: [+s.early_harvest.month, +s.early_harvest.day, +s.late_harvest.month, +s.late_harvest.day],
        days: s.growing_period?.value || '',
        unit: s.growing_period?.period || '',
      });
    }
  }
  return out;
}

export async function calendarRecords({ fetchImpl = fetch } = {}) {
  if (live && Date.now() - live.at < TTL_MS) return { records: live.records, source: 'FAO Crop Calendar' };
  try {
    const res = await fetchImpl(FAO_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`FAO HTTP ${res.status}`);
    const records = normalizeFao(await res.json());
    if (!records.length) throw new Error('FAO returned no records');
    live = { at: Date.now(), records };
    return { records, source: 'FAO Crop Calendar' };
  } catch (err) {
    return { records: SAVED.records, source: `FAO Crop Calendar (saved copy, ${SAVED.savedOn})`, error: err.message };
  }
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, m === 2 ? 28 : d)).padStart(2, '0')}`;
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Where today sits in a sowing window that may cross the new year.
export function windowState(sow, today) {
  const year = Number(today.slice(0, 4));
  const [m1, d1, m2, d2] = sow;
  const wraps = m2 < m1 || (m2 === m1 && d2 < d1);
  const candidates = [year - 1, year, year + 1].map((y) => ({ start: iso(y, m1, d1), end: iso(wraps ? y + 1 : y, m2, d2) }));
  const open = candidates.find((w) => w.start <= today && today <= w.end);
  if (open) return { state: 'now', start: open.start, end: open.end, daysLeft: dayDiff(today, open.end) };
  const next = candidates.find((w) => w.start > today);
  return { state: 'later', start: next.start, end: next.end, daysUntil: dayDiff(today, next.start) };
}

export function growDays(text) {
  const nums = String(text || '').match(/\d+/g)?.map(Number) || [];
  if (!nums.length) return null;
  return { min: nums[0], max: nums[nums.length - 1] };
}

export function windowsFor(records, aez, today) {
  return records
    .filter((r) => r.aez === aez && r.unit === 'days')
    .map((r) => ({ crop: r.crop, season: r.season, grow: growDays(r.days), ...windowState(r.sow, today) }));
}

// App key for every crop in the FAO Bangladesh calendar (names live in public/i18n.js).
export const FAO_KEYS = {
  Anis: 'anis', Barley: 'barley', 'Bean, broad': 'broad_bean', 'Bean, broad green': 'broad_bean_green',
  'Bitter gourd': 'bitter_gourd', 'Bottle gourd': 'bottle_gourd', 'Cabbage, common': 'cabbage', Carrot: 'carrot',
  Cauliflower: 'cauliflower', 'Chick-pea': 'chickpea', Coconut: 'coconut', 'Colza(rapeseed)': 'rapeseed',
  Cowpea: 'cowpea', Lentil: 'lentil', 'Millet, foxtail': 'millet', Mustard: 'mustard', 'Pea, dry': 'pea',
  Peanut: 'peanut', 'Pigeon pea': 'pigeon_pea', Potato: 'potato', Safflower: 'safflower', Sesame: 'sesame',
  Soybean: 'soybean', Sugarcane: 'sugarcane', 'Sweet potato': 'sweet_potato', Taro: 'taro',
};

// Full calendar for one zone: every crop season with its sowing and harvest windows and today's status.
export function calendarFor(records, aez, today, { soonDays = 45 } = {}) {
  return records
    .filter((r) => r.aez === aez && r.unit === 'days' && FAO_KEYS[r.crop])
    .map((r) => {
      const w = windowState(r.sow, today);
      const status = w.state === 'now' ? (w.daysLeft <= 7 ? 'closing' : 'open') : w.daysUntil <= soonDays ? 'soon' : 'later';
      return {
        key: FAO_KEYS[r.crop],
        faoName: r.crop,
        season: r.season,
        sow: r.sow,
        harvest: r.harvest,
        growDays: growDays(r.days),
        status,
        daysLeft: w.daysLeft ?? null,
        daysUntil: w.daysUntil ?? null,
        windowStart: w.start,
        windowEnd: w.end,
      };
    })
    .sort((a, b) => {
      const rank = { closing: 0, open: 1, soon: 2, later: 3 };
      return rank[a.status] - rank[b.status] || (a.daysLeft ?? a.daysUntil) - (b.daysLeft ?? b.daysUntil);
    });
}
