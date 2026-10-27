// Alert rules: Saathi speaks up on its own. Each alert stores a language-neutral key in
// `title` and its values as JSON in `body`; the app turns them into Bangla, Hindi or English.
// No medical, veterinary or pesticide-dosage advice: animal health only ever says "call the vet".
export const DEDUPE_HOURS = 12;

export const LIMITS = {
  rainChance: 60, rainMm: 10,
  fungusHumidity: 85, fungusTemp: [20, 30],
  dryMoisture: 18,
  sowDays: 3,
  shedTemp: 32, ammonia: 25, waterLow: 20, feedLow: 20,
};

const wet = (d) => (d?.rainChance ?? 0) >= LIMITS.rainChance || (d?.rainMm ?? 0) >= LIMITS.rainMm;
const meanT = (d) => (d?.tMax != null && d?.tMin != null ? (d.tMax + d.tMin) / 2 : null);
const fungusDay = (d) => {
  const t = meanT(d);
  return d?.humidity != null && d.humidity > LIMITS.fungusHumidity && t != null && t >= LIMITS.fungusTemp[0] && t <= LIMITS.fungusTemp[1];
};

// Rules for one field. plan from buildPlan; history = this field's soil_moisture values, newest first.
export function fieldAlerts(land, plan, history = []) {
  const out = [];
  const place = land.place || null;
  const days = plan?.weather?.days || [];
  const tomorrow = days.find((d) => d.date > plan.today);
  if (tomorrow && wet(tomorrow)) {
    out.push({ land_id: land.id, area: 'weather', severity: 'info', title: 'rain_skip', source: 'weather', body: { place, chance: tomorrow.rainChance, mm: tomorrow.rainMm, date: tomorrow.date } });
  }
  const next2 = days.filter((d) => d.date >= plan.today).slice(0, 2);
  if (next2.length === 2 && next2.every(fungusDay)) {
    out.push({ land_id: land.id, area: 'weather', severity: 'warn', title: 'fungus_watch', source: 'weather', body: { place, humidity: Math.round(Math.max(...next2.map((d) => d.humidity))) } });
  }
  if (history.length >= 2 && history[0] < LIMITS.dryMoisture && history[1] < LIMITS.dryMoisture) {
    out.push({ land_id: land.id, area: 'field', severity: 'warn', title: 'soil_dry', source: 'sensor', body: { place, value: history[0] } });
  }
  const closing = (plan?.crops || []).find((c) => c.status === 'closing' && c.daysLeft <= LIMITS.sowDays);
  if (land.kind === 'empty' && closing) {
    out.push({ land_id: land.id, area: 'field', severity: 'warn', title: 'sow_closing', source: 'calendar', body: { place, crop: closing.key, days: closing.daysLeft, date: closing.windowEnd } });
  }
  return out;
}

export function shedAlerts(shed) {
  if (!shed) return [];
  const out = [];
  const add = (title, value) => out.push({ land_id: null, area: 'shed', severity: 'warn', title, source: 'sensor', body: { value } });
  if (shed.shed_temp > LIMITS.shedTemp) add('shed_hot', shed.shed_temp);
  if (shed.ammonia_ppm > LIMITS.ammonia) add('shed_ammonia', shed.ammonia_ppm);
  if (shed.water_pct < LIMITS.waterLow) add('shed_water', shed.water_pct);
  if (shed.feed_pct < LIMITS.feedLow) add('shed_feed', shed.feed_pct);
  return out;
}

// Drops alerts already raised for the same land within DEDUPE_HOURS.
export function dedupe(candidates, recent) {
  const seen = new Set(recent.map((a) => `${a.land_id || ''}|${a.title}`));
  const out = [];
  for (const c of candidates) {
    const k = `${c.land_id || ''}|${c.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

export const toRow = (a) => ({ ...a, body: JSON.stringify(a.body) });
