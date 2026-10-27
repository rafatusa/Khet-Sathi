// Khet Saathi server: farmer app at /, model-check bench at /check/.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, hasKey, listModels, chat, messageText, transcribe, transcriptText, segmentStream } from './lib/meta.js';
import { collectSegments } from './lib/segment.js';
import { fetchSatelliteImage, zoomCenter } from './lib/tile.js';
import { scanLand } from './lib/scan.js';
import { buildPlan, localToday } from './lib/plan.js';
import { aezFor, calendarRecords, calendarFor } from './lib/calendar.js';
import { createEngine } from './lib/engine.js';
import { fieldDevice, SHED_DEVICE, latestByDevice, FIELD_METRICS, SHED_METRICS } from './lib/sensors.js';
import { env } from './lib/env.js';
import { runAgent } from './lib/agent.js';
import { TTS, hasTtsKey, synthesize } from './lib/tts.js';
import { DEMO_PLACES } from './lib/plot.js';
import {
  dbConfigured, isId, newId, createLand, listLands, getLand, updateLand, deleteLand, putFile, getFile, deleteFiles, listAlerts, pingDb,
  recentAlerts, insertAlerts, markAlertRead, insertReadings, latestReadings,
} from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = env('PORT', '3000');
const VERSION = '0.6.0';

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

// What to grow: real soil, weather and sowing windows for this land, plus the top crops.
// Soil and farming zone are saved on the land the first time, so SoilGrids runs once per land.
async function planForLand(land) {
  const plan = await buildPlan(land);
  if (plan.soilFresh || (plan.aez && land.aez !== plan.aez)) {
    try {
      await updateLand(land.id, { soil: plan.soil, aez: plan.aez });
    } catch (err) {
      plan.saveError = err.message; // shown on the bench; the plan itself is still returned
    }
  }
  return plan;
}

app.get(
  '/api/lands/:id/plan',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    if (!(land.objects || []).length) throw new Error('No farm field was found on this land');
    return { plan: await planForLand(land) };
  })
);

// Crop calendar: every crop's sowing and harvest window for the land's FAO zone.
// Uses the given land, else the newest land in Bangladesh, else the Bogura demo zone.
app.get(
  '/api/calendar',
  guard,
  timed(async (req) => {
    let land = req.query.landId ? await getLand(req.query.landId) : null;
    if (!land) {
      for (const l of await listLands()) {
        if (aezFor(l).aez) {
          land = l;
          break;
        }
      }
    }
    if (!land) land = { place: 'bogura', ...DEMO_PLACES.bogura };
    const { aez, assumed } = aezFor(land);
    const today = localToday('Asia/Dhaka');
    if (!aez) return { aez: null, place: land.place || null, today, rows: [] };
    const cal = await calendarRecords();
    return {
      aez,
      aezAssumed: assumed,
      place: land.place || null,
      landId: land.id || null,
      today,
      rows: calendarFor(cal.records, aez, today),
      source: cal.source,
    };
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
    // No land picked yet: answer for the Bogura demo plot (the Scenario 1 plot with full data).
    let lat = DEMO_PLACES.bogura.lat;
    let lon = DEMO_PLACES.bogura.lon;
    let context = 'no plot added yet';
    let noField = false;
    let plan = null;
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
        plan = await planForLand(land).catch(() => null);
        context = [
          land.kind === 'empty' ? 'the land is empty, nothing planted yet' : `there is a standing crop${land.crop ? ` (${land.crop})` : ''}`,
          land.acres ? `plot size about ${land.acres} acres (measured from satellite)` : 'plot size unknown',
        ].join('; ');
      }
    }
    if (!landId) plan = await buildPlan({ lat, lon, place: 'bogura' }).catch(() => null);
    return runAgent({ userText: String(text).slice(0, 2000), lat, lon, context, noField, plan });
  })
);

// ---------- alerts + simulated village sensor kit ----------
const engine = createEngine({
  store: { listLands, getLand, latestReadings, insertReadings, recentAlerts, insertAlerts },
  planForLand,
  log: (m) => console.log(m),
});
const ENGINE_EVERY_MS = 10 * 60 * 1000;
setTimeout(() => engine.run().catch((e) => console.error('engine', e.message)), 30000).unref();
setInterval(() => engine.run().catch((e) => console.error('engine', e.message)), ENGINE_EVERY_MS).unref();

async function newestFieldLand() {
  for (const l of await listLands()) {
    const full = await getLand(l.id).catch(() => null);
    if (full && (full.objects || []).length) return full;
  }
  return null;
}

// Home: unread alerts, newest first. Runs the engine first if it has not run in 2 minutes.
app.get(
  '/api/alerts',
  guard,
  timed(async () => {
    await engine.runIfStale().catch(() => null);
    return { alerts: await listAlerts(8), engine: engine.status() };
  })
);

app.post(
  '/api/alerts/:id/read',
  guard,
  timed(async (req) => ({ read: await markAlertRead(req.params.id) }))
);

// Latest kit readings for the newest field and the shed (Home card and bench).
app.get(
  '/api/sensors',
  guard,
  timed(async () => {
    const land = await newestFieldLand();
    const device = land ? fieldDevice(land.id) : null;
    const latest = latestByDevice(await latestReadings([device, SHED_DEVICE].filter(Boolean), 60));
    const pick = (dev, metrics) => (latest[dev] ? Object.fromEntries(metrics.filter((m) => latest[dev][m]).map((m) => [m, latest[dev][m]])) : null);
    return {
      simulated: true,
      land: land ? { id: land.id, place: land.place } : null,
      field: device ? pick(device, FIELD_METRICS) : null,
      shed: pick(SHED_DEVICE, SHED_METRICS),
      engine: engine.status(),
    };
  })
);

// Bench: one simulator tick now.
app.post('/api/sensors/tick', guard, timed(async () => ({ summary: await engine.run() })));

// Bench demo control: hold one reading out of range for two ticks so an alert fires on camera.
app.post(
  '/api/sensors/force',
  guard,
  timed(async (req) => {
    const { target, metric, value } = req.body || {};
    const allowed = target === 'shed' ? SHED_METRICS : FIELD_METRICS;
    if (!allowed.includes(metric)) throw new Error(`metric must be one of ${allowed.join(', ')}`);
    if (!Number.isFinite(Number(value))) throw new Error('value must be a number');
    let device = SHED_DEVICE;
    if (target !== 'shed') {
      const land = await newestFieldLand();
      if (!land) throw new Error('Add a land with a field first');
      device = fieldDevice(land.id);
    }
    return { device, summary: await engine.force(device, metric, Number(value)) };
  })
);

// ---------- model-check bench (/check/) ----------
app.post(
  '/api/agent',
  guard,
  timed(async (req) => {
    const { text, lat, lon } = req.body || {};
    if (!text) throw new Error('text is required');
    const plan = await buildPlan({ lat: Number(lat), lon: Number(lon) }).catch(() => null);
    return runAgent({ userText: String(text).slice(0, 2000), lat: Number(lat), lon: Number(lon), plan });
  })
);

// Soil, weather and crop calendar for any point (or a demo place), for the bench.
app.get(
  '/api/plan',
  guard,
  timed(async (req) => {
    const place = DEMO_PLACES[req.query.place] ? req.query.place : null;
    const lat = place ? DEMO_PLACES[place].lat : Number(req.query.lat);
    const lon = place ? DEMO_PLACES[place].lon : Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('lat and lon are required');
    return { plan: await buildPlan({ lat, lon, place }) };
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
