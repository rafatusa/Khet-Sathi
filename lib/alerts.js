// Alert rules: Sathi speaks up on its own. Each alert stores a language-neutral key in
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
// v0.11.0: the simulated soil kit only speaks for demo lands; a real land gets weather and calendar alerts only.
export const realOnly = (land, alerts) => alerts.filter((a) => land.location_source === 'demo' || a.source !== 'sensor');

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
// Today's camera (a saved clip): warnings from its last check. Hens resting at night are normal.
export function cameraAlerts(clip, { hour = 12 } = {}) {
  const r = clip?.result;
  if (!r) return [];
  const out = [];
  const night = hour >= 19 || hour < 6;
  const still = r.count?.still?.length || 0;
  // v0.27.2: a clip checked at night (hens resting) never raises "not moving" the next morning.
  if (still > 0 && !night && !r.count?.resting) out.push({ land_id: null, area: 'shed', severity: 'warn', title: 'birds_still', source: 'camera', body: { value: still, clip: clip.name } });
  if (r.observation?.unusualSound) out.push({ land_id: null, area: 'shed', severity: 'warn', title: 'sound_unusual', source: 'camera', body: { clip: clip.name } });
  return out;
}

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
  // Egg sales follow the farmer's sell rule since v0.8.0 (sell_due / sell_offers from the server).
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

// v0.27.1: is a saved shed warning still true for the latest reading? Sensor warnings that have
// cleared are closed; the ones still true show today's value. Camera warnings older than
// CAMERA_HOURS are closed (a newer check would have raised them again).
const SENSOR_RULES = {
  shed_hot: ['shed_temp', (v) => v > LIMITS.shedTemp],
  shed_cold: ['shed_temp', (v) => v < LIMITS.shedCold],
  shed_humid: ['shed_humidity', (v) => v > LIMITS.shedHumid],
  shed_dry: ['shed_humidity', (v) => v < LIMITS.shedDry],
  shed_ammonia: ['ammonia_ppm', (v) => v > LIMITS.ammonia],
  shed_water: ['water_pct', (v) => v < LIMITS.waterLow],
  shed_feed: ['feed_pct', (v) => v < LIMITS.feedLow],
};
export const CAMERA_HOURS = 12;
export function freshen(alert, shed, { now = Date.now } = {}) {
  const rule = alert?.area === 'shed' && alert.source === 'sensor' ? SENSOR_RULES[alert.title] : null;
  if (rule) {
    const v = shed?.[rule[0]];
    if (v == null) return { keep: true, alert };
    if (!rule[1](v)) return { keep: false, alert };
    let body = {};
    try { body = JSON.parse(alert.body || '{}'); } catch {}
    return { keep: true, alert: { ...alert, body: JSON.stringify({ ...body, value: Math.round(v * 10) / 10 }) } };
  }
  if (alert?.source === 'camera' && now() - new Date(alert.created_at).getTime() > CAMERA_HOURS * 3600 * 1000) return { keep: false, alert };
  return { keep: true, alert };
}
