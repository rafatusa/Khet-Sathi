// A growing crop (v0.12.0): harvest readiness, the harvest amount, booking the harvest and selling it.
//   When: the crop's own calendar row (FAO in Bangladesh, MIRCA-OS district months elsewhere) from the
//     sowing date; the Sentinel-2 greenness curve says whether the crop is past its peak (ripening).
//   How much: field acres x the country's average yield (FAOSTAT, CC BY 4.0), shown as "about".
//   Selling: the farmer's lowest price; on demo lands Sathi bargains with fictional demo buyers by fixed
//     rules (Muse Spark only voices the buyers); on real lands there is no price and no call (coming soon).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const META = JSON.parse(readFileSync(fileURLToPath(new URL('./data/faostat-crops.json', import.meta.url)), 'utf8'));
const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const addDays = (d, n) => iso(Date.parse(`${d}T12:00:00Z`) + n * DAY);

// ---------- when was it sown ----------
// The farmer's answer ("3 months ago") or, without one, the start of this season's green-up:
// the last low point (NDVI under 0.3) before greenness rose above 0.45, minus about two weeks of emergence.
export function sowingFromPasses(passes, today) {
  const clear = (passes || []).filter((p) => !p.cloudy && p.ndvi?.mean != null).sort((a, b) => a.date.localeCompare(b.date));
  if (clear.length < 3) return null;
  let rise = -1;
  for (let i = clear.length - 1; i >= 0; i--) if (clear[i].ndvi.mean < 0.3) {
    rise = i;
    break;
  }
  if (rise < 0) return null; // green the whole time: sown before the satellite window
  if (!clear.slice(rise + 1).some((p) => p.ndvi.mean > 0.45)) return null;
  const est = addDays(clear[rise].date, -14);
  return est <= today ? est : null;
}

// ---------- which calendar row ----------
// The calendar row of this crop whose sowing month is closest to the sowing date.
export function rowFor(calendar, crop, sownOn) {
  const rows = (calendar || []).filter((r) => r.key === crop);
  if (!rows.length) return null;
  const m = Number(sownOn.slice(5, 7));
  const dist = (r) => {
    const a = r.sow[0];
    const b = r.sow[2];
    const inside = a <= b ? m >= a && m <= b : m >= a || m <= b;
    if (inside) return 0;
    return Math.min(...[a, b].map((x) => Math.min(Math.abs(x - m), 12 - Math.abs(x - m))));
  };
  return [...rows].sort((x, y) => dist(x) - dist(y))[0];
}

// ---------- readiness ----------
// The next date on or after `from` with this month and day.
function nextOn(from, m, d) {
  const y = Number(from.slice(0, 4));
  for (const yy of [y, y + 1]) {
    const iso = `${yy}-${String(m).padStart(2, '0')}-${String(Math.min(d, new Date(Date.UTC(yy, m, 0)).getUTCDate())).padStart(2, '0')}`;
    if (iso >= from) return iso;
  }
  return null;
}
// Harvest window: the calendar's own harvest months when the crop was sown in (or within two months of)
// its sowing months, since many crops (Aman rice above all) ripen by season, not by days from sowing.
// Otherwise, or without a calendar row, sowing date + days to maturity.
export function harvestWindow(row, sownOn) {
  const g = row?.growDays || { min: 100, max: 130 };
  const byDays = { harvestStart: addDays(sownOn, g.min), harvestEnd: addDays(sownOn, g.max + 10) };
  const h = row?.harvest;
  if (!Array.isArray(h) || h.length < 4) return byDays;
  const m = Number(sownOn.slice(5, 7));
  const [a, , b] = row.sow;
  const inside = a <= b ? m >= a && m <= b : m >= a || m <= b;
  const off = Math.min(...[a, b].map((x) => Math.min(Math.abs(x - m), 12 - Math.abs(x - m))));
  if (!inside && off > 2) return byDays;
  const start = nextOn(addDays(sownOn, Math.round(g.min * 0.6)), h[0], h[1]);
  const endRaw = start && nextOn(start, h[2], h[3]);
  if (!start || !endRaw) return byDays;
  return { harvestStart: start, harvestEnd: addDays(endRaw, 10) };
}
export function readiness({ crop, sownOn, today, row, passes }) {
  const { harvestStart, harvestEnd } = harvestWindow(row, sownOn);
  const total = Math.max(30, days(sownOn, harvestStart) + 7);
  const grown = Math.max(0, days(sownOn, today));
  const season = (passes || []).filter((p) => !p.cloudy && p.ndvi?.mean != null && p.date >= sownOn).sort((a, b) => a.date.localeCompare(b.date));
  const peak = season.reduce((best, p) => (!best || p.ndvi.mean > best.ndvi.mean ? p : best), null);
  const now = season.at(-1) || null;
  const pastPeak = Boolean(peak && now && now.date > peak.date && now.ndvi.mean <= peak.ndvi.mean - 0.05);
  let pct = Math.round((grown / total) * 100);
  if (pastPeak && grown > total * 0.6) pct += 5; // the satellite already sees the crop turning
  if (today < harvestStart) pct = Math.min(pct, 97);
  pct = Math.max(0, Math.min(100, pct));
  if (today >= harvestStart) pct = 100;
  const daysLeft = Math.max(0, days(today, harvestStart));
  const stage = today > harvestEnd ? 'late' : today >= harvestStart ? 'ready' : pastPeak && grown > total * 0.6 ? 'ripening' : 'growing';
  return {
    crop,
    sownOn,
    grown,
    total,
    pct,
    stage,
    daysLeft,
    harvestStart,
    harvestEnd,
    peak: peak ? { date: peak.date, ndvi: peak.ndvi.mean } : null,
    now: now ? { date: now.date, ndvi: now.ndvi.mean } : null,
    curve: season.map((p) => ({ date: p.date, ndvi: p.ndvi.mean })),
    calendar: row ? { from: row.windowStart, to: row.windowEnd, source: row.areaScope ? 'MIRCA-OS' : 'FAO' } : null,
  };
}

// ---------- how much ----------
const YIELD_ALIAS = { mustard: 'rapeseed', rapeseed: 'mustard', bottle_gourd: 'pumpkin' };
export function unitFor(cc) {
  const C = String(cc || '').toUpperCase();
  if (C === 'BD') return { key: 'mon', kg: 40 };
  if (['IN', 'PK', 'NP'].includes(C)) return { key: 'quintal', kg: 100 };
  return { key: 't', kg: 1000 };
}
export function harvestAmount({ cc, crop, acres }) {
  const y = META.yields?.[String(cc || '').toUpperCase()] || {};
  const perHa = y[crop] || y[YIELD_ALIAS[crop]] || null;
  if (!perHa || !acres) return null;
  const kg = perHa * Number(acres) * 0.404686;
  const unit = unitFor(cc);
  return { kg: Math.round(kg), units: Math.round((kg / unit.kg) * 10) / 10, unit, perHa, source: 'FAOSTAT' };
}

// ---------- sample prices (demo lands only) ----------
const PRICE_USD_KG = {
  rice: 0.27, wheat: 0.27, maize: 0.22, mustard: 0.65, rapeseed: 0.65, potato: 0.15, pulses: 0.8, lentil: 0.9, chickpea: 0.8, pea: 0.6, beans: 0.8,
  soybean: 0.5, sorghum: 0.25, millet: 0.3, peanut: 0.7, cotton: 0.8, sugarcane: 0.04, barley: 0.22, rye: 0.2, sunflower: 0.5, cassava: 0.1,
  sugar_beet: 0.05, cabbage: 0.2, cauliflower: 0.25, carrot: 0.3, bottle_gourd: 0.2, sesame: 1.2,
};
export function samplePrice({ crop, unit, currency }) {
  const usd = PRICE_USD_KG[crop] ?? 0.3;
  const v = usd * unit.kg * (currency?.perUsd || 1);
  return v >= 100 ? Math.round(v / 10) * 10 : Math.round(v);
}

// ---------- demo buyers and the bargaining ----------
export const DEMO_BUYERS = [
  { id: 'demo-buyer-1', name: { en: 'Demo rice mill', bn: 'ডেমো চালকল', hi: 'डेमो चावल मिल' }, lift: 1.03, slot: 0 },
  { id: 'demo-buyer-2', name: { en: 'Demo wholesale trader', bn: 'ডেমো পাইকার', hi: 'डेमो थोक व्यापारी' }, lift: 1.0, slot: 1 },
  { id: 'demo-buyer-3', name: { en: 'Demo local buyer', bn: 'ডেমো স্থানীয় ক্রেতা', hi: 'डेमो स्थानीय खरीदार' }, lift: 0.94, slot: 2 },
];
const PICK = { en: ['the day after harvest, 9 am', 'two days after harvest', 'three days after harvest'], bn: ['কাটার পরদিন সকাল ৯টায়', 'কাটার দুদিন পর', 'কাটার তিন দিন পর'], hi: ['कटाई के अगले दिन सुबह 9 बजे', 'कटाई के दो दिन बाद', 'कटाई के तीन दिन बाद'] };
const step = (p) => (p >= 1000 ? 10 : p >= 100 ? 5 : 1);
const round = (p) => Math.round(p / step(p)) * step(p);

// Every price is decided here from the sample price and the farmer's floor; nothing is left to a model.
export function planCropDeal({ buyer, base, floor, lang = 'bn' }) {
  const max = round(base * buyer.lift);
  const o1 = round(max * 0.95);
  const target = Math.max(floor, round(base));
  const pickup = PICK[lang]?.[buyer.slot] || PICK.en[buyer.slot];
  const turns = [{ who: 'saathi', key: 'greet' }, { who: 'shop', kind: 'open', price: o1 }];
  const offers = [o1];
  let price = null;
  const accept = (p) => {
    price = p;
    turns.push({ who: 'saathi', key: 'accept', price: p }, { who: 'shop', kind: 'deal', pickup });
  };
  if (o1 >= target) accept(o1);
  else {
    turns.push({ who: 'saathi', key: 'counter', price: target });
    const o2 = Math.min(max, round((o1 + target) / 2));
    offers.push(o2);
    turns.push({ who: 'shop', kind: 'final', price: o2 });
    if (o2 >= floor) accept(o2);
    else turns.push({ who: 'saathi', key: 'decline', price: floor });
  }
  return { turns, price, best: Math.max(...offers), pickup: price ? pickup : null };
}

const DIG = { bn: '০১২৩৪৫৬৭৮৯', hi: '०१२३४५६७८९' };
export const digitsFor = (s, lang) => dg(s, lang);
const dg = (s, lang) => (DIG[lang] ? String(s).replace(/[0-9]/g, (c) => DIG[lang][c]) : String(s));
const UNIT_NAME = { quintal: { en: 'quintal', bn: 'কুইন্টাল', hi: 'क्विंटल' }, mon: { en: 'maund', bn: 'মণ', hi: 'मन' }, t: { en: 'tonne', bn: 'টন', hi: 'टन' } };
export const unitName = (unit, lang) => UNIT_NAME[unit.key]?.[lang] || UNIT_NAME[unit.key]?.en || unit.key;
export const priceText = (n, currency, lang) => dg(`${currency?.symbol || ''}${Math.round(n).toLocaleString('en-IN')}`, lang);

const LINES = {
  en: {
    greet: (c) => `Hello, this is Khet Sathi calling for a farmer. We will have about ${c.qty} ${c.unit} of ${c.crop} after the harvest. What would you pay per ${c.unit}?`,
    counter: (c, p) => `We can do it for ${p} per ${c.unit}.`,
    accept: (c, p) => `All right, ${p} per ${c.unit}. I will check with the farmer and confirm.`,
    decline: (c, p) => `We cannot go below ${p}. Not this time, thank you.`,
    open: (c, p) => `Prices are soft right now. I can give ${p} per ${c.unit}.`,
    final: (c, p) => `${p}, that is the most I can do.`,
    deal: (c, w) => `Fine, I will collect it ${w}.`,
  },
  bn: {
    greet: (c) => `নমস্কার, আমি খেত সাথী, একজন কৃষকের হয়ে ফোন করছি। কাটার পর প্রায় ${c.qty} ${c.unit} ${c.crop} হবে। ${c.unit} প্রতি কত দেবেন?`,
    counter: (c, p) => `${c.unit} প্রতি ${p} হলে দিতে পারি।`,
    accept: (c, p) => `ঠিক আছে, ${c.unit} প্রতি ${p}। কৃষককে জানিয়ে পাকা করব।`,
    decline: (c, p) => `${p}-র কম হবে না। এবার থাক, ধন্যবাদ।`,
    open: (c, p) => `এখন দাম একটু কম। ${c.unit} প্রতি ${p} দিতে পারি।`,
    final: (c, p) => `${p}, এর বেশি পারব না।`,
    deal: (c, w) => `ঠিক আছে, ${w} নিয়ে যাব।`,
  },
  hi: {
    greet: (c) => `नमस्ते, मैं खेत साथी हूँ, एक किसान की ओर से फ़ोन कर रहा हूँ। कटाई के बाद लगभग ${c.qty} ${c.unit} ${c.crop} होगा। प्रति ${c.unit} कितना देंगे?`,
    counter: (c, p) => `प्रति ${c.unit} ${p} हों तो दे सकते हैं।`,
    accept: (c, p) => `ठीक है, प्रति ${c.unit} ${p}। किसान को बताकर पक्का करूँगा।`,
    decline: (c, p) => `${p} से कम नहीं होगा। इस बार रहने दीजिए, धन्यवाद।`,
    open: (c, p) => `अभी दाम थोड़े कम हैं। प्रति ${c.unit} ${p} दे सकता हूँ।`,
    final: (c, p) => `${p}, इससे ज़्यादा नहीं हो पाएगा।`,
    deal: (c, w) => `ठीक है, ${w} ले जाऊँगा।`,
  },
};
export function voiceCropDeal(plan, { lang = 'bn', qty, unit, cropName, currency }) {
  const L = LINES[lang] || LINES.bn;
  const c = { qty: dg(qty, lang), unit: unitName(unit, lang), crop: cropName };
  return plan.turns.map((t) => {
    const p = t.price != null ? priceText(t.price, currency, lang) : '';
    if (t.who === 'saathi') return { who: 'saathi', text: t.key === 'greet' ? L.greet(c) : L[t.key](c, p) };
    return { who: 'shop', text: t.kind === 'deal' ? L.deal(c, t.pickup) : L[t.kind](c, p) };
  });
}

// The farmer's rule for this field's harvest (saved on the land as sell_rule).
export function cleanCropRule(body = {}, prev = {}) {
  const floor = Math.round(Number(body.floor_price ?? prev.floor_price));
  if (!Number.isFinite(floor) || floor <= 0) throw new Error('Set the lowest price');
  const qty = Math.round(Number(body.qty ?? prev.qty) * 10) / 10;
  return {
    floor_price: floor,
    qty: Number.isFinite(qty) && qty > 0 ? qty : null,
    when: ['harvest', 'hold30'].includes(body.when) ? body.when : prev.when || 'harvest',
    ask_first: body.ask_first === undefined ? prev.ask_first !== false : body.ask_first !== false,
    last_run: prev.last_run || null,
    updated_at: new Date().toISOString(),
  };
}
