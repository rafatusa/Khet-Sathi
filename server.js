// Khet Saathi server: farmer app at /, model-check bench at /check/.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, hasKey, listModels, chat, messageText, transcribe, transcriptText, segmentStream } from './lib/meta.js';
import { collectSegments } from './lib/segment.js';
import { fetchSatelliteImage, zoomCenter } from './lib/tile.js';
import { scanLand } from './lib/scan.js';
import { env } from './lib/env.js';
import { runAgent } from './lib/agent.js';
import { TTS, hasTtsKey, synthesize } from './lib/tts.js';
import { DEMO_PLACES } from './lib/plot.js';
import {
  dbConfigured, isId, newId, createLand, listLands, getLand, updateLand, deleteLand, putFile, getFile, deleteFiles, listAlerts, pingDb,
} from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = env('PORT', '3000');
const VERSION = '0.3.2';

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Optional passcode so a public URL can't burn API credits.
// Images use ?k= because <img> tags can't send headers.
function guard(req, res, next) {
  const code = env('APP_PASSCODE');
  if (!code) return next();
  if (req.get('x-app-passcode') === code || req.query.k === code) return next();
  return res.status(401).json({ ok: false, error: 'Passcode required' });
}

// Wraps a handler so every response has { ok, ms, ... }.
function timed(handler) {
  return async (req, res) => {
    const t0 = Date.now();
    try {
      const data = await handler(req);
      res.json({ ok: true, ms: Date.now() - t0, ...data });
    } catch (err) {
      res.status(200).json({ ok: false, ms: Date.now() - t0, error: err.message || String(err) });
    }
  };
}

function landView(land) {
  if (!land) return null;
  const { tile_path, photo_path, ...rest } = land;
  return {
    ...rest,
    // ?v= changes when a re-scan stores a new picture, so browsers don't show the old one.
    tileUrl: tile_path ? `/api/lands/${land.id}/image/tile?v=${encodeURIComponent(String(land.ground_m ?? ''))}-${(land.objects || []).length}` : null,
    photoUrl: photo_path ? `/api/lands/${land.id}/image/photo` : null,
  };
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  return { type: m[1], buffer: Buffer.from(m[2], 'base64') };
}

// ---------- health ----------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    keyConfigured: hasKey(),
    passcodeRequired: Boolean(env('APP_PASSCODE')),
    ttsConfigured: hasTtsKey(),
    dbConfigured: dbConfigured(),
    models: { ...MODELS, tts: TTS.model },
    demoPlaces: Object.fromEntries(Object.entries(DEMO_PLACES).map(([k, v]) => [k, v.label])),
  });
});

app.get('/api/db', guard, timed(async () => pingDb()));

app.get(
  '/api/models',
  guard,
  timed(async () => {
    const ids = await listModels();
    const needed = Object.values(MODELS);
    return {
      available: ids,
      needed: needed.map((id) => ({ id, accessible: ids.includes(id) })),
      allAccessible: needed.every((id) => ids.includes(id)),
    };
  })
);

// ---------- farmer app: lands ----------
app.post(
  '/api/lands',
  guard,
  timed(async (req) => {
    const { kind, lat, lon, place, photoDataUrl, lang } = req.body || {};
    if (!['empty', 'crop'].includes(kind)) throw new Error('kind must be "empty" or "crop"');
    let la = Number(lat);
    let lo = Number(lon);
    let source = 'gps';
    if (place && DEMO_PLACES[place]) {
      ({ lat: la, lon: lo } = DEMO_PLACES[place]);
      source = 'demo';
    }
    if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new Error('Location is required');

    const id = newId();
    const scan = await scanLand({ lat: la, lon: lo });
    const plot = scan.plot;

    const tileImg = dataUrlToBuffer(scan.image.dataUrl);
    await putFile(`${id}/tile.jpg`, tileImg.buffer, tileImg.type);
    let photoPath = null;
    const photo = dataUrlToBuffer(photoDataUrl);
    if (photo && photo.buffer.length < 8 * 1024 * 1024) {
      photoPath = await putFile(`${id}/photo.jpg`, photo.buffer, photo.type);
    }

    const land = await createLand({
      id,
      kind,
      lat: la,
      lon: lo,
      lang: ['bn', 'hi', 'en'].includes(lang) ? lang : 'bn',
      location_source: source,
      place: source === 'demo' ? place : null,
      acres: plot?.acres ?? null,
      selected_object: plot?.id ?? null,
      objects: scan.objects,
      ground_m: scan.image.groundMeters,
      image_px: scan.image.width,
      tile_path: `${id}/tile.jpg`,
      photo_path: photoPath,
    });
    return { land: landView(land), fields: scan.objects.length, samError: scan.sam.error, sam: scan.sam };
  })
);

// Runs the v0.3.1 scan again on a saved land (lands saved by v0.3.0 with 0 fields).
app.post(
  '/api/lands/:id/rescan',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const scan = await scanLand({ lat: land.lat, lon: land.lon });
    const img = dataUrlToBuffer(scan.image.dataUrl);
    await putFile(`${land.id}/tile.jpg`, img.buffer, img.type);
    const updated = await updateLand(land.id, {
      objects: scan.objects,
      selected_object: scan.plot?.id ?? null,
      acres: scan.plot?.acres ?? null,
      ground_m: scan.image.groundMeters,
      image_px: scan.image.width,
      tile_path: `${land.id}/tile.jpg`,
    });
    return { land: landView(updated), fields: scan.objects.length, samError: scan.sam.error, sam: scan.sam };
  })
);

app.get('/api/lands', guard, timed(async () => ({ lands: await listLands() })));

app.get(
  '/api/lands/:id',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    return { land: landView(land) };
  })
);

// The farmer taps a different field: it becomes their plot.
app.patch(
  '/api/lands/:id',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const sel = String(req.body?.selected ?? '');
    const obj = (land.objects || []).find((o) => String(o.id) === sel);
    if (!obj) throw new Error('That field is not on this map');
    const updated = await updateLand(land.id, { selected_object: obj.id, acres: obj.acres ?? null });
    return { land: landView(updated) };
  })
);

// The farmer deletes a land: the row first, then its pictures.
app.delete(
  '/api/lands/:id',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const deleted = await deleteLand(land.id);
    if (!deleted) throw new Error('Land could not be deleted');
    let filesRemoved = 0;
    let storageError = null;
    try {
      filesRemoved = await deleteFiles([land.tile_path, land.photo_path]);
    } catch (err) {
      storageError = err.message; // the land is gone; leftover pictures are only reported
    }
    return { deleted: true, id: land.id, filesRemoved, storageError };
  })
);

app.get('/api/lands/:id/image/:which', guard, async (req, res) => {
  try {
    if (!isId(req.params.id) || !['tile', 'photo'].includes(req.params.which)) return res.status(404).end();
    const land = await getLand(req.params.id);
    const p = land?.[req.params.which === 'tile' ? 'tile_path' : 'photo_path'];
    if (!p) return res.status(404).end();
    const file = await getFile(p);
    if (!file) return res.status(404).end();
    res.set('Content-Type', file.contentType).set('Cache-Control', 'private, max-age=86400').send(file.buffer);
  } catch {
    res.status(502).end();
  }
});

// ---------- farmer app: ask the agent (text from voice or a chip) ----------
app.post(
  '/api/ask',
  guard,
  timed(async (req) => {
    const { text, landId } = req.body || {};
    if (!text) throw new Error('text is required');
    let lat = DEMO_PLACES.bolpur.lat;
    let lon = DEMO_PLACES.bolpur.lon;
    let context = 'no plot added yet';
    let noField = false;
    if (landId) {
      const land = await getLand(landId);
      if (land && !(land.objects || []).length) {
        // No field outline at this spot (a town, a river, or a failed scan): no soil or crop advice.
        lat = land.lat;
        lon = land.lon;
        noField = true;
        context = 'NO FARM FIELD WAS FOUND in the satellite image at this spot, so its soil and size are unknown';
      } else if (land) {
        lat = land.lat;
        lon = land.lon;
        context = [
          land.kind === 'empty' ? 'the land is empty, nothing planted yet' : `there is a standing crop${land.crop ? ` (${land.crop})` : ''}`,
          land.acres ? `plot size about ${land.acres} acres (measured from satellite)` : 'plot size unknown',
        ].join('; ');
      }
    }
    return runAgent({ userText: String(text).slice(0, 2000), lat, lon, context, noField });
  })
);

app.get('/api/alerts', guard, timed(async () => ({ alerts: await listAlerts(5) })));

// ---------- model-check bench (/check/) ----------
app.post(
  '/api/agent',
  guard,
  timed(async (req) => {
    const { text, lat, lon } = req.body || {};
    if (!text) throw new Error('text is required');
    return runAgent({ userText: String(text).slice(0, 2000), lat: Number(lat), lon: Number(lon) });
  })
);

// Same scan the farmer app runs (zoomed pass first), for the bench.
app.get(
  '/api/scan',
  guard,
  timed(async (req) => {
    const scan = await scanLand({ lat: Number(req.query.lat), lon: Number(req.query.lon) });
    return { image: scan.image.dataUrl, imagePx: scan.image.width, objects: scan.objects, plot: scan.plot?.id ?? null, acres: scan.plot?.acres ?? null, sam: scan.sam };
  })
);

app.get(
  '/api/tile',
  guard,
  timed(async (req) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const half = Math.min(Math.max(Number(req.query.half) || 300, 100), 1500);
    return fetchSatelliteImage({ lat, lon, halfSideMeters: half });
  })
);

app.post(
  '/api/vision',
  guard,
  timed(async (req) => {
    const { imageDataUrl, question } = req.body || {};
    if (!imageDataUrl?.startsWith('data:image/')) throw new Error('imageDataUrl must be a data:image URL');
    const resp = await chat({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                question ||
                'This is a top-down satellite image of farmland. In 3 short bullet points: how many distinct fields you can see, what they appear to be (cropped, bare, flooded, orchard), and anything a farmer should check. Say clearly if you are unsure.',
            },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      maxTokens: 6000,
      effort: 'low',
    });
    const { text, finishReason } = messageText(resp);
    if (!text) throw new Error(`Muse Spark returned no text (finish_reason: ${finishReason || 'unknown'})`);
    return { text, finishReason, usage: resp.usage || null };
  })
);

app.post(
  '/api/segment',
  guard,
  timed(async (req) => {
    const { imageDataUrl, prompt } = req.body || {};
    if (!imageDataUrl?.startsWith('data:image/')) throw new Error('imageDataUrl must be a data:image URL');
    const phrase = String(prompt || 'farm field').slice(0, 80);
    const events = await segmentStream({ imageDataUrl, prompt: phrase });
    const result = await collectSegments(events);
    return { prompt: phrase, count: result.objects.length, ...result };
  })
);

app.post(
  '/api/transcribe',
  guard,
  express.raw({ type: ['audio/wav', 'audio/x-wav', 'application/octet-stream'], limit: '30mb' }),
  timed(async (req) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 44) throw new Error('No WAV audio received');
    const json = await transcribe(req.body);
    return { text: transcriptText(json), raw: json };
  })
);

app.post(
  '/api/speak',
  guard,
  timed(async (req) => {
    const text = String(req.body?.text || '');
    if (!text.trim()) throw new Error('text is required');
    const { wav, chars } = await synthesize(text);
    return {
      audioDataUrl: `data:audio/wav;base64,${wav.toString('base64')}`,
      chars,
      seconds: wav.length > 44 ? Math.round(((wav.length - 44) / 48000) * 10) / 10 : 0,
    };
  })
);

app.listen(PORT, () => {
  console.log(`Khet Saathi v${VERSION} on :${PORT} (meta key: ${hasKey()}, db: ${dbConfigured() ? 'supabase' : 'memory'})`);
});
