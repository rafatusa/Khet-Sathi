// Crops for any place on Earth (v0.11.0), used wherever FAO has no crop calendar for the farmer's zone.
//   What grows here and when: MIRCA-OS v2 (2020) gridded crop calendars, 5 arc-minute cells (about 9 km),
//     only where the crop is really grown; planting and maturity month per crop and season.
//   How much of each: MIRCA-OS growing area for the farmer's own district (or state), matched by the
//     OpenStreetMap district name; FAOSTAT country totals when no district matches.
// All CC BY 4.0. Built offline by tools/build_crop_data.py into lib/data/.
import { readFileSync } from 'node:fs';
import { gunzipSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { windowState } from './calendar.js';
import { CROPS, soilFits } from './recommend.js';

const file = (n) => fileURLToPath(new URL(`./data/${n}`, import.meta.url));
const META = JSON.parse(readFileSync(file('faostat-crops.json'), 'utf8'));
export const SOURCE = { which: META.calendar, country: META.source };

// ---------- the gridded calendars ----------
let G = null;
function grid() {
  if (G) return G;
  const buf = readFileSync(file('mirca-grid.bin'));
  const n = buf.readUInt32LE(0);
  const head = JSON.parse(buf.subarray(4, 4 + n).toString('utf8'));
  G = { ...head, data: buf.subarray(4 + n), blocks: new Map() };
  return G;
}
function blockOf(g, gi, bi) {
  const key = `${gi}|${bi}`;
  if (g.blocks.has(key)) return g.blocks.get(key);
  const [off, len] = g.index[gi][bi];
  const out = len ? inflateSync(g.data.subarray(off, off + len)) : null;
  if (g.blocks.size > 400) g.blocks.clear();
  g.blocks.set(key, out);
  return out;
}
function cellValue(g, gi, row, col) {
  if (row < 0 || row >= g.rows) return 0;
  col = ((col % g.cols) + g.cols) % g.cols;
  const b = g.block;
  const blk = blockOf(g, gi, Math.floor(row / b) * (g.cols / b) + Math.floor(col / b));
  return blk ? blk[(row % b) * b + (col % b)] : 0;
}

// Every crop season grown in this cell: { key, crop, system, plant, mature } (months 1 to 12).
// On a coast or a border a neighbouring cell (up to 2 away) is used.
export function cellCrops(lat, lon) {
  const g = grid();
  const row0 = Math.floor((90 - lat) * 12);
  const col0 = Math.floor((lon + 180) * 12);
  for (let r = 0; r <= 2; r++) {
    const out = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        g.grids.forEach((gr, gi) => {
          const v = cellValue(g, gi, row0 + dy, col0 + dx);
          if (!v) return;
          const s = { key: gr.key, crop: gr.crop, system: gr.system, plant: v >> 4, mature: v & 15 };
          if (s.plant >= 1 && s.plant <= 12 && !out.some((o) => o.crop === s.crop && o.plant === s.plant && o.mature === s.mature)) out.push(s);
        });
      }
    }
    if (out.length) return out;
  }
  return [];
}

// ---------- districts and states ----------
let UNITS = null;
const units = () => (UNITS ||= JSON.parse(gunzipSync(readFileSync(file('mirca-units.json.gz'))).toString('utf8')));
export function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(district|division|county|zila|zilla|parish|province|state|region|municipality|city|sadar|upazila|tehsil|taluk|department)\b/g, ' ')
    .replace(/gonj/g, 'ganj')
    .replace(/[^a-z]/g, '');
}
function similar(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}
// The farmer's district (best name match in the right state), else the whole state, else nothing.
export function matchUnit(cc, place = {}) {
  const list = units()[String(cc || '').toUpperCase()];
  if (!list?.length) return null;
  const st = normName(place.state);
  const names = [place.district, place.county, place.village].map(normName).filter(Boolean);
  let best = null;
  for (const u of list) {
    if (!u.d) continue;
    const ss = st ? similar(st, normName(u.s)) : 0.5;
    if (st && ss < 0.7) continue;
    const ds = Math.max(...names.map((n) => similar(n, normName(u.d))), 0);
    const score = ds + ss * 0.1;
    if (ds >= 0.75 && (!best || score > best.score)) best = { score, u };
  }
  if (best) return { scope: 'district', name: best.u.d, state: best.u.s, crops: best.u.c };
  // State level: a unit with no district, or the sum of the state's districts.
  const inState = st ? list.filter((u) => similar(st, normName(u.s)) >= 0.8) : [];
  if (!inState.length) return list.length === 1 && !list[0].s ? { scope: 'country', name: '', state: '', crops: list[0].c } : null;
  const crops = {};
  for (const u of inState) for (const [k, seasons] of Object.entries(u.c)) for (const [a, p, m] of seasons) {
    const e = (crops[k] ||= []).find((x) => x[1] === p && x[2] === m);
    if (e) e[0] += a;
    else crops[k].push([a, p, m]);
  }
  return { scope: 'state', name: inState[0].s, state: inState[0].s, crops };
}

// ---------- the calendar for one spot ----------
const LOCAL_NAME = { BD: { rapeseed: 'mustard' }, IN: { rapeseed: 'mustard' }, NP: { rapeseed: 'mustard' }, PK: { rapeseed: 'mustard' } };
const EXTRA_RULES = {
  maize: { avoid: ['clay'], ph: [5.5, 7.5], water: 'medium' }, wheat: { avoid: ['sand'], ph: [6.0, 7.8], water: 'medium' },
  rice: { avoid: ['sand', 'loamy_sand'], ph: [5.0, 7.5], water: 'high' }, soybean: { avoid: ['sand'], ph: [6.0, 7.5], water: 'medium' },
  sorghum: { avoid: [], ph: [5.5, 8.5], water: 'low' }, millet: { avoid: [], ph: [5.0, 8.0], water: 'low' }, peanut: { avoid: ['clay', 'silty_clay'], ph: [5.5, 7.0], water: 'low' },
  pulses: { avoid: ['clay'], ph: [6.0, 8.0], water: 'low' }, cassava: { avoid: ['clay'], ph: [4.5, 7.5], water: 'low' }, cotton: { avoid: ['sand'], ph: [5.8, 8.0], water: 'medium' },
  sunflower: { avoid: ['sand'], ph: [6.0, 7.5], water: 'low' }, sugar_beet: { avoid: ['sand'], ph: [6.5, 8.0], water: 'medium' }, sugarcane: { avoid: ['sand'], ph: [5.5, 8.0], water: 'high' },
  rye: { avoid: [], ph: [5.0, 7.0], water: 'low' },
};
const ruleFor = (key) => Object.values(CROPS).find((c) => c.key === key) || EXTRA_RULES[key] || null;
const lastDay = (m) => [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export const knownCountry = (cc) => Boolean(META.countries[String(cc || '').toUpperCase()] || units()[String(cc || '').toUpperCase()]);

// MIRCA-OS puts some South Asian winter (rabi) crops in June on irrigated land in many districts
// (Ludhiana wheat "planted June"). On the plains these crops are only sown in the cool season, so
// such a season is moved to the crop's usual rabi months. Hill states keep their own seasons.
const RABI = { wheat: [11, 3], barley: [11, 3], rapeseed: [10, 2], potato: [10, 2] };
const HILLS = /himachal|jammu|kashmir|ladakh|uttarakhand|sikkim|arunachal|meghalaya|nagaland|mizoram|manipur/i;
export function fixSeason(cc, state, key, plant, mature) {
  if (!['IN', 'BD', 'PK', 'NP'].includes(cc) || !RABI[key] || plant < 5 || plant > 8) return [plant, mature];
  if (key === 'potato' && HILLS.test(state || '')) return [plant, mature];
  if (cc === 'NP') return [plant, mature];
  return RABI[key];
}

// Rows have the same shape as calendar.js calendarFor rows, plus the hectares behind them.
// District (or state) matched: its own crops, seasons and hectares. Otherwise: the crops grown in this
// 9 km cell (MIRCA-OS grid), ranked by the country's FAOSTAT area.
export function worldCalendar({ cc, lat, lon, today, place = {}, soonDays = 30 }) {
  const C = String(cc || '').toUpperCase();
  const unit = matchUnit(C, place);
  const national = META.countries[C] || {};
  let seasons = [];
  if (unit) {
    const total = Object.values(unit.crops).flat().reduce((a, s) => a + s[0], 0) || 1;
    for (const [key, list] of Object.entries(unit.crops)) {
      for (const [ha, p, m] of list) if (ha / total >= 0.005) seasons.push({ key, crop: key, system: '', plant: p, mature: m, ha, scope: unit.scope });
    }
  } else {
    seasons = cellCrops(lat, lon)
      .map((s) => ({ ...s, ha: national[s.key] ?? 0, scope: 'country' }))
      .filter((s) => !Object.keys(national).length || s.ha > 0);
  }
  const rows = [];
  for (const s of seasons) {
    const [plant, mature] = fixSeason(C, unit?.state || place.state, s.key, s.plant, s.mature);
    const key = LOCAL_NAME[C]?.[s.key] || s.key;
    const same = rows.find((r) => r.key === key && r.sow[0] === plant);
    if (same) {
      if (s.scope !== 'country') same.hectares += s.ha;
      continue;
    }
    const sow = [plant, 1, plant, lastDay(plant)];
    const w = windowState(sow, today);
    const months = ((mature - plant + 12) % 12) || 12;
    const status = w.state === 'now' ? (w.daysLeft <= 7 ? 'closing' : 'open') : w.daysUntil <= soonDays ? 'soon' : 'later';
    rows.push({
      key,
      faoName: key,
      code: s.crop,
      season: '',
      sow,
      harvest: [mature, 1, mature, lastDay(mature)],
      growDays: { min: Math.max(60, months * 30 - 15), max: months * 30 + 15 },
      status,
      daysLeft: w.daysLeft ?? null,
      daysUntil: w.daysUntil ?? null,
      windowStart: w.start,
      windowEnd: w.end,
      hectares: s.ha,
      areaScope: s.scope,
      areaName: unit?.name || null,
    });
  }
  const rank = { closing: 0, open: 1, soon: 2, later: 3 };
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || (b.hectares || 0) - (a.hectares || 0));
}

// Up to three crops for an empty plot: sowing now or within a month, soil fits, the biggest in the area first.
// With nothing in the next month, the next three windows are shown instead.
export function worldCrops(calendar, soil, { max = 3 } = {}) {
  const fits = calendar.filter((c) => {
    const r = ruleFor(c.key);
    return !r || soilFits({ avoid: r.avoid || [], ph: r.ph || [0, 14] }, soil);
  });
  const seen = new Set();
  const pick = (list) => {
    const out = [];
    for (const c of list) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      out.push(c);
      if (out.length === max) break;
    }
    return out;
  };
  const soon = fits.filter((c) => c.status !== 'later');
  let picked = pick(soon);
  if (!picked.length) picked = pick([...fits].sort((a, b) => a.daysUntil - b.daysUntil));
  return picked.map((c) => ({
    key: c.key,
    faoName: c.faoName,
    status: c.status,
    daysLeft: c.daysLeft,
    daysUntil: c.daysUntil,
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
    growDays: c.growDays,
    water: ruleFor(c.key)?.water || 'medium',
    hectares: c.hectares,
    areaScope: c.areaScope,
    areaName: c.areaName,
    sampleProfitBdtPerAcre: null,
  }));
}
