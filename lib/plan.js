// Everything the "what to grow" screen and the agent need for one plot:
// soil (SoilGrids), 10-day weather (Open-Meteo), sowing windows (FAO) and the top crops.
import { soilForLand } from './soil.js';
import { fetchWeather, rainAdvice } from './weather.js';
import { aezFor, calendarRecords, windowsFor, inBangladesh, calendarFor } from './calendar.js';
import { recommendCrops } from './recommend.js';
import { checkPlace, currencyFor } from './place.js';
import { worldCalendar, worldCrops, knownCountry, SOURCE as WORLD } from './cropworld.js';
import { pickCrops } from './croppick.js';

// The place check is saved on the land (place_info) and redone after 30 days.
export async function placeForLand(land, { lang = 'en', deps } = {}) {
  const saved = land?.place_info;
  if (saved?.at && Date.now() - Date.parse(saved.at) < 30 * 864e5 && !saved.geoError) return { place: saved, fresh: false };
  const place = await checkPlace({ lat: Number(land.lat), lon: Number(land.lon), lang }, deps);
  // Nominatim down: fall back to the country by box, so Bangladesh and India still get their crops.
  if (!place.cc) {
    if (inBangladesh(land.lat, land.lon)) place.cc = 'BD';
    else if (land.lat >= 6 && land.lat <= 36 && land.lon >= 68 && land.lon <= 97.5) place.cc = 'IN';
    if (place.cc) place.currency = currencyFor(place.cc);
  }
  return { place, fresh: true };
}

export function localToday(timezone) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export async function buildPlan(land, { fetchImpl, today: todayOverride, placeDeps, think } = {}) {
  const [soilR, weatherR, cal, placeR] = await Promise.all([
    soilForLand(land, { fetchImpl }),
    fetchWeather(land.lat, land.lon, { fetchImpl }).then((w) => ({ w }), (err) => ({ err: err.message })),
    calendarRecords({ fetchImpl }),
    placeForLand(land, { deps: placeDeps }).catch((err) => ({ place: { error: err.message, verdict: 'mixed', currency: currencyFor(null) }, fresh: false })),
  ]);
  const place = placeR.place;
  const weather = weatherR.w || null;
  const tz = weather?.timezone || (inBangladesh(land.lat, land.lon) ? 'Asia/Dhaka' : 'Asia/Kolkata');
  const today = todayOverride || localToday(tz);
  const blocked = place.verdict === 'built' || place.verdict === 'water';
  const { aez, assumed } = aezFor(land, place.cc);
  // Bangladesh: FAO crop calendar by farming zone. Elsewhere: FAOSTAT crops for the country, GGCMI dates
  // for this spot, then Muse Spark keeps the ones farmers in this district really sow now.
  let crops = [];
  let calendar = [];
  let calendarSource = null;
  let picksBy = null;
  if (!blocked && aez) {
    const windows = windowsFor(cal.records, aez, today);
    crops = recommendCrops(windows, soilR.soil);
    calendar = calendarFor(cal.records, aez, today);
    calendarSource = cal.source;
  } else if (!blocked && knownCountry(place.cc)) {
    calendar = worldCalendar({ cc: place.cc, lat: Number(land.lat), lon: Number(land.lon), today, place });
    crops = worldCrops(calendar, soilR.soil);
    calendarSource = WORLD.which + (calendar[0]?.areaScope === 'country' ? `; ${WORLD.country}` : '');
    const candidates = calendar.filter((c) => c.status !== 'later').slice(0, 12);
    const pk = await pickCrops(
      { cacheKey: `${land.id || `${land.lat},${land.lon}`}|${today}`, place, today, candidates: candidates.length ? candidates : calendar.slice(0, 8), soil: soilR.soil, rain: weatherR.w?.rainNext10Mm },
      think ? { think } : {}
    );
    if (pk?.picks?.length) {
      const byKey = Object.fromEntries(worldCrops(calendar, null, { max: 30 }).map((c) => [c.key, c]));
      const picked = pk.picks.map((p) => byKey[p.key] && { ...byKey[p.key], why: p.why }).filter(Boolean);
      if (picked.length) {
        crops = picked;
        picksBy = pk.by;
      }
    }
  }
  return {
    place,
    blocked,
    currency: place.currency || currencyFor(place.cc),
    picksBy,
    today,
    soil: soilR.soil,
    soilFresh: soilR.fresh,
    soilError: soilR.error,
    weather: weather && { days: weather.days.slice(0, 7), timezone: weather.timezone, soilMoisture: weather.soilMoisture, soilMoistureLevel: weather.soilMoistureLevel, rainNext10Mm: weather.rainNext10Mm },
    weatherError: weatherR.err || null,
    rain: weather ? rainAdvice(weather.days, today) : null,
    aez: blocked ? null : aez,
    aezAssumed: blocked ? false : assumed,
    calendarSource,
    calendarError: aez ? cal.error || null : null,
    crops,
    calendar,
    sources: ['ISRIC SoilGrids (CC BY 4.0)', 'Open-Meteo (CC BY 4.0)', aez ? 'FAO Crop Calendar' : 'MIRCA-OS v2 crop calendars (CC BY 4.0), FAOSTAT (CC BY 4.0)', ...(place.sources || [])],
    placeFresh: placeR.fresh,
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
    place: plan.place ? [plan.place.village, plan.place.district, plan.place.state, plan.place.country].filter(Boolean).join(', ') : 'unknown',
    land_cover_here: plan.place?.cover || 'unknown',
    is_farmland: plan.blocked ? `NO: this spot is ${plan.place.verdict === 'built' ? 'houses and roads (residential)' : 'water'}; do not suggest crops` : 'yes',
    currency: plan.currency?.code || 'unknown',
    farming_zone: plan.aez ? `${plan.aez}${plan.aezAssumed ? ' (assumed: exact zone unknown)' : ''}` : plan.calendar?.length ? `MIRCA-OS crop calendar for ${plan.calendar[0]?.areaName || 'this area'} (${plan.calendar[0]?.areaScope || 'cell'} level)` : 'no crop calendar for this area',
    today: plan.today,
  };
}

export function windowsForAgent(plan) {
  if (plan.blocked) return { crops: [], note: 'This spot is not farmland (houses, roads or water). Do not suggest crops.' };
  if (!plan.crops.length) return { crops: [], note: plan.calendar?.length ? 'No crop can be sown here right now or soon.' : 'No crop calendar for this area yet.' };
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
