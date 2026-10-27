// Simulated village sensor kit (one per field, one for the shed), in the shape a real
// ESP32 kit would post: { device, area, metric, value }. Values start from the land's real
// weather and soil moisture, then drift in small steps. Everything here is SIMULATED.
export const FIELD_METRICS = ['soil_moisture', 'soil_temp', 'air_temp', 'humidity'];
export const SHED_METRICS = ['shed_temp', 'shed_humidity', 'ammonia_ppm', 'light', 'water_pct', 'feed_pct'];
export const SHED_DEVICE = 'shed-1';

export const fieldDevice = (landId) => `field-${String(landId).slice(0, 8)}`;

const LIMITS = {
  soil_moisture: [3, 60], soil_temp: [10, 45], air_temp: [5, 48], humidity: [15, 100],
  shed_temp: [10, 45], shed_humidity: [20, 100], ammonia_ppm: [0, 60], light: [0, 1], water_pct: [0, 100], feed_pct: [0, 100],
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

export function seedShed(fieldAir = 28) {
  return { shed_temp: r1(fieldAir + 2), shed_humidity: 70, ammonia_ppm: 12, light: 1, water_pct: 80, feed_pct: 75 };
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

export function stepShed(prev, { rand = Math.random } = {}) {
  const j = (s) => (rand() - 0.5) * 2 * s;
  // Water and feed are used up; the farmer refills when nearly empty.
  const water = prev.water_pct - 3 + j(1);
  const feed = prev.feed_pct - 2 + j(1);
  return {
    shed_temp: r1(clamp('shed_temp', prev.shed_temp + j(0.4))),
    shed_humidity: r1(clamp('shed_humidity', prev.shed_humidity + j(2))),
    ammonia_ppm: r1(clamp('ammonia_ppm', prev.ammonia_ppm + j(1))),
    light: prev.light,
    water_pct: r1(water < 5 ? 95 : clamp('water_pct', water)),
    feed_pct: r1(feed < 5 ? 90 : clamp('feed_pct', feed)),
  };
}

export function toRows(device, area, values) {
  return Object.entries(values).map(([metric, value]) => ({ device, area, metric, value }));
}
