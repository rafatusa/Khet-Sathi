// Finds the farmer's plot on satellite imagery with SAM 3.1.
// Pass 1: centre 225 m enlarged to 1024 px, concept "field" (works on small Bengal plots).
// Pass 2: the full 600 m view, concept "farm field" (works on large Punjab plots).
// The first pass whose outlines cover the farmer's point wins.
import { segmentStream } from './meta.js';
import { collectSegments } from './segment.js';
import { fetchSatelliteImage, zoomCenter } from './tile.js';
import { pickPlot, withAcres, dropBlobs } from './plot.js';

export const SCAN = { halfSideM: 300, imagePx: 1024, zoomKeepPx: 384 };

export const PASSES = [
  { view: 'zoom', prompt: 'field' },
  { view: 'full', prompt: 'farm field' },
];

async function samSegment(image, prompt) {
  const events = await segmentStream({ imageDataUrl: image.dataUrl, prompt });
  return collectSegments(events, { point: { x: image.width / 2, y: image.height / 2 } });
}

function slim(o) {
  return { id: o.id, box: o.box, confidence: o.confidence, areaPx: o.areaPx, acres: o.acres, containsPoint: o.containsPoint, mask: o.mask };
}

// Picks which pass to keep. Exported for the offline tests.
export function choosePass(passes) {
  const ok = passes.filter((p) => !p.error);
  const centred = ok.find((p) => p.objects.some((o) => o.containsPoint));
  if (centred) return centred;
  const most = ok.reduce((a, b) => (b.objects.length > (a?.objects.length ?? 0) ? b : a), null);
  if (most && most.objects.length) return most;
  // Nothing found. If SAM answered, keep the close-up so the farmer sees the spot;
  // if every pass failed, keep the wide view so the land can be re-scanned later.
  return ok.find((p) => p.view === 'zoom') || passes.find((p) => p.view === 'full') || passes[0];
}

export async function scanLand({ lat, lon, segment = samSegment, fetchImage = fetchSatelliteImage, zoom = zoomCenter }) {
  const full = await fetchImage({ lat, lon, halfSideMeters: SCAN.halfSideM, size: SCAN.imagePx });
  const images = { full };
  try {
    images.zoom = await zoom(full, { keepPx: SCAN.zoomKeepPx, outPx: SCAN.imagePx });
  } catch (err) {
    images.zoomError = err.message;
  }

  const passes = [];
  for (const { view, prompt } of PASSES) {
    const image = images[view];
    const pass = { view, prompt, image, objects: [], found: 0, error: null };
    if (!image) {
      pass.error = images.zoomError || 'image not available';
      passes.push(pass);
      continue;
    }
    try {
      const seg = await segment(image, prompt);
      pass.found = seg.objects.length;
      pass.objects = dropBlobs(withAcres(seg.objects, image.groundMeters, image.width), image.width).map(slim);
    } catch (err) {
      pass.error = err.message || String(err);
    }
    passes.push(pass);
    if (pass.objects.some((o) => o.containsPoint)) break; // farmer's plot found, skip the next pass
  }

  const best = choosePass(passes);
  const plot = pickPlot(best.objects, { width: best.image.width, height: best.image.height });
  return {
    image: best.image,
    objects: best.objects,
    plot,
    sam: {
      view: best.view,
      prompt: best.prompt,
      groundMeters: best.image.groundMeters,
      fields: best.objects.length,
      passes: passes.map(({ view, prompt, found, objects, error }) => ({ view, prompt, found, kept: objects.length, error })),
      error: passes.every((p) => p.error) ? passes.map((p) => `${p.view}: ${p.error}`).join(' | ') : null,
    },
  };
}
