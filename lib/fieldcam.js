// v0.23.0: the field camera. A camera (or, in the demo farm, a series of saved demo frames) looks at one patch of
// a field. SAM 3.1 outlines the crop; since v0.25.1 the share of it that is yellow or brown is counted by colour
// (SAM outlines objects, and a yellow area inside a field is not one: live, it found only the bare bund). The
// share is kept with the photo, with the grid squares that are mostly yellow. When that share keeps rising over several looks, an alert wakes
// Sathi (lib/watch.js), who looks closer and asks the farmer about the agriculture office. Measured, never
// diagnosed. Looks live in the shed-clips bucket: fieldcam/<land id>/index.json and one JPEG per look.
import { decodeMaskToRaster } from '@meta-sam/parser';
import sharp from 'sharp';
import { segmentStream } from './meta.js';
import { collectSegments } from './segment.js';
import { putFile, getFile, newId, isId, CLIP_BUCKET } from './store.js';

export const PLANT_PROMPTS = ['rice plant', 'plant', 'crop'];
// v0.24.0: grain heads tell ripening from a problem; animals in the field are their own alert.
export const HEAD_PROMPTS = { rice: 'rice panicle', wheat: 'wheat ear', barley: 'barley ear', maize: 'corn cob', mustard: 'mustard pod' };
export const ANIMAL_PROMPTS = ['cow', 'goat'];
const LATE = new Set(['ripening', 'ready', 'late']);
export const MAX_LOOKS = 60;
export const RISE = { points: 5, held: 3 }; // a rise of 5 points that holds for the last 3 looks
const GRID = 160;

export function paintMask(grid, gw, gh, scale, mask, bounds) {
  const raster = decodeMaskToRaster(mask);
  const sx = (bounds.right - bounds.left) / mask.width;
  const sy = (bounds.bottom - bounds.top) / mask.height;
  for (let r = 0; r < mask.height; r++)
    for (let c = 0; c < mask.width; c++) {
      if (!raster[r * mask.width + c]) continue;
      const gx = Math.floor((bounds.left + (c + 0.5) * sx) * scale);
      const gy = Math.floor((bounds.top + (r + 0.5) * sy) * scale);
      if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) grid[gy * gw + gx] = 1;
    }
}

// Share of the plant area (all plant masks together) that the patches cover, in whole percent.
export function coverShare({ width, height, plants, patches }, paint = paintMask) {
  const scale = GRID / Math.max(width, height);
  const gw = Math.max(1, Math.round(width * scale));
  const gh = Math.max(1, Math.round(height * scale));
  const A = new Uint8Array(gw * gh);
  const B = new Uint8Array(gw * gh);
  for (const p of plants) paint(A, gw, gh, scale, p.raw, p.bounds);
  for (const p of patches) paint(B, gw, gh, scale, p.raw, p.bounds);
  let a = 0;
  let both = 0;
  for (let i = 0; i < A.length; i++) if (A[i]) {
    a++;
    if (B[i]) both++;
  }
  return a ? Math.round((both / a) * 100) : null;
}

// v0.24.0: how evenly the yellow is spread over the plants: the plant area is cut into 4 x 4 blocks; the share
// of blocks (with enough plant in them) where at least 30% is yellow or spotted. Ripening is even (most
// blocks), a problem is patchy (a few blocks).
export function evenness({ width, height, plants, patches }, paint = paintMask) {
  const scale = GRID / Math.max(width, height);
  const gw = Math.max(1, Math.round(width * scale));
  const gh = Math.max(1, Math.round(height * scale));
  const A = new Uint8Array(gw * gh);
  const B = new Uint8Array(gw * gh);
  for (const p of plants) paint(A, gw, gh, scale, p.raw, p.bounds);
  for (const p of patches) paint(B, gw, gh, scale, p.raw, p.bounds);
  const bw = gw / 4;
  const bh = gh / 4;
  let blocks = 0;
  let yellow = 0;
  for (let by = 0; by < 4; by++)
    for (let bx = 0; bx < 4; bx++) {
      let a = 0;
      let both = 0;
      for (let y = Math.floor(by * bh); y < Math.floor((by + 1) * bh); y++)
        for (let x = Math.floor(bx * bw); x < Math.floor((bx + 1) * bw); x++) if (A[y * gw + x]) {
          a++;
          if (B[y * gw + x]) both++;
        }
      if (a < 5) continue;
      blocks++;
      if (both / a >= 0.3) yellow++;
    }
  return blocks ? Math.round((yellow / blocks) * 100) / 100 : null;
}

// Ripening or a problem? Late in the season (by the calendar and Sentinel-2, or by warmth since sowing) AND the
// look is even or shows grain heads: ripening. Anything else that rises is a problem, also late in the season.
export function classify({ look, stage = null, heatPct = null }) {
  const late = LATE.has(stage) || (Number.isFinite(heatPct) && heatPct >= 80);
  const ripeLook = (look?.even ?? 0) >= 0.7 || (look?.heads ?? 0) >= 3;
  return late && ripeLook ? 'ripening' : 'problem';
}

// Animals in a frame where the camera noticed movement (SAM 3.1, one phrase per kind).
export async function findAnimals(image, { segment = null } = {}) {
  const seg = segment || (async (img, prompt) => collectSegments(await segmentStream({ imageDataUrl: img.dataUrl, prompt }), { point: { x: img.width / 2, y: img.height / 2 } }));
  const out = [];
  for (const kind of ANIMAL_PROMPTS) {
    const r = await seg(image, kind).catch(() => ({ objects: [] }));
    for (const o of (r.objects || []).filter((x) => x.box && (x.confidence == null || x.confidence >= 0.5)).slice(0, 10)) out.push({ kind, box: o.box });
  }
  return out;
}

const slim = (o) => ({ svgPath: o.mask.svgPath, bounds: o.mask.bounds, mw: o.mask.width, mh: o.mask.height });

// v0.25.1: yellow or brown by colour: hue 20 to 70 degrees (straw, gold, yellow; brown sits at the low end), with
// enough colour and light that it is not grey stalk or shadow. Green rice sits at about 75 to 110 degrees.
export function isYellow(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx < 64 || mx - mn < 0.3 * mx) return false;
  const d = mx - mn;
  const h = mx === r ? (((g - b) / d) % 6) * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  const hue = h < 0 ? h + 360 : h;
  return hue >= 20 && hue < 70;
}
// The photo as RGB pixels on the measuring grid.
export async function rgbGrid(image, gw, gh) {
  const buf = Buffer.from(String(image.dataUrl).split(',')[1] || '', 'base64');
  const { data } = await sharp(buf).resize(gw, gh, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}
const CELLS = 16; // squares across for the overlay
// Inside the plant outlines: the share that is yellow or brown, how evenly it is spread (4 x 4 blocks, as
// evenness above) and the squares of a 16-wide grid that are at least 30% yellow (drawn on the photo).
export function colourMeasure({ width, height, plants }, rgb, paint = paintMask) {
  const scale = GRID / Math.max(width, height);
  const gw = Math.max(1, Math.round(width * scale));
  const gh = Math.max(1, Math.round(height * scale));
  const A = new Uint8Array(gw * gh);
  for (const p of plants) paint(A, gw, gh, scale, p.raw, p.bounds);
  const Y = new Uint8Array(gw * gh);
  let a = 0;
  let y = 0;
  for (let i = 0; i < A.length; i++) if (A[i]) {
    a++;
    if (isYellow(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])) {
      Y[i] = 1;
      y++;
    }
  }
  if (!a) return { share: null, even: null, cells: [] };
  const share = Math.round((y / a) * 100);
  const blockShare = (cols, rows, keep) => {
    const out = [];
    for (let by = 0; by < rows; by++)
      for (let bx = 0; bx < cols; bx++) {
        let n = 0;
        let k = 0;
        for (let yy = Math.floor((by * gh) / rows); yy < Math.floor(((by + 1) * gh) / rows); yy++)
          for (let xx = Math.floor((bx * gw) / cols); xx < Math.floor(((bx + 1) * gw) / cols); xx++) if (A[yy * gw + xx]) {
            n++;
            if (Y[yy * gw + xx]) k++;
          }
        if (n >= keep) out.push({ bx, by, f: k / n });
      }
    return out;
  };
  const blocks = blockShare(4, 4, 5);
  const even = blocks.length ? Math.round((blocks.filter((x) => x.f >= 0.3).length / blocks.length) * 100) / 100 : null;
  const rows = Math.max(1, Math.round((CELLS * gh) / gw));
  const cw = width / CELLS;
  const ch = height / rows;
  const cells = blockShare(CELLS, rows, 3).filter((x) => x.f >= 0.3).map((x) => ({ x: Math.round(x.bx * cw), y: Math.round(x.by * ch), w: Math.round(cw), h: Math.round(ch) }));
  return { share, even, cells };
}

// One look: SAM 3.1 finds the crop (first phrase that finds any), then the yellow share is counted by colour inside it.
export async function measureLook(image, { segment = null, paint = paintMask, crop = null, pixels = rgbGrid } = {}) {
  const seg = segment || (async (img, prompt) => collectSegments(await segmentStream({ imageDataUrl: img.dataUrl, prompt }), { point: { x: img.width / 2, y: img.height / 2 }, keepRaw: true }));
  const out = { width: image.width, height: image.height, plants: [], patches: [], cells: [], share: null, error: null, method: 'colour' };
  try {
    let plants = [];
    for (const p of PLANT_PROMPTS) {
      plants = ((await seg(image, p)).objects || []).filter((o) => o.mask?.svgPath && o.raw);
      if (plants.length) break;
    }
    if (!plants.length) return { ...out, error: 'SAM 3.1 found no plants in the picture' };
    out.plants = plants.slice(0, 30).map(slim);
    const scale = GRID / Math.max(image.width, image.height);
    const rgb = await pixels(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    const c = colourMeasure({ width: image.width, height: image.height, plants: plants.map((p) => ({ raw: p.raw, bounds: p.mask.bounds })) }, rgb, paint);
    out.share = c.share;
    out.even = c.even;
    out.cells = c.cells;
    const head = HEAD_PROMPTS[crop];
    if (head) out.heads = ((await seg(image, head).catch(() => ({ objects: [] }))).objects || []).length;
    return out;
  } catch (err) {
    return { ...out, error: err.message || String(err) };
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
// Is the yellow or spotted share rising? Baseline: the first looks of the last 7 days; now: the last 3 looks.
// One odd look (a shadow, rain on the lens) does not count: each of the last 3 must be above the baseline.
export function trend(looks, { now = Date.now() } = {}) {
  const measured = looks.filter((l) => Number.isFinite(l.share) && Date.parse(l.at) >= now - 7 * 864e5).sort((a, b) => a.at.localeCompare(b.at));
  if (measured.length < 2) return { rising: false, looks: measured.length, from: measured[0]?.share ?? null, to: measured.at(-1)?.share ?? null };
  const base = median(measured.slice(0, Math.min(3, measured.length - RISE.held > 0 ? measured.length - RISE.held : 1)).map((l) => l.share));
  const last = measured.slice(-RISE.held);
  const to = median(last.map((l) => l.share));
  const rising = measured.length >= RISE.held + 1 && to - base >= RISE.points && last.every((l) => l.share >= base + RISE.points / 2);
  return { rising, looks: measured.length, from: base, to, since: measured[0].at };
}

// ---------- storage ----------
const indexPath = (landId) => `fieldcam/${landId}/index.json`;
const photoPath = (landId, id) => `fieldcam/${landId}/${id}.jpg`;
export async function readLooks(landId, { getFileImpl = getFile } = {}) {
  if (!isId(landId)) return [];
  const f = await getFileImpl(indexPath(landId), CLIP_BUCKET).catch(() => null);
  if (!f?.buffer) return [];
  try {
    const j = JSON.parse(Buffer.from(f.buffer).toString('utf8'));
    return Array.isArray(j.looks) ? j.looks : [];
  } catch {
    return [];
  }
}
const queues = new Map();
export function saveLooks(landId, change, { getFileImpl = getFile, putFileImpl = putFile } = {}) {
  const prev = queues.get(landId) || Promise.resolve();
  const run = prev.then(async () => {
    const looks = await readLooks(landId, { getFileImpl });
    const next = (await change(looks)) || looks;
    next.sort((a, b) => a.at.localeCompare(b.at));
    const kept = next.slice(-MAX_LOOKS);
    await putFileImpl(indexPath(landId), Buffer.from(JSON.stringify({ looks: kept })), 'application/json', CLIP_BUCKET, 'no-cache');
    return kept;
  });
  queues.set(landId, run.catch(() => null));
  return run;
}
export async function addLook(landId, { photo, image, at = new Date().toISOString(), demo = false, measure, crop = null, motion = false }, deps = {}) {
  const id = newId();
  await (deps.putFileImpl || putFile)(photoPath(landId, id), photo, 'image/jpeg', CLIP_BUCKET, 'no-cache');
  // A movement frame is only checked for animals; it is not measured for yellow and not part of the trend.
  if (motion) {
    const animals = await findAnimals(image, deps);
    const look = { id, at, demo, motion: true, width: image.width, height: image.height, share: null, animals };
    const looks = await saveLooks(landId, (ls) => [...ls, look], deps);
    return { look, looks };
  }
  const m = measure || (await measureLook(image, { ...deps, crop }));
  const look = { id, at, demo, width: image.width, height: image.height, share: m.share, error: m.error, even: m.even ?? null, heads: m.heads ?? null, measure: { plants: m.plants, patches: m.patches || [], cells: m.cells || [], method: m.method || 'sam' } };
  const looks = await saveLooks(landId, (ls) => [...ls, look], deps);
  return { look, looks };
}
export const lookPhoto = (landId, id, { getFileImpl = getFile } = {}) => (isId(landId) && isId(id) ? getFileImpl(photoPath(landId, id), CLIP_BUCKET) : null);
export const lookView = (landId, l) => ({ id: l.id, at: l.at, demo: Boolean(l.demo), motion: Boolean(l.motion), animals: l.animals || null, even: l.even ?? null, heads: l.heads ?? null, share: l.share ?? null, error: l.error || null, width: l.width, height: l.height, measure: l.measure || null, photoUrl: `/api/lands/${landId}/camera/${l.id}/photo` });

// Demo frames saved in one go are dated across the last days (oldest first), so the series reads like a camera
// that has watched the patch since Monday. Several looks a day, in daylight.
export function demoDates(n, { now = Date.now(), days = 3 } = {}) {
  const start = now - days * 864e5;
  return Array.from({ length: n }, (_, i) => new Date(start + ((i + 1) / n) * days * 864e5).toISOString());
}
