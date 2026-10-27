// Field outline geometry (v0.10.0): turns the SAM 3.1 mask of the chosen field into a polygon in metres
// around the land's point, so satellite data (Sentinel-2) can be read for exactly that field.
// The satellite tile is centred on the land's lat/lon and covers ground_m metres across image_px pixels.

// "M4.5 0L5 -0.5 ... Z M..." (absolute M/L/Z, as decodeMaskToSVGPath writes it) -> [[x, y], ...] rings.
export function parsePath(d) {
  const rings = [];
  let cur = null;
  const re = /([MLZ])|(-?\d*\.?\d+(?:e-?\d+)?)/gi;
  let cmd = null;
  const nums = [];
  const flush = () => {
    while (nums.length >= 2) {
      const x = nums.shift();
      const y = nums.shift();
      if (cmd === 'M' || !cur) {
        cur = [];
        rings.push(cur);
        cmd = 'L';
      }
      cur.push([x, y]);
    }
  };
  for (const m of String(d || '').matchAll(re)) {
    if (m[1]) {
      flush();
      const c = m[1].toUpperCase();
      if (c === 'Z') cur = null;
      cmd = c === 'Z' ? 'M' : c;
    } else nums.push(Number(m[2]));
  }
  flush();
  return rings.filter((r) => r.length >= 3);
}

const ringArea = (r) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

export function chosenObject(land) {
  const objs = land?.objects || [];
  if (!objs.length) return null;
  return objs.find((o) => String(o.id) === String(land.selected_object)) || objs.find((o) => o.containsPoint) || [...objs].sort((a, b) => (b.areaPx || 0) - (a.areaPx || 0))[0];
}

// The chosen field as rings in metres: x east, y north of the land's point. Holes are dropped.
export function fieldPolygonM(land) {
  const o = chosenObject(land);
  const W = Number(land?.image_px) || 1024;
  const mpp = (Number(land?.ground_m) || 225) / W;
  const toM = (x, y) => [(x - W / 2) * mpp, (W / 2 - y) * mpp];
  if (o?.mask?.svgPath && o.mask.bounds) {
    const { bounds: b, width: mw, height: mh } = o.mask;
    const sx = (b.right - b.left) / mw;
    const sy = (b.bottom - b.top) / mh;
    const rings = parsePath(o.mask.svgPath).map((r) => r.map(([x, y]) => toM(b.left + x * sx, b.top + y * sy)));
    const outer = rings.filter((r) => Math.abs(ringArea(r)) > 0).sort((a, z) => Math.abs(ringArea(z)) - Math.abs(ringArea(a)));
    if (outer.length) return [outer[0]];
  }
  if (o?.box) {
    const { left, top, right, bottom } = o.box;
    return [[toM(left, top), toM(right, top), toM(right, bottom), toM(left, bottom)]];
  }
  return null;
}

export function inRings(rings, x, y) {
  let inside = false;
  for (const p of rings) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i];
      const [xj, yj] = p[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function ringsBox(rings) {
  const pts = rings.flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export const areaAcres = (rings) => Math.abs(ringArea(rings[0])) / 4046.86;
