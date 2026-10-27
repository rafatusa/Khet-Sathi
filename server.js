// Khet Saathi server: farmer app at /, model-check bench at /check/.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, hasKey, listModels, chat, messageText, transcribe, transcriptText, segmentStream, uploadFile, deleteFile, respond, responseText } from './lib/meta.js';
import { analyseFrames, framesFromSegments, observePrompt, parseObservation, MAX_FRAMES, SAFE_VET_LINE } from './lib/poultry.js';
import { readIndex, createClip, putClipVideo, getClip, clipFrames, clipVideo, saveResult, deleteClip, setToday, todayCamera, MAX_CLIPS } from './lib/clips.js';
import { collectSegments } from './lib/segment.js';
import { fetchSatelliteImage, zoomCenter } from './lib/tile.js';
import { scanLand } from './lib/scan.js';
import { buildPlan, localToday } from './lib/plan.js';
import { aezFor, calendarRecords, calendarFor } from './lib/calendar.js';
import { createEngine } from './lib/engine.js';
import { fieldDevice, SHED_DEVICE, latestByDevice, FIELD_METRICS, SHED_METRICS, isNight } from './lib/sensors.js';
import { env } from './lib/env.js';
import { runAgent } from './lib/agent.js';
import { TTS, hasTtsKey, synthesize } from './lib/tts.js';
import { DEMO_PLACES } from './lib/plot.js';
import {
  dbConfigured, isId, newId, createLand, listLands, getLand, updateLand, deleteLand, putFile, getFile, deleteFiles, listAlerts, pingDb,
  recentAlerts, insertAlerts, markAlertRead, insertReadings, latestReadings, listContacts, CLIP_BUCKET,
} from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = env('PORT', '3000');
const VERSION = '0.7.1';

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
  camera: todayCamera,
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

// ---------- poultry shed (video from the farmer's phone; sensors simulated) ----------
let lastShed = null; // latest count and observation, kept in memory for the shed screen

async function raiseShedAlert(title, body) {
  const recent = await recentAlerts(12).catch(() => []);
  if (recent.some((a) => !a.land_id && a.title === title)) return;
  await insertAlerts([{ land_id: null, area: 'shed', severity: 'warn', title, source: 'camera', body: JSON.stringify(body) }]).catch(() => null);
}

const shedHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

// SAM 3.1 on each frame (4 at a time), then count and still birds. Hens resting at night are normal.
async function countFrames(frameUrls, width) {
  const frames = frameUrls.filter((f) => typeof f === 'string' && f.startsWith('data:image/')).slice(0, MAX_FRAMES);
  if (frames.length < 2) throw new Error('Send at least 2 frames');
  const segs = [];
  for (let i = 0; i < frames.length; i += 4) {
    const batch = frames.slice(i, i + 4).map(async (f) => collectSegments(await segmentStream({ imageDataUrl: f, prompt: 'chicken' })));
    segs.push(...(await Promise.all(batch)));
  }
  const result = analyseFrames(framesFromSegments(segs, width));
  const hour = shedHour();
  const lightRow = latestByDevice(await latestReadings([SHED_DEVICE], 20).catch(() => []))[SHED_DEVICE]?.light;
  result.resting = isNight(hour) || (lightRow?.value === 0 && (hour < 6 || hour >= 18));
  return result;
}

// Muse Spark 1.2 watches the clip with its sound (Files API upload, deleted afterwards). Never a diagnosis.
async function observeVideo(buffer, lang) {
  const fileId = await uploadFile(buffer, 'shed.mp4', 'video/mp4');
  try {
    const json = await respond({ content: [{ type: 'input_text', text: observePrompt(lang) }, { type: 'input_file', file_id: fileId }] });
    return parseObservation(responseText(json));
  } finally {
    deleteFile(fileId).catch(() => null);
  }
}
const pickLang = (q) => (['bn', 'hi', 'en'].includes(q) ? q : 'bn');

// Frames (JPEG data URLs) pulled from the video by the phone. SAM finds every bird in each.
app.post(
  '/api/poultry/count',
  guard,
  timed(async (req) => {
    const result = await countFrames(req.body?.frames || [], Number(req.body?.width) || 1024);
    lastShed = { ...(lastShed || {}), count: result, countedAt: new Date().toISOString() };
    if (result.still.length && !result.resting) await raiseShedAlert('birds_still', { value: result.still.length });
    return result;
  })
);

// The whole clip, with its sound, for Muse Spark 1.2: behaviour and unusual sounds.
app.post(
  '/api/poultry/video',
  guard,
  express.raw({ type: ['video/mp4', 'video/quicktime', 'application/octet-stream'], limit: '60mb' }),
  timed(async (req) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new Error('No video received');
    const lang = pickLang(req.query.lang);
    const obs = await observeVideo(req.body, lang);
    lastShed = { ...(lastShed || {}), video: obs, videoAt: new Date().toISOString() };
    if (obs.unusualSound) await raiseShedAlert('sound_unusual', {});
    return { observation: obs, vetLine: SAFE_VET_LINE[lang], model: MODELS.media };
  })
);

// ---------- saved shed clips: the simulated shed camera (v0.7.1) ----------
app.get('/api/clips', guard, timed(async () => ({ ...(await readIndex()), max: MAX_CLIPS })));

// Step 1: name + frames (from the phone). Step 2: PUT the video. Step 3: check.
app.post(
  '/api/clips',
  guard,
  timed(async (req) => ({ clip: await createClip(req.body || {}) }))
);

app.put(
  '/api/clips/:id/video',
  guard,
  express.raw({ type: ['video/mp4', 'video/quicktime', 'application/octet-stream'], limit: '50mb' }),
  timed(async (req) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new Error('No video received');
    return { clip: await putClipVideo(req.params.id, req.body, req.get('content-type')) };
  })
);

// Runs SAM on the saved frames and Spark on the saved video, and keeps the result with the clip.
app.post(
  '/api/clips/:id/check',
  guard,
  timed(async (req) => {
    const clip = await getClip(req.params.id);
    if (!clip) throw new Error('Clip not found');
    const lang = pickLang(req.query.lang);
    const count = await countFrames(await clipFrames(clip), clip.width);
    let observation = null;
    let videoError = null;
    const video = await clipVideo(clip);
    if (video) {
      try {
        observation = await observeVideo(video.buffer, lang);
      } catch (err) {
        videoError = err.message;
      }
    }
    const saved = await saveResult(clip.id, { count, observation, videoError, lang });
    const index = await readIndex();
    if (index.todayId === clip.id) engine.run().catch(() => null); // today's camera: raise its warnings now
    return { clip: saved, vetLine: SAFE_VET_LINE[lang] };
  })
);

app.post(
  '/api/clips/:id/today',
  guard,
  timed(async (req) => {
    const index = await setToday(req.body?.on ? req.params.id : null);
    if (index.todayId) engine.run().catch(() => null);
    return index;
  })
);

app.delete(
  '/api/clips/:id',
  guard,
  timed(async (req) => ({ deleted: await deleteClip(req.params.id) }))
);

// Frames of a saved clip, for the shed screen.
app.get('/api/clips/:id/frame/:n', guard, async (req, res) => {
  try {
    const clip = await getClip(req.params.id);
    const n = Number(req.params.n);
    if (!clip || !Number.isInteger(n) || n < 0 || n >= clip.frames) return res.status(404).end();
    const f = await getFile(`${clip.id}/f${n}.jpg`, CLIP_BUCKET);
    if (!f) return res.status(404).end();
    res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'private, max-age=86400').send(f.buffer);
  } catch {
    res.status(502).end();
  }
});

// A sound clip only (WAV), for Muse Spark 1.2 audio input.
app.post(
  '/api/poultry/sound',
  guard,
  express.raw({ type: ['audio/wav', 'audio/x-wav', 'application/octet-stream'], limit: '30mb' }),
  timed(async (req) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 44) throw new Error('No sound received');
    const lang = ['bn', 'hi', 'en'].includes(req.query.lang) ? req.query.lang : 'bn';
    const resp = await chat({
      model: MODELS.media,
      maxTokens: 4000,
      messages: [{ role: 'user', content: [
        { type: 'text', text: observePrompt(lang, { withVideo: false }) },
        { type: 'input_audio', input_audio: { data: req.body.toString('base64'), format: 'wav' } },
      ] }],
    });
    const obs = parseObservation(messageText(resp).text);
    lastShed = { ...(lastShed || {}), sound: obs, soundAt: new Date().toISOString() };
    if (obs.unusualSound) await raiseShedAlert('sound_unusual', {});
    return { observation: obs, vetLine: SAFE_VET_LINE[lang], model: MODELS.media };
  })
);

// Shed screen: latest simulated shed kit, last camera results, the (simulated) vet.
app.get(
  '/api/poultry',
  guard,
  timed(async () => {
    const latest = latestByDevice(await latestReadings([SHED_DEVICE], 30));
    const shed = latest[SHED_DEVICE] ? Object.fromEntries(SHED_METRICS.filter((m) => latest[SHED_DEVICE][m]).map((m) => [m, latest[SHED_DEVICE][m]])) : null;
    const vets = await listContacts('vet').catch(() => []);
    return { shed, simulated: true, last: lastShed, vet: vets[0] || null, eggTarget: 300 };
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
