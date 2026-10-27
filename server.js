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
import { buildPlan, localToday, placeForLand } from './lib/plan.js';
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
} from './lib/store.js';
import { runAs, currentOwner, currentScope, scopeFor, isAdmin, userFromToken, sendCode, verifyCode, refreshSession, signOut, useLimit, LIMITS, usageToday, listUsers, seenUsers } from './lib/auth.js';
import { runChecks } from './lib/checks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = env('PORT', '3000');
const VERSION = '0.14.0';

app.use(express.json({ limit: '15mb' }));
// v0.11.0: the new app is the main app at /; the classic app stays at /classic/ as a backup.
const PUB = path.join(__dirname, 'public');
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(PUB, 'app.html')));
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
const RO_TALK = /^\/api\/(ask|speak|transcribe|vet\/message)$/;
const RO_DEMO_CALLS = /^\/api\/(vet\/call|sell\/run|lands\/[^/]+\/(order|harvest\/run|harvest\/book))$/;
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
    health = await fieldHealth({ lat: land.lat, lon: land.lon, rings, today: localToday('Asia/Dhaka') });
    healthCache.set(key, { at: Date.now(), health });
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
app.get('/api/sheds', guard, timed(async () => ({ sheds: await listSheds() })));
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
    return { shed };
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
app.post(
  '/api/ask',
  guard,
  timed(async (req) => {
    const { text, landId, shedId, lang } = req.body || {};
    if (!text) throw new Error('text is required');
    useLimit('ask');
    // v0.11.3: a shed is picked, so Sathi answers about the shed (kit, eggs, sell rule, last camera check).
    if (shedId) return askShed(String(text), String(shedId), lang);
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
        if (plan) plan.demoLand = land.location_source === 'demo';
        context = [
          land.kind === 'empty' ? 'the land is empty, nothing planted yet' : `there is a standing crop${land.crop ? ` (${land.crop})` : ''}`,
          land.acres ? `plot size about ${land.acres} acres (measured from satellite)` : 'plot size unknown',
        ].join('; ');
        // v0.12.0: a standing crop: its sowing date, harvest window and expected amount.
        if (land.kind === 'crop' && land.crop) {
          const s = await harvestState(land).catch(() => null);
          if (s?.ready) context += `; sown ${s.sownOn}${s.estimated ? ' (estimated from satellite greenness)' : ''}; harvest window ${s.ready.harvestStart} to ${s.ready.harvestEnd}; stage ${s.ready.stage}, ${s.ready.pct}% of the way to harvest`;
          if (s?.amount) context += `; expected harvest about ${s.amount.units} ${s.unit.key === 'mon' ? 'maund (40 kg)' : s.unit.key === 'quintal' ? 'quintal' : 'x 100 kg'} (country average yield, FAOSTAT)`;
          context += plan?.demoLand ? '; the harvest booking and buyer calls in the Market tab are a demo' : '; no live crop prices yet, and calling buyers is coming soon';
        }
      }
    }
    if (!landId) plan = await buildPlan({ lat, lon, place: 'bogura' }).catch(() => null);
    if (!landId && plan) plan.demoLand = true;
    return runAgent({ userText: String(text).slice(0, 2000), lat, lon, context, noField, plan });
  })
);

async function askShed(text, shedId, lang) {
  const sheds = await listSheds();
  const shed = sheds.find((s) => String(s.id) === shedId) || sheds[0];
  const demo = Boolean(shed?.demo || shed?.builtIn);
  const latest = latestByDevice(await latestReadings([SHED_DEVICE], 30).catch(() => []))[SHED_DEVICE] || null;
  const index = await readIndex().catch(() => ({ clips: [] }));
  const mine = index.clips.filter((c) => (demo ? !c.shedId : c.shedId === shed?.id) && c.result?.count);
  const last = mine.sort((a, b) => String(b.result.checkedAt).localeCompare(String(a.result.checkedAt)))[0]?.result;
  const check = last ? { when: last.checkedAt, count: last.count.count, still: last.count.still?.length || 0, resting: Boolean(last.count.resting), unusualSound: Boolean(last.observation?.unusualSound) } : null;
  const facts = shedFacts({ shed, kit: latest, stock: await eggStock().catch(() => null), tray: TRAY, rule: await loadRule().catch(() => null), check, night: isNight(shedHour()) });
  const out = await shedAnswer({ text, lang: pickLang(lang), facts });
  return { ...out, trace: [], mode: 'shed' };
}

// ---------- alerts + simulated village sensor kit ----------
const engine = createEngine({
  store: { listLands, getLand, latestReadings, insertReadings, recentAlerts, insertAlerts },
  planForLand,
  camera: todayCamera,
  market: marketTick,
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
app.get('/api/deals', guard, timed(async () => ({ deals: await listDeals(), simulated: true })));

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
  console.log(`Khet Sathi v${VERSION} on :${PORT} (meta key: ${hasKey()}, db: ${dbConfigured() ? 'supabase' : 'memory'})`);
});
