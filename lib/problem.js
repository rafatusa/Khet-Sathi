// v0.16.0: a photo of a crop problem, measured, never diagnosed. SAM 3.1 outlines the leaf and then the
// yellow or brown patches on it; the share of the leaf they cover is worked out on a common grid. Sathi
// never says what the cause is: the farmer's own answers and this measurement go to the agriculture office.
import { decodeMaskToRaster } from '@meta-sam/parser';
import { segmentStream } from './meta.js';
import { collectSegments } from './segment.js';
import { pickPlot } from './plot.js';

export const LEAF_PROMPT = 'leaf';
export const PATCH_PROMPT = 'yellow or brown patch';
const GRID = 160; // the long side of the grid the masks are compared on

// Paints one SAM mask onto the common grid (image pixels scaled down to the grid).
export function paint(grid, gw, gh, scale, mask, bounds) {
  const raster = decodeMaskToRaster(mask);
  const sx = (bounds.right - bounds.left) / mask.width;
  const sy = (bounds.bottom - bounds.top) / mask.height;
  for (let r = 0; r < mask.height; r++) {
    for (let c = 0; c < mask.width; c++) {
      if (!raster[r * mask.width + c]) continue;
      const gx = Math.floor((bounds.left + (c + 0.5) * sx) * scale);
      const gy = Math.floor((bounds.top + (r + 0.5) * sy) * scale);
      if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) grid[gy * gw + gx] = 1;
    }
  }
}

// The share of the leaf the patches cover, in whole percent (patches outside the leaf do not count).
export function patchShare({ width, height, leaf, patches }, paintFn = paint) {
  const scale = GRID / Math.max(width, height);
  const gw = Math.max(1, Math.round(width * scale));
  const gh = Math.max(1, Math.round(height * scale));
  const L = new Uint8Array(gw * gh);
  const P = new Uint8Array(gw * gh);
  paintFn(L, gw, gh, scale, leaf.raw, leaf.bounds);
  for (const p of patches) paintFn(P, gw, gh, scale, p.raw, p.bounds);
  let leafN = 0;
  let both = 0;
  for (let i = 0; i < L.length; i++) {
    if (L[i]) {
      leafN++;
      if (P[i]) both++;
    }
  }
  return leafN ? Math.round((both / leafN) * 100) : null;
}

const slim = (o) => ({ svgPath: o.mask.svgPath, bounds: o.mask.bounds, mw: o.mask.width, mh: o.mask.height });

export async function measureProblem(image, { segment = null } = {}) {
  const seg = segment || (async (img, prompt) => collectSegments(await segmentStream({ imageDataUrl: img.dataUrl, prompt }), { point: { x: img.width / 2, y: img.height / 2 }, keepRaw: true }));
  const out = { width: image.width, height: image.height, leaf: null, patches: [], share: null, error: null };
  try {
    const leaves = ((await seg(image, LEAF_PROMPT)).objects || []).filter((o) => o.mask?.svgPath && o.raw);
    if (!leaves.length) return { ...out, error: 'SAM 3.1 found no leaf in the photo' };
    const leaf = pickPlot(leaves, { width: image.width, height: image.height });
    out.leaf = slim(leaf);
    const patches = ((await seg(image, PATCH_PROMPT)).objects || []).filter((o) => o.mask?.svgPath && o.raw);
    out.patches = patches.slice(0, 12).map(slim);
    out.share = patches.length ? patchShare({ width: image.width, height: image.height, leaf: { raw: leaf.raw, bounds: leaf.mask.bounds }, patches: patches.map((p) => ({ raw: p.raw, bounds: p.mask.bounds })) }) : 0;
    return out;
  } catch (err) {
    return { ...out, error: err.message || String(err) };
  }
}
