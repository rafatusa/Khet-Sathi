// v0.15.0: help with a crop problem. Sathi never names a disease, pest or medicine; she finds the nearest
// agriculture office on Google Maps (the same search the shop list uses) and the country's government farm
// hotline. "Call" opens the farmer's own phone dialer: Sathi never calls an office herself.
import { env } from './env.js';
import { cleanShopName, countPlaces, haversineKm } from './place.js';

// What the office is called on Google Maps in each country.
export const OFFICE_QUERY = {
  BD: 'Upazila Agriculture Office',
  IN: 'Krishi Vigyan Kendra',
  US: 'cooperative extension office',
};
export const officeQuery = (cc) => OFFICE_QUERY[String(cc || '').toUpperCase()] || 'agricultural extension office';

// Government farm hotlines. Checked on Oct 28, 2026:
// BD: Krishi Call Center 16123, run by the Department of Agricultural Extension (Dhaka Tribune).
// IN: Kisan Call Centre 1800-180-1551, toll free (mkisan.gov.in, Ministry of Agriculture).
export const HOTLINES = {
  BD: { name: { bn: 'কৃষি কল সেন্টার', hi: 'कृषि कॉल सेंटर (बांग्लादेश)', en: 'Krishi Call Center' }, number: '16123', tel: '16123', hours: { bn: 'সকাল ৯টা থেকে বিকাল ৫টা, শুক্রবার ও সরকারি ছুটি বাদে, প্রতি মিনিট ২৫ পয়সা (একটা খবর থেকে নেওয়া, ফোন করার আগে মিলিয়ে নিন)', hi: 'सुबह 9 से शाम 5 बजे, शुक्रवार और सरकारी छुट्टी छोड़कर 25 पैसे प्रति मिनट (एक ख़बर से लिया गया, फ़ोन करने से पहले जाँच लें)', en: '9 am to 5 pm, except Fridays and government holidays, 25 paisa a minute (from a news report; check before calling)' }, by: 'Department of Agricultural Extension, Bangladesh' },
  IN: { name: { bn: 'কিষাণ কল সেন্টার', hi: 'किसान कॉल सेंटर', en: 'Kisan Call Centre' }, number: '1800-180-1551', tel: '18001801551', hours: { bn: 'সকাল ৬টা থেকে রাত ১০টা, সপ্তাহে সাত দিন, টোল ফ্রি', hi: 'सुबह 6 से रात 10 बजे, सातों दिन, टोल फ्री', en: '6 am to 10 pm, all seven days, toll free' }, by: 'Ministry of Agriculture and Farmers Welfare, India' },
};
export const hotlineFor = (cc) => HOTLINES[String(cc || '').toUpperCase()] || null;

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'KhetSathi/0.15 (Meta Global AI Hackathon demo; farming assistant)';

export function officesFromPlaces(json, at, radiusKm) {
  return (json?.places || [])
    .map((p) => ({
      id: `g-${p.id}`,
      name: cleanShopName(p.displayName?.text),
      lat: p.location?.latitude,
      lon: p.location?.longitude,
      address: p.formattedAddress || null,
      phone: p.nationalPhoneNumber || p.internationalPhoneNumber || null,
      tel: String(p.internationalPhoneNumber || p.nationalPhoneNumber || '').replace(/[^\d+]/g, '') || null,
      mapsUrl: p.googleMapsUri || null,
      source: 'Google Maps',
    }))
    .filter((o) => o.name && Number.isFinite(o.lat))
    .map((o) => ({ ...o, km: Math.round(haversineKm(at, o) * 10) / 10 }))
    .filter((o) => o.km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, 3);
}

// Nearest agriculture offices around a point. Google Maps when GOOGLE_PLACES_KEY is set, else OpenStreetMap.
// Google's terms do not allow keeping Places results, so nothing here is cached.
export async function nearbyOffices(lat, lon, cc, { radiusKm = 40, fetchImpl = fetch } = {}) {
  const gkey = env('GOOGLE_PLACES_KEY');
  const at = { lat, lon };
  if (gkey) {
    try {
      countPlaces();
      const dLat = radiusKm / 111;
      const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
      const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': gkey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.googleMapsUri',
        },
        body: JSON.stringify({ textQuery: officeQuery(cc), locationRestriction: { rectangle: { low: { latitude: lat - dLat, longitude: lon - dLon }, high: { latitude: lat + dLat, longitude: lon + dLon } } }, maxResultCount: 5 }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return { offices: officesFromPlaces(await res.json(), at, radiusKm), source: 'Google Maps', query: officeQuery(cc) };
    } catch {}
  }
  const r = radiusKm * 1000;
  const q = `[out:json][timeout:12];nwr(around:${r},${lat},${lon})[office~"^(government|agricultural)$"][name~"(agri|krishi|কৃষি|कृषि|extension)",i];out center 20;`;
  const offices = await Promise.any(
    OVERPASS.map(async (url) => {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const j = await res.json();
      return (j.elements || [])
        .map((e) => {
          const p = e.lat != null ? { lat: e.lat, lon: e.lon } : e.center || null;
          const name = e.tags?.name || e.tags?.['name:en'];
          if (!p || !name) return null;
          const phone = e.tags?.phone || e.tags?.['contact:phone'] || null;
          return { id: `osm-${e.type}-${e.id}`, name: cleanShopName(name), lat: p.lat, lon: p.lon, address: null, phone, tel: phone ? phone.replace(/[^\d+]/g, '') : null, mapsUrl: null, km: Math.round(haversineKm(at, p) * 10) / 10, source: 'OpenStreetMap' };
        })
        .filter(Boolean)
        .sort((a, b) => a.km - b.km)
        .slice(0, 3);
    })
  ).catch(() => []);
  return { offices, source: 'OpenStreetMap', query: officeQuery(cc) };
}

// Directions link for an office (Google's own link when the search gave one).
export const directionsUrl = (o) => o.mapsUrl || `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lon}`;

// What the agent tool returns: short facts for Sathi to say, plus everything the screen draws.
export async function officeHelp({ lat, lon, cc, lang = 'en' }, deps = {}) {
  const found = await (deps.nearbyOffices || nearbyOffices)(lat, lon, cc).catch(() => ({ offices: [], source: null }));
  const hot = hotlineFor(cc);
  const L = ['bn', 'hi', 'en'].includes(lang) ? lang : 'en';
  return {
    offices: found.offices.map((o) => ({ ...o, directions: directionsUrl(o) })),
    source: found.source,
    hotline: hot ? { name: hot.name[L], number: hot.number, tel: hot.tel, hours: hot.hours[L], by: hot.by } : null,
    note: 'The farmer calls the office themselves with the Call button. Sathi does not call offices.',
  };
}
