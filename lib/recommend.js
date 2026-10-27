// Picks up to three crops for an empty plot from real sowing windows and soil.
// Profit figures are SAMPLES (labelled in the app) until a market price source is added.

// Soil textures each crop does badly on; pH range it tolerates; water need.
export const CROPS = {
  Mustard: { key: 'mustard', group: 'oilseed', avoid: ['sand', 'clay', 'silty_clay'], ph: [5.5, 7.8], water: 'low', sampleProfitBdt: 12000 },
  'Colza(rapeseed)': { key: 'rapeseed', group: 'oilseed', avoid: ['sand', 'clay', 'silty_clay'], ph: [5.5, 7.8], water: 'low', sampleProfitBdt: 11000 },
  Potato: { key: 'potato', group: 'tuber', avoid: ['clay', 'silty_clay', 'sandy_clay'], ph: [5.0, 7.0], water: 'medium', sampleProfitBdt: 35000 },
  'Cabbage, common': { key: 'cabbage', group: 'vegetable', avoid: ['sand'], ph: [6.0, 7.5], water: 'high', sampleProfitBdt: 25000 },
  Cauliflower: { key: 'cauliflower', group: 'vegetable', avoid: ['sand'], ph: [6.0, 7.5], water: 'high', sampleProfitBdt: 24000 },
  Carrot: { key: 'carrot', group: 'vegetable', avoid: ['clay', 'silty_clay'], ph: [6.0, 7.0], water: 'medium', sampleProfitBdt: 20000 },
  'Bottle gourd': { key: 'bottle_gourd', group: 'vegetable', avoid: ['sand'], ph: [6.0, 7.5], water: 'high', sampleProfitBdt: 18000 },
  Barley: { key: 'barley', group: 'cereal', avoid: ['clay'], ph: [6.0, 8.0], water: 'low', sampleProfitBdt: 8000 },
  Lentil: { key: 'lentil', group: 'pulse', avoid: ['sand', 'clay'], ph: [6.0, 8.0], water: 'low', sampleProfitBdt: 10000 },
  'Chick-pea': { key: 'chickpea', group: 'pulse', avoid: ['clay', 'silty_clay'], ph: [6.0, 8.5], water: 'low', sampleProfitBdt: 10000 },
  'Pea, dry': { key: 'pea', group: 'pulse', avoid: ['sand', 'clay'], ph: [6.0, 7.5], water: 'low', sampleProfitBdt: 9000 },
};

// Ties go to the crop listed first above (main field crops first).
const ORDER = Object.keys(CROPS);

export function soilFits(rule, soil) {
  if (!soil) return true; // unknown soil: keep the crop, the screen says soil is unknown
  if (soil.texture && rule.avoid.includes(soil.texture)) return false;
  if (Number.isFinite(soil.ph) && (soil.ph < rule.ph[0] || soil.ph > rule.ph[1])) return false;
  return true;
}

// Lower score = shown first. Closing soon beats open beats starting soon.
function score(w) {
  if (w.state === 'now' && w.daysLeft <= 7) return w.daysLeft;
  if (w.state === 'now') return 100 + w.daysLeft;
  return 200 + w.daysUntil;
}

export function recommendCrops(windows, soil, { soonDays = 10, max = 3 } = {}) {
  const candidates = windows
    .filter((w) => CROPS[w.crop])
    .filter((w) => w.state === 'now' || (w.state === 'later' && w.daysUntil <= soonDays))
    .filter((w) => soilFits(CROPS[w.crop], soil))
    .map((w) => ({ ...w, ...CROPS[w.crop], status: w.state === 'now' ? (w.daysLeft <= 7 ? 'closing' : 'open') : 'soon' }))
    .sort((a, b) => score(a) - score(b) || ORDER.indexOf(a.crop) - ORDER.indexOf(b.crop));
  // One crop per group (oilseed, tuber, vegetable...) so the farmer gets real choices.
  const seen = new Set();
  const picked = [];
  for (const c of candidates) {
    if (seen.has(c.group)) continue;
    seen.add(c.group);
    // Same crop can have two FAO sessions: keep the first.
    if (picked.some((p) => p.key === c.key)) continue;
    picked.push(c);
    if (picked.length === max) break;
  }
  return picked.map((c) => ({
    key: c.key,
    faoName: c.crop,
    status: c.status,
    daysLeft: c.daysLeft ?? null,
    daysUntil: c.daysUntil ?? null,
    windowStart: c.start,
    windowEnd: c.end,
    growDays: c.grow,
    water: c.water,
    sampleProfitBdtPerAcre: c.sampleProfitBdt,
  }));
}
