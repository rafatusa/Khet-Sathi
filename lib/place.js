// "Check the place first" (v0.11.0): where the land is, what covers it, and the nearest seed shops.
// Every source is free and keyless:
//   OpenStreetMap Nominatim reverse geocoding (ODbL, one request at a time, cached)
//   ESA WorldCover 2021 10 m land cover (CC BY 4.0), read straight from its cloud-optimised GeoTIFFs on AWS
//   OpenStreetMap shops through the Overpass API (ODbL), or Google Places when GOOGLE_PLACES_KEY is set
import { fromUrl } from 'geotiff';
import { env } from './env.js';

const UA = 'KhetSaathi/0.11 (Meta Global AI Hackathon demo; farming assistant)';

// ---------- 1. where is it ----------
const geoCache = new Map();
let geoQueue = Promise.resolve(); // Nominatim allows one request per second

export function addressParts(json) {
  const a = json?.address || {};
  return {
    country: a.country || null,
    cc: (a.country_code || '').toUpperCase() || null,
    state: a.state || a.region || a.province || null,
    district: a.state_district || a.county || a.district || null,
    village: a.village || a.hamlet || a.town || a.suburb || a.neighbourhood || a.city_district || a.city || null,
    osmClass: json?.category || json?.class || null,
    osmType: json?.type || null,
    label: json?.display_name || null,
  };
}

export async function reverseGeocode(lat, lon, lang = 'en', { fetchImpl = fetch } = {}) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${lang}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const job = geoQueue.then(async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=16&lat=${lat}&lon=${lon}&accept-language=${lang},en`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return addressParts(await res.json());
  });
  geoQueue = job.then(() => new Promise((r) => setTimeout(r, 1100)), () => new Promise((r) => setTimeout(r, 1100)));
  const out = await job;
  geoCache.set(key, out);
  return out;
}

// ---------- 2. what covers it ----------
export const COVER = { 10: 'tree', 20: 'shrub', 30: 'grass', 40: 'crop', 50: 'built', 60: 'bare', 70: 'snow', 80: 'water', 90: 'wetland', 95: 'mangrove', 100: 'moss' };

export function worldCoverTile(lat, lon) {
  const la = Math.floor(lat / 3) * 3;
  const lo = Math.floor(lon / 3) * 3;
  const name = `${la >= 0 ? 'N' : 'S'}${String(Math.abs(la)).padStart(2, '0')}${lo >= 0 ? 'E' : 'W'}${String(Math.abs(lo)).padStart(3, '0')}`;
  return `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;
}

// Share of each class (0..1) in a square of about 2 x halfM metres around the point.
export function coverShares(values) {
  const n = values.length || 1;
  const out = {};
  for (const v of values) {
    const k = COVER[v];
    if (k) out[k] = (out[k] || 0) + 1 / n;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

const coverCache = new Map();
export async function landCover(lat, lon, halfM = 100) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${halfM}`;
  if (coverCache.has(key)) return coverCache.get(key);
  const img = await (await fromUrl(worldCoverTile(lat, lon))).getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const px = Math.floor((lon - ox) / rx);
  const py = Math.floor((lat - oy) / ry);
  const r = Math.max(2, Math.round(halfM / 10));
  const [band] = await img.readRasters({ window: [px - r, py - r, px + r, py + r] });
  const shares = coverShares(band);
  coverCache.set(key, shares);
  return shares;
}

// The verdict that decides whether Saathi may suggest crops here.
// WorldCover often calls small Bengal fields "trees" or "grass", so only built-up land and water block crops.
export function verdictFrom({ cover, osmClass, osmType } = {}) {
  const c = cover || {};
  if ((c.built || 0) >= 0.5 || (osmClass === 'landuse' && osmType === 'residential' && (c.crop || 0) < 0.2)) return 'built';
  if ((c.water || 0) >= 0.6) return 'water';
  if ((c.crop || 0) >= 0.3) return 'cropland';
  return 'mixed';
}

// ---------- 3. nearest seed and fertilizer shops ----------
const haversineKm = (a, b) => {
  const R = 6371;
  const d = (x) => (x * Math.PI) / 180;
  const h = Math.sin(d(b.lat - a.lat) / 2) ** 2 + Math.cos(d(a.lat)) * Math.cos(d(b.lat)) * Math.sin(d(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Shop names as the farmer should read them: no emoji or symbols, no empty brackets, single spaces.
export function cleanShopName(s) {
  return String(s || '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shopsFromOverpass(json, at) {
  return (json?.elements || [])
    .map((e) => {
      const p = e.lat != null ? { lat: e.lat, lon: e.lon } : e.center ? { lat: e.center.lat, lon: e.center.lon } : null;
      const name = e.tags?.name || e.tags?.['name:en'];
      if (!p || !name) return null;
      return { id: `osm-${e.type}-${e.id}`, name: cleanShopName(name), kind: e.tags.shop || 'shop', lat: p.lat, lon: p.lon, km: Math.round(haversineKm(at, p) * 10) / 10, source: 'OpenStreetMap', real: true };
    })
    .filter(Boolean)
    .sort((a, b) => a.km - b.km)
    .slice(0, 5);
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const shopCache = new Map();
// kind 'inputs': seed and fertilizer shops. kind 'buyers' (v0.12.0): produce markets, mills and wholesale traders.
const SEARCH = {
  inputs: { text: 'seed and fertilizer shop', osm: '[shop~"^(agrarian|farm|garden_centre|seeds|fertilizer)$"]' },
  buyers: { text: 'wholesale market', osm: '[shop~"^(wholesale|greengrocer)$"]' },
};
// v0.12.1: who buys this crop, in the words Google Maps lists them under.
const BUYER_TEXT = { rice: 'rice mill', wheat: 'flour mill', mustard: 'oil mill', rapeseed: 'oil mill', sesame: 'oil mill', peanut: 'oil mill', potato: 'cold storage', maize: 'grain elevator', soybean: 'grain elevator', sugarcane: 'sugar mill', cotton: 'cotton ginning mill', jute: 'jute mill' };
export const buyerQuery = (crop) => BUYER_TEXT[String(crop || '').replace(/ /g, '_')] || 'wholesale vegetable and grain market';
export async function nearbyShops(lat, lon, { radiusKm = 15, fetchImpl = fetch, kind = 'inputs', cropText = '' } = {}) {
  const S = SEARCH[kind] || SEARCH.inputs;
  const key = `${kind}|${kind === 'buyers' ? buyerQuery(cropText) : ''}|${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (shopCache.has(key)) return shopCache.get(key);
  const gkey = env('GOOGLE_PLACES_KEY');
  let out = null;
  if (gkey) {
    try {
      const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': gkey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress' },
        // Buyers: a box around the field (a restriction, so far-off city results are not returned); shops: a bias.
        body: JSON.stringify(
          kind === 'buyers'
            ? { textQuery: buyerQuery(cropText), locationRestriction: { rectangle: { low: { latitude: lat - radiusKm / 111, longitude: lon - radiusKm / (111 * Math.cos((lat * Math.PI) / 180)) }, high: { latitude: lat + radiusKm / 111, longitude: lon + radiusKm / (111 * Math.cos((lat * Math.PI) / 180)) } } }, maxResultCount: 5 }
            : { textQuery: S.text, locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: radiusKm * 1000 } }, maxResultCount: 5 }
        ),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const j = await res.json();
        out = (j.places || [])
          .map((p) => ({ id: `g-${p.id}`, name: cleanShopName(p.displayName?.text), kind: 'shop', lat: p.location?.latitude, lon: p.location?.longitude, address: p.formattedAddress, source: 'Google Places', real: true }))
          .filter((s) => s.name && Number.isFinite(s.lat))
          .map((s) => ({ ...s, km: Math.round(haversineKm({ lat, lon }, s) * 10) / 10 }))
          .sort((a, b) => a.km - b.km);
      }
    } catch {}
  }
  if (!out) {
    const r = radiusKm * 1000;
    const q = `[out:json][timeout:12];(nwr(around:${r},${lat},${lon})${S.osm};${kind === 'buyers' ? `nwr(around:${r},${lat},${lon})[amenity=marketplace];nwr(around:${r},${lat},${lon})[craft=mill];` : ''});out center 30;`;
    // Both public Overpass servers at once; the first good answer wins.
    out = await Promise.any(
      OVERPASS.map(async (url) => {
        const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
        return shopsFromOverpass(await res.json(), { lat, lon });
      })
    ).catch(() => null);
  }
  // Google treats the radius as a preference: keep only shops within it.
  if (out) out = out.filter((s) => s.name && s.km <= radiusKm).slice(0, 5);
  const result = { shops: out || [], source: gkey ? 'Google Places' : 'OpenStreetMap', error: out ? null : 'Shop search did not answer' };
  // Google's terms do not allow keeping Places results; only OpenStreetMap answers are cached.
  if (out && !gkey) shopCache.set(key, result);
  return result;
}

// ---------- money per country ----------
// Sample-price conversion only (fixed, rounded rates; the app labels every price as a sample).
const CURRENCY = {
  BD: ['BDT', '৳', 120], IN: ['INR', '₹', 84], PK: ['PKR', 'Rs', 280], NP: ['NPR', 'Rs', 134], LK: ['LKR', 'Rs', 300], MM: ['MMK', 'K', 2100],
  US: ['USD', '$', 1], CA: ['CAD', '$', 1.37], GB: ['GBP', '£', 0.78], AU: ['AUD', '$', 1.5], NG: ['NGN', '₦', 1500], KE: ['KES', 'KSh', 130],
  ET: ['ETB', 'Br', 120], GH: ['GHS', '₵', 15], TZ: ['TZS', 'TSh', 2600], UG: ['UGX', 'USh', 3700], BR: ['BRL', 'R$', 5.5], MX: ['MXN', '$', 18],
  ID: ['IDR', 'Rp', 16000], PH: ['PHP', '₱', 57], VN: ['VND', '₫', 25000], TH: ['THB', '฿', 35], CN: ['CNY', '¥', 7.2], EG: ['EGP', 'E£', 48],
  FR: ['EUR', '€', 0.92], DE: ['EUR', '€', 0.92], IT: ['EUR', '€', 0.92], ES: ['EUR', '€', 0.92], NL: ['EUR', '€', 0.92],
};
export function currencyFor(cc) {
  const c = CURRENCY[String(cc || '').toUpperCase()] || ['USD', '$', 1];
  return { code: c[0], symbol: c[1], perUsd: c[2] };
}

// ---------- all together ----------
export async function checkPlace({ lat, lon, lang = 'en' }, deps = {}) {
  const [geo, cover] = await Promise.all([
    reverseGeocode(lat, lon, lang, deps).catch((err) => ({ error: err.message })),
    (deps.landCover || landCover)(lat, lon).catch((err) => ({ error: err.message })),
  ]);
  const coverOk = cover && !cover.error ? cover : null;
  const verdict = verdictFrom({ cover: coverOk, osmClass: geo?.osmClass, osmType: geo?.osmType });
  return {
    at: new Date().toISOString(),
    country: geo?.country || null,
    cc: geo?.cc || null,
    state: geo?.state || null,
    district: geo?.district || null,
    village: geo?.village || null,
    osm: geo?.osmClass ? `${geo.osmClass}/${geo.osmType}` : null,
    geoError: geo?.error || null,
    cover: coverOk,
    coverError: cover?.error || null,
    verdict,
    currency: currencyFor(geo?.cc),
    sources: ['OpenStreetMap Nominatim (ODbL)', 'ESA WorldCover 2021 (CC BY 4.0)'],
  };
}
