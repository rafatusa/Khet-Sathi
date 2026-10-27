// Real field health from Sentinel-2 (v0.10.0): ESA Copernicus Sentinel-2 L2A, served as free cloud-optimised
// GeoTIFFs on AWS (Earth Search STAC by Element 84, no key). For the farmer's own field outline we read the
// red (B04), near-infrared (B08) and scene-classification (SCL) bands, mask clouds, and compute NDVI per pass.
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import { env } from './env.js';
import { inRings, ringsBox } from './fieldgeo.js';

const STAC = env('STAC_URL', 'https://earth-search.aws.element84.com/v1').replace(/\/+$/, '');
const BAD_SCL = new Set([0, 1, 3, 8, 9, 10, 11]); // no data, saturated, cloud shadow, clouds, cirrus, snow
export const ZONES = { cols: 6, rows: 4 };

const day = (iso) => String(iso).slice(0, 10);

// Passes over the point in the last `days` days, newest first; one per date (the clearest tile).
export async function searchPasses({ lat, lon, days = 150, now = new Date(), fetchImpl = fetch }) {
  const from = new Date(now.getTime() - days * 86400000).toISOString();
  const res = await fetchImpl(`${STAC}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collections: ['sentinel-2-l2a'], intersects: { type: 'Point', coordinates: [lon, lat] }, datetime: `${from}/${now.toISOString()}`, limit: 100 }),
  });
  if (!res.ok) throw new Error(`Sentinel-2 search failed (HTTP ${res.status})`);
  const json = await res.json();
  return passesFromStac(json);
}

export function passesFromStac(json) {
  const byDate = new Map();
  for (const f of json?.features || []) {
    const p = f.properties || {};
    const code = p['proj:epsg'] || Number(String(p['proj:code'] || '').split(':')[1]) || null;
    const pass = {
      id: f.id,
      date: day(p.datetime),
      sat: String(f.id).slice(0, 3),
      tileCloud: Math.round(Number(p['eo:cloud_cover'] ?? 100)),
      epsg: code,
      offsetApplied: p['earthsearch:boa_offset_applied'] === true,
      baseline: Number(p['s2:processing_baseline'] || 0),
      red: f.assets?.red?.href,
      nir: f.assets?.nir?.href,
      scl: f.assets?.scl?.href,
    };
    if (!pass.red || !pass.nir || !pass.epsg) continue;
    const old = byDate.get(pass.date);
    if (!old || pass.tileCloud < old.tileCloud) byDate.set(pass.date, pass);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// Reads a window [minE, minN, maxE, maxN] (UTM metres) from one COG band.
async function readWindowCOG(url, [minE, minN, maxE, maxN]) {
  const tif = await fromUrl(url);
  const img = await tif.getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution(); // ry is negative
  const c0 = Math.floor((minE - ox) / rx);
  const c1 = Math.ceil((maxE - ox) / rx);
  const r0 = Math.floor((maxN - oy) / ry);
  const r1 = Math.ceil((minN - oy) / ry);
  const [data] = await img.readRasters({ window: [c0, r0, c1, r1] });
  return { data, w: c1 - c0, h: r1 - r0, e0: ox + c0 * rx, n0: oy + r0 * ry, res: rx };
}

const utmDef = (epsg) => {
  const zone = epsg % 100;
  return `+proj=utm +zone=${zone}${epsg >= 32700 ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
};

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] : null);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// NDVI of one pass for the field (rings in metres around lat/lon). readWindow is injectable for tests.
export async function readPass(pass, { lat, lon, rings, readWindow = readWindowCOG }) {
  const [cx, cy] = proj4('EPSG:4326', utmDef(pass.epsg), [lon, lat]);
  const b = ringsBox(rings);
  const box = [cx + b.minX - 15, cy + b.minY - 15, cx + b.maxX + 15, cy + b.maxY + 15];
  const [red, nir, scl] = await Promise.all([readWindow(pass.red, box), readWindow(pass.nir, box), pass.scl ? readWindow(pass.scl, box) : null]);
  const shift = pass.offsetApplied || pass.baseline < 4 ? 0 : 1000; // L2A baseline 04.00+ adds 1000 to every value
  const cells = [];
  const values = [];
  let total = 0;
  let clear = 0;
  for (let r = 0; r < red.h; r++) {
    for (let c = 0; c < red.w; c++) {
      const E = red.e0 + (c + 0.5) * red.res;
      const N = red.n0 - (r + 0.5) * red.res;
      const x = E - cx;
      const y = N - cy;
      const inside = inRings(rings, x, y);
      let v = null;
      if (inside) {
        total++;
        let cloudy = false;
        if (scl) {
          const sc = Math.floor((E - scl.e0) / scl.res);
          const sr = Math.floor((scl.n0 - N) / scl.res);
          const s = sc >= 0 && sr >= 0 && sc < scl.w && sr < scl.h ? scl.data[sr * scl.w + sc] : 0;
          cloudy = BAD_SCL.has(s);
        }
        const R = red.data[r * red.w + c] - shift;
        const NIR = nir.data[r * nir.w + c] - shift;
        if (!cloudy && R + NIR > 0 && red.data[r * red.w + c] > 0) {
          v = Math.max(-1, Math.min(1, (NIR - R) / (NIR + R)));
          clear++;
          values.push(v);
        }
      }
      cells.push(inside ? v : undefined);
    }
  }
  const sorted = [...values].sort((a, z) => a - z);
  const median = quantile(sorted, 0.5);
  const stats = values.length
    ? {
        mean: r2(values.reduce((a, z) => a + z, 0) / values.length),
        min: r2(sorted[0]),
        max: r2(sorted[sorted.length - 1]),
        p10: r2(quantile(sorted, 0.1)),
        stressedPct: Math.round((100 * values.filter((v) => v < median - 0.15).length) / values.length),
        canopyPct: Math.round((100 * values.filter((v) => v > 0.5).length) / values.length),
      }
    : null;
  return {
    pixels: total,
    clearPct: total ? Math.round((100 * clear) / total) : 0,
    ndvi: stats,
    grid: { w: red.w, h: red.h, res: red.res, x0: red.e0 - cx, y0: red.n0 - cy, cells: cells.map((v) => (v === undefined ? -9 : v === null ? -8 : Math.round(v * 100) / 100)) },
  };
}

// Mean NDVI in a cols x rows grid over the field box (null where no clear pixel).
export function zonesFrom(grid, rings, { cols = ZONES.cols, rows = ZONES.rows } = {}) {
  const b = ringsBox(rings);
  const sums = Array(cols * rows).fill(0);
  const counts = Array(cols * rows).fill(0);
  for (let r = 0; r < grid.h; r++) {
    for (let c = 0; c < grid.w; c++) {
      const v = grid.cells[r * grid.w + c];
      if (v < -1) continue;
      const x = grid.x0 + (c + 0.5) * grid.res;
      const y = grid.y0 - (r + 0.5) * grid.res;
      const zc = Math.min(cols - 1, Math.max(0, Math.floor(((x - b.minX) / (b.maxX - b.minX || 1)) * cols)));
      const zr = Math.min(rows - 1, Math.max(0, Math.floor(((b.maxY - y) / (b.maxY - b.minY || 1)) * rows)));
      sums[zr * cols + zc] += v;
      counts[zr * cols + zc]++;
    }
  }
  return sums.map((s, i) => (counts[i] ? r2(s / counts[i]) : null));
}

// Zone grid that fits the field (v0.10.1): at most 6 x 4, but never more zones than 10 m pixels across or
// down the field, so a 0.1 acre plot (about 2 x 2 pixels) gets 2 x 2 zones instead of mostly empty boxes.
export function zoneShape(grid) {
  const rowsIn = new Set();
  const colsIn = new Set();
  for (let r = 0; r < grid.h; r++) {
    for (let c = 0; c < grid.w; c++) {
      if (grid.cells[r * grid.w + c] === -9) continue;
      rowsIn.add(r);
      colsIn.add(c);
    }
  }
  return { cols: Math.max(1, Math.min(ZONES.cols, colsIn.size)), rows: Math.max(1, Math.min(ZONES.rows, rowsIn.size)) };
}

// Each Sentinel-2 satellite repeats its track every 10 days; next pass = soonest repeat after today.
export function nextPass(passes, today) {
  const lastBySat = new Map();
  for (const p of passes) if (!lastBySat.has(p.sat)) lastBySat.set(p.sat, p.date);
  let best = null;
  for (const [sat, d] of lastBySat) {
    let t = new Date(`${d}T00:00:00Z`).getTime();
    const now = new Date(`${today}T00:00:00Z`).getTime();
    while (t <= now) t += 10 * 86400000;
    const iso = new Date(t).toISOString().slice(0, 10);
    if (!best || iso < best.date) best = { date: iso, sat };
  }
  return best;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]).catch((e) => ({ error: e.message }));
      }
    })
  );
  return out;
}

// Full field report: every pass in the window, NDVI for the clearer ones, zones on the latest clear pass.
export async function fieldHealth({ lat, lon, rings, today, days = 150, maxRead = 20, search = searchPasses, read = readPass }) {
  const passes = await search({ lat, lon, days });
  const toRead = passes.filter((p) => p.tileCloud <= 80).slice(0, maxRead);
  const results = await pool(toRead, 5, (p) => read(p, { lat, lon, rings }));
  const readMap = new Map(toRead.map((p, i) => [p.id, results[i]]));
  let latest = null;
  const list = passes.map((p) => {
    const r = readMap.get(p.id);
    const fieldCloud = r && !r.error ? 100 - r.clearPct : null;
    const clear = Boolean(r && !r.error && r.ndvi && r.clearPct >= 50);
    if (clear && !latest) {
      const shape = zoneShape(r.grid);
      latest = { date: p.date, sat: p.sat, ...r, zones: zonesFrom(r.grid, rings, shape), zoneCols: shape.cols, zoneRows: shape.rows };
    }
    return { date: p.date, sat: p.sat, tileCloud: p.tileCloud, fieldCloud, cloudy: !clear, read: Boolean(r), ndvi: clear ? r.ndvi : null, grid: clear ? r.grid : null, error: r?.error || null };
  });
  return {
    source: 'ESA Copernicus Sentinel-2 L2A (Earth Search on AWS)',
    passes: list,
    latest,
    next: today ? nextPass(passes, today) : null,
  };
}
