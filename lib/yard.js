// v0.15.0: what to plant in the open space in front of the house (বাড়ির উঠোন), from one photo.
// SAM 3.1 outlines the open ground in the photo; the farmer gives the size in the units of their country
// (feet, শতাংশ / डिसमिल, কাঠা, गज, square feet, acres or metres); the picks come from the table below with
// that place's weather and the month. Sowing months are a general guide for Bangladesh and eastern India;
// outside South Asia the picks use the temperature instead, and the screen says the table is tuned for South Asia.
import { segmentStream } from './meta.js';
import { collectSegments } from './segment.js';
import { pickPlot } from './plot.js';
import { currencyFor } from './place.js';

// ---------- units ----------
export const M2 = { sqft: 0.09290304, decimal: 40.468564, katha: 66.8902, gaj: 0.83612736, acre: 4046.8564 };
// Which units Sathi asks in, by country. 'ft' and 'm' take length × width; the rest take one number.
// কাঠা is fixed (720 sq ft) only in Bangladesh; बीघा and India's কাঠা change from state to state, so they are
// never converted: Sathi asks again in feet or डिसमिल.
export const UNITS = {
  BD: ['ft', 'decimal', 'katha'],
  IN: ['ft', 'decimal', 'gaj', 'bigha'],
  US: ['ft', 'sqft', 'acre'],
};
export const unitsFor = (cc) => UNITS[String(cc || '').toUpperCase()] || ['m', 'm2'];
export const SOUTH_ASIA = ['BD', 'IN', 'NP', 'PK', 'LK', 'BT', 'MM'];

// The size the farmer gave -> square metres. Returns { m2 } or { ask } (a follow-up is needed) or { error }.
export function sizeToM2(size, cc) {
  const s = size || {};
  const n = (v) => Number(String(v ?? '').replace(/[^\d.]/g, ''));
  const units = unitsFor(cc);
  if (!units.includes(s.unit) && s.unit !== 'unknown') return { error: 'unit' };
  if (s.unit === 'bigha') return { ask: 'bigha' };
  if (s.unit === 'unknown') return { m2: null, estimate: true };
  let m2;
  if (s.unit === 'ft' || s.unit === 'm') {
    const a = n(s.a);
    const b = n(s.b);
    if (!(a > 0 && b > 0)) return { error: 'number' };
    m2 = s.unit === 'ft' ? a * b * M2.sqft : a * b;
  } else {
    const v = n(s.n);
    if (!(v > 0)) return { error: 'number' };
    m2 = s.unit === 'm2' ? v : v * M2[s.unit];
  }
  if (m2 < 0.2) return { error: 'tiny' };
  if (m2 > 4047) return { ask: 'field' }; // more than an acre: that is a field, add it as a field
  return { m2: Math.round(m2 * 10) / 10 };
}

// One size in the farmer's own words, plus a second unit they may know ("6 শতাংশ · about 2,600 sq ft").
export function sizeWords(m2, cc) {
  if (!Number.isFinite(m2)) return null;
  const C = String(cc || '').toUpperCase();
  const sqft = Math.round(m2 / M2.sqft);
  if (C === 'BD' || C === 'IN') return { main: m2 >= 40 ? { n: Math.round((m2 / M2.decimal) * 10) / 10, unit: 'decimal' } : { n: sqft, unit: 'sqft' }, also: { n: Math.round(m2), unit: 'm2' } };
  if (C === 'US') return { main: { n: sqft, unit: 'sqft' }, also: { n: Math.round(m2), unit: 'm2' } };
  return { main: { n: Math.round(m2), unit: 'm2' }, also: { n: sqft, unit: 'sqft' } };
}

export const sizeClass = (m2) => (m2 < 2 ? 'tiny' : m2 < 10 ? 'small' : m2 < 40 ? 'medium' : 'large');

// ---------- plants ----------
// per: square metres one plant needs (leafy greens: one bed of 1 m²). sun: light it grows in.
// months: sowing or planting months in Bangladesh and eastern India. warm: a warm-season plant (outside South Asia
// it needs days above about 20 °C); cool: a cool-season one (about 10 to 25 °C).
// buy: what to get at the nursery. min: the smallest yard class it fits.
export const PLANTS = {
  red_amaranth: { group: 'leafy', per: 1, bed: true, sun: ['full', 'half'], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], season: 'any', days: [25, 30], buy: 'seed', min: 'tiny' },
  spinach: { group: 'leafy', per: 1, bed: true, sun: ['full', 'half', 'shade'], months: [10, 11, 12, 1], season: 'cool', days: [30, 40], buy: 'seed', min: 'tiny' },
  coriander: { group: 'leafy', per: 1, bed: true, sun: ['full', 'half', 'shade'], months: [10, 11, 12, 1], season: 'cool', days: [35, 45], buy: 'seed', min: 'tiny' },
  radish: { group: 'leafy', per: 1, bed: true, sun: ['full', 'half'], months: [9, 10, 11, 12, 1], season: 'cool', days: [30, 45], buy: 'seed', min: 'small' },
  malabar_spinach: { group: 'vine', per: 1, sun: ['full', 'half'], months: [3, 4, 5, 6, 7], season: 'warm', days: [40, 50], buy: 'seed', trellis: true, min: 'small' },
  bottle_gourd: { group: 'vine', per: 2.5, sun: ['full'], months: [2, 3, 4, 9, 10, 11], season: 'warm', days: [60, 70], buy: 'sapling', trellis: true, min: 'small' },
  bitter_gourd: { group: 'vine', per: 1.5, sun: ['full'], months: [2, 3, 4, 5], season: 'warm', days: [55, 60], buy: 'sapling', trellis: true, min: 'small' },
  okra: { group: 'fruitveg', per: 0.25, sun: ['full'], months: [2, 3, 4, 5, 6], season: 'warm', days: [45, 50], buy: 'seed', min: 'small' },
  chilli: { group: 'fruitveg', per: 0.2, sun: ['full', 'half'], months: [1, 2, 8, 9, 10, 11], season: 'warm', days: [60, 75], buy: 'sapling', min: 'tiny' },
  brinjal: { group: 'fruitveg', per: 0.5, sun: ['full'], months: [1, 2, 8, 9, 10, 11], season: 'warm', days: [60, 70], buy: 'sapling', min: 'small' },
  tomato: { group: 'fruitveg', per: 0.4, sun: ['full'], months: [9, 10, 11], season: 'cool', days: [60, 75], buy: 'sapling', stake: true, min: 'small' },
  papaya: { group: 'tree', per: 4, sun: ['full'], months: [2, 3, 4, 5, 9, 10], season: 'warm', days: [240, 300], buy: 'tree', min: 'medium' },
  lemon: { group: 'tree', per: 4, sun: ['full', 'half'], months: [5, 6, 7, 8, 9], season: 'warm', days: [365, 540], buy: 'tree', min: 'small' },
  holy_basil: { group: 'herb', per: 0.1, sun: ['full', 'half'], months: [2, 3, 4, 5, 6, 7], season: 'warm', days: [30, 40], buy: 'sapling', pot: true, min: 'tiny' },
  mint: { group: 'herb', per: 0.1, sun: ['half', 'shade'], months: [2, 3, 10, 11], season: 'any', days: [30, 40], buy: 'sapling', pot: true, min: 'tiny' },
  marigold: { group: 'flower', per: 0.15, sun: ['full', 'half'], months: [9, 10, 11, 12], season: 'cool', days: [50, 60], buy: 'sapling', pot: true, min: 'tiny' },
};
const CLASS_RANK = { tiny: 0, small: 1, medium: 2, large: 3 };
// Which kinds of plant come first for each size: a step or two of space suits herbs and flowers in pots,
// a medium yard suits a gourd on a trellis and vegetables.
const GROUP_ORDER = {
  tiny: ['herb', 'leafy', 'flower', 'fruitveg'],
  small: ['leafy', 'fruitveg', 'herb', 'vine', 'flower'],
  medium: ['vine', 'fruitveg', 'leafy', 'tree', 'herb'],
  large: ['vine', 'tree', 'fruitveg', 'leafy'],
};

function seasonFits(p, { month, cc, tMean }) {
  if (SOUTH_ASIA.includes(String(cc || '').toUpperCase())) return p.months.includes(month);
  if (!Number.isFinite(tMean)) return p.season !== 'warm';
  if (p.season === 'warm') return tMean >= 20 && tMean <= 35;
  if (p.season === 'cool') return tMean >= 10 && tMean <= 25;
  return tMean >= 10 && tMean <= 32;
}

// Up to three picks, one per kind of plant, each with how many plants (or how big a bed) fit.
export function pickPlants({ m2, sun = 'half', month, cc, tMean = null }) {
  if (!Number.isFinite(m2) || m2 <= 0) return { picks: [], cls: null };
  const cls = sizeClass(m2);
  const fits = Object.entries(PLANTS)
    .filter(([, p]) => CLASS_RANK[cls] >= CLASS_RANK[p.min])
    .filter(([, p]) => p.sun.includes(sun))
    .filter(([, p]) => seasonFits(p, { month, cc, tMean }))
    .filter(([, p]) => p.per <= m2);
  const order = GROUP_ORDER[cls];
  const picked = [];
  for (const g of order) {
    if (picked.length >= 3) break;
    const hit = fits.find(([k, p]) => p.group === g && !picked.some((x) => x.key === k));
    if (hit) picked.push({ key: hit[0], ...hit[1] });
  }
  // Space is shared out between the picks, with a sensible most-per-kind (a home yard, not a farm).
  const share = m2 / Math.max(1, picked.length);
  const CAP = { herb: 4, flower: 6, fruitveg: 12, vine: 4, tree: 2, leafy: 10 };
  const picks = picked.map((p) => {
    const room = Math.max(p.per, share);
    if (p.bed) return { key: p.key, group: p.group, bedM2: Math.max(1, Math.min(Math.floor(room), CAP.leafy)), days: p.days, buy: p.buy, trellis: Boolean(p.trellis), stake: Boolean(p.stake), pot: Boolean(p.pot) };
    const count = Math.max(1, Math.min(Math.floor(room / p.per), CAP[p.group] || 6));
    return { key: p.key, group: p.group, count, days: p.days, buy: p.buy, trellis: Boolean(p.trellis), stake: Boolean(p.stake), pot: Boolean(p.pot) || cls === 'tiny' };
  });
  return { picks, cls };
}

// ---------- shopping list (sample prices, labelled on screen) ----------
const PRICE_USD = { seed: 0.3, sapling: 0.15, tree: 1, trellis: 1, stake: 0.05, pot: 0.5, compost: 1 };
const round = (v, cur) => {
  const step = v >= 100 ? 10 : v >= 10 ? 5 : cur.perUsd >= 50 ? 5 : 0.5;
  return Math.max(step, Math.round(v / step) * step);
};
export function shoppingList(picks, cc) {
  const cur = currencyFor(cc);
  const lines = [];
  for (const p of picks) {
    if (p.buy === 'seed') lines.push({ item: 'seed', plant: p.key, qty: 1, unit: 'packet' });
    else lines.push({ item: p.buy, plant: p.key, qty: p.count || 1, unit: 'plant' });
    if (p.trellis) lines.push({ item: 'trellis', plant: p.key, qty: 1, unit: 'net' });
    if (p.stake) lines.push({ item: 'stake', plant: p.key, qty: p.count || 1, unit: 'piece' });
    if (p.pot) lines.push({ item: 'pot', plant: p.key, qty: Math.min(p.count || 1, 10), unit: 'pot' });
  }
  if (lines.length) lines.push({ item: 'compost', plant: null, qty: 1, unit: 'bag5kg' });
  const priced = lines.map((l) => ({ ...l, price: round(PRICE_USD[l.item] * cur.perUsd * l.qty, cur) }));
  return { lines: priced, total: priced.reduce((s, l) => s + l.price, 0), currency: cur, sample: true };
}

// ---------- weather tips ----------
export function waterTip(wx) {
  const days = wx?.days || [];
  const next = days.slice(1, 4);
  const rain = next.find((d) => (d.rainChance ?? 0) >= 60 || (d.rainMm ?? 0) >= 8);
  const hot = days[0] && Number.isFinite(days[0].tMax) && days[0].tMax >= 36;
  return { rainDate: rain?.date || null, hot: Boolean(hot), tMax: days[0]?.tMax ?? null, tMin: days[0]?.tMin ?? null };
}
export const meanTemp = (wx) => {
  const d = (wx?.days || []).slice(0, 5).filter((x) => Number.isFinite(x.tMax) && Number.isFinite(x.tMin));
  return d.length ? d.reduce((s, x) => s + (x.tMax + x.tMin) / 2, 0) / d.length : null;
};

// ---------- SAM 3.1 on the yard photo ----------
// The open ground is usually in the lower half of a photo taken standing at the door.
// v0.20.1: 'lawn' added, since many yards are grass rather than bare soil.
export const YARD_PROMPTS = ['open ground', 'soil', 'lawn'];
export async function outlineYard(image, { segment = null } = {}) {
  const seg = segment || (async (img, prompt) => collectSegments(await segmentStream({ imageDataUrl: img.dataUrl, prompt }), { point: { x: img.width / 2, y: img.height * 0.7 } }));
  let lastError = null;
  for (const prompt of YARD_PROMPTS) {
    try {
      const r = await seg(image, prompt);
      const objects = (r.objects || []).filter((o) => o.mask?.svgPath);
      if (!objects.length) continue;
      const best = pickPlot(objects, { width: image.width, height: image.height });
      const share = best.areaPx ? Math.round((best.areaPx / (image.width * image.height)) * 100) : null;
      return { prompt, outline: { svgPath: best.mask.svgPath, bounds: best.mask.bounds, mw: best.mask.width, mh: best.mask.height, box: best.box, share }, width: image.width, height: image.height, error: null };
    } catch (err) {
      lastError = err.message || String(err);
      if (/model_not_found/.test(lastError)) break; // SAM failed every retry already: the second prompt would only wait again
    }
  }
  // answered: SAM replied to every phrase but found no open ground (not the same as SAM being down).
  return { prompt: null, outline: null, width: image.width, height: image.height, error: lastError || 'SAM 3.1 found no open ground in the photo', answered: !lastError };
}
