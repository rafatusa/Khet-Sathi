// Turns a SAM 3.1 event stream into plain JSON the browser can draw:
// one entry per detected object with its box, confidence and an SVG mask path.
import {
  parseImageStream,
  recordsOfKind,
  decodeMaskToSVGPath,
} from '@meta-sam/parser';

export async function collectSegments(events) {
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
