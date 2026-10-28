// 10-day weather and topsoil moisture from Open-Meteo (CC BY 4.0, free for non-commercial use).
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const TTL_MS = 60 * 60 * 1000;
const cache = new Map();

export function summarizeForecast(json) {
  const d = json?.daily;
  if (!d?.time?.length) return null;
  const days = d.time.map((date, i) => ({
    date,
    rainMm: d.precipitation_sum?.[i] ?? null,
    rainChance: d.precipitation_probability_max?.[i] ?? null,
    tMax: d.temperature_2m_max?.[i] ?? null,
    tMin: d.temperature_2m_min?.[i] ?? null,
    humidity: d.relative_humidity_2m_mean?.[i] ?? null,
  }));
  // Soil moisture at the current local hour (3-9 cm layer, m3/m3).
  let soilMoisture = null;
  const h = json.hourly;
  if (h?.time?.length && h.soil_moisture_3_to_9cm) {
    const offset = (json.utc_offset_seconds || 0) * 1000;
    const nowLocal = new Date(Date.now() + offset).toISOString().slice(0, 13);
    let idx = h.time.findIndex((t) => t.slice(0, 13) === nowLocal);
    if (idx < 0) idx = Math.min(12, h.time.length - 1);
    soilMoisture = h.soil_moisture_3_to_9cm[idx] ?? null;
  }
  const level = soilMoisture == null ? null : soilMoisture < 0.2 ? 'dry' : soilMoisture > 0.35 ? 'wet' : 'moist';
  return {
    timezone: json.timezone || null,
    days,
    soilMoisture,
    soilMoistureLevel: level,
    rainNext10Mm: Math.round(days.reduce((s, x) => s + (x.rainMm || 0), 0) * 10) / 10,
  };
}

// First of the next 3 days with a real chance of rain, and the best days to sow around it.
export function rainAdvice(days, today) {
  const ahead = days.filter((x) => x.date > today).slice(0, 3);
  const wet = (x) => (x.rainChance ?? 0) >= 60 || (x.rainMm ?? 0) >= 10;
  const rain = ahead.find(wet);
  if (!rain) return null;
  const before = days.find((x) => x.date > today && x.date < rain.date && !wet(x)) || null;
  const after = days.find((x) => x.date > rain.date && !wet(x)) || null;
  return { rainDate: rain.date, chance: rain.rainChance, mm: rain.rainMm, sowBefore: before?.date || null, sowAfter: after?.date || null };
}

export async function fetchWeather(lat, lon, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const key = `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean',
    hourly: 'soil_moisture_3_to_9cm',
    forecast_days: '10',
    timezone: 'auto',
  });
  const res = await fetchImpl(`${OPEN_METEO}?${q}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const value = summarizeForecast(await res.json());
  if (!value) throw new Error('Open-Meteo returned no forecast');
  value.source = 'Open-Meteo';
  value.fetchedAt = new Date().toISOString();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Tests only: forget the 1-hour forecast store (v0.19.0, to test the kept forecast after it expires).
export function _resetWeatherCache() {
  cache.clear();
}
