// Soil for a plot from ISRIC SoilGrids (250 m global maps, CC BY 4.0).
// SoilGrids is slow (6 to 8 s) and its REST API is labelled beta, so each land's
// soil is looked up once and saved; the three demo plots also carry a dated copy.
const SOILGRIDS = 'https://rest.isric.org/soilgrids/v2.0/properties/query';
const PROPS = ['clay', 'sand', 'silt', 'phh2o', 'soc'];
const DEPTHS = ['0-5cm', '5-15cm', '15-30cm'];

// USDA soil texture triangle. Inputs in percent.
export function textureClass(sand, silt, clay) {
  if (![sand, silt, clay].every(Number.isFinite)) return null;
  if (silt + 1.5 * clay < 15) return 'sand';
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return 'loamy_sand';
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return 'sandy_loam';
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'loam';
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return 'silt_loam';
  if (silt >= 80 && clay < 12) return 'silt';
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return 'sandy_clay_loam';
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return 'clay_loam';
  if (clay >= 27 && clay < 40 && sand <= 20) return 'silty_clay_loam';
  if (clay >= 35 && sand > 45) return 'sandy_clay';
  if (clay >= 40 && silt >= 40) return 'silty_clay';
  if (clay >= 40 && sand <= 45 && silt < 40) return 'clay';
  return 'loam';
}

// Topsoil (0-15 cm) average, weighting each layer by its thickness.
export function summarizeSoilGrids(json) {
  const layers = json?.properties?.layers || [];
  const get = (name) => {
    const layer = layers.find((l) => l.name === name);
    if (!layer) return null;
    const d = layer.unit_measure?.d_factor || 1;
    const v = (label) => layer.depths.find((x) => x.label === label)?.values?.mean;
    const a = v('0-5cm');
    const b = v('5-15cm');
    if (a == null && b == null) return null;
    if (a == null) return b / d;
    if (b == null) return a / d;
    return (a * 5 + b * 10) / 15 / d;
  };
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const clay = r1(get('clay'));
  const sand = r1(get('sand'));
  const silt = r1(get('silt'));
  const ph = r1(get('phh2o'));
  const soc = r1(get('soc')); // g/kg
  if (clay == null && sand == null && silt == null) return null;
  return { clay, sand, silt, ph, socGkg: soc, texture: textureClass(sand, silt, clay) };
}

// Dated copies for the demo plots, taken from SoilGrids on Oct 27, 2026.
export const SOIL_SNAPSHOT = {
  bolpur: { clay: 31.5, sand: 26.5, silt: 42, ph: 6.3, socGkg: 14.3, texture: 'clay_loam' },
  bogura: { clay: 36.1, sand: 18.4, silt: 45.5, ph: 6.4, socGkg: 17.9, texture: 'silty_clay_loam' },
  punjab: { clay: 28, sand: 37.2, silt: 34.8, ph: 7.9, socGkg: 9.2, texture: 'clay_loam' },
};

export async function fetchSoil(lat, lon, { timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const q = new URLSearchParams({ lon: String(lon), lat: String(lat), value: 'mean' });
  PROPS.forEach((p) => q.append('property', p));
  DEPTHS.forEach((d) => q.append('depth', d));
  const res = await fetchImpl(`${SOILGRIDS}?${q}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`SoilGrids HTTP ${res.status}`);
  const soil = summarizeSoilGrids(await res.json());
  if (!soil) throw new Error('SoilGrids has no soil data for this spot');
  return { ...soil, source: 'SoilGrids 250 m', fetchedAt: new Date().toISOString() };
}

// Saved soil first, then a live lookup, then the demo copy.
export async function soilForLand(land, { fetchImpl } = {}) {
  if (land?.soil?.texture) return { soil: land.soil, fresh: false, error: null };
  try {
    return { soil: await fetchSoil(land.lat, land.lon, { fetchImpl }), fresh: true, error: null };
  } catch (err) {
    const snap = land?.place && SOIL_SNAPSHOT[land.place];
    if (snap) return { soil: { ...snap, source: 'SoilGrids 250 m (saved copy, Oct 27, 2026)' }, fresh: false, error: err.message };
    return { soil: null, fresh: false, error: err.message };
  }
}
