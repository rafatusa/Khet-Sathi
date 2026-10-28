// v0.19.3: the demo farm's sample leaf for the crop problem feature. The admin saves one photo (with its SAM
// measurement when SAM answered); everyone in the demo farm can try it. A leaf saved while SAM was down is
// measured later by itself (retryLeaf: at start, every 3 hours and when opened). Real farms' problem photos
// are still never stored; only this one demo photo is.
const PHOTO = 'demo/leaf.jpg';
const META = 'demo/leaf.json';

// Only the parts of a measurement the screen draws; anything else the browser sent is dropped.
export function cleanMeasure(m) {
  if (!m || typeof m !== 'object' || !m.leaf?.svgPath) return null;
  const box = (b) => (b && ['left', 'top', 'right', 'bottom'].every((k) => Number.isFinite(b[k])) ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null);
  const shape = (o) => (o && typeof o.svgPath === 'string' && o.svgPath.length < 200000 && box(o.bounds) ? { svgPath: o.svgPath, bounds: box(o.bounds), mw: Number(o.mw) || 1, mh: Number(o.mh) || 1 } : null);
  const leaf = shape(m.leaf);
  if (!leaf || !Number.isFinite(m.share)) return null;
  return {
    width: Number(m.width) || 1024,
    height: Number(m.height) || 768,
    leaf,
    patches: (Array.isArray(m.patches) ? m.patches : []).map(shape).filter(Boolean).slice(0, 40),
    share: Math.max(0, Math.min(100, Math.round(m.share))),
    error: null,
    model: typeof m.model === 'string' ? m.model.slice(0, 40) : null,
  };
}

export async function loadLeaf({ getFile }) {
  const f = await getFile(META).catch(() => null);
  if (!f?.buffer) return null;
  try {
    const meta = JSON.parse(Buffer.from(f.buffer).toString('utf8'));
    return meta && meta.savedAt ? meta : null;
  } catch {
    return null;
  }
}

export async function saveLeaf({ photo, width, height, measure }, { putFile, now = new Date() }) {
  await putFile(PHOTO, photo, 'image/jpeg', undefined, 'no-cache');
  const m = cleanMeasure(measure);
  const meta = { savedAt: now.toISOString(), width, height, measure: m, measuredAt: m ? now.toISOString() : null, tries: 0, lastError: null };
  await putFile(META, Buffer.from(JSON.stringify(meta)), 'application/json', undefined, 'no-cache');
  return meta;
}

export const leafPhoto = ({ getFile }) => getFile(PHOTO);

// Measures a saved leaf that has no measurement yet. measure(image) is measureProblem; returns the meta.
export async function retryLeaf({ getFile, putFile, measure, now = new Date() }) {
  const meta = await loadLeaf({ getFile });
  if (!meta || meta.measure) return meta;
  const f = await getFile(PHOTO).catch(() => null);
  if (!f?.buffer) return meta;
  const image = { dataUrl: `data:image/jpeg;base64,${Buffer.from(f.buffer).toString('base64')}`, width: meta.width || 1024, height: meta.height || 768 };
  const r = await measure(image).catch((err) => ({ error: err.message }));
  const m = cleanMeasure({ ...r, model: r?.model || 'sam-3.1' });
  const next = { ...meta, tries: (meta.tries || 0) + 1, lastError: m ? null : String(r?.error || 'no leaf found').slice(0, 200) };
  if (m) Object.assign(next, { measure: m, measuredAt: now.toISOString() });
  await putFile(META, Buffer.from(JSON.stringify(next)), 'application/json', undefined, 'no-cache');
  return next;
}
