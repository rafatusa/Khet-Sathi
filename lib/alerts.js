// Alert rules: Saathi speaks up on its own. Each alert stores a language-neutral key in
// `title` and its values as JSON in `body`; the app turns them into Bangla, Hindi or English.
// No medical, veterinary or pesticide-dosage advice: animal health only ever says "call the vet".
export const DEDUPE_HOURS = 12;

export const LIMITS = {
  rainChance: 60, rainMm: 10,
  fungusHumidity: 85, fungusTemp: [20, 30],
  dryMoisture: 18,
  sowDays: 3,
  shedTemp: 32, shedCold: 16, shedHumid: 80, shedDry: 40, ammonia: 25, waterLow: 20, feedLow: 20, eggs: 300,
  heatComing: 36, coldNight: 12,
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

// hour: local hour (Asia/Dhaka). weather: a nearby plot's forecast for heat and cold warnings.
export function shedAlerts(shed, { hour = 12, weather = null, today = null } = {}) {
  if (!shed) return [];
  const out = [];
  const add = (title, value) => out.push({ land_id: null, area: 'shed', severity: 'warn', title, source: 'sensor', body: { value } });
  if (shed.shed_temp > LIMITS.shedTemp) add('shed_hot', shed.shed_temp);
  if (shed.shed_temp < LIMITS.shedCold) add('shed_cold', shed.shed_temp);
  if (shed.shed_humidity > LIMITS.shedHumid) add('shed_humid', shed.shed_humidity);
  if (shed.shed_humidity < LIMITS.shedDry) add('shed_dry', shed.shed_humidity);
  // Light schedule: off at night (22:00-5:00), on in the evening (18:00-22:00), off in full daylight (9:00-16:00).
  if (shed.light === 1 && (hour >= 22 || hour < 5)) add('light_night', 1);
  if (shed.light === 0 && hour >= 18 && hour < 22) add('light_evening', 0);
  if (shed.light === 1 && hour >= 9 && hour < 16) add('light_day', 1);
  const days = weather?.days || [];
  const tomorrow = today ? days.find((d) => d.date > today) : days[1];
  if (tomorrow?.tMax != null && tomorrow.tMax >= LIMITS.heatComing) out.push({ land_id: null, area: 'weather', severity: 'warn', title: 'heat_coming', source: 'weather', body: { value: Math.round(tomorrow.tMax), date: tomorrow.date } });
  const coldDay = days.filter((d) => !today || d.date >= today).slice(0, 2).find((d) => d.tMin != null && d.tMin <= LIMITS.coldNight);
  if (coldDay) out.push({ land_id: null, area: 'weather', severity: 'warn', title: 'cold_night', source: 'weather', body: { value: Math.round(coldDay.tMin), date: coldDay.date } });
  if (shed.ammonia_ppm > LIMITS.ammonia) add('shed_ammonia', shed.ammonia_ppm);
  if (shed.water_pct < LIMITS.waterLow) add('shed_water', shed.water_pct);
  if (shed.feed_pct < LIMITS.feedLow) add('shed_feed', shed.feed_pct);
  if (shed.eggs_today >= LIMITS.eggs) out.push({ land_id: null, area: 'market', severity: 'info', title: 'eggs_ready', source: 'sensor', body: { value: shed.eggs_today } });
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
