// Khet Saathi server: farmer app at /, model-check bench at /check/.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, hasKey, listModels, chat, messageText, transcribe, transcriptText, segmentStream } from './lib/meta.js';
import { collectSegments } from './lib/segment.js';
import { fetchSatelliteImage } from './lib/tile.js';
import { runAgent } from './lib/agent.js';
import { TTS, hasTtsKey, synthesize } from './lib/tts.js';
import { pickPlot, withAcres, DEMO_PLACES } from './lib/plot.js';
import {
  dbConfigured, isId, newId, createLand, listLands, getLand, updateLand, putFile, getFile, listAlerts, pingDb,
} from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '0.3.0';
const PLOT_HALF_SIDE_M = 300; // satellite view 600 m across, centred on the farmer
const PLOT_IMAGE_PX = 1024;

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Optional passcode so a public URL can't burn API credits.
// Images use ?k= because <img> tags can't send headers.
function guard(req, res, next) {
  const code = process.env.APP_PASSCODE;
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
    tileUrl: tile_path ? `/api/lands/${land.id}/image/tile` : null,
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
    passcodeRequired: Boolean(process.env.APP_PASSCODE),
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
    const tile = await fetchSatelliteImage({ lat: la, lon: lo, halfSideMeters: PLOT_HALF_SIDE_M, size: PLOT_IMAGE_PX });

    let objects = [];
    let samError = null;
    try {
      const events = await segmentStream({ imageDataUrl: tile.dataUrl, prompt: 'farm field' });
      const seg = await collectSegments(events, { point: { x: tile.width / 2, y: tile.height / 2 } });
      objects = withAcres(seg.objects, tile.groundMeters, tile.width).map((o) => ({
        id: o.id,
        box: o.box,
        confidence: o.confidence,
        acres: o.acres,
        containsPoint: o.containsPoint,
        mask: o.mask,
      }));
    } catch (err) {
      samError = err.message;
    }
    const plot = pickPlot(objects, { width: tile.width, height: tile.height });

    const tileImg = dataUrlToBuffer(tile.dataUrl);
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
      objects,
      ground_m: tile.groundMeters,
      image_px: tile.width,
      tile_path: `${id}/tile.jpg`,
      photo_path: photoPath,
    });
    return { land: landView(land), fields: objects.length, samError };
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
    if (landId) {
      const land = await getLand(landId);
      if (land) {
        lat = land.lat;
        lon = land.lon;
        context = [
          land.kind === 'empty' ? 'the land is empty, nothing planted yet' : `there is a standing crop${land.crop ? ` (${land.crop})` : ''}`,
          land.acres ? `plot size about ${land.acres} acres (measured from satellite)` : 'plot size unknown',
        ].join('; ');
      }
    }
    return runAgent({ userText: String(text).slice(0, 2000), lat, lon, context });
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
