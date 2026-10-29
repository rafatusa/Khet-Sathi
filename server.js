// Khet Sathi server: landing page and farmer app at /, admin model checks in the Settings tab.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, hasKey, listModels, chat, messageText, transcribe, transcriptText, segmentStream, uploadFile, deleteFile, respond, responseText } from './lib/meta.js';
import { analyseFrames, framesFromSegments, observePrompt, parseObservation, MAX_FRAMES, SAFE_VET_LINE, safeText } from './lib/poultry.js';
import { autoSigns, vetMessage, vetScript, withNames, cleanCall, parseDeaths, parseSince, SIGN_CODES } from './lib/vetcall.js';
import { DEFAULT_RULE, TRAY, cleanRule, sellDue, planDeal, shopPrompt, voiceDeal, parseLines, rankOffers } from './lib/sell.js';
import { withNames as namesOf } from './lib/names.js';
import { readIndex, createClip, putClipVideo, getClip, clipFrames, clipVideo, saveResult, deleteClip, setToday, todayCamera, MAX_CLIPS, setClipNames, setClipNotes } from './lib/clips.js';
import { threeNames, threeNotes } from './lib/translate.js';
import { shedFacts, shedAnswer } from './lib/shedchat.js';
import { collectSegments } from './lib/segment.js';
import { fetchSatelliteImage, zoomCenter } from './lib/tile.js';
import { scanLand } from './lib/scan.js';
import { buildPlan, localToday, placeForLand, wxKey } from './lib/plan.js';
import { aezFor, calendarRecords, calendarFor } from './lib/calendar.js';
import { createEngine } from './lib/engine.js';
import { fieldDevice, SHED_DEVICE, latestByDevice, FIELD_METRICS, SHED_METRICS, isNight, eggsPerDay } from './lib/sensors.js';
import { env } from './lib/env.js';
import { runAgent } from './lib/agent.js';
import { TTS, hasTtsKey, synthesize } from './lib/tts.js';
import { brainChat, openChat, hasOpenKey, OPEN } from './lib/brain.js';
import { fieldHealth } from './lib/sentinel.js';
import { fieldPolygonM, areaAcres } from './lib/fieldgeo.js';
import { DEMO_PLACES } from './lib/plot.js';
import { nearbyShops, currencyFor } from './lib/place.js';
import { needsFor, orderCalls, DEMO_SHOP, DEMO_CREW } from './lib/market.js';
import { sowingFromPasses, rowFor, readiness, harvestAmount, unitFor, samplePrice, DEMO_BUYERS, planCropDeal, voiceCropDeal, cleanCropRule, priceText, digitsFor, unitName } from './lib/harvest.js';
import {
  dbConfigured, isId, newId, createLand, listLands, getLand, updateLand, deleteLand, putFile, getFile, deleteFiles, listAlerts, pingDb,
  recentAlerts, insertAlerts, markAlertRead, insertReadings, latestReadings, listContacts, CLIP_BUCKET, getSellRule, saveSellRule, insertDeal, listDeals,
  listSheds, createShed, metricHistory, demoTemplates, farmCounts, moveLand,
  listYards, getYard, createYard, updateYard, deleteYard,
  listMissions, getMission, dueMissions, openMissionFor, saveMission, getWatchMode, setWatchMode, DEFAULT_SHED,
} from './lib/store.js';
import { powerDaily, heatStage, GDD_CROPS } from './lib/agroclimate.js';
import { classify as camClassify, measureLook, trend as camTrend, readLooks, saveLooks, addLook, lookPhoto, lookView, demoDates } from './lib/fieldcam.js';
import { missionFrom, runMission, translateSteps, decide as decideWatch, missionView, TRIGGERS as WATCH_TRIGGERS, MODES as WATCH_MODES, DEFAULT_MODE as DEFAULT_WATCH_MODE } from './lib/watch.js';
import sharp from 'sharp';
import { unitsFor, sizeToM2, sizeWords, sizeClass, pickPlants, shoppingList, waterTip, meanTemp, outlineYard, SOUTH_ASIA } from './lib/yard.js';
import { officeHelp } from './lib/office.js';
import { measureProblem } from './lib/problem.js';
import { loadLeaf, saveLeaf, leafPhoto, retryLeaf } from './lib/demoleaf.js';
import { fetchWeather } from './lib/weather.js';
import { withKeep, recall, remember } from './lib/keep.js';
import { relayInfo } from './lib/meta.js';
import { checkNumbers, factsFrom } from './lib/numcheck.js';
import { reverseGeocode } from './lib/place.js';
import { runAs, currentOwner, currentScope, scopeFor, isAdmin, userFromToken, sendCode, verifyCode, refreshSession, signOut, useLimit, LIMITS, usageToday, listUsers, seenUsers } from './lib/auth.js';
import { runChecks } from './lib/checks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = env('PORT', '3000');
const VERSION = '0.25.1';

app.use(express.json({ limit: '15mb' }));
// v0.11.0: the new app is the main app at /; the classic app stays at /classic/ as a backup.
const PUB = path.join(__dirname, 'public');
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(PUB, 'app.html')));
// v0.15.1: each tab has its own address; they all open the same app, which shows that tab.
app.get(['/home', '/sathi', '/field', '/shed', '/market', '/money', '/settings', '/guide'], (req, res) => res.sendFile(path.join(PUB, 'app.html')));
// v0.17.0: browsers ask for /favicon.ico on their own; the app's icon answers.
// v0.21.0: the guide for browser agents (Meta's Muse and others); /llms.txt is served from public/ as it is.
app.get('/for-agents', (req, res) => res.sendFile(path.join(PUB, 'for-agents.html')));
app.get('/favicon.ico', (req, res) => res.type('image/png').sendFile(path.join(PUB, 'icons', 'favicon-32.png')));
// The service worker must come from the site root to look after the whole app, and must never be cached stale.
app.get('/sw.js', (req, res) => res.set('Cache-Control', 'no-cache').type('application/javascript').sendFile(path.join(PUB, 'sw.js')));
app.get(['/next', '/next/', '/next/index.html'], (req, res) => res.redirect(302, '/'));
// Express matches /classic and /classic/ alike, so one route tells them apart (relative links need the slash).
// v0.14.0: the model bench page is retired; the checks live in the admin Settings tab.
app.get(['/check', '/check/', '/check/index.html'], (req, res) => res.redirect(302, '/'));
// v0.13.0: the classic app (shared passcode) is retired; its address opens the app.
app.get(['/classic', '/classic/', '/classic.html'], (req, res) => res.redirect(302, '/'));
app.use(express.static(PUB));

// v0.13.0: every /api route (except health and sign-in) needs a signed-in farm. The token comes in the
// Authorization header, or as ?t= on GET media links (pictures and video), which cannot send headers.
// The request then runs as that farm: the store only reads and writes its rows.
async function guard(req, res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.method === 'GET' ? String(req.query.t || '') : '';
  const user = await userFromToken(token).catch(() => null);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first', signIn: true });
  // v0.14.0: the demo farm (X-View: demo) or, for an admin, someone's farm (X-View: farm:<id>), read only.
  const view = req.get('x-view') || (req.method === 'GET' ? String(req.query.view || '') : '');
  const scope = scopeFor(user, view);
  if (scope.readOnly && req.method !== 'GET' && !readOnlyAllowed(req, scope)) {
    return res.status(200).json({ ok: false, readOnly: true, error: scope.mode === 'demo' ? 'This is the demo farm, so nothing is saved' : 'Read only: this is someone else\'s farm' });
  }
  req.user = user;
  req.scope = scope;
  return runAs(user, next, scope);
}
// Read-only visitors may still talk to Sathi and, in the demo farm, play the demo calls (nothing is saved).
const RO_TALK = /^\/api\/(ask|ask\/stream|speak|transcribe|vet\/message|problem\/measure)$/;
const RO_DEMO_CALLS = /^\/api\/(vet\/call|sell\/run|lands\/[^/]+\/(order|harvest\/run|harvest\/book)|watch\/[^/]+\/decide)$/; // v0.22.0: a visitor's tap on Sathi's question (nothing saved)
function readOnlyAllowed(req, scope) {
  const p = req.path;
  if (RO_TALK.test(p)) return true;
  return scope.mode === 'demo' && RO_DEMO_CALLS.test(p);
}
// Demo calls in the demo farm count against a small daily cap per person (they cost voice generation).
function demoCallCap(req, res, next) {
  if (req.scope?.mode === 'demo' && req.scope.readOnly && RO_DEMO_CALLS.test(req.path)) {
    try {
      runAs(req.user, () => useLimit('demoCall'), req.scope);
    } catch (err) {
      return res.status(200).json({ ok: false, error: err.message });
    }
  }
  return next();
}
// Admin-only routes: the Settings tab and the model bench.
function adminOnly(req, res, next) {
  if (!req.scope?.admin) return res.status(200).json({ ok: false, adminOnly: true, error: 'For admins only' });
  return next();
}

// Wraps a handler so every response has { ok, ms, ... }.
function timed(handler) {
  return async (req, res) => {
    const t0 = Date.now();
    try {
      // Runs as the signed-in farm again: a body parser (video upload) can drop the async context.
      const data = await runAs(req.user || null, () => handler(req), req.scope || null);
      res.json({ ok: true, ms: Date.now() - t0, ...data });
    } catch (err) {
      // v0.20.0: failed requests are logged in Railway too (method, path, time, error; never the farm's email).
      if (!err?.limit) console.log(`api FAIL ${req.method} ${req.path} ${((Date.now() - t0) / 1000).toFixed(1)} s: ${String(err?.message || err).slice(0, 300)}`);
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
    openWeights: { configured: hasOpenKey(), model: OPEN.model, host: 'Baseten' },
    signIn: 'email code',
    ttsConfigured: hasTtsKey(),
    dbConfigured: dbConfigured(),
    models: { ...MODELS, tts: TTS.model },
    demoPlaces: Object.fromEntries(Object.entries(DEMO_PLACES).map(([k, v]) => [k, v.label])),
  });
});

app.get('/api/db', guard, adminOnly, timed(async () => pingDb()));

// ---------- sign-in (v0.13.0): email + 6-digit code, no password, no link ----------
app.post('/api/auth/send', timed(async (req) => sendCode(req.body?.email)));
app.post('/api/auth/verify', timed(async (req) => ({ session: await verifyCode(req.body?.email, req.body?.code) })));
app.post('/api/auth/refresh', timed(async (req) => ({ session: await refreshSession(req.body?.refresh_token) })));
app.post('/api/auth/signout', timed(async (req) => signOut(String(req.get('authorization') || '').replace(/^Bearer /, ''))));
app.get('/api/auth/me', guard, timed(async (req) => ({ email: req.user.email, admin: isAdmin(req.user), limits: LIMITS })));

// v0.14.0: a person's farm holds only their own real places. The demo places (no owner) live in the
// demo farm: the admin makes and edits them there, everyone else can watch it read only.

// ---------- admin: the Settings tab ----------
app.get(
  '/api/admin/overview',
  guard,
  adminOnly,
  timed(async () => {
    const [users, counts, demo] = await Promise.all([listUsers().catch((e) => ({ error: e.message })), farmCounts(), runAs(null, () => demoTemplates())]);
    const list = Array.isArray(users) ? users : [];
    const farms = list
      .map((u) => ({
        id: u.id,
        email: u.email,
        admin: isAdmin(u),
        lands: counts.lands[u.id] || 0,
        sheds: counts.sheds[u.id] || 0,
        deals: counts.deals[u.id] || 0,
        lastActive: seenUsers.get(u.id) ? new Date(seenUsers.get(u.id).at).toISOString() : u.lastSignIn || null,
      }))
      .sort((a, b) => String(b.lastActive || '').localeCompare(String(a.lastActive || '')));
    const day = new Date().toISOString().slice(0, 10);
    const usage = usageToday();
    const emailOf = Object.fromEntries(list.map((u) => [u.id, u.email]));
    for (const k of Object.keys(usage.top)) usage.top[k] = { ...usage.top[k], email: emailOf[usage.top[k].owner] || null, owner: undefined };
    return {
      farms,
      usersError: Array.isArray(users) ? null : users.error,
      signedInToday: farms.filter((f) => String(f.lastActive || '').startsWith(day)).length,
      usage,
      demoPlaces: demo.map((l) => ({ id: l.id, place: l.place, place_info: l.place_info || null, crop: l.crop, kind: l.kind, sown_on: l.sown_on || null, acres: l.acres })),
    };
  })
);
app.get('/api/admin/checks', guard, adminOnly, timed(async (req) => runChecks({ force: req.query.run === '1' })));
// Moves one of the admin's own lands into the demo farm, or a demo land back into the admin's farm.
app.post(
  '/api/admin/demo/:id',
  guard,
  adminOnly,
  timed(async (req) => ({ land: landView(await runAs(null, () => moveLand(req.params.id, { toDemo: req.body?.toDemo !== false, owner: req.user.id }))) }))
);

app.get(
  '/api/models',
  guard,
  adminOnly,
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
      // v0.14.0: demo places are made only by an admin inside the demo farm; a person's farm is real places only.
      if (currentScope()?.mode !== 'demo') throw new Error('Demo places are made by the admin in the demo farm. Add your own field with your location or a photo');
      ({ lat: la, lon: lo } = DEMO_PLACES[place]);
      source = 'demo';
    }
    if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new Error('Location is required');
    useLimit('scan');

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
    useLimit('scan');
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

app.get(
  '/api/lands',
  guard,
  timed(async () => {
    return { lands: await listLands() };
  })
);

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
    // v0.10.0: the farmer picks the crop for this land's season (a FAO crop key, or null to clear).
    if (req.body && 'crop' in req.body && !('selected' in req.body)) {
      const crop = req.body.crop == null ? null : String(req.body.crop);
      if (crop !== null && !/^[a-z_]{2,30}$/.test(crop)) throw new Error('Unknown crop');
      const patch = { crop };
      // v0.12.0: "something is growing": the land becomes a crop land with its sowing date (or null = estimate it).
      if (req.body.kind === 'crop' || req.body.kind === 'empty') patch.kind = req.body.kind;
      if ('sown_on' in req.body) {
        const d = req.body.sown_on == null ? null : String(req.body.sown_on);
        if (d !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T12:00:00Z`)) || new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) !== d)) throw new Error('Sowing date must be a real date (YYYY-MM-DD)');
        if (d !== null && d > localToday('Asia/Dhaka')) throw new Error('Sowing date cannot be in the future');
        patch.sown_on = d;
      }
      // A built-up or water spot never gets a crop (v0.11.0 place check).
      if (patch.kind === 'crop' && ['built', 'water'].includes(land.place_info?.verdict)) throw new Error('This spot looks like a built-up area or water, so no crop can be tracked here');
      try {
        return { land: landView(await updateLand(land.id, patch)) };
      } catch (err) {
        if (/sown_on/.test(err.message)) throw new Error('Run SQL 006 in Supabase first to save the sowing date');
        throw err;
      }
    }
    const sel = String(req.body?.selected ?? '');
    const obj = (land.objects || []).find((o) => String(o.id) === sel);
    if (!obj) throw new Error('That field is not on this map');
    const updated = await updateLand(land.id, { selected_object: obj.id, acres: obj.acres ?? null });
    return { land: landView(updated) };
  })
);

// What to grow: real soil, weather and sowing windows for this land, plus the top crops.
// Soil and farming zone are saved on the land the first time, so SoilGrids runs once per land.
// v0.12.0: Home asks for the plan and the harvest at once; both share one build (2 minutes), so the
// place check never sends OpenStreetMap two requests in the same second.
const planJobs = new Map();
function planForLand(land) {
  const key = `${land.id}|${land.lat},${land.lon}|${(land.objects || []).length}`;
  const hit = planJobs.get(key);
  if (hit && Date.now() - hit.at < 120000) return hit.job;
  const job = buildPlanForLand(land).catch((err) => {
    planJobs.delete(key);
    throw err;
  });
  planJobs.set(key, { at: Date.now(), job });
  if (planJobs.size > 200) planJobs.delete(planJobs.keys().next().value);
  return job;
}
async function buildPlanForLand(land) {
  const plan = await buildPlan(land);
  if (plan.soilFresh || (plan.aez && land.aez !== plan.aez)) {
    try {
      await updateLand(land.id, { soil: plan.soil, aez: plan.aez });
    } catch (err) {
      plan.saveError = err.message; // shown on the bench; the plan itself is still returned
    }
  }
  // v0.11.0: the place check is kept on the land (needs SQL 005; without it the check reruns, cached in memory).
  if (plan.placeFresh && plan.place && !plan.place.error) {
    land.place_info = plan.place;
    await updateLand(land.id, { place_info: plan.place }).catch((err) => (plan.placeSaveError = err.message));
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

// Field health from Sentinel-2 (v0.10.0): real NDVI for the field outline, every pass in 150 days.
// Cached for 6 hours per land and outline; the first load reads up to 20 passes (a few seconds).
const healthCache = new Map();
async function healthFor(land, fresh = false) {
  const outline = fieldPolygonM(land);
  const rings = outline || [[[-30, -30], [30, -30], [30, 30], [-30, 30]]]; // no outline: 60 m around the point
  const key = `${land.id}|${land.selected_object}|${(land.objects || []).length}`;
  const hit = healthCache.get(key);
  let health = hit && Date.now() - hit.at < 6 * 3600 * 1000 ? hit.health : null;
  if (!health || fresh) {
    // v0.19.0: if Sentinel-2 does not answer, the last good reading for this field is shown, marked with its time.
    const k = await withKeep(`ndvi|${key}`, () => fieldHealth({ lat: land.lat, lon: land.lon, rings, today: localToday('Asia/Dhaka') }), {
      persist: land.location_source === 'demo',
      // Good: a clear reading, or every pass read without an error (a field can just be cloudy).
      ok: (h) => Boolean(h && (h.passes || []).length && (h.latest || h.passes.every((p) => !p.error))),
      maxAgeMs: 10 * 864e5,
    }).catch((err) => (hit ? { value: hit.health, staleAt: new Date(hit.at).toISOString() } : Promise.reject(err)));
    health = k.staleAt ? { ...k.value, staleAt: k.staleAt } : k.value;
    if (!k.staleAt) healthCache.set(key, { at: Date.now(), health });
  }
  return { outline, rings, health };
}
app.get(
  '/api/lands/:id/field',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const { outline, rings, health } = await healthFor(land, req.query.fresh === '1');
    return { outline: rings, outlineFound: Boolean(outline), outlineAcres: Math.round(areaAcres(rings) * 100) / 100, groundM: land.ground_m, imagePx: land.image_px, health };
  })
);

// ---------- a growing crop (v0.12.0): readiness, amount, booking the harvest, selling it ----------
async function harvestState(land) {
  if (!land.crop) throw new Error('Pick the crop that is growing first');
  const [plan, { health }] = await Promise.all([
    (land.objects || []).length ? planForLand(land).catch(() => null) : null,
    healthFor(land).catch(() => ({ health: null })),
  ]);
  const today = plan?.today || localToday('Asia/Dhaka');
  const passes = health?.passes || [];
  const estimated = !land.sown_on;
  const sownOn = land.sown_on || sowingFromPasses(passes, today) || null;
  const currency = plan?.currency || land.place_info?.currency || currencyFor(land.place_info?.cc);
  const cc = plan?.place?.cc || land.place_info?.cc || null;
  const demo = land.location_source === 'demo';
  const unit = unitFor(cc);
  const ready = sownOn ? readiness({ crop: land.crop, sownOn, today, row: rowFor(plan?.growCalendar?.length ? plan.growCalendar : plan?.calendar, land.crop, sownOn), passes }) : null;
  const amount = harvestAmount({ cc, crop: land.crop, acres: land.acres });
  return { land, plan, today, sownOn, estimated, ready, amount, unit, currency, demo, cc, price: demo ? samplePrice({ crop: land.crop, unit, currency }) : null };
}

app.get(
  '/api/lands/:id/harvest',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const s = await harvestState(land);
    // Real buyers only when the Market asks (v0.13.0), so opening Home does not spend a shop search.
    let buyers = { shops: [] };
    if (req.query.buyers === '1') {
      useLimit('shops');
      buyers = await nearbyShops(Number(land.lat), Number(land.lon), { kind: 'buyers', cropText: land.crop, radiusKm: 20 }).catch(() => ({ shops: [], error: 'Buyer search did not answer' }));
    }
    const rule = land.sell_rule || null;
    return {
      crop: land.crop,
      sownOn: s.sownOn,
      estimated: s.estimated,
      ready: s.ready,
      amount: s.amount,
      unit: s.unit,
      currency: s.currency,
      demoLand: s.demo,
      samplePrice: s.price,
      rule,
      buyers: buyers.shops,
      buyerSource: buyers.source || null,
      buyerError: buyers.error || null,
      demoBuyers: s.demo ? DEMO_BUYERS.map((b) => ({ id: b.id, name: b.name })) : [],
      simulated: s.demo,
    };
  })
);

app.post(
  '/api/lands/:id/harvest/rule',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const rule = cleanCropRule(req.body || {}, land.sell_rule || {});
    try {
      await updateLand(land.id, { sell_rule: rule });
    } catch (err) {
      if (/sell_rule/.test(err.message)) throw new Error('Run SQL 006 in Supabase first to save the selling rule');
      throw err;
    }
    return { rule };
  })
);

// Demo lands only: Sathi bargains with the fictional demo buyers by fixed rules. Real lands: coming soon.
app.post(
  '/api/lands/:id/harvest/run',
  guard,
  demoCallCap,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    if (land.location_source !== 'demo' || req.body?.buyer?.real) return { comingSoon: true, simulated: false };
    const s = await harvestState(land);
    const L = pickLang(req.body?.lang);
    const rule = land.sell_rule || { floor_price: Math.round((s.price * 0.97) / 10) * 10, qty: s.amount?.units || 1, ask_first: true };
    const qty = rule.qty || s.amount?.units || 1;
    const cropName = String(req.body?.cropName || land.crop).slice(0, 40);
    const shops = DEMO_BUYERS.map((b) => {
      const plan = planCropDeal({ buyer: b, base: s.price, floor: Number(rule.floor_price), lang: L });
      return { contact_id: b.id, name: b.name[L], names: b.name, turns: voiceCropDeal(plan, { lang: L, qty, unit: s.unit, cropName, currency: s.currency }), price: plan.price, best: plan.best, pickup: plan.pickup };
    });
    const ranked = rankOffers(shops).map((x) => x.contact_id);
    const run = { id: newId(), at: new Date().toISOString(), lang: L, qty, unit: s.unit, floor: Number(rule.floor_price), currency: s.currency, status: 'open', shops, ranked };
    await updateLand(land.id, { sell_rule: { ...rule, last_run: run } }).catch(() => null);
    return { run, simulated: true };
  })
);

app.post(
  '/api/lands/:id/harvest/confirm',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const run = land.sell_rule?.last_run;
    if (!run || run.id !== req.body?.runId || run.status !== 'open') throw new Error('These offers are no longer open; call the buyers again');
    const shop = run.shops.find((x) => x.contact_id === req.body?.buyerId);
    if (!shop?.price) throw new Error('This buyer did not reach your lowest price');
    const total = Math.round(shop.price * run.qty);
    const deal = await insertDeal({
      land_id: land.id,
      direction: 'sell',
      items: [{ item: 'harvest', crop: land.crop, qty: run.qty, unit: run.unit.key, price: shop.price, currency: run.currency.code, symbol: run.currency.symbol, shop: shop.name, pickup: shop.pickup, simulated: true }],
      total_inr: total,
      status: 'confirmed',
    });
    await updateLand(land.id, { sell_rule: { ...land.sell_rule, last_run: { ...run, status: 'sold', soldTo: shop.contact_id } } }).catch(() => null);
    return { deal, total, simulated: true };
  })
);

// Book the harvester or transport. Demo lands: a scripted demo call with the demo crew. Real lands: coming soon.
app.post(
  '/api/lands/:id/harvest/book',
  guard,
  demoCallCap,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const what = req.body?.what === 'transport' ? 'transport' : 'harvester';
    if (land.location_source !== 'demo') return { comingSoon: true, what, simulated: false };
    const s = await harvestState(land);
    const L = pickLang(req.body?.lang);
    const acres = Number(land.acres) || 1;
    const usd = what === 'harvester' ? Math.max(8, acres * 25) : Math.max(5, (s.amount?.units || 2) * 1.5);
    const total = Math.round(usd * (s.currency?.perUsd || 1));
    const whenIso = s.ready?.harvestStart || s.today;
    const when = digitsFor(new Date(`${whenIso}T12:00:00Z`).toLocaleDateString({ bn: 'bn-BD', hi: 'hi-IN', en: 'en-IN' }[L], { day: 'numeric', month: 'long', timeZone: 'UTC' }), L);
    const acresT = digitsFor(String(Math.round(acres * 100) / 100), L);
    const qtyT = digitsFor(String(s.amount?.units || 2), L);
    const T = {
      en: { harvester: ['Hello, this is Khet Sathi calling for a farmer.', `Can your reaper cut ${acresT} acres of the crop from ${when}?`, `Yes, we can come on ${when}. ${priceText(total, s.currency, 'en')} for the job.`, 'Please book it. Thank you.'], transport: ['Hello, this is Khet Sathi calling for a farmer.', `Can you carry about ${qtyT} ${unitName(s.unit, 'en')} to the buyer the day after harvest?`, `Yes, my van can do it. ${priceText(total, s.currency, 'en')}.`, 'Please book it. Thank you.'] },
      bn: { harvester: ['নমস্কার, আমি খেত সাথী, একজন কৃষকের হয়ে ফোন করছি।', `${when} থেকে ${acresT} একর ফসল কেটে দিতে পারবেন?`, `হ্যাঁ, ${when} আসতে পারি। পুরো কাজ ${priceText(total, s.currency, 'bn')}।`, 'বুক করে দিন। ধন্যবাদ।'], transport: ['নমস্কার, আমি খেত সাথী, একজন কৃষকের হয়ে ফোন করছি।', `কাটার পরদিন প্রায় ${qtyT} ${unitName(s.unit, 'bn')} ফসল ক্রেতার কাছে পৌঁছে দিতে পারবেন?`, `হ্যাঁ, আমার গাড়ি পারবে। ${priceText(total, s.currency, 'bn')}।`, 'বুক করে দিন। ধন্যবাদ।'] },
      hi: { harvester: ['नमस्ते, मैं खेत साथी हूँ, एक किसान की ओर से फ़ोन कर रही हूँ।', `क्या आप ${when} से ${acresT} एकड़ फ़सल काट सकते हैं?`, `हाँ, ${when} आ सकते हैं। पूरे काम के ${priceText(total, s.currency, 'hi')}।`, 'कृपया बुक कर दीजिए। धन्यवाद।'], transport: ['नमस्ते, मैं खेत साथी हूँ, एक किसान की ओर से फ़ोन कर रही हूँ।', `क्या आप कटाई के अगले दिन लगभग ${qtyT} ${unitName(s.unit, 'hi')} फ़सल खरीदार तक पहुँचा सकते हैं?`, `हाँ, मेरी गाड़ी कर देगी। ${priceText(total, s.currency, 'hi')}।`, 'कृपया बुक कर दीजिए। धन्यवाद।'] },
    }[L][what];
    const crew = { harvester: { en: 'Demo reaper crew', bn: 'ডেমো ফসল কাটার দল', hi: 'डेमो कटाई टीम' }, transport: { en: 'Demo transport van', bn: 'ডেমো মাল পরিবহন', hi: 'डेमो ढुलाई गाड़ी' } }[what][L];
    const turns = T.map((text, i) => ({ who: i === 2 ? 'shop' : 'saathi', text }));
    const deal = await insertDeal({ land_id: land.id, direction: 'buy', items: [{ item: what, crop: land.crop, qty: what === 'harvester' ? acres : s.amount?.units || 2, unit: what === 'harvester' ? 'acre' : s.unit.key, price: total, currency: s.currency.code, symbol: s.currency.symbol, shop: crew, when: whenIso, simulated: true }], total_inr: total, status: 'confirmed' });
    await insertAlerts([{ land_id: land.id, area: 'market', severity: 'info', title: 'order_booked', source: 'demo', body: JSON.stringify({ shop: crew, total, symbol: s.currency.symbol, when: whenIso }) }]).catch(() => null);
    return { calls: [{ to: crew, total, when: whenIso, turns }], total, currency: s.currency, deal, simulated: true };
  })
);

// Where a land is and what covers it, also for lands with no field outline (a town is called a town).
app.get(
  '/api/lands/:id/place',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const { place, fresh } = await placeForLand(land);
    if (fresh && !place.error) await updateLand(land.id, { place_info: place }).catch(() => null);
    return { place };
  })
);

// ---------- buying for a field (v0.11.0): real shop names, DEMO calls, simulated booking ----------
app.get(
  '/api/lands/:id/market',
  guard,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const plan = (land.objects || []).length ? await planForLand(land).catch(() => null) : null;
    const crop = land.crop || plan?.crops?.[0]?.key || null;
    const currency = plan?.currency || currencyFor(land.place_info?.cc);
    useLimit('shops');
    const shops = await nearbyShops(Number(land.lat), Number(land.lon)).catch((err) => ({ shops: [], error: err.message }));
    return {
      crop,
      acres: land.acres ?? null,
      currency,
      blocked: Boolean(plan?.blocked),
      needs: crop ? needsFor({ crop, acres: land.acres || 1, currency }) : [],
      shops: shops.shops,
      shopSource: shops.source || null,
      shopError: shops.error || null,
      demoShop: land.location_source === 'demo' ? DEMO_SHOP : null,
      demoLand: land.location_source === 'demo',
      crew: DEMO_CREW,
      place: plan?.place ? [plan.place.village, plan.place.district].filter(Boolean).join(', ') : null,
      simulated: true,
    };
  })
);

app.post(
  '/api/lands/:id/order',
  guard,
  demoCallCap,
  timed(async (req) => {
    const land = await getLand(req.params.id);
    if (!land) throw new Error('Land not found');
    const { lines: want = [], shop, crop, cropName, lang, place } = req.body || {};
    const currency = land.place_info?.currency || currencyFor(land.place_info?.cc);
    const all = needsFor({ crop: String(crop || land.crop || ''), acres: land.acres || 1, currency });
    const lines = all.filter((l) => want.includes(l.id));
    if (!lines.length) throw new Error('Pick at least one thing to buy');
    const L = ['bn', 'hi', 'en'].includes(lang) ? lang : 'bn';
    // A real land (the farmer's own GPS or photo): nothing is faked. Sathi only says it will call the
    // real shop, and the app notes that calling is coming soon. Demo lands keep the scripted demo call.
    // v0.11.1: a real shop is never put in a demo call, even on a demo land; only the fictional demo shop is.
    if (land.location_source !== 'demo' || shop?.real) {
      return { comingSoon: true, shop: shop?.real ? { name: String(shop.name).slice(0, 80), km: shop.km ?? null, source: shop.source || null } : null, lines, currency, simulated: false };
    }
    const shopName = DEMO_SHOP.name[L];
    const calls = orderCalls({ lines, shop: shopName, crew: DEMO_CREW.name[L], place: String(place || '').slice(0, 80), cropName: String(cropName || crop || '').slice(0, 40), currency, lang: L });
    const total = lines.reduce((a, l) => a + l.price, 0);
    const deal = await insertDeal({
      land_id: land.id,
      direction: 'buy',
      items: lines.map((l) => ({ item: l.id, crop: l.crop || null, qty: l.qty, unit: l.unit, price: l.price, currency: currency.code, symbol: currency.symbol, shop: l.id === 'plough' ? DEMO_CREW.name[L] : shopName, shopReal: false, simulated: true })),
      total_inr: total,
      status: 'confirmed',
    });
    // The update the farmer sees in Sathi after the (demo) calls.
    await insertAlerts([{ land_id: land.id, area: 'market', severity: 'info', title: 'order_booked', source: 'demo', body: JSON.stringify({ shop: shopName, total, symbol: currency.symbol, when: calls[0]?.when || '' }) }]).catch(() => null);
    return { calls, total, currency, deal, simulated: true };
  })
);

// ---------- sheds (v0.11.0) ----------
// v0.18.1: each shed carries its own currency, from the country at its location (the same address lookup the
// yard uses, done once per spot and kept in memory). The demo shed sits near Bolpur, West Bengal, so it stays
// in rupees. A shed with no location gets none and the app uses the farm's field currency.
const shedCur = new Map();
async function shedCurrency(s) {
  if (s?.demo || s?.builtIn) return currencyFor('IN');
  const lat = Number(s?.lat);
  const lon = Number(s?.lon);
  if (s?.lat == null || s?.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (shedCur.has(key)) return shedCur.get(key);
  const look = reverseGeocode(lat, lon, 'en')
    .then((g) => {
      const c = g?.cc ? currencyFor(g.cc) : null;
      if (c) shedCur.set(key, c);
      return c;
    })
    .catch(() => null);
  // A slow lookup never holds up the shed list; it finishes in the background and the next load has it.
  return Promise.race([look, new Promise((r) => setTimeout(() => r(null), 4000))]);
}
const withCurrency = async (s) => (s ? { ...s, currency: await shedCurrency(s) } : s);
app.get('/api/sheds', guard, timed(async () => ({ sheds: await Promise.all((await listSheds()).map(withCurrency)) })));
app.post(
  '/api/sheds',
  guard,
  timed(async (req) => {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) throw new Error('Give the shed a name');
    const n = Number(req.body?.chickens);
    const lat = Number(req.body?.lat);
    const lon = Number(req.body?.lon);
    const shed = await createShed({
      name,
      chickens: Number.isFinite(n) && n > 0 ? Math.min(100000, Math.round(n)) : null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      lang: ['bn', 'hi', 'en'].includes(req.body?.lang) ? req.body.lang : 'bn',
    });
    return { shed: await withCurrency(shed) };
  })
);

// ---------- home yards (v0.15.0) ----------
// One photo of the open space in front of the house: SAM 3.1 outlines the open ground, the farmer gives
// the size in their own units, and the picks follow that place's weather and month.
function yardView(y) {
  if (!y) return null;
  const { photo_path, ...rest } = y;
  return { ...rest, photoUrl: photo_path ? `/api/yards/${y.id}/photo` : null, units: unitsFor(y.place_info?.cc) };
}
async function yardDetails(y) {
  const cc = y.place_info?.cc || null;
  // v0.19.0: the yard shares the field's kept forecast, so a quiet Open-Meteo shows earlier weather, marked.
  const k = await withKeep(wxKey(y.lat, y.lon), () => fetchWeather(y.lat, y.lon), { persist: Boolean(y.demo) }).catch(() => null);
  const wx = k?.value || null;
  const today = wx?.days?.[0]?.date || new Date().toISOString().slice(0, 10);
  const month = Number(today.slice(5, 7));
  const tMean = meanTemp(wx);
  const { picks, cls } = pickPlants({ m2: y.size_m2, sun: y.sun || 'half', month, cc, tMean });
  return {
    month,
    today,
    cls,
    picks,
    list: picks.length ? shoppingList(picks, cc) : null,
    size: sizeWords(y.size_m2, cc),
    weather: wx ? { ...waterTip(wx), tMean: tMean == null ? null : Math.round(tMean), staleAt: k?.staleAt || null } : null,
    southAsia: SOUTH_ASIA.includes(String(cc || '').toUpperCase()),
  };
}
app.get('/api/yards', guard, timed(async () => ({ yards: (await listYards()).map(yardView) })));
app.post(
  '/api/yards',
  guard,
  timed(async (req) => {
    const { photoDataUrl, lat, lon, lang, place } = req.body || {};
    let la = Number(lat);
    let lo = Number(lon);
    if (place && DEMO_PLACES[place]) {
      if (currentScope()?.mode !== 'demo') throw new Error('Demo places are made by the admin in the demo farm. Add your own yard with your location or a photo');
      ({ lat: la, lon: lo } = DEMO_PLACES[place]);
    }
    if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new Error('Location is required');
    const photo = dataUrlToBuffer(photoDataUrl);
    if (!photo) throw new Error('Take or pick a photo of the yard first');
    useLimit('scan');
    // One size for SAM and for the screen: the long side at most 1024 pixels.
    const img = sharp(photo.buffer).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    const image = { dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`, width: info.width, height: info.height };
    const L = ['bn', 'hi', 'en'].includes(lang) ? lang : 'bn';
    const [sam, geo] = await Promise.all([outlineYard(image), reverseGeocode(la, lo, L).catch(() => null)]);
    const id = newId();
    await putFile(`yards/${id}/photo.jpg`, data, 'image/jpeg');
    const cc = geo?.cc || null;
    const yard = await createYard({
      id,
      lat: la,
      lon: lo,
      lang: L,
      place_info: { cc, country: geo?.country || null, state: geo?.state || null, district: geo?.district || null, village: geo?.village || null, currency: currencyFor(cc) },
      photo_path: `yards/${id}/photo.jpg`,
      outline: sam.outline ? { ...sam.outline, width: sam.width, height: sam.height } : null,
      sam: { prompt: sam.prompt, error: sam.error, model: MODELS.sam, answered: Boolean(sam.answered) },
    });
    return { yard: yardView(yard), samError: sam.error };
  })
);
app.patch(
  '/api/yards/:id',
  guard,
  timed(async (req) => {
    const yard = await getYard(req.params.id);
    if (!yard) throw new Error('Yard not found');
    const { size, sun } = req.body || {};
    const patch = {};
    if (sun) {
      if (!['full', 'half', 'shade'].includes(sun)) throw new Error('sun must be full, half or shade');
      patch.sun = sun;
    }
    if (size) {
      const r = sizeToM2(size, yard.place_info?.cc);
      if (r.ask || r.error) return { ask: r.ask || null, sizeError: r.error || null };
      // "I don't know": a medium yard stands in, labelled as an estimate until the farmer gives a size.
      patch.size = { ...size, estimate: Boolean(r.estimate) };
      patch.size_m2 = r.estimate ? 12 : r.m2;
    }
    const next = await updateYard(yard.id, patch);
    return { yard: yardView(next), ...(next.size_m2 ? await yardDetails(next) : {}) };
  })
);
app.get(
  '/api/yards/:id',
  guard,
  timed(async (req) => {
    const yard = await getYard(req.params.id);
    if (!yard) throw new Error('Yard not found');
    // v0.19.3: a demo yard saved while SAM was down gets its outline later, by itself (not on real farms).
    if (yard.demo && !yard.outline) retryLater(`yard|${yard.id}`, () => retryYardOutline(yard.id));
    return { yard: yardView(yard), ...(yard.size_m2 ? await yardDetails(yard) : {}) };
  })
);
app.get('/api/yards/:id/photo', guard, async (req, res) => {
  try {
    const yard = await getYard(req.params.id);
    const file = yard?.photo_path ? await getFile(yard.photo_path) : null;
    if (!file) return res.status(404).end();
    res.set('Content-Type', file.contentType).set('Cache-Control', 'private, max-age=86400').send(file.buffer);
  } catch {
    res.status(502).end();
  }
});
app.get(
  '/api/yards/:id/shops',
  guard,
  timed(async (req) => {
    const yard = await getYard(req.params.id);
    if (!yard) throw new Error('Yard not found');
    useLimit('shops');
    return nearbyShops(yard.lat, yard.lon, { kind: 'garden', radiusKm: 15 });
  })
);
app.delete(
  '/api/yards/:id',
  guard,
  timed(async (req) => {
    const yard = await getYard(req.params.id);
    if (!yard) throw new Error('Yard not found');
    const deleted = await deleteYard(yard.id);
    if (!deleted) throw new Error('Yard could not be deleted');
    await deleteFiles([yard.photo_path].filter(Boolean)).catch(() => null);
    return { deleted: true, id: yard.id };
  })
);

// ---------- a photo of a crop problem (v0.16.0): measured, never diagnosed; nothing is saved ----------
app.post(
  '/api/problem/measure',
  guard,
  timed(async (req) => {
    const photo = dataUrlToBuffer(req.body?.photoDataUrl);
    if (!photo) throw new Error('Take or pick a photo first');
    useLimit('check');
    const { data, info } = await sharp(photo.buffer).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    const m = await measureProblem({ dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`, width: info.width, height: info.height });
    return { measure: { ...m, model: MODELS.sam } };
  })
);

// ---------- the demo leaf and SAM retries for demo places (v0.19.3) ----------
// The demo farm's places saved while SAM was down get their outline once SAM answers, then it is kept for
// good: at start and every 3 hours (warmDemo) and when someone opens them, at most once every 10 minutes
// each. Retries run in a writable demo scope, so a judge opening a demo yard can trigger the save.
const WRITE_DEMO = { mode: 'demo', owner: null, readOnly: false, admin: true };
const lastRetry = new Map();
const RETRY_GAP_MS = Number(process.env.DEMO_RETRY_MS) || 10 * 60 * 1000; // 10 minutes; tests use a few seconds
function retryLater(key, fn) {
  if (Date.now() - (lastRetry.get(key) || 0) < RETRY_GAP_MS) return;
  lastRetry.set(key, Date.now());
  runAs({ id: 'demo-retry', email: 'demo-retry' }, fn, WRITE_DEMO).catch((err) => console.log('demo retry', key, err.message));
}
async function imageFor(buffer) {
  const { data, info } = await sharp(buffer).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
  return { data, image: { dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`, width: info.width, height: info.height } };
}
async function retryYardOutline(id) {
  const y = await getYard(id);
  if (!y?.demo || y.outline || !y.photo_path) return y;
  const f = await getFile(y.photo_path);
  if (!f?.buffer) return y;
  const { image } = await imageFor(Buffer.from(f.buffer));
  const sam = await outlineYard(image);
  if (!sam.outline) {
    console.log(`demo yard ${id}: still no outline (${String(sam.error || 'no open ground found').slice(0, 120)})`);
    // v0.20.1: the screen says which it was: SAM down, or SAM answered and found no open ground.
    if (Boolean(sam.answered) !== Boolean(y.sam?.answered)) return updateYard(id, { sam: { ...(y.sam || {}), error: sam.error, answered: Boolean(sam.answered), model: MODELS.sam } });
    return y;
  }
  const done = await updateYard(id, { outline: { ...sam.outline, width: sam.width, height: sam.height }, sam: { prompt: sam.prompt, error: null, model: MODELS.sam, later: new Date().toISOString() } });
  console.log(`demo yard ${id}: outline saved`);
  return done;
}
// The demo leaf lives in the shed-clips bucket: land-images only accepts images, so its JSON record was
// refused there (found live on Oct 29); shed-clips accepts JPEG and JSON.
const leafDeps = () => ({ getFile: (p) => getFile(p, CLIP_BUCKET), putFile: (p, b, t, _bucket, cc) => putFile(p, b, t, CLIP_BUCKET, cc), measure: measureProblem });
app.get(
  '/api/problem/demo-leaf',
  guard,
  timed(async () => {
    const meta = await loadLeaf(leafDeps());
    if (meta && !meta.measure) retryLater('leaf', () => retryLeaf(leafDeps()));
    return { leaf: leafView(meta) };
  })
);
function leafView(meta) {
  return meta ? { savedAt: meta.savedAt, measuredAt: meta.measuredAt, measure: meta.measure, width: meta.width, height: meta.height, lastError: meta.lastError || null, photoUrl: `/api/problem/demo-leaf/photo?v=${encodeURIComponent(meta.savedAt)}` } : null;
}
const demoAdminOnly = () => {
  const sc = currentScope();
  if (sc?.mode !== 'demo' || !sc.admin || sc.readOnly) throw new Error('Only an admin can set the demo leaf, inside the demo farm');
};
// v0.20.1: the admin's "Measure again": SAM 3.1 measures the saved demo leaf now, with the current phrases.
// If SAM does not answer, the earlier measurement stays.
app.post(
  '/api/problem/demo-leaf/measure',
  guard,
  timed(async () => {
    demoAdminOnly();
    useLimit('check');
    const before = await loadLeaf(leafDeps());
    if (!before) throw new Error('No demo leaf saved yet');
    const meta = await retryLeaf({ ...leafDeps(), force: true });
    const fresh = meta.measuredAt !== before.measuredAt;
    return { leaf: leafView(meta), measured: fresh, error: fresh ? null : meta.lastError };
  })
);
app.get('/api/problem/demo-leaf/photo', guard, async (req, res) => {
  try {
    const f = await leafPhoto(leafDeps());
    if (!f) return res.status(404).end();
    res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'private, max-age=86400').send(Buffer.from(f.buffer));
  } catch {
    res.status(502).end();
  }
});
app.post(
  '/api/problem/demo-leaf',
  guard,
  timed(async (req) => {
    demoAdminOnly();
    const photo = dataUrlToBuffer(req.body?.photoDataUrl);
    if (!photo) throw new Error('Take or pick a photo first');
    const { data, image } = await imageFor(photo.buffer);
    const meta = await saveLeaf({ photo: data, width: image.width, height: image.height, measure: req.body?.measure || null }, leafDeps());
    if (!meta.measure) {
      lastRetry.delete('leaf');
      retryLater('leaf', () => retryLeaf(leafDeps()));
    }
    return { leaf: { savedAt: meta.savedAt, measuredAt: meta.measuredAt, measured: Boolean(meta.measure) } };
  })
);

// ---------- help with a crop problem (v0.15.0): the nearest agriculture office and the farm hotline ----------
async function whereFor({ landId, yardId, shedId }) {
  if (landId) {
    const l = await getLand(String(landId));
    if (l) return { lat: l.lat, lon: l.lon, cc: l.place_info?.cc || (await reverseGeocode(l.lat, l.lon).catch(() => null))?.cc || null };
  }
  if (yardId) {
    const y = await getYard(String(yardId));
    if (y) return { lat: y.lat, lon: y.lon, cc: y.place_info?.cc || null };
  }
  if (shedId) {
    const s = (await listSheds()).find((x) => String(x.id) === String(shedId));
    if (s && Number.isFinite(s.lat)) return { lat: s.lat, lon: s.lon, cc: (await reverseGeocode(s.lat, s.lon).catch(() => null))?.cc || null };
  }
  return null;
}
app.get(
  '/api/help/offices',
  guard,
  timed(async (req) => {
    const at = await whereFor(req.query);
    if (!at) throw new Error('Pick a field, yard or shed first');
    useLimit('shops');
    return { help: await officeHelp({ ...at, lang: pickLang(req.query.lang) }), at };
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
      // A demo copy shares its pictures with the demo land, so only this land's own files are removed.
      filesRemoved = await deleteFiles([land.tile_path, land.photo_path].filter((p) => p && p.startsWith(`${land.id}/`)));
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
// v0.17.0: one function answers Sathi questions; onStep reports each step as it happens (the live
// "Sathi at work" list). /api/ask answers at the end as before; /api/ask/stream sends the steps as they come.
// v0.19.0: on the demo farm, a question Sathi answered before is kept; if both Meta models then fail, that
// answer comes back marked with its time instead of an error. Real farms are never answered from a copy.
async function askCore(body, onStep = null) {
  const demo = currentScope()?.mode === 'demo';
  if (!demo) return askLive(body, onStep);
  const { text, landId, shedId, yardId, lang } = body || {};
  const key = `ask|${landId || shedId || yardId || 'none'}|${pickLang(lang)}|${String(text || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200)}`;
  try {
    const r = await askLive(body, onStep);
    if (r?.answer) remember(key, r, { persist: true });
    return r;
  } catch (err) {
    if (!text || err.limit) throw err;
    const kept = await recall(key, { persist: true, maxAgeMs: 14 * 864e5 });
    if (!kept) throw err;
    console.log(`kept copy served: Sathi answer from ${new Date(kept.at).toISOString().slice(0, 16)} UTC (${String(err.message).slice(0, 120)})`);
    return { ...kept.value, staleAt: new Date(kept.at).toISOString(), staleReason: err.message };
  }
}
async function askLive(body, onStep = null) {
  const step = (s) => {
    try {
      onStep?.({ ...s, at: Date.now() });
    } catch {}
  };
  const { text, landId, shedId, yardId, lang } = body || {};
  if (!text) throw new Error('text is required');
  useLimit('ask');
  // v0.11.3: a shed is picked, so Sathi answers about the shed (kit, eggs, sell rule, last camera check).
  if (shedId) return askShed(String(text), String(shedId), lang, onStep);
  // v0.15.0: a home yard: its size, sun and picks; crop problems go to the nearest agriculture office.
  if (yardId) {
    const yard = await getYard(String(yardId));
    if (!yard) throw new Error('Yard not found');
    step({ type: 'context', kind: 'yard', phase: 'start' });
    const d = yard.size_m2 ? await yardDetails(yard) : null;
    step({ type: 'context', kind: 'yard', phase: 'done' });
    const context = [
      'this is a HOME YARD (the open space in front of the house), not a farm field',
      yard.size_m2 ? `about ${yard.size_m2} square metres${yard.size?.estimate ? ' (a rough estimate, the farmer did not give the size)' : ''}` : 'size not given yet',
      yard.sun ? `sun: ${yard.sun === 'full' ? 'all day' : yard.sun === 'half' ? 'half the day' : 'mostly shade'}` : '',
      d?.picks?.length ? `suggested now: ${d.picks.map((p) => `${p.key.replace(/_/g, ' ')} (${p.count ? `${p.count} plants` : `${p.bedM2} m2 bed`}, first harvest in ${p.days[0]} to ${p.days[1]} days)`).join(', ')}` : '',
      d?.weather?.rainDate ? `rain expected ${d.weather.rainDate}, so skip watering that day` : '',
      d?.weather?.hot ? 'very hot today: water in the evening and shade young plants' : '',
    ].filter(Boolean).join('; ');
    // v0.19.0: the same facts with their sources, for the number check.
    const parts = [
      { text: yard.size_m2 ? `${yard.size_m2} square metres` : '', source: yard.size?.estimate ? 'SAM 3.1' : 'yard' },
      { text: (d?.picks || []).map((p) => `${p.count || ''} ${p.bedM2 || ''} ${p.days?.[0] ?? ''} ${p.days?.[1] ?? ''}`).join(' '), source: 'plants' },
      { text: d?.weather ? `${d.weather.rainDate || ''} ${d.weather.tMax ?? ''} ${d.weather.tMin ?? ''} ${d.weather.tMean ?? ''}` : '', source: 'Open-Meteo' },
    ];
    return runAgent({ userText: String(text).slice(0, 2000), lat: yard.lat, lon: yard.lon, context, parts, cc: yard.place_info?.cc || null, lang: pickLang(lang), onStep });
  }
  // No land picked yet: answer for the Bogura demo plot (the Scenario 1 plot with full data).
  let lat = DEMO_PLACES.bogura.lat;
  let lon = DEMO_PLACES.bogura.lon;
  let context = 'no plot added yet';
  let noField = false;
  let plan = null;
  const parts = [];
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
      step({ type: 'context', kind: 'field', phase: 'start' });
      plan = await planForLand(land).catch(() => null);
      if (plan) plan.demoLand = land.location_source === 'demo';
      context = [
        land.kind === 'empty' ? 'the land is empty, nothing planted yet' : `there is a standing crop${land.crop ? ` (${land.crop})` : ''}`,
        land.acres ? `plot size about ${land.acres} acres (measured from satellite)` : 'plot size unknown',
      ].join('; ');
      parts.push({ text: land.acres ? String(land.acres) : '', source: 'SAM 3.1' });
      // v0.19.0: the latest clear Sentinel-2 greenness, so Sathi can say how the crop looks from space.
      const g = await healthFor(land).then((h) => greenLine(h.health)).catch(() => null);
      if (g) {
        context += `; ${g.text}`;
        parts.push({ text: g.text, source: 'Sentinel-2' });
      }
      // v0.12.0: a standing crop: its sowing date, harvest window and expected amount.
      if (land.kind === 'crop' && land.crop) {
        const s = await harvestState(land).catch(() => null);
        if (s?.ready) {
          const line = `sown ${s.sownOn}${s.estimated ? ' (estimated from satellite greenness)' : ''}; harvest window ${s.ready.harvestStart} to ${s.ready.harvestEnd}; stage ${s.ready.stage}, ${s.ready.pct}% of the way to harvest; ${daysBetweenIso(plan?.today || localToday('Asia/Dhaka'), s.ready.harvestStart)} days until the harvest window opens`;
          context += `; ${line}`;
          parts.push({ text: line, source: 'MIRCA-OS' });
        }
        if (s?.amount) {
          context += `; expected harvest about ${s.amount.units} ${s.unit.key === 'mon' ? 'maund (40 kg)' : s.unit.key === 'quintal' ? 'quintal' : 'x 100 kg'} (country average yield, FAOSTAT)`;
          parts.push({ text: String(s.amount.units), source: 'FAOSTAT' });
        }
        context += plan?.demoLand ? '; the harvest booking and buyer calls in the Market tab are a demo' : '; no live crop prices yet, and calling buyers is coming soon';
      }
      step({ type: 'context', kind: 'field', phase: 'done' });
    }
  }
  if (!landId) {
    step({ type: 'context', kind: 'field', phase: 'start' });
    plan = await buildPlan({ lat, lon, place: 'bogura' }).catch(() => null);
    step({ type: 'context', kind: 'field', phase: 'done' });
  }
  if (!landId && plan) plan.demoLand = true;
  const landCc = landId ? (await getLand(landId).catch(() => null))?.place_info?.cc : null;
  return runAgent({ userText: String(text).slice(0, 2000), lat, lon, context, parts, noField, plan, cc: landCc || plan?.place?.cc || (landId ? null : 'BD'), lang: pickLang(lang), onStep });
}
app.post('/api/ask', guard, timed(async (req) => askCore(req.body)));
app.post('/api/ask/stream', guard, async (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const t0 = Date.now();
  // A comment line every 10 s keeps proxies from closing a long answer.
  const ping = setInterval(() => res.write(': ping\n\n'), 10000);
  try {
    const out = await runAs(req.user, () => askCore(req.body, (s) => send('step', s)), req.scope);
    send('answer', { ok: true, ms: Date.now() - t0, ...out });
  } catch (err) {
    send('answer', { ok: false, ms: Date.now() - t0, error: err.message || String(err) });
  } finally {
    clearInterval(ping);
    res.end();
  }
});

// v0.19.0: "greenness (NDVI) 0.77 on 2026-10-25, 0.03 less than the clear picture before".
function greenLine(health) {
  const clear = (health?.passes || []).filter((p) => !p.cloudy && p.ndvi?.mean != null);
  if (!clear.length) return null;
  const [a, b] = clear;
  const r = (x) => Math.round(x * 100) / 100;
  const diff = b ? r(a.ndvi.mean - b.ndvi.mean) : null;
  return { text: `crop greenness (NDVI, Sentinel-2) ${r(a.ndvi.mean)} on ${a.date}${diff == null ? '' : diff === 0 ? ', the same as the clear picture before' : `, ${Math.abs(diff)} ${diff > 0 ? 'more' : 'less'} than the clear picture before (${b.date})`}` };
}
const daysBetweenIso = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

async function askShed(text, shedId, lang, onStep = null) {
  onStep?.({ type: 'context', kind: 'shed', phase: 'start', at: Date.now() });
  const sheds = await listSheds();
  const shed = sheds.find((s) => String(s.id) === shedId) || sheds[0];
  const demo = Boolean(shed?.demo || shed?.builtIn);
  const latest = latestByDevice(await latestReadings([SHED_DEVICE], 30).catch(() => []))[SHED_DEVICE] || null;
  const index = await readIndex().catch(() => ({ clips: [] }));
  const mine = index.clips.filter((c) => (demo ? !c.shedId : c.shedId === shed?.id) && c.result?.count);
  const last = mine.sort((a, b) => String(b.result.checkedAt).localeCompare(String(a.result.checkedAt)))[0]?.result;
  const check = last ? { when: last.checkedAt, count: last.count.count, still: last.count.still?.length || 0, resting: Boolean(last.count.resting), unusualSound: Boolean(last.observation?.unusualSound) } : null;
  const cur = (await shedCurrency(shed).catch(() => null)) || (await listLands().catch(() => [])).find((l) => l.place_info?.currency)?.place_info.currency || currencyFor('IN');
  const facts = shedFacts({ shed, kit: latest, stock: await eggStock().catch(() => null), tray: TRAY, rule: await loadRule().catch(() => null), check, night: isNight(shedHour()), money: cur.code });
  onStep?.({ type: 'context', kind: 'shed', phase: 'done', at: Date.now() });
  onStep?.({ type: 'think', phase: 'start', step: 1, at: Date.now() });
  const out = await shedAnswer({ text, lang: pickLang(lang), facts });
  onStep?.({ type: 'think', phase: 'done', step: 1, tools: 0, label: out.brain?.label || null, at: Date.now() });
  // v0.19.0: each line of the shed facts has one source, for the number check.
  const SRC = [[/^Sensor kit/, 'kit'], [/^Comfortable/, 'ranges'], [/^Eggs in stock/, 'eggs'], [/^Farmer's sell rule/, 'rule'], [/^Last camera check/, 'SAM 3.1'], [/^Shed:/, 'shed']];
  const parts = facts.split('\n').map((line) => ({ text: line, source: (SRC.find(([re]) => re.test(line)) || [])[1] || 'shed' }));
  const checks = out.answer ? checkNumbers(out.answer, factsFrom({ parts })) : null;
  return { ...out, trace: [], mode: 'shed', checks };
}

// ---------- alerts + simulated village sensor kit ----------
const engine = createEngine({
  store: { listLands, getLand, latestReadings, insertReadings, recentAlerts, insertAlerts },
  planForLand,
  camera: todayCamera,
  market: marketTick,
  onAlerts: (rows) => wakeSathi(rows),
  log: (m) => console.log(m),
});
const ENGINE_EVERY_MS = 10 * 60 * 1000;
setTimeout(() => engine.run().catch((e) => console.error('engine', e.message)), 30000).unref();
setInterval(() => engine.run().catch((e) => console.error('engine', e.message)), ENGINE_EVERY_MS).unref();

// ---------- Sathi on watch (v0.22.0, lib/watch.js) ----------
// New alerts wake Sathi; Muse Spark looks closer with these tools, decides, and logs each step. Second looks
// she schedules are run by the engine's timer. Missions run as the system (every farm), like the engine.
async function shedNow() {
  const latest = latestByDevice(await latestReadings([SHED_DEVICE], 40).catch(() => []))[SHED_DEVICE] || {};
  const v = (m) => latest[m]?.value ?? null;
  const clip = await todayCamera().catch(() => null);
  const r = clip?.result;
  return {
    simulated: true,
    temp: v('shed_temp'), humidity: v('shed_humidity'), ammonia: v('ammonia_ppm'), water: v('water_pct'), feed: v('feed_pct'), eggs: v('eggs_today'),
    camera: r ? { clip: clip.name, birds: r.count?.count ?? null, still: r.count?.still?.length || 0, unusualSound: Boolean(r.observation?.unusualSound), checkedAt: r.checkedAt || null, simulated: true } : null,
  };
}
async function placeOf(m) {
  if (m.place_kind === 'field') {
    const land = m.place_id ? await getLand(m.place_id).catch(() => null) : null;
    return land ? { lat: land.lat, lon: land.lon, land } : null;
  }
  return { lat: DEFAULT_SHED.lat, lon: DEFAULT_SHED.lon };
}
const watchToolsFor = (m) => ({
  look_at_shed: () => shedNow(),
  look_at_camera_again: async () => {
    const clip = await todayCamera();
    if (!clip) return { error: 'No camera clip is set for today' };
    const count = await countFrames(await clipFrames(clip), clip.width);
    noteClip(await saveResult(clip.id, { count }));
    return shedNow();
  },
  look_at_weather: async () => {
    const p = await placeOf(m);
    if (!p) return { error: 'Place not found' };
    const k = await withKeep(wxKey(p.lat, p.lon), () => fetchWeather(p.lat, p.lon), { persist: true });
    return { days: (k.value?.days || []).slice(0, 3).map((d) => ({ date: d.date, tMax: d.tMax, tMin: d.tMin, rainChance: d.rainChance, rainMm: d.rainMm, humidity: d.humidity })), staleAt: k.staleAt || null };
  },
  look_at_field_camera: async () => {
    if (!m.place_id) return { error: 'Field not found' };
    const looks = await readLooks(m.place_id);
    const tr = camTrend(looks);
    const last = looks.filter((l) => Number.isFinite(l.share)).slice(-6);
    const land = await getLand(m.place_id).catch(() => null);
    const season = land ? await seasonFor(land) : { stage: null, heat: null };
    const latest = last.at(-1);
    const animals = looks.filter((l) => l.motion && (l.animals || []).length).slice(-3).map((l) => ({ at: l.at, animals: l.animals.map((a) => a.kind) }));
    return {
      looks: tr.looks, from: tr.from, now: latest?.share ?? null, rising: tr.rising, recent: last.map((l) => ({ at: l.at, share: l.share })), demo: last.some((l) => l.demo),
      evenness: latest?.even ?? null, grainHeads: latest?.heads ?? null,
      looksLike: latest ? camClassify({ look: latest, stage: season.stage, heatPct: season.heat?.pct ?? null }) : null,
      animalsSeen: animals,
    };
  },
  look_at_field: async () => {
    const p = await placeOf(m);
    if (!p?.land) return { error: 'Field not found' };
    const { health } = await healthFor(p.land).catch(() => ({ health: null }));
    const clear = (health?.passes || []).filter((x) => !x.cloudy && x.ndvi?.mean != null);
    const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
    const plan = await planForLand(p.land).catch(() => null);
    const season = await seasonFor(p.land);
    return {
      season: { stage: season.stage, daysToHarvest: season.daysLeft, harvestStart: season.harvestStart, warmthSinceSowing: season.heat ? { gdd: season.heat.gdd, needed: season.heat.need, pct: season.heat.pct, through: season.heat.through, source: 'NASA POWER' } : null },
      crop: p.land.crop || null,
      ndvi: r2(clear[0]?.ndvi.mean), ndviDate: clear[0]?.date || null,
      trend: clear[1] ? r2(clear[0].ndvi.mean - clear[1].ndvi.mean) : null,
      moisture: plan?.weather?.soilMoistureLevel || null,
      simulated: false,
    };
  },
});
async function modeFor(ownerId) {
  return (await getWatchMode(ownerId || 'demo').catch(() => null)) || DEFAULT_WATCH_MODE;
}
async function runAndSave(mission) {
  let m;
  try {
    m = await runMission(mission, { tools: watchToolsFor(mission), translate: (steps) => translateSteps(steps) });
  } catch (err) {
    m = { ...mission, status: mission.runs ? 'sleeping' : 'failed', due_at: mission.runs ? new Date(Date.now() + 30 * 60000).toISOString() : null, steps: [...(mission.steps || []), { at: new Date().toISOString(), kind: 'did', key: 'wtDidFailed', vars: { error: String(err.message || err).slice(0, 160) } }] };
    console.log(`watch ${mission.trigger}: failed (${err.message})`);
  }
  await saveMission(m).catch((e) => console.log('watch save', e.message));
  console.log(`watch ${m.trigger}: ${m.status}, ${m.steps.length} steps${m.model ? `, ${m.model}` : ''}`);
  return m;
}
const watchBusy = new Set();
// At most WATCH_DAILY_MAX new missions a day (each is a few model calls); second looks always run.
const watchDay = { day: '', n: 0 };
const WATCH_DAILY_MAX = Number(process.env.WATCH_DAILY_MAX) || 30;
function watchBudget() {
  const d = new Date().toISOString().slice(0, 10);
  if (watchDay.day !== d) Object.assign(watchDay, { day: d, n: 0 });
  if (watchDay.n >= WATCH_DAILY_MAX) return false;
  watchDay.n++;
  return true;
}
async function wakeSathi(rows) {
  for (const a of rows || []) {
    const kind = WATCH_TRIGGERS[a.title];
    if (!kind) continue;
    const placeId = kind === 'field' ? a.land_id || null : null;
    const key = `${a.owner_id || ''}|${kind}|${placeId || ''}|${a.title}`;
    if (watchBusy.has(key)) continue;
    if (await openMissionFor({ ownerId: a.owner_id || null, placeKind: kind, placeId, trigger: a.title }).catch(() => null)) continue;
    if (!watchBudget()) {
      console.log(`watch ${a.title}: skipped, ${WATCH_DAILY_MAX} missions already today`);
      continue;
    }
    watchBusy.add(key);
    const mission = missionFrom(a, { mode: await modeFor(a.owner_id), id: newId() });
    await runAs(null, () => runAndSave(mission)).catch((e) => console.log('watch', e.message)).finally(() => watchBusy.delete(key));
  }
}
async function watchDue() {
  for (const m of await dueMissions().catch(() => [])) {
    if (watchBusy.has(m.id)) continue;
    watchBusy.add(m.id);
    await runAs(null, () => runAndSave({ ...m, status: 'running' })).catch((e) => console.log('watch due', e.message)).finally(() => watchBusy.delete(m.id));
  }
}
setInterval(() => watchDue().catch(() => null), Number(process.env.WATCH_DUE_EVERY_MS) || 60 * 1000).unref();

// Home: Sathi's log for the place on screen, and the farm's setting.
app.get(
  '/api/watch',
  guard,
  timed(async (req) => {
    const placeKind = ['field', 'shed', 'yard'].includes(req.query.kind) ? req.query.kind : null;
    const placeId = isId(req.query.id) ? req.query.id : null;
    const missions = await listMissions({ placeKind, placeId, limit: 5 });
    const sc = currentScope();
    return { mode: (await getWatchMode(sc?.mode === 'demo' ? 'demo' : sc?.owner || 'demo').catch(() => null)) || DEFAULT_WATCH_MODE, missions: missions.map(missionView) };
  })
);
app.post(
  '/api/watch/mode',
  guard,
  timed(async (req) => {
    const mode = String(req.body?.mode || '');
    if (!WATCH_MODES.includes(mode)) throw new Error('mode must be tell, ask or rules');
    const sc = currentScope();
    if (sc?.mode === 'demo' && !sc.admin) throw new Error('This is the demo farm, so nothing is saved');
    return { mode: await setWatchMode(mode) };
  })
);
// The farmer's tap on what Sathi is waiting for. Visitors to the demo farm can tap too; nothing is saved.
app.post(
  '/api/watch/:id/decide',
  guard,
  timed(async (req) => {
    const m = await getMission(req.params.id);
    if (!m) throw new Error('Not found');
    const { mission, open } = decideWatch(m, req.body?.choice === 'yes' ? 'yes' : 'no');
    const saved = await saveMission(mission);
    return { mission: missionView(saved), open };
  })
);
// Admin, demo farm: wake Sathi now from the demo shed's current camera check (for the demo and the video).
app.post(
  '/api/watch/wake',
  guard,
  timed(async () => {
    const sc = currentScope();
    if (sc?.mode !== 'demo' || !sc.admin) throw new Error('Only an admin can wake Sathi, inside the demo farm');
    const now = await shedNow();
    const still = now.camera?.still || 0;
    const alert = still ? { title: 'birds_still', area: 'shed', source: 'camera', owner_id: null, land_id: null, body: { value: still, clip: now.camera.clip } } : { title: 'watch_round', area: 'shed', source: 'sensor', owner_id: null, land_id: null, body: { value: now.temp } };
    const mission = missionFrom(alert, { mode: await modeFor(null), id: newId() });
    const done = await runAs(null, () => runAndSave(mission));
    return { mission: missionView(done) };
  })
);

// ---------- the field camera (v0.23.0, lib/fieldcam.js) ----------
// Looks at one patch of a field, measured by SAM 3.1. A farm can add looks to its own fields; the demo field's
// looks are saved demo frames, loaded by an admin and labelled. A rise that holds raises patch_rising, which
// wakes Sathi.
async function fieldForCamera(id) {
  const land = await getLand(id).catch(() => null);
  if (!land) throw new Error('Field not found');
  return land;
}
// v0.24.0: warmth since sowing (NASA POWER), kept for a day per field.
async function heatFor(land, sownOn) {
  if (!sownOn || !GDD_CROPS[land.crop]) return null;
  const today = localToday('Asia/Dhaka');
  const k = await withKeep(`power|${land.id}|${sownOn}`, async () => heatStage({ crop: land.crop, days: await powerDaily({ lat: land.lat, lon: land.lon, start: sownOn, end: today }) }), { persist: land.location_source === 'demo', maxAgeMs: 864e5, ok: (v) => Boolean(v) }).catch(() => null);
  return k?.value || null;
}
// Where the field is in its season: the harvest readiness stage (calendar and Sentinel-2) and the warmth stage.
async function seasonFor(land) {
  if (!land.crop) return { stage: null, heat: null };
  const s = await harvestState(land).catch(() => null);
  return { stage: s?.ready?.stage || null, daysLeft: s?.ready?.daysLeft ?? null, harvestStart: s?.ready?.harvestStart || null, heat: await heatFor(land, s?.sownOn).catch(() => null) };
}
// Rising yellow: ripening (late in the season and even, or grain heads) wakes Sathi for the harvest; anything
// else for the agriculture office. One alert of each kind per field in 12 hours.
async function cameraCheck(land, looks) {
  const tr = camTrend(looks);
  if (!tr.rising) return tr;
  const season = await seasonFor(land);
  const last = [...looks].reverse().find((l) => !l.motion && Number.isFinite(l.share));
  const kind = camClassify({ look: last, stage: season.stage, heatPct: season.heat?.pct ?? null });
  const title = kind === 'ripening' ? 'crop_ripening' : 'patch_rising';
  const recent = await recentAlerts(12).catch(() => []);
  if (recent.some((a) => a.land_id === land.id && a.title === title)) return { ...tr, kind };
  const saved = await runAs(null, () => insertAlerts([{ land_id: land.id, owner_id: land.owner_id || null, area: 'field', severity: kind === 'ripening' ? 'info' : 'warn', title, source: 'camera', body: JSON.stringify({ from: tr.from, to: tr.to, looks: tr.looks, stage: season.stage, heat: season.heat?.pct ?? null, heads: last?.heads ?? null, even: last?.even ?? null }) }])).catch(() => null);
  if (saved?.length) wakeSathi(saved).catch(() => null);
  return { ...tr, kind };
}
async function animalCheck(land, look) {
  const n = (look.animals || []).length;
  if (!n) return;
  const kinds = [...new Set(look.animals.map((a) => a.kind))];
  const saved = await runAs(null, () => insertAlerts([{ land_id: land.id, owner_id: land.owner_id || null, area: 'field', severity: 'warn', title: 'animal_in_field', source: 'camera', body: JSON.stringify({ value: n, kinds, at: look.at }) }])).catch(() => null);
  if (saved?.length) wakeSathi(saved).catch(() => null);
}
app.get(
  '/api/lands/:id/camera',
  guard,
  timed(async (req) => {
    const land = await fieldForCamera(req.params.id);
    const looks = await readLooks(land.id);
    const tr = camTrend(looks);
    if (tr.rising) {
      const season = await seasonFor(land);
      const last = [...looks].reverse().find((l) => !l.motion && Number.isFinite(l.share));
      tr.kind = camClassify({ look: last, stage: season.stage, heatPct: season.heat?.pct ?? null });
    }
    return { looks: looks.map((l) => lookView(land.id, l)), trend: tr };
  })
);
app.get('/api/lands/:id/camera/:look/photo', guard, async (req, res) => {
  try {
    const land = await fieldForCamera(req.params.id);
    const f = await lookPhoto(land.id, req.params.look);
    if (!f) return res.status(404).end();
    res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'private, max-age=86400').send(Buffer.from(f.buffer));
  } catch {
    res.status(404).end();
  }
});
app.post(
  '/api/lands/:id/camera/look',
  guard,
  timed(async (req) => {
    const land = await fieldForCamera(req.params.id);
    const sc = currentScope();
    if (sc?.readOnly) throw new Error('This is the demo farm, so nothing is saved');
    const photo = dataUrlToBuffer(req.body?.photoDataUrl);
    if (!photo) throw new Error('Send a photo');
    useLimit('check');
    const motion = Boolean(req.body?.motion); // v0.24.0: a frame where the camera noticed movement
    const { data, image } = await imageFor(photo.buffer);
    const { look, looks } = await addLook(land.id, { photo: data, image, crop: land.crop, motion, demo: sc?.mode === 'demo' });
    if (motion) {
      await animalCheck(land, look);
      return { look: lookView(land.id, look), trend: camTrend(looks) };
    }
    const tr = await cameraCheck(land, looks);
    return { look: lookView(land.id, look), trend: tr };
  })
);
// Admin, demo farm: saved demo frames, sent one at a time (index 0 starts a fresh series), oldest first, dated
// across the last 3 days. After the last frame the rise check runs and may wake Sathi.
app.post(
  '/api/lands/:id/camera/demo',
  guard,
  timed(async (req) => {
    const sc = currentScope();
    if (sc?.mode !== 'demo' || !sc.admin || sc.readOnly) throw new Error('Only an admin can load demo frames, inside the demo farm');
    const land = await fieldForCamera(req.params.id);
    const total = Math.max(2, Math.min(12, Number(req.body?.total) || 0));
    const index = Math.max(0, Math.min(total - 1, Number(req.body?.index) || 0));
    const photo = dataUrlToBuffer(req.body?.photoDataUrl);
    if (!photo) throw new Error('Send a frame');
    if (index === 0) await saveLooks(land.id, () => []);
    const { data, image } = await imageFor(photo.buffer);
    const { look, looks } = await addLook(land.id, { photo: data, image, at: demoDates(total)[index], demo: true, crop: land.crop });
    const tr = index === total - 1 ? await cameraCheck(land, looks) : camTrend(looks);
    return { look: lookView(land.id, look), trend: tr, done: index === total - 1 };
  })
);

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
  timed(async (req) => {
    // ?landId= picks that land's kit (new app); otherwise the newest land with a field.
    const asked = req.query.landId ? await getLand(req.query.landId).catch(() => null) : null;
    const land = asked && (asked.objects || []).length ? asked : await newestFieldLand();
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
  const saved = await insertAlerts([{ land_id: null, area: 'shed', severity: 'warn', title, source: 'camera', body: JSON.stringify(body) }]).catch(() => null);
  if (saved?.length) wakeSathi(saved).catch(() => null); // v0.22.0
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
    useLimit('check');
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
    useLimit('check');
    const lang = pickLang(req.query.lang);
    const obs = await observeVideo(req.body, lang);
    lastShed = { ...(lastShed || {}), video: obs, videoAt: new Date().toISOString() };
    if (obs.unusualSound) await raiseShedAlert('sound_unusual', {});
    return { observation: obs, vetLine: SAFE_VET_LINE[lang], model: MODELS.media };
  })
);

// ---------- saved shed clips: the simulated shed camera (v0.7.1) ----------
// v0.11.2: clips without names in all three languages get them in the background (once each).
const naming = new Set();
function nameClip(clip) {
  if (!clip || clip.names || naming.has(clip.id)) return;
  naming.add(clip.id);
  threeNames(clip.name)
    .then((n) => n && setClipNames(clip.id, n))
    .catch(() => null)
    .finally(() => setTimeout(() => naming.delete(clip.id), 10 * 60 * 1000));
}
// v0.12.2: a checked clip's note and vet summary in the other two languages, in the background (once each).
const noting = new Set();
function noteClip(clip) {
  const o = clip?.result?.observation;
  if (!o?.note || o.notes || noting.has(clip.id)) return;
  noting.add(clip.id);
  threeNotes(o, clip.result.lang || 'bn', { filter: safeText })
    .then((n) => n && setClipNotes(clip.id, clip.result.checkedAt, n))
    .catch(() => null)
    .finally(() => setTimeout(() => noting.delete(clip.id), 10 * 60 * 1000));
}
// v0.13.0: a farm sees the demo shed's built-in clips and the clips of its own sheds.
async function ownShedIds() {
  return new Set((await listSheds()).filter((s) => !s.demo && !s.builtIn).map((s) => s.id));
}
// v0.14.0: the demo shed's clips (no shed id) belong to the demo farm; a farm sees only its own sheds' clips.
const inDemo = () => currentScope()?.mode === 'demo';
async function allowedClip(id) {
  const clip = await getClip(id);
  if (!clip) return null;
  if (!clip.shedId) return inDemo() ? clip : null;
  return (await ownShedIds()).has(clip.shedId) ? clip : null;
}
app.get(
  '/api/clips',
  guard,
  timed(async () => {
    const index = await readIndex();
    const mine = await ownShedIds();
    const clips = index.clips.filter((c) => (inDemo() ? !c.shedId : mine.has(c.shedId)));
    clips.forEach(nameClip);
    clips.forEach(noteClip);
    return { ...index, clips, todayId: clips.some((c) => c.id === index.todayId) ? index.todayId : null, max: MAX_CLIPS };
  })
);

// Step 1: name + frames (from the phone). Step 2: PUT the video. Step 3: check.
app.post(
  '/api/clips',
  guard,
  timed(async (req) => {
    // Only a farm's own shed takes new clips; the demo shed's camera is built in.
    // The admin adds the demo shed's clips in the demo farm (no shed id); everyone else only to their own sheds.
    const demoClip = inDemo() && !currentScope()?.readOnly && (!req.body?.shedId || req.body.shedId === 'shed-default');
    if (!demoClip && !(await ownShedIds()).has(String(req.body?.shedId || ''))) throw new Error('Add a shed of your own to save its camera clips');
    if (demoClip) req.body.shedId = null;
    const clip = await createClip(req.body || {});
    nameClip(clip);
    return { clip };
  })
);

app.put(
  '/api/clips/:id/video',
  guard,
  express.raw({ type: ['video/mp4', 'video/quicktime', 'application/octet-stream'], limit: '50mb' }),
  timed(async (req) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new Error('No video received');
    const own = await allowedClip(req.params.id);
    if (!own) throw new Error('Clip not found');
    return { clip: await putClipVideo(req.params.id, req.body, req.get('content-type')) };
  })
);

// Runs SAM on the saved frames and Spark on the saved video, and keeps the result with the clip.
app.post(
  '/api/clips/:id/check',
  guard,
  timed(async (req) => {
    const clip = await allowedClip(req.params.id);
    if (!clip) throw new Error('Clip not found');
    useLimit('check');
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
    noteClip(saved);
    const index = await readIndex();
    if (index.todayId === clip.id) engine.run().catch(() => null); // today's camera: raise its warnings now
    return { clip: saved, vetLine: SAFE_VET_LINE[lang] };
  })
);

app.post(
  '/api/clips/:id/today',
  guard,
  timed(async (req) => {
    // Today's camera is the demo shed's setting; a farm can pick one of its own clips for it.
    const clip = await allowedClip(req.params.id);
    if (!clip) throw new Error('Clip not found');
    const index = await setToday(req.body?.on ? req.params.id : null);
    if (index.todayId) engine.run().catch(() => null);
    return index;
  })
);

app.delete(
  '/api/clips/:id',
  guard,
  timed(async (req) => {
    // v0.11.2: the demo shed's clips are its built-in demo camera feeds and cannot be deleted.
    const clip = await allowedClip(req.params.id);
    if (!clip) throw new Error('Clip not found');
    if (!clip.shedId) throw new Error('This is a built-in demo camera and cannot be deleted');
    return { deleted: await deleteClip(req.params.id) };
  })
);

// Frames of a saved clip, for the shed screen.
// The clip's video (v0.11.0): the Shed tab plays saved clips as camera feeds. Supports Range for Safari.
app.get('/api/clips/:id/video', guard, async (req, res) => {
  try {
    const clip = await allowedClip(req.params.id);
    const file = clip ? await clipVideo(clip) : null;
    if (!file) return res.status(404).end();
    const buf = file.buffer;
    const total = buf.length;
    const type = file.contentType && file.contentType.startsWith('video/') ? file.contentType : 'video/mp4';
    res.set({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
    const m = /bytes=(\d*)-(\d*)/.exec(req.get('range') || '');
    if (!m) return res.send(buf);
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (start >= total || start > end) return res.status(416).set('Content-Range', `bytes */${total}`).end();
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${total}`).send(buf.subarray(start, end + 1));
  } catch {
    res.status(502).end();
  }
});

app.get('/api/clips/:id/frame/:n', guard, async (req, res) => {
  try {
    const clip = await allowedClip(req.params.id);
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
    useLimit('check');
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
    return { shed, simulated: true, last: lastShed, vet: withNames(vets[0]), eggTarget: (await loadRule()).min_count || 300 };
  })
);

app.get(
  '/api/shed/eggs',
  guard,
  timed(async () => ({ days: eggsPerDay(await metricHistory(SHED_DEVICE, 'eggs_today').catch(() => []), localToday('Asia/Kolkata')), simulated: true }))
);

// ---------- symptoms to the vet (v0.7.2; the vet and the call are SIMULATED) ----------
// Signs Sathi ticks from one camera check: SAM still birds (daytime) + what Spark saw or heard.
app.post(
  '/api/vet/signs',
  guard,
  timed(async (req) => ({ signs: autoSigns({ count: req.body?.count, observation: req.body?.observation, night: isNight(shedHour()) }), all: SIGN_CODES }))
);

// The farmer's spoken answer to "since when?" and "any deaths today?".
app.post(
  '/api/vet/answer',
  guard,
  timed(async (req) => {
    const text = String(req.body?.text || '').slice(0, 500);
    return { since: parseSince(text), deaths: parseDeaths(text) };
  })
);

// Preview: the exact words Sathi will say. Nothing is sent.
app.post('/api/vet/message', guard, timed(async (req) => ({ message: vetMessage(req.body || {}) })));

// The simulated call: only with the farmer's consent. No real call is made.
app.post(
  '/api/vet/call',
  guard,
  demoCallCap,
  timed(async (req) => {
    if (req.body?.consent !== true) throw new Error('The farmer has to agree before Sathi calls the vet');
    const call = cleanCall(req.body);
    const message = vetMessage(call);
    // Sathi answers the vet only from data the app has: the bird count and the simulated shed kit.
    const latest = latestByDevice(await latestReadings([SHED_DEVICE], 30).catch(() => []))[SHED_DEVICE] || {};
    const shed = Object.fromEntries(['shed_temp', 'shed_humidity', 'water_pct', 'feed_pct'].map((m) => [m, latest[m]?.value ?? null]));
    const birds = Number(req.body?.birds) > 0 ? Number(req.body.birds) : lastShed?.count?.count || null;
    const script = vetScript(call, { birds, shed });
    const vets = await listContacts('vet').catch(() => []);
    const calledAt = new Date().toISOString();
    lastShed = { ...(lastShed || {}), vetCall: { ...call, calledAt } };
    return { message, ...script, vet: withNames(vets[0]), simulated: true, calledAt };
  })
);

// ---------- egg sale (v0.8.0): the farmer's rule, simulated shop calls, one-tap deal ----------
async function loadRule() {
  const row = await getSellRule('eggs').catch(() => null);
  return { ...DEFAULT_RULE, ...(row || {}) };
}
async function eggStock() {
  const latest = latestByDevice(await latestReadings([SHED_DEVICE], 30).catch(() => []))[SHED_DEVICE];
  return Math.round(latest?.egg_stock?.value ?? latest?.eggs_today?.value ?? 0);
}
async function eggShops(rule) {
  const all = (await listContacts('shop').catch(() => [])).filter((c) => (c.details?.buys || ['eggs']).includes('eggs'));
  const picked = rule.shop_ids?.length ? all.filter((c) => rule.shop_ids.includes(c.id)) : all;
  return (picked.length ? picked : all).slice(0, 5);
}

// One round of calls: every price from lib/sell.js; Muse Spark voices the shopkeepers in parallel.
async function runSale(lang) {
  const rule = await loadRule();
  const stock = await eggStock();
  const trays = Math.floor(stock / TRAY);
  if (trays < 1) throw new Error('Not enough eggs for one tray yet');
  const shops = await eggShops(rule);
  if (!shops.length) throw new Error('No egg shops saved');
  const day = localToday('Asia/Dhaka');
  const calls = await Promise.all(
    shops.map(async (shop, i) => {
      const plan = planDeal({ shop, floor: Number(rule.floor_price), trays, lang, day, slot: i });
      let lines = null;
      let by = null;
      try {
        const turn = await brainChat({ messages: [{ role: 'user', content: shopPrompt({ shop, lang, plan }) }], maxTokens: 3000, effort: 'low' });
        lines = parseLines(messageText(turn.resp).text);
        by = turn.label;
      } catch (err) {
        console.log('shop voice fallback:', err.message);
      }
      const { turns, spark } = voiceDeal(plan, lang, lines);
      const named = namesOf(shop);
      return { contact_id: shop.id, name: shop.name, names: named.names, villages: named.villages, village: shop.village, turns, price: plan.price, best: plan.best, pickup: plan.pickup, spark, by: spark ? by : null };
    })
  );
  // shops: in the order they were called; ranked: best offer first (for the offers screen).
  const run = { id: newId(), at: new Date().toISOString(), lang, trays, eggs: trays * TRAY, stock, floor: Number(rule.floor_price), status: 'open', shops: calls, ranked: rankOffers(calls).map((s) => s.contact_id) };
  await saveSellRule({ ...rule, last_run: run });
  return run;
}

// Engine hook: when the rule says it is time, ask the farmer (or call the shops on its own).
async function marketTick({ shed }) {
  const rule = await loadRule();
  const { due, trays } = sellDue(rule, shed.egg_stock);
  if (!due) return [];
  const open = rule.last_run?.status === 'open' && Date.now() - new Date(rule.last_run.at).getTime() < 12 * 3600 * 1000;
  if (open) return [];
  if (rule.ask_first) return [{ land_id: null, area: 'market', severity: 'info', title: 'sell_due', source: 'sensor', body: { value: trays } }];
  const run = await runSale(rule.last_run?.lang || 'bn');
  const best = run.shops.find((s) => s.contact_id === run.ranked[0] && s.price);
  return [{ land_id: null, area: 'market', severity: 'info', title: best ? 'sell_offers' : 'sell_low', source: 'sensor', body: { value: best ? best.price : run.trays } }];
}

app.get(
  '/api/sell',
  guard,
  timed(async () => {
    const rule = await loadRule();
    const stock = await eggStock();
    const shops = (await listContacts('shop').catch(() => [])).filter((c) => (c.details?.buys || ['eggs']).includes('eggs')).map(namesOf);
    return { rule, stock, trays: Math.floor(stock / TRAY), tray: TRAY, due: sellDue(rule, stock), shops, simulated: true };
  })
);

app.post(
  '/api/sell/rule',
  guard,
  timed(async (req) => {
    const rule = await saveSellRule(cleanRule(req.body || {}, await loadRule()));
    engine.run().catch(() => null);
    return { rule };
  })
);

// Money tab: confirmed and draft deals, newest first (simulated money).
// v0.19.0: on the demo farm, a demo field with a crop in the ground and no deal yet shows the season's sample
// inputs (seed, fertilizer, ploughing from the fictional demo shop and crew), so its Money tab is not empty.
// Built in, never saved; marked simulated like every demo deal. The sale itself comes after the harvest.
async function sampleDeals(deals, L) {
  const lands = (await listLands().catch(() => [])).filter((l) => l.location_source === 'demo' && l.crop && !deals.some((d) => d.land_id === l.id));
  const full = await Promise.all(lands.map((l) => getLand(l.id).catch(() => l)));
  return full.map((land) => {
    const currency = land.place_info?.currency || currencyFor(land.place_info?.cc);
    const lines = needsFor({ crop: land.crop, acres: land.acres || 1, currency });
    const sown = land.sown_on || addDaysIso(localToday('Asia/Dhaka'), -95);
    return {
      id: `sample-${land.id}`,
      sample: true,
      land_id: land.id,
      direction: 'buy',
      created_at: `${addDaysIso(sown, -3)}T10:00:00Z`,
      items: lines.map((l) => ({ item: l.id, crop: l.crop || null, qty: l.qty, unit: l.unit, price: l.price, currency: currency.code, symbol: currency.symbol, shop: l.id === 'plough' ? DEMO_CREW.name[L] : DEMO_SHOP.name[L], shopReal: false, simulated: true })),
      total_inr: lines.reduce((a, l) => a + l.price, 0),
      status: 'confirmed',
    };
  });
}
const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
app.get(
  '/api/deals',
  guard,
  timed(async (req) => {
    const deals = await listDeals();
    if (currentScope()?.mode === 'demo') deals.push(...(await sampleDeals(deals, pickLang(req.query.lang))));
    return { deals, simulated: true };
  })
);

app.post('/api/sell/run', guard, demoCallCap, timed(async (req) => ({ run: await runSale(pickLang(req.body?.lang || req.query.lang)) })));

// The farmer's one tap: the deal is saved (simulated money) and the sold eggs leave the stock.
app.post(
  '/api/sell/confirm',
  guard,
  timed(async (req) => {
    const rule = await loadRule();
    const run = rule.last_run;
    if (!run || run.id !== req.body?.runId) throw new Error('These offers are no longer open; call the shops again');
    if (run.status !== 'open') throw new Error('This sale is already closed');
    const shop = run.shops.find((s) => s.contact_id === req.body?.contactId);
    if (!shop?.price) throw new Error('This shop did not reach your lowest price');
    const total = shop.price * run.trays;
    const deal = await insertDeal({
      contact_id: /^[0-9a-f-]{36}$/i.test(shop.contact_id) ? shop.contact_id : null,
      direction: 'sell',
      items: [{ item: 'eggs', trays: run.trays, eggs: run.eggs, price_inr_per_tray: shop.price, pickup: shop.pickup, shop: shop.name, simulated: true }],
      total_inr: total,
      status: 'confirmed',
    });
    const now = new Date().toISOString();
    await saveSellRule({ ...rule, last_sold_at: now, last_run: { ...run, status: 'sold', soldTo: shop.contact_id, soldAt: now } });
    const left = Math.max(0, (await eggStock()) - run.eggs);
    await insertReadings([{ device: SHED_DEVICE, area: 'shed', metric: 'egg_stock', value: left }]).catch(() => 0);
    return { deal, total, left, simulated: true };
  })
);

app.post(
  '/api/sell/skip',
  guard,
  timed(async (req) => {
    const rule = await loadRule();
    if (rule.last_run?.id === req.body?.runId && rule.last_run.status === 'open') await saveSellRule({ ...rule, last_run: { ...rule.last_run, status: 'skipped' } });
    return { skipped: true };
  })
);

// Bench: one simulator tick now.
app.post('/api/sensors/tick', guard, adminOnly, timed(async () => ({ summary: await engine.run() })));

// Bench demo control: hold one reading out of range for two ticks so an alert fires on camera.
app.post(
  '/api/sensors/force',
  guard,
  adminOnly,
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
  adminOnly,
  timed(async (req) => {
    const { text, lat, lon } = req.body || {};
    if (!text) throw new Error('text is required');
    const plan = await buildPlan({ lat: Number(lat), lon: Number(lon) }).catch(() => null);
    return runAgent({ userText: String(text).slice(0, 2000), lat: Number(lat), lon: Number(lon), plan });
  })
);

// Bench: one real tool call on Muse Spark Open (Baseten), no fallback, so the row shows the open model itself.
app.post(
  '/api/open-check',
  guard,
  adminOnly,
  timed(async () => {
    if (!hasOpenKey()) throw new Error('BASETEN_API_KEY missing in Railway Variables');
    const tools = [{ type: 'function', function: { name: 'get_egg_count', description: 'Eggs collected in the shed today', parameters: { type: 'object', properties: {} } } }];
    const messages = [{ role: 'user', content: 'How many eggs were collected today? Use the tool, then answer in one short sentence.' }];
    const first = await openChat({ messages, tools, maxTokens: 2000, effort: 'low' });
    const call = first.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return { model: OPEN.model, toolCall: false, answer: messageText(first).text, usage: first.usage || null };
    messages.push({ role: 'assistant', content: first.choices[0].message.content ?? '', tool_calls: [call] });
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ eggs: 214 }) });
    const second = await openChat({ messages, tools, maxTokens: 2000, effort: 'low' });
    return { model: OPEN.model, toolCall: call.function?.name, answer: messageText(second).text, usage: second.usage || null };
  })
);

// Soil, weather and crop calendar for any point (or a demo place), for the bench.
app.get(
  '/api/plan',
  guard,
  adminOnly,
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
  adminOnly,
  timed(async (req) => {
    const scan = await scanLand({ lat: Number(req.query.lat), lon: Number(req.query.lon) });
    return { image: scan.image.dataUrl, imagePx: scan.image.width, objects: scan.objects, plot: scan.plot?.id ?? null, acres: scan.plot?.acres ?? null, sam: scan.sam };
  })
);

app.get(
  '/api/tile',
  guard,
  adminOnly,
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
  adminOnly,
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
  adminOnly,
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
    // voice 'vet': the simulated vet in the demo call speaks with a second voice.
    const opts = req.body?.voice === 'vet' ? { voice: TTS.vetVoice, style: 'calm, kind and professional, an animal doctor on a phone call' } : req.body?.voice === 'shop' ? { voice: TTS.shopVoice, style: 'friendly, quick village shopkeeper on a phone call' } : {};
    const { wav, chars } = await synthesize(text, opts);
    return {
      audioDataUrl: `data:audio/wav;base64,${wav.toString('base64')}`,
      chars,
      seconds: wav.length > 44 ? Math.round(((wav.length - 44) / 48000) * 10) / 10 : 0,
    };
  })
);

app.listen(PORT, () => {
  console.log(`Khet Sathi v${VERSION} on :${PORT} (meta key: ${hasKey()}, db: ${dbConfigured() ? 'supabase' : 'memory'}, meta route: ${relayInfo() ? `relay ${relayInfo().host}` : 'direct'})`);
  // v0.19.0: shortly after start and every 3 hours, read the demo farm's weather and satellite once, so a
  // kept copy is ready before anyone opens it (judges see earlier data, marked, if a source is down).
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(warmDemo, 20000).unref?.();
    setInterval(warmDemo, 3 * 3600 * 1000).unref?.();
  }
});
async function warmDemo() {
  const t0 = Date.now();
  const scope = { mode: 'demo', owner: null, readOnly: true, admin: false };
  const done = await runAs({ id: 'warm-up', email: 'warm-up' }, async () => {
    let n = 0;
    // The list leaves out the field outline, so each land is read in full first.
    for (const row of await listLands().catch(() => [])) {
      const land = await getLand(row.id).catch(() => null);
      if (!(land?.objects || []).length) continue;
      await planForLand(land).catch(() => null);
      await healthFor(land).catch(() => null);
      n++;
    }
    for (const y of (await listYards().catch(() => [])).filter((x) => x.size_m2)) {
      await yardDetails(y).catch(() => null);
      n++;
    }
    // v0.19.3: demo yards and the demo leaf still waiting for SAM.
    for (const y of (await listYards().catch(() => [])).filter((x) => x.demo && !x.outline)) {
      lastRetry.delete(`yard|${y.id}`);
      retryLater(`yard|${y.id}`, () => retryYardOutline(y.id));
    }
    lastRetry.delete('leaf');
    retryLater('leaf', () => retryLeaf(leafDeps()));
    return n;
  }, scope).catch(() => 0);
  console.log(`demo warm-up: ${done} places in ${Math.round((Date.now() - t0) / 1000)} s`);
}
