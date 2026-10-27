// Turns a SAM 3.1 event stream into plain JSON the browser can draw:
// one entry per detected object with its box, confidence, SVG mask path,
// pixel area, and whether it covers a given point (e.g. the farmer's GPS spot).
import {
  parseImageStream,
  recordsOfKind,
  decodeMaskToSVGPath,
  decodeMaskToRaster,
} from '@meta-sam/parser';

// Area in source-image pixels, and whether (px, py) falls inside the mask.
export function maskStats(mask, bounds, point) {
  const raster = decodeMaskToRaster(mask);
  let on = 0;
  for (let i = 0; i < raster.length; i++) on += raster[i];
  const sx = (bounds.right - bounds.left) / mask.width;
  const sy = (bounds.bottom - bounds.top) / mask.height;
  let contains = false;
  if (point) {
    const col = Math.floor((point.x - bounds.left) / sx);
    const row = Math.floor((point.y - bounds.top) / sy);
    if (col >= 0 && row >= 0 && col < mask.width && row < mask.height) {
      contains = raster[row * mask.width + col] === 1;
    }
  }
  return { areaPx: Math.round(on * sx * sy), contains };
}

export async function collectSegments(events, { point } = {}) {
  const parsed = parseImageStream(events);
  for await (const _snapshot of parsed) {
    // snapshots are cumulative; only the final result is needed here
  }
  const result = await parsed.finalResult;

  const boxes = recordsOfKind(result.records, 'box');
  const masks = recordsOfKind(result.records, 'mask');
  const byId = new Map();

  for (const b of boxes) {
    byId.set(b.objectId, {
      id: b.objectId,
      box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
      confidence: b.confidence ?? null,
      mask: null,
      areaPx: null,
      containsPoint: false,
    });
  }
  for (const m of masks) {
    const entry = byId.get(m.objectId) || { id: m.objectId, box: m.bounds, confidence: m.confidence ?? null };
    let path = null;
    try {
      path = decodeMaskToSVGPath(m.mask);
    } catch {
      path = null;
    }
    try {
      const st = maskStats(m.mask, m.bounds, point);
      entry.areaPx = st.areaPx;
      entry.containsPoint = st.contains;
    } catch {
      entry.areaPx = null;
    }
    entry.mask = { width: m.mask.width, height: m.mask.height, bounds: m.bounds, svgPath: path };
    byId.set(m.objectId, entry);
  }

  return {
    outcome: result.outcome,
    objects: [...byId.values()],
    diagnostics: result.diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`),
    rawPreview: result.rawOutput.slice(0, 400),
  };
}
