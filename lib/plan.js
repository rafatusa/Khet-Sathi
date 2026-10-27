// Everything the "what to grow" screen and the agent need for one plot:
// soil (SoilGrids), 10-day weather (Open-Meteo), sowing windows (FAO) and the top crops.
import { soilForLand } from './soil.js';
import { fetchWeather, rainAdvice } from './weather.js';
import { aezFor, calendarRecords, windowsFor, inBangladesh } from './calendar.js';
import { recommendCrops } from './recommend.js';

export function localToday(timezone) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export async function buildPlan(land, { fetchImpl, today: todayOverride } = {}) {
  const [soilR, weatherR, cal] = await Promise.all([
    soilForLand(land, { fetchImpl }),
    fetchWeather(land.lat, land.lon, { fetchImpl }).then((w) => ({ w }), (err) => ({ err: err.message })),
    calendarRecords({ fetchImpl }),
  ]);
  const weather = weatherR.w || null;
  const tz = weather?.timezone || (inBangladesh(land.lat, land.lon) ? 'Asia/Dhaka' : 'Asia/Kolkata');
  const today = todayOverride || localToday(tz);
  const { aez, assumed } = aezFor(land);
  const windows = aez ? windowsFor(cal.records, aez, today) : [];
  const crops = aez ? recommendCrops(windows, soilR.soil) : [];
  return {
    today,
    soil: soilR.soil,
    soilFresh: soilR.fresh,
    soilError: soilR.error,
    weather: weather && { days: weather.days.slice(0, 7), timezone: weather.timezone, soilMoisture: weather.soilMoisture, soilMoistureLevel: weather.soilMoistureLevel, rainNext10Mm: weather.rainNext10Mm },
    weatherError: weatherR.err || null,
    rain: weather ? rainAdvice(weather.days, today) : null,
    aez,
    aezAssumed: assumed,
    calendarSource: aez ? cal.source : null,
    calendarError: aez ? cal.error || null : null,
    crops,
    sources: ['ISRIC SoilGrids (CC BY 4.0)', 'Open-Meteo (CC BY 4.0)', 'FAO Crop Calendar'],
    sampleNote: 'Profit per acre is a sample figure until a market price source is added.',
  };
}

// Short version for the agent's tools.
export function profileForAgent(plan) {
  return {
    soil: plan.soil ? { texture: plan.soil.texture, ph: plan.soil.ph, clay_pct: plan.soil.clay, sand_pct: plan.soil.sand, silt_pct: plan.soil.silt, source: plan.soil.source } : 'unknown',
    topsoil_moisture: plan.weather?.soilMoistureLevel || 'unknown',
    rain_next_10_days_mm: plan.weather?.rainNext10Mm ?? 'unknown',
    rain_warning: plan.rain ? { day: plan.rain.rainDate, chance_pct: plan.rain.chance, sow_before: plan.rain.sowBefore, sow_after: plan.rain.sowAfter } : 'none in the next 3 days',
    farming_zone: plan.aez ? `${plan.aez}${plan.aezAssumed ? ' (assumed: exact zone unknown)' : ''}` : 'no FAO sowing calendar for this area',
    today: plan.today,
  };
}

export function windowsForAgent(plan) {
  if (!plan.crops.length) return { crops: [], note: plan.aez ? 'No crop can be sown in this zone right now or in the next 10 days.' : 'No FAO sowing calendar for this area yet.' };
  return {
    crops: plan.crops.map((c) => ({
      crop: c.faoName,
      status: c.status,
      sow_by: c.windowEnd,
      days_left_to_sow: c.daysLeft,
      starts_in_days: c.daysUntil,
      days_to_harvest: c.growDays ? `${c.growDays.min}-${c.growDays.max}` : null,
      water_need: c.water,
    })),
    source: plan.calendarSource,
  };
}
