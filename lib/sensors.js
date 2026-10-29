// Simulated village sensor kit (one per field, one for the shed), in the shape a real
// ESP32 kit would post: { device, area, metric, value }. Values start from the land's real
// weather and soil moisture, then drift in small steps. Everything here is SIMULATED.
export const FIELD_METRICS = ['soil_moisture', 'soil_temp', 'air_temp', 'humidity'];
export const SHED_METRICS = ['shed_temp', 'shed_humidity', 'ammonia_ppm', 'light', 'water_pct', 'feed_pct', 'eggs_today', 'egg_stock'];
export const EGG_TARGET = 300; // eggs collected today that make a sale worth a call
export const SHED_DEVICE = 'shed-1';

export const fieldDevice = (landId) => `field-${String(landId).slice(0, 8)}`;

const LIMITS = {
  soil_moisture: [3, 60], soil_temp: [10, 45], air_temp: [5, 48], humidity: [15, 100],
  shed_temp: [10, 45], shed_humidity: [20, 100], ammonia_ppm: [0, 60], light: [0, 1], water_pct: [0, 100], feed_pct: [0, 100], eggs_today: [0, 600], egg_stock: [0, 5000],
};
const clamp = (m, v) => Math.min(LIMITS[m][1], Math.max(LIMITS[m][0], v));
const r1 = (v) => Math.round(v * 10) / 10;

// Latest value per device+metric from readings sorted newest first.
export function latestByDevice(readings) {
  const out = {};
  for (const r of readings) {
    out[r.device] ||= {};
    if (out[r.device][r.metric] == null) out[r.device][r.metric] = { value: r.value, at: r.at };
  }
  return out;
}

// Starting values for a field kit from the land's real weather.
export function seedField(weather) {
  const today = weather?.days?.[0];
  const air = today?.tMax != null && today?.tMin != null ? (today.tMax + today.tMin) / 2 : 28;
  return {
    soil_moisture: weather?.soilMoisture != null ? r1(weather.soilMoisture * 100) : 25,
    soil_temp: r1(air - 1),
    air_temp: r1(air),
    humidity: today?.humidity != null ? r1(today.humidity) : 70,
  };
}

// Shed light schedule for layers: extra light 18:00-22:00 and 5:00-6:00, sunlight by day, dark at night.
export const lightScheduled = (hour) => (hour >= 18 && hour < 22) || (hour >= 5 && hour < 6);
// Hens rest at night: no "not moving" warnings then.
export const isNight = (hour) => hour >= 19 || hour < 6;

// Hens lay mostly between 6:00 and 15:00 local time; the counter starts again each day.
const LAY_START = 6;
const LAY_END = 15;
const EGGS_PER_TICK = 6;
export function seedEggs(hour) {
  return Math.round(Math.max(0, Math.min(hour, LAY_END) - LAY_START) * EGGS_PER_TICK * 6);
}

export function seedShed(fieldAir = 28, hour = 12) {
  const eggs = seedEggs(hour);
  return { shed_temp: r1(fieldAir + 2), shed_humidity: 70, ammonia_ppm: 12, light: lightScheduled(hour) ? 1 : 0, water_pct: 80, feed_pct: 75, eggs_today: eggs, egg_stock: eggs };
}

// One step of drift. rand() returns 0..1 (injectable for tests).
export function stepField(prev, { raining = false, rand = Math.random } = {}) {
  const j = (s) => (rand() - 0.5) * 2 * s;
  return {
    soil_moisture: r1(clamp('soil_moisture', prev.soil_moisture + (raining ? 3 : -0.4) + j(0.4))),
    soil_temp: r1(clamp('soil_temp', prev.soil_temp + j(0.3))),
    air_temp: r1(clamp('air_temp', prev.air_temp + j(0.5))),
    humidity: r1(clamp('humidity', prev.humidity + j(2))),
  };
}

// v0.26.0: the readings drift back toward normal (shed a little warmer than outside, 70% humidity, 12 ppm ammonia)
// instead of wandering freely: live, the demo shed had drifted to 37.8 °C at night with 23 °C outside.
export function stepShed(prev, { rand = Math.random, hour = 12, newDay = false, air = null } = {}) {
  const j = (s) => (rand() - 0.5) * 2 * s;
  const pull = (v, to, k = 0.12) => v + (to - v) * k;
  const outside = Number.isFinite(air) ? air : 28;
  // Water and feed are used up; the farmer refills when nearly empty.
  const water = prev.water_pct - 3 + j(1);
  const feed = prev.feed_pct - 2 + j(1);
  const eggsToday = newDay ? 0 : Math.round(clamp('eggs_today', (prev.eggs_today ?? 0) + (hour >= LAY_START && hour < LAY_END ? EGGS_PER_TICK + j(2) : 0)));
  return {
    shed_temp: r1(clamp('shed_temp', pull(prev.shed_temp, outside + 2) + j(0.4))),
    shed_humidity: r1(clamp('shed_humidity', pull(prev.shed_humidity, 70) + j(2))),
    ammonia_ppm: r1(clamp('ammonia_ppm', pull(prev.ammonia_ppm, 12, 0.08) + j(1))),
    water_pct: r1(water < 5 ? 95 : clamp('water_pct', water)),
    feed_pct: r1(feed < 5 ? 90 : clamp('feed_pct', feed)),
    light: lightScheduled(hour) ? 1 : 0,
    eggs_today: eggsToday,
    // Eggs collected and not sold yet (v0.8.0): grows with each collection, drops on a confirmed sale.
    egg_stock: Math.round(clamp('egg_stock', (prev.egg_stock ?? prev.eggs_today ?? 0) + (newDay ? 0 : eggsToday - (prev.eggs_today ?? 0)))),
  };
}

export function toRows(device, area, values) {
  return Object.entries(values).map(([metric, value]) => ({ device, area, metric, value }));
}

// Eggs per day for the last 7 days (simulated egg counter): the highest count each local day.
export function eggsPerDay(rows, today, days = 7) {
  const byDay = {};
  for (const r of rows || []) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.at));
    byDay[d] = Math.max(byDay[d] || 0, Number(r.value) || 0);
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.parse(`${today}T12:00:00Z`) - i * 864e5).toISOString().slice(0, 10);
    out.push({ date: d, eggs: byDay[d] ?? null });
  }
  return out;
}
