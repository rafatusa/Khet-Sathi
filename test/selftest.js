// Offline self-test: no API key or network needed.
// Run: npm test
process.env.META_LOG = 'off'; // v0.20.0: Meta log lines are for Railway, not for the test output
import assert from 'node:assert/strict';
import { collectSegments } from '../lib/segment.js';
import { transcriptText, messageText, toResponsesInput, toResponsesTools, fromResponses } from '../lib/meta.js';
import { bboxFor, minHalfSide, zoomCenter } from '../lib/tile.js';
import { cleanForSpeech, extractAudio, ensureWav } from '../lib/tts.js';
import { acresFromPx, pickPlot, inSouthAsia, dropBlobs } from '../lib/plot.js';
import { env } from '../lib/env.js';
import { scanLand, choosePass } from '../lib/scan.js';
import { plotProfile, cropWindows, sowingCalendar } from '../lib/agent.js';
import { textureClass, summarizeSoilGrids, soilForLand } from '../lib/soil.js';
import { summarizeForecast, rainAdvice } from '../lib/weather.js';
import { windowState, windowsFor, aezFor, normalizeFao, calendarFor, FAO_KEYS } from '../lib/calendar.js';
import { recommendCrops } from '../lib/recommend.js';
import { buildPlan } from '../lib/plan.js';
import { readFileSync } from 'node:fs';
import { seedField, stepField, stepShed, seedShed, latestByDevice, fieldDevice, lightScheduled, isNight } from '../lib/sensors.js';
import { analyseFrames, safeText, parseObservation } from '../lib/poultry.js';
import { responseText } from '../lib/meta.js';
import { fieldAlerts, shedAlerts, cameraAlerts, dedupe, realOnly } from '../lib/alerts.js';
import * as clipsLib from '../lib/clips.js';
import { parsePath, fieldPolygonM, inRings, areaAcres } from '../lib/fieldgeo.js';
import { passesFromStac, readPass, zonesFrom, zoneShape, nextPass, fieldHealth } from '../lib/sentinel.js';
import { brainChat, OPEN } from '../lib/brain.js';
import { runAgent } from '../lib/agent.js';
import { DEFAULT_RULE, TRAY, cleanRule, sellDue, planDeal, voiceDeal, parseLines, rankOffers, shopPrompt } from '../lib/sell.js';
import { autoSigns, vetMessage, vetScript, withNames, cleanCall, parseDeaths, parseSince, SIGN_CODES } from '../lib/vetcall.js';
import { createEngine } from '../lib/engine.js';
import * as memStore from '../lib/store.js';
import { scopeFor, runAs, devId, currentOwner, sendCode, verifyCode, refreshSession, userFromToken, useLimit, LIMITS, cleanEmail, friendly } from '../lib/auth.js';
import { buyerQuery } from '../lib/place.js';
import { CAPABILITIES } from '../lib/agent.js';
import { shedSystem } from '../lib/shedchat.js';
import { sowingFromPasses, rowFor, readiness, harvestAmount, unitFor, samplePrice, DEMO_BUYERS, planCropDeal, voiceCropDeal, cleanCropRule } from '../lib/harvest.js';
import sharp from 'sharp';
import { createLand, getLand, putFile, getFile, deleteLand, deleteFiles } from '../lib/store.js';
import { addressParts, coverShares, verdictFrom, worldCoverTile, shopsFromOverpass, currencyFor, cleanShopName, nearbyShops } from '../lib/place.js';
import { worldCalendar, worldCrops, cellCrops, matchUnit, normName, fixSeason, knownCountry } from '../lib/cropworld.js';
import { parsePicks, pickPrompt } from '../lib/croppick.js';
import { needsFor, orderCalls } from '../lib/market.js';
import { parseNames, namesPrompt, parseNotes, threeNotes } from '../lib/translate.js';
import { shedFacts, shedAnswer } from '../lib/shedchat.js';
import { eggsPerDay } from '../lib/sensors.js';

// SAM 3.1 sample output from Meta's documentation, split across deltas.
const outputText =
  '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334;c=0.91|>' +
  "<|mask;x=0;y=0;c=0.91;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
  ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>' +
  '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';

async function* events() {
  const split = outputText.indexOf(',1<|box');
  const base = { item_id: 'm', output_index: 0, content_index: 0 };
  yield { type: 'response.output_text.delta', ...base, delta: outputText.slice(0, split) };
  yield { type: 'response.output_text.delta', ...base, delta: outputText.slice(split) };
  yield { type: 'response.output_text.done', ...base, text: outputText };
  yield { type: 'response.completed' };
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', `${name} - ${e.message}`]);
  }
}

const seg = await collectSegments(events());
// Point inside object 0's box (211..271, 228..255) near its middle.
const segPt = await collectSegments(events(), { point: { x: 240, y: 242 } });
check('SAM parse: stream completed', () => assert.equal(seg.outcome.status, 'completed'));
check('SAM parse: 2 objects found', () => assert.equal(seg.objects.length, 2));
check('SAM parse: box + confidence read', () => {
  assert.deepEqual(seg.objects[0].box, { left: 211, top: 228, right: 271, bottom: 255 });
  assert.equal(seg.objects[0].confidence, 0.91);
});
check('SAM parse: masks decode to SVG paths', () => {
  for (const o of seg.objects) assert.ok(o.mask?.svgPath?.startsWith('M'));
});
check('Transcript extraction (turns shape)', () =>
  assert.equal(transcriptText({ turns: [{ transcript: 'नमस्ते' }, { transcript: 'ভাই' }] }), 'नमस्ते ভাই')
);
check('Transcript extraction (flat shape)', () => assert.equal(transcriptText({ transcript: 'hello' }), 'hello'));
check('Spark text: string content', () =>
  assert.deepEqual(messageText({ choices: [{ message: { content: ' hi ' }, finish_reason: 'stop' }] }), { text: 'hi', finishReason: 'stop' })
);
check('Spark text: empty content reports finish_reason', () =>
  assert.deepEqual(messageText({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }), { text: '', finishReason: 'length' })
);
check('Spark text: array content', () =>
  assert.equal(messageText({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] }).text, 'ab')
);
check('TTS: markdown stripped before speaking', () =>
  assert.equal(cleanForSpeech('**গম** বীজ\n- DAP সার # মোট'), 'গম বীজ\nDAP সার মোট')
);
check('TTS: audio found in steps[].content[]', () =>
  assert.equal(extractAudio({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: 'QUJD' }] }] }), 'QUJD')
);
check('TTS: audio found in output_audio', () => assert.equal(extractAudio({ output_audio: { data: 'WFla' } }), 'WFla'));
check('TTS: raw PCM gets a WAV header, WAV passes through', () => {
  const wrapped = ensureWav(Buffer.alloc(480));
  assert.equal(wrapped.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wrapped.readUInt32LE(24), 24000);
  assert.equal(ensureWav(wrapped), wrapped);
});
check('Plot: mask area is positive and within its box', () => {
  for (const o of segPt.objects) {
    const boxArea = (o.box.right - o.box.left) * (o.box.bottom - o.box.top);
    assert.ok(o.areaPx > 0 && o.areaPx <= boxArea, `area ${o.areaPx} vs box ${boxArea}`);
  }
});
check('Plot: GPS point found inside the right field', () => {
  assert.equal(segPt.objects.find((o) => o.id === '0').containsPoint, true);
  assert.equal(segPt.objects.find((o) => o.id === '1').containsPoint, false);
  assert.equal(pickPlot(segPt.objects, { width: 320, height: 334 }).id, '0');
});
check('Plot: nearest field picked when point is outside all fields', () => {
  const objs = [
    { id: 'a', box: { left: 0, top: 0, right: 10, bottom: 10 }, containsPoint: false },
    { id: 'b', box: { left: 140, top: 150, right: 180, bottom: 190 }, containsPoint: false },
  ];
  assert.equal(pickPlot(objs, { width: 320, height: 334 }).id, 'b');
});
check('Plot: acres from pixels (600 m view, 1024 px)', () => {
  // 1 acre = 4046.86 m2; at 600/1024 m per px, 1 acre ≈ 11,788 px
  assert.equal(acresFromPx(11788, 600, 1024), 1);
  assert.equal(acresFromPx(0, 600, 1024), null);
});
check('Plot: South Asia bounds', () => {
  assert.equal(inSouthAsia(23.64, 87.73), true);
  assert.equal(inSouthAsia(39.1, -77.5), false);
});
check('Satellite: never sharper than Esri allows', () => {
  assert.ok(minHalfSide(0, 1024) >= 317);
  assert.ok(minHalfSide(23.64, 1024) <= 300);
  assert.ok(minHalfSide(30.91, 1024) <= 300);
});
check('Satellite bbox is square and centred', () => {
  const [x1, y1, x2, y2] = bboxFor(30.91, 75.62, 300);
  assert.ok(Math.abs(x2 - x1 - (y2 - y1)) < 0.01);
});


// ---------- v0.3.1 ----------
check('Env: Windows line endings and invisible characters removed', () => {
  process.env.KS_TEST_VAR = 'sam-3.1\r\n';
  assert.equal(env('KS_TEST_VAR'), 'sam-3.1');
  process.env.KS_TEST_VAR = '\uFEFFmuse-spark-1.3\u200B ';
  assert.equal(env('KS_TEST_VAR'), 'muse-spark-1.3');
  process.env.KS_TEST_VAR = '  \r';
  assert.equal(env('KS_TEST_VAR', 'fallback'), 'fallback');
  delete process.env.KS_TEST_VAR;
  assert.equal(env('KS_TEST_VAR', 'x'), 'x');
});
check('Plot: whole-image blob dropped, real fields kept', () => {
  const objs = [
    { id: 'blob', areaPx: 0.64 * 1024 * 1024 },
    { id: 'plot', areaPx: 9000 },
    { id: 'boxOnly', box: { left: 0, top: 0, right: 100, bottom: 100 } },
  ];
  assert.deepEqual(dropBlobs(objs, 1024).map((o) => o.id), ['plot', 'boxOnly']);
});
check('Plot: acres on the zoomed 225 m view', () => {
  // at 225/1024 m per px, 1 acre ≈ 83,830 px
  assert.equal(acresFromPx(83830, 225, 1024), 1);
});
check('Scan: pass covering the farmer point wins', () => {
  const zoom = { view: 'zoom', objects: [{ id: 'a', containsPoint: false }] };
  const full = { view: 'full', objects: [{ id: 'b', containsPoint: true }] };
  assert.equal(choosePass([zoom, full]).view, 'full');
});
check('Scan: nothing found keeps the close-up, all errors keep the wide view', () => {
  assert.equal(choosePass([{ view: 'zoom', objects: [] }, { view: 'full', objects: [] }]).view, 'zoom');
  assert.equal(choosePass([{ view: 'zoom', objects: [], error: 'x' }, { view: 'full', objects: [], error: 'y' }]).view, 'full');
});
check('Agent: no plot profile invented when no field was found', () => {
  assert.ok(plotProfile({ lat: 1, lon: 2 }, { noField: true }).error);
  assert.ok(plotProfile({ lat: 1, lon: 2 }).error, 'no plan means no made-up soil');
  assert.deepEqual(cropWindows({ noField: true }).crops, []);
});

async function checkAsync(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', `${name} - ${e.message}`]);
  }
}

// A 1024 px test picture: left half dark, right half light.
const testJpeg = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 40, g: 90, b: 40 } } })
  .composite([{ input: { create: { width: 512, height: 1024, channels: 3, background: { r: 220, g: 200, b: 150 } } }, left: 512, top: 0 }])
  .jpeg()
  .toBuffer();
const fullImage = { dataUrl: `data:image/jpeg;base64,${testJpeg.toString('base64')}`, width: 1024, height: 1024, groundMeters: 600 };

await checkAsync('Zoom: centre 384 px enlarged to 1024 px covers 225 m', async () => {
  const z = await zoomCenter(fullImage, { keepPx: 384, outPx: 1024 });
  const meta = await sharp(Buffer.from(z.dataUrl.split(',')[1], 'base64')).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
  assert.equal(z.groundMeters, 225);
});

await checkAsync('Scan: zoomed "field" pass used first; wide pass skipped once the plot is found', async () => {
  const asked = [];
  const r = await scanLand({
    lat: 23.64,
    lon: 87.73,
    fetchImage: async () => fullImage,
    segment: async (image, prompt) => {
      asked.push(`${image.groundMeters}:${prompt}`);
      return { objects: [{ id: '7', box: { left: 480, top: 480, right: 560, bottom: 560 }, areaPx: 6400, containsPoint: true }] };
    },
  });
  assert.deepEqual(asked, ['225:field']);
  assert.equal(r.sam.view, 'zoom');
  assert.equal(r.image.groundMeters, 225);
  assert.equal(r.plot.id, '7');
  assert.ok(r.plot.acres > 0 && r.plot.acres < 0.1);
});

await checkAsync('Scan: falls back to wide "farm field" when the close-up finds only a blob', async () => {
  const r = await scanLand({
    lat: 30.91,
    lon: 75.62,
    fetchImage: async () => fullImage,
    segment: async (image, prompt) =>
      prompt === 'field'
        ? { objects: [{ id: 'blob', box: { left: 0, top: 0, right: 1024, bottom: 1024 }, areaPx: 700000, containsPoint: true }] }
        : { objects: [{ id: '3', box: { left: 400, top: 400, right: 600, bottom: 600 }, areaPx: 40000, containsPoint: true }] },
  });
  assert.equal(r.sam.view, 'full');
  assert.equal(r.image.groundMeters, 600);
  assert.equal(r.plot.id, '3');
  assert.deepEqual(r.sam.passes.map((p) => [p.view, p.found, p.kept]), [['zoom', 1, 0], ['full', 1, 1]]);
});

await checkAsync('Scan: SAM errors are reported, not hidden', async () => {
  const r = await scanLand({
    lat: 23.64,
    lon: 87.73,
    fetchImage: async () => fullImage,
    segment: async () => {
      throw new Error('model_not_found: sam-3.1\r');
    },
  });
  // v0.14.0: SAM down: one labelled 1-acre estimate stands in, and the error is still reported.
  assert.equal(r.objects.length, 1);
  assert.equal(r.objects[0].approx, true);
  assert.ok(Math.abs(r.plot.acres - 1) < 0.1, `about 1 acre (${r.plot.acres})`);
  assert.equal(r.sam.approx, true);
  assert.equal(r.image.groundMeters, 600);
  assert.match(r.sam.error, /zoom: model_not_found/);
});

await checkAsync('Delete: land row and both pictures removed (memory store)', async () => {
  const land = await createLand({ kind: 'empty', lat: 23.64, lon: 87.73, tile_path: 'x/tile.jpg', photo_path: 'x/photo.jpg' });
  await putFile('x/tile.jpg', Buffer.from('t'), 'image/jpeg');
  await putFile('x/photo.jpg', Buffer.from('p'), 'image/jpeg');
  assert.equal(await deleteLand(land.id), true);
  assert.equal(await getLand(land.id), null);
  assert.equal(await deleteFiles([land.tile_path, land.photo_path, null]), 2);
  assert.equal(await getFile('x/tile.jpg'), null);
  assert.equal(await deleteLand(land.id), false);
});

// ---------- v0.4.0: soil, weather, sowing windows ----------
const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const faoSaved = JSON.parse(readFileSync(new URL('../lib/data/fao-bd-calendar.json', import.meta.url), 'utf8')).records;
const TODAY = '2026-10-27';

check('Soil: USDA texture triangle', () => {
  assert.equal(textureClass(26.5, 42, 31.5), 'clay_loam');
  assert.equal(textureClass(18.4, 45.5, 36.1), 'silty_clay_loam');
  assert.equal(textureClass(40, 40, 20), 'loam');
  assert.equal(textureClass(90, 5, 5), 'sand');
  assert.equal(textureClass(10, 30, 60), 'clay');
});
check('Soil: SoilGrids topsoil for Bolpur and Bogura (real responses, Oct 27)', () => {
  const bol = summarizeSoilGrids(fx('sg_bolpur'));
  const bog = summarizeSoilGrids(fx('sg_bogura'));
  assert.equal(bol.texture, 'clay_loam');
  assert.equal(bog.texture, 'silty_clay_loam');
  assert.equal(bog.ph, 6.4);
});
check('Weather: Open-Meteo forecast and rain advice for Bogura (real response)', () => {
  const w = summarizeForecast(fx('om_bogura'));
  assert.equal(w.days.length, 10);
  assert.equal(w.rainNext10Mm, 22.9);
  const r = rainAdvice(w.days, TODAY);
  assert.deepEqual([r.rainDate, r.sowBefore, r.sowAfter], ['2026-10-29', '2026-10-28', '2026-10-31']);
  assert.equal(rainAdvice(w.days.map((d) => ({ ...d, rainChance: 5, rainMm: 0 })), TODAY), null);
});
check('Calendar: sowing windows across the new year', () => {
  assert.deepEqual(windowState([10, 1, 10, 30], TODAY), { state: 'now', start: '2026-10-01', end: '2026-10-30', daysLeft: 3 });
  assert.equal(windowState([11, 1, 12, 15], TODAY).daysUntil, 5);
  const wrap = windowState([12, 1, 1, 15], '2027-01-10');
  assert.equal(wrap.state, 'now');
  assert.equal(wrap.end, '2027-01-15');
});
check('Calendar: FAO zone only exact for the demo plot; none for India', () => {
  assert.deepEqual(aezFor({ place: 'bogura', lat: 24.88, lon: 89.33 }), { aez: '4. Karatoya-Bangali Floodplain', assumed: false });
  assert.equal(aezFor({ lat: 23.8, lon: 90.4 }).assumed, true);
  assert.equal(aezFor({ place: 'bolpur', lat: 23.64, lon: 87.73 }).aez, null);
});
check('Calendar: FAO API shape normalised like the saved copy', () => {
  const one = normalizeFao([{ crop: { name: 'Mustard' }, aez: { name: 'Z' }, sessions: [{ early_sowing: { month: '10', day: '1' }, later_sowing: { month: '10', day: '30' }, early_harvest: { month: '12', day: '10' }, late_harvest: { month: '12', day: '20' }, growing_period: { value: '70 - 90', period: 'days' } }] }]);
  assert.deepEqual(one[0].sow, [10, 1, 10, 30]);
});
check('Recommend: Bogura on Oct 27 gives mustard, bottle gourd, potato', () => {
  const soil = summarizeSoilGrids(fx('sg_bogura'));
  const crops = recommendCrops(windowsFor(faoSaved, '4. Karatoya-Bangali Floodplain', TODAY), soil);
  assert.deepEqual(crops.map((c) => [c.key, c.status]), [['mustard', 'closing'], ['bottle_gourd', 'closing'], ['potato', 'soon']]);
  assert.equal(crops[0].daysLeft, 3);
  assert.deepEqual(crops[0].growDays, { min: 70, max: 90 });
});
check('Recommend: heavy clay drops potato and mustard', () => {
  const crops = recommendCrops(windowsFor(faoSaved, '4. Karatoya-Bangali Floodplain', TODAY), { texture: 'clay', ph: 6.5 });
  assert.ok(!crops.some((c) => c.key === 'potato' || c.key === 'mustard'));
});

// Fake network: answers SoilGrids, Open-Meteo and FAO from the saved real responses.
// v0.11.0: the place check (OpenStreetMap + ESA WorldCover) and Muse Spark crop picks, offline.
const fakePlace = (cc, country, cover = { crop: 0.4, tree: 0.3, grass: 0.3 }) => ({
  fetchImpl: async () => ({ ok: true, json: async () => ({ category: 'place', type: 'village', address: { village: 'Test village', state: 'Test state', country, country_code: cc.toLowerCase() } }) }),
  landCover: async () => cover,
});
const noThink = async () => {
  throw new Error('offline');
};
const fakeFetch = (fail = []) => async (url) => {
  const u = String(url);
  const which = u.includes('soilgrids') ? 'soil' : u.includes('open-meteo') ? 'weather' : 'fao';
  if (fail.includes(which)) throw new Error(`${which} down`);
  const lat = Number(new URL(u).searchParams.get('lat') || new URL(u).searchParams.get('latitude'));
  const place = lat > 30 ? 'punjab' : lat > 24 ? 'bogura' : 'bolpur';
  const body = which === 'soil' ? fx(`sg_${place}`) : which === 'weather' ? fx(`om_${place}`) : [];
  return { ok: true, status: 200, json: async () => body };
};

await checkAsync('Plan: Bogura demo land end to end (soil, weather, zone, 3 crops)', async () => {
  // v0.19.1: soil moisture is read at the current hour of the recorded forecast, so the clock is pinned to
  // noon on TODAY in Dhaka (the test failed from the evening of Oct 28 once the recorded soil got wetter).
  const realNow = Date.now;
  Date.now = () => Date.parse(`${TODAY}T06:00:00Z`);
  let p;
  try {
    (await import('../lib/weather.js'))._resetWeatherCache();
    p = await buildPlan({ place: 'bogura', lat: 24.88, lon: 89.33 }, { fetchImpl: fakeFetch(['fao']), today: TODAY, placeDeps: fakePlace('BD', 'Bangladesh'), think: noThink });
  } finally {
    Date.now = realNow;
  }
  assert.equal(p.soil.texture, 'silty_clay_loam');
  assert.equal(p.weather.soilMoistureLevel, 'dry');
  assert.equal(p.rain.rainDate, '2026-10-29');
  assert.equal(p.aez, '4. Karatoya-Bangali Floodplain');
  assert.match(p.calendarSource, /saved copy/);
  assert.equal(p.crops.length, 3);
});
await checkAsync('Plan v0.11.0: Bolpur (India) gets Indian crops from FAOSTAT + GGCMI, in rupees', async () => {
  const p = await buildPlan({ place: 'bolpur', lat: 23.64, lon: 87.73 }, { fetchImpl: fakeFetch(), today: TODAY, placeDeps: fakePlace('IN', 'India'), think: noThink });
  assert.equal(p.soil.texture, 'clay_loam');
  assert.ok(p.weather);
  assert.equal(p.aez, null);
  assert.equal(p.place.cc, 'IN');
  assert.equal(p.currency.code, 'INR');
  assert.ok(p.crops.length >= 1);
  assert.ok(p.calendar.every((c) => c.status && c.windowStart));
  assert.match(p.calendarSource, /MIRCA-OS/);
  assert.ok(!p.crops.some((c) => c.key === 'soybean' && c.status === 'later'));
});
await checkAsync('Plan v0.11.0: a residential spot gets no crops at all', async () => {
  const p = await buildPlan({ lat: 23.7465, lon: 90.376 }, { fetchImpl: fakeFetch(), today: TODAY, placeDeps: fakePlace('BD', 'Bangladesh', { built: 0.89, tree: 0.01 }), think: noThink });
  assert.equal(p.blocked, true);
  assert.equal(p.place.verdict, 'built');
  assert.deepEqual(p.crops, []);
  assert.deepEqual(p.calendar, []);
  assert.equal(cropWindows({ plan: p }).crops.length, 0);
  assert.match(plotProfile({}, { plan: p }).is_farmland, /^NO/);
});
await checkAsync('Plan v0.11.0: an Iowa farm gets US crops only, in dollars; Muse Spark picks from that list', async () => {
  const think = async () => ({ label: 'stub', resp: { choices: [{ message: { content: '{"picks":[{"key":"wheat","why_en":"winter wheat goes in now"},{"key":"jute","why_en":"not in list"}]}' } }] } });
  const p = await buildPlan({ lat: 42.03, lon: -93.6 }, { fetchImpl: fakeFetch(), today: TODAY, placeDeps: fakePlace('US', 'United States', { crop: 0.6, grass: 0.2 }), think });
  assert.equal(p.currency.symbol, '$');
  assert.ok(p.calendar.length && p.calendar.every((c) => c.key !== 'mustard'));
  if (p.calendar.some((c) => c.key === 'wheat' && c.status !== 'later')) {
    assert.deepEqual(p.crops.map((c) => c.key), ['wheat']);
    assert.equal(p.picksBy, 'stub');
  }
});
check('Place: address parts, cover shares, verdicts, WorldCover tile names, currencies', () => {
  const a = addressParts({ category: 'landuse', type: 'residential', address: { village: 'Bolpur', state_district: 'Birbhum', state: 'West Bengal', country: 'India', country_code: 'in' } });
  assert.equal(a.cc, 'IN');
  assert.equal(a.district, 'Birbhum');
  assert.deepEqual(coverShares([40, 40, 50, 10]), { crop: 0.5, built: 0.25, tree: 0.25 });
  assert.equal(verdictFrom({ cover: { built: 0.89 } }), 'built');
  assert.equal(verdictFrom({ cover: { water: 0.7 } }), 'water');
  assert.equal(verdictFrom({ cover: { crop: 0.5 } }), 'cropland');
  assert.equal(verdictFrom({ cover: { tree: 0.5, grass: 0.4 } }), 'mixed');
  assert.equal(verdictFrom({ cover: { crop: 0.05, tree: 0.3 }, osmClass: 'landuse', osmType: 'residential' }), 'built');
  assert.match(worldCoverTile(23.68, 87.68), /_N21E087_Map\.tif$/);
  assert.match(worldCoverTile(42.03, -93.6), /_N42W096_Map\.tif$/);
  assert.match(worldCoverTile(-1.3, 36.8), /_S03E036_Map\.tif$/);
  assert.equal(currencyFor('bd').symbol, '৳');
  assert.equal(currencyFor('ZZ').code, 'USD');
});
check('Place: real shops from OpenStreetMap, nearest first, unnamed dropped', () => {
  const s = shopsFromOverpass({ elements: [{ type: 'node', id: 1, lat: 23.65, lon: 87.73, tags: { shop: 'agrarian', name: 'Far shop' } }, { type: 'way', id: 2, center: { lat: 23.641, lon: 87.731 }, tags: { shop: 'agrarian', name: 'Near shop' } }, { type: 'node', id: 3, lat: 23.64, lon: 87.73, tags: { shop: 'agrarian' } }] }, { lat: 23.64, lon: 87.73 });
  assert.deepEqual(s.map((x) => x.name), ['Near shop', 'Far shop']);
  assert.ok(s.every((x) => x.real && x.source === 'OpenStreetMap'));
});
check('Crops anywhere: MIRCA-OS district crops and months, no foreign crops', () => {
  assert.ok(knownCountry('IN') && knownCountry('US') && !knownCountry('ZZ'));
  assert.equal(normName('Bogura District'), 'bogura');
  assert.equal(matchUnit('BD', { state: 'Rajshahi Division', district: 'Bogura District' }).name, 'Bogra');
  assert.equal(matchUnit('IN', { state: 'West Bengal', district: 'Birbhum' }).scope, 'district');
  assert.equal(matchUnit('US', { state: 'Iowa', county: 'Story County' }).name, 'Story');
  // Birbhum in late October: mustard closing, then rabi rice, pulses, potato, wheat in November.
  const wb = worldCalendar({ cc: 'IN', lat: 23.64, lon: 87.73, today: '2026-10-28', place: { state: 'West Bengal', district: 'Birbhum' } });
  assert.equal(wb[0].key, 'mustard');
  assert.equal(wb[0].status, 'closing');
  assert.ok(['wheat', 'pulses', 'potato'].every((k) => wb.some((c) => c.key === k && c.status === 'soon')));
  // Story County, Iowa: maize and soybean only, sown in spring; nothing Bangladeshi.
  const ia = worldCalendar({ cc: 'US', lat: 42.03, lon: -93.6, today: '2026-10-28', place: { state: 'Iowa', county: 'Story County' } });
  assert.deepEqual([...new Set(ia.map((c) => c.key))].sort(), ['maize', 'soybean']);
  assert.ok(ia.every((c) => c.status === 'later'));
  assert.deepEqual(worldCrops(ia, null).map((c) => c.key), ['maize', 'soybean']);
  // Ludhiana wheat is a winter crop even where MIRCA-OS lists it in June.
  assert.deepEqual(fixSeason('IN', 'Punjab', 'wheat', 6, 10), [11, 3]);
  assert.deepEqual(fixSeason('IN', 'Himachal Pradesh', 'potato', 6, 10), [6, 10]);
  const pb = worldCalendar({ cc: 'IN', lat: 30.91, lon: 75.62, today: '2026-10-28', place: { state: 'Punjab', district: 'Ludhiana' } });
  assert.ok(pb.some((c) => c.key === 'wheat' && c.windowStart.slice(5, 7) === '11'));
  // No district match: the 9 km cell's crops, ranked by the country.
  assert.ok(cellCrops(23.64, 87.73).length > 5);
  assert.equal(worldCalendar({ cc: 'ZZ', lat: 0, lon: -30, today: TODAY }).length, 0);
});
await checkAsync('Shops v0.11.1: Google Places names cleaned, only within 15 km, nearest first', async () => {
  assert.equal(cleanShopName('🌱🌾Maa Durga krishi Bhander🌾🌱'), 'Maa Durga krishi Bhander');
  assert.equal(cleanShopName('Ma tara  krishi ( ) bhandar'), 'Ma tara krishi bhandar');
  const before = process.env.GOOGLE_PLACES_KEY;
  process.env.GOOGLE_PLACES_KEY = 'test-key';
  const places = [
    { id: 'a', displayName: { text: 'Far shop' }, location: { latitude: 23.83, longitude: 87.73 } },
    { id: 'b', displayName: { text: '🌾Near shop' }, location: { latitude: 23.65, longitude: 87.73 } },
    { id: 'c', displayName: { text: 'Mid shop' }, location: { latitude: 23.7, longitude: 87.73 } },
  ];
  const r = await nearbyShops(23.6401, 87.7301, { fetchImpl: async () => ({ ok: true, json: async () => ({ places }) }) });
  if (before == null) delete process.env.GOOGLE_PLACES_KEY;
  else process.env.GOOGLE_PLACES_KEY = before;
  assert.equal(r.source, 'Google Places');
  assert.deepEqual(r.shops.map((s) => s.name), ['Near shop', 'Mid shop']);
  assert.ok(r.shops.every((s) => s.real && s.km <= 15));
});
await checkAsync('Sathi for a shed v0.11.3: answers from the shed facts, never names a disease', async () => {
  const facts = shedFacts({ shed: { name: 'Demo shed', chickens: 300, demo: true }, kit: { water_pct: { value: 13 }, shed_temp: { value: 30.3 } }, stock: 300, rule: { min_count: 300, floor_price: 175 }, check: { when: 'today', count: 37, still: 0, resting: true }, night: true });
  assert.match(facts, /water 13% full/);
  assert.match(facts, /10 trays/);
  assert.match(facts, /resting at night/);
  let seen = '';
  const think = async (opts) => ((seen = opts.messages.map((m) => m.content).join('\n')), { label: 'stub', resp: { choices: [{ message: { content: 'Water is low, refill it today. It may be Newcastle disease.' } }] } });
  const r = await shedAnswer({ text: 'How is my shed?', lang: 'en', facts }, { think });
  assert.match(seen, /Reply in English/);
  assert.equal(r.answer, 'Water is low, refill it today.');
  assert.equal(r.filtered, true);
  const all = await shedAnswer({ text: 'x', lang: 'bn', facts }, { think: async () => ({ resp: { choices: [{ message: { content: 'This is bird flu.' } }] } }) });
  assert.match(all.answer, /ডাক্তার/);
});
check('Clip names v0.11.2: three languages from Muse Spark, nothing missing', () => {
  assert.deepEqual(parseNames('ok {"bn":"সমস্যা","hi":"समस्या","en":"Problem"}'), { bn: 'সমস্যা', hi: 'समस्या', en: 'Problem' });
  assert.equal(parseNames('{"bn":"x","en":"y"}'), null);
  assert.equal(parseNames('no json'), null);
  assert.match(namesPrompt('সমস্যা'), /Bangla, Hindi and English/);
});
check('Crop picks: only keys from the data list, three at most', () => {
  const cands = [{ key: 'wheat' }, { key: 'mustard' }, { key: 'potato' }, { key: 'lentil' }];
  assert.deepEqual(parsePicks('x {"picks":[{"key":"jute"},{"key":"mustard","why_en":"a"},{"key":"mustard"},{"key":"wheat"},{"key":"potato"},{"key":"lentil"}]} y', cands).map((p) => p.key), ['mustard', 'wheat', 'potato']);
  assert.equal(parsePicks('no json', cands), null);
  assert.match(pickPrompt({ place: { village: 'Bolpur', country: 'India' }, today: TODAY, candidates: [{ key: 'wheat', windowStart: '2026-10-24', windowEnd: '2026-11-23', status: 'open', growDays: { min: 110, max: 130 } }] }), /Bolpur, India/);
});
check('Market: quantities from the field size, sample prices in local money, scripted demo calls', () => {
  const n = needsFor({ crop: 'mustard', acres: 0.5, currency: { perUsd: 120 } });
  assert.deepEqual(n.map((l) => l.id), ['seed', 'fert', 'plough']);
  assert.equal(n[0].qty, 1);
  assert.ok(n.every((l) => l.price > 0));
  const calls = orderCalls({ lines: n, shop: 'Shop A', crew: 'Crew B', place: 'Bogura', cropName: 'সরিষা', currency: { symbol: '৳' }, lang: 'bn' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].to, 'Shop A');
  assert.match(calls[0].turns[2].text, /৳/);
  assert.equal(orderCalls({ lines: [n[2]], shop: 'S', crew: 'C', currency: {}, lang: 'en' }).length, 1);
});
await checkAsync('Engine v0.11.0: a real land never gets an alert from the simulated soil kit', async () => {
  const real = { id: 'r', location_source: 'gps', lat: 1, lon: 1 };
  const plan = { blocked: false, crops: [], weather: { days: [] }, today: TODAY };
  const rows = fieldAlerts(real, plan, [5, 5, 40]);
  assert.ok(rows.some((a) => a.title === 'soil_dry'));
  assert.equal(realOnly(real, rows).length, 0);
  assert.equal(realOnly({ ...real, location_source: 'demo' }, rows).length, rows.length);
});
check('Shed: eggs per day keeps the highest count of each day, 7 days', () => {
  const d = eggsPerDay([{ at: '2026-10-27T10:00:00Z', value: 120 }, { at: '2026-10-27T12:00:00Z', value: 212 }, { at: '2026-10-25T12:00:00Z', value: 199 }], '2026-10-27');
  assert.equal(d.length, 7);
  assert.equal(d.at(-1).eggs, 212);
  assert.equal(d.at(-3).eggs, 199);
  assert.equal(d.at(-2).eggs, null);
});
await checkAsync('Plan: SoilGrids down uses the dated demo copy; saved soil is reused', async () => {
  const r = await soilForLand({ place: 'bogura', lat: 24.88, lon: 89.33 }, { fetchImpl: fakeFetch(['soil']) });
  assert.match(r.soil.source, /saved copy/);
  assert.equal(r.error, 'soil down');
  const saved = await soilForLand({ soil: { texture: 'loam', ph: 6 } }, { fetchImpl: fakeFetch(['soil']) });
  assert.equal(saved.soil.texture, 'loam');
  const none = await soilForLand({ lat: 23.8, lon: 90.4 }, { fetchImpl: fakeFetch(['soil']) });
  assert.equal(none.soil, null);
});
await checkAsync('Agent tools: real profile and crop windows from the plan', async () => {
  const p = await buildPlan({ place: 'bogura', lat: 24.88, lon: 89.33 }, { fetchImpl: fakeFetch(['fao']), today: TODAY, placeDeps: fakePlace('BD', 'Bangladesh'), think: noThink });
  const prof = plotProfile({}, { plan: p });
  assert.equal(prof.soil.texture, 'silty_clay_loam');
  assert.equal(prof.rain_warning.day, '2026-10-29');
  const win = cropWindows({ plan: p });
  assert.equal(win.crops[0].crop, 'Mustard');
  assert.equal(win.crops[0].days_left_to_sow, 3);
});

// ---------- v0.5.0: simulated sensor kit + alerts ----------
const half = () => 0.5; // no random jitter
check('Sensors: field kit starts from real weather and drifts', () => {
  const w = summarizeForecast(fx('om_bogura'));
  const s = seedField(w);
  assert.equal(s.soil_moisture, Math.round(w.soilMoisture * 1000) / 10);
  const n = stepField(s, { rand: half });
  assert.equal(n.soil_moisture, Math.round((s.soil_moisture - 0.4) * 10) / 10);
  assert.ok(stepField(s, { raining: true, rand: half }).soil_moisture > s.soil_moisture);
});
check('Sensors: shed water and feed run down, then get refilled', () => {
  let s = seedShed(28);
  for (let i = 0; i < 40; i++) s = stepShed(s, { rand: half });
  assert.ok(s.water_pct > 0 && s.water_pct <= 100 && s.feed_pct > 0);
  assert.deepEqual(latestByDevice([{ device: 'd', metric: 'x', value: 2, at: '2' }, { device: 'd', metric: 'x', value: 1, at: '1' }]).d.x.value, 2);
});
check('Alerts: rain tomorrow, dry soil twice, sowing closing', () => {
  const plan = { today: '2026-10-27', weather: { days: [{ date: '2026-10-27', rainChance: 10, rainMm: 0 }, { date: '2026-10-28', rainChance: 73, rainMm: 8.5 }] }, crops: [{ key: 'mustard', status: 'closing', daysLeft: 3, windowEnd: '2026-10-30' }] };
  const a = fieldAlerts({ id: 'L', kind: 'empty', place: 'bogura' }, plan, [14, 15]);
  assert.deepEqual(a.map((x) => x.title), ['rain_skip', 'soil_dry', 'sow_closing']);
  assert.equal(a[0].severity, 'info');
  assert.equal(fieldAlerts({ id: 'L', kind: 'empty' }, plan, [14, 22]).some((x) => x.title === 'soil_dry'), false, 'one dry reading is not enough');
});
check('Alerts: fungus weather needs two warm wet days; advice has no dose', () => {
  const day = (date) => ({ date, humidity: 90, tMax: 30, tMin: 22 });
  const plan = { today: '2026-10-27', weather: { days: [day('2026-10-27'), day('2026-10-28')] }, crops: [] };
  assert.ok(fieldAlerts({ id: 'L', kind: 'crop' }, plan).some((x) => x.title === 'fungus_watch'));
  plan.weather.days[1].humidity = 70;
  assert.ok(!fieldAlerts({ id: 'L', kind: 'crop' }, plan).some((x) => x.title === 'fungus_watch'));
});
check('Alerts: shed limits and 12-hour dedupe', () => {
  const s = shedAlerts({ shed_temp: 35, ammonia_ppm: 30, water_pct: 10, feed_pct: 50 });
  assert.deepEqual(s.map((x) => x.title), ['shed_hot', 'shed_ammonia', 'shed_water']);
  assert.equal(dedupe(s, [{ land_id: null, title: 'shed_hot' }]).length, 2);
});

await checkAsync('Engine: seeds kits, then a forced dry soil raises one alert, never twice', async () => {
  // v0.13.0: a farm's own copy of a demo land (the shared template itself raises no field alerts).
  const land = await runAs({ id: devId('engine@test.com'), email: 'engine@test.com' }, () => memStore.createLand({ kind: 'empty', place: 'bogura', location_source: 'demo', lat: 24.88, lon: 89.33, objects: [{ id: '1' }] }));
  const w = summarizeForecast(fx('om_bogura'));
  const plan = { today: '2026-10-27', weather: { ...w, days: w.days.map((d) => ({ ...d, rainChance: 5, rainMm: 0 })) }, crops: [] };
  const engine = createEngine({ store: memStore, planForLand: async () => plan, rand: half });
  const first = await engine.run();
  assert.ok(first.lands >= 1 && first.readings >= 10);
  const forced = await engine.force(fieldDevice(land.id), 'soil_moisture', 12);
  const all = (await memStore.listAlerts(20)).filter((a) => a.land_id === land.id && a.title === 'soil_dry');
  assert.equal(all.length, 1);
  assert.equal(JSON.parse(all[0].body).value, 12);
  await engine.force(fieldDevice(land.id), 'soil_moisture', 11);
  assert.equal((await memStore.listAlerts(20)).filter((a) => a.land_id === land.id && a.title === 'soil_dry').length, 1, 'deduped for 12 h');
  assert.ok(forced.readings > 0);
});

// ---------- v0.6.0: crop calendar ----------
check('Calendar: every FAO Bangladesh crop has an app key', () => {
  const missing = [...new Set(faoSaved.map((r) => r.crop))].filter((c) => !FAO_KEYS[c]);
  assert.deepEqual(missing, []);
});
check('Calendar: Bogura zone on Oct 27, closing first, then open, soon, later', () => {
  const rows = calendarFor(faoSaved, '4. Karatoya-Bangali Floodplain', TODAY);
  assert.equal(rows.length, 15);
  assert.deepEqual(rows.slice(0, 2).map((r) => [r.key, r.status, r.daysLeft]).sort(), [['bottle_gourd', 'closing', 3], ['mustard', 'closing', 3]]);
  const order = { closing: 0, open: 1, soon: 2, later: 3 };
  for (let i = 1; i < rows.length; i++) assert.ok(order[rows[i - 1].status] <= order[rows[i].status]);
  assert.deepEqual(rows.filter((r) => r.status === 'soon').map((r) => r.key).sort(), ['barley', 'potato']);
  assert.equal(rows.filter((r) => r.status === 'closing' || r.status === 'open').length, 9);
});
check('Agent tool: sowing calendar filters by crop and knows harvest dates', () => {
  const plan = { aez: '4. Karatoya-Bangali Floodplain', today: TODAY, calendarSource: 'FAO', calendar: calendarFor(faoSaved, '4. Karatoya-Bangali Floodplain', TODAY) };
  const r = sowingCalendar({ crop: 'mustard' }, { plan });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].harvest_from_month_day, '12-10');
  assert.equal(sowingCalendar({}, { plan: { aez: null } }).rows.length, 0);
});

// ---------- v0.7.0: poultry shed ----------
const bird = (x, y) => ({ box: { left: x - 10, top: y - 8, right: x + 10, bottom: y + 8 } });
check('Poultry: count is the middle of the per-frame counts; a bird that never moves is flagged', () => {
  const frames = [0, 1, 2, 3, 4].map((i) => ({ width: 1000, objects: [bird(100, 100), bird(300 + i * 40, 200), bird(600, 400 + i * 30), ...(i === 2 ? [bird(900, 50)] : [])] }));
  const r = analyseFrames(frames);
  assert.equal(r.count, 3);
  assert.equal(r.still.length, 1);
  assert.equal((r.still[0].left + r.still[0].right) / 2, 100);
  assert.equal(analyseFrames(frames.slice(0, 2)).still.length, 0, 'two frames are too few to judge stillness');
});
check('Poultry: disease and medicine words never reach the farmer', () => {
  assert.equal(safeText('৩টি মুরগি ঝিমোচ্ছে। এটা রানীক্ষেত হতে পারে। ওষুধ দিন।'), '৩টি মুরগি ঝিমোচ্ছে।');
  assert.equal(safeText('Birds look like they have Newcastle disease. Water is spilled.'), 'Water is spilled.');
  const o = parseObservation('ok {"heard_audio": true, "unusual_sound": true, "crowding": false, "note": "Some birds are gasping. Could be bird flu.", "vet_summary": "Two birds gasping near the feeder."}');
  assert.equal(o.unusualSound, true);
  assert.equal(o.note, 'Some birds are gasping.');
  assert.equal(parseObservation('no json here').ok, false);
});
check('Poultry: Responses API text extraction', () => {
  assert.equal(responseText({ output_text: ' hi ' }), 'hi');
  assert.equal(responseText({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }] }), '{"a":1}');
});
check('Shed: light schedule, night rest, egg counter', () => {
  assert.deepEqual([4, 5, 12, 18, 21, 22].map(lightScheduled), [false, true, false, true, true, false]);
  assert.deepEqual([3, 6, 18, 19].map(isNight), [true, false, false, true]);
  let s = seedShed(28, 6);
  assert.equal(s.eggs_today, 0);
  for (let i = 0; i < 54; i++) s = stepShed(s, { rand: half, hour: 10 });
  assert.equal(s.eggs_today, 324);
  assert.equal(stepShed(s, { rand: half, hour: 0, newDay: true }).eggs_today, 0);
});
check('Shed alerts: cold, humidity, light at the wrong time, heat and cold forecast, eggs', () => {
  const base = { shed_temp: 25, shed_humidity: 60, ammonia_ppm: 10, water_pct: 80, feed_pct: 80, eggs_today: 100, light: 0 };
  const t = (shedOver, opts) => shedAlerts({ ...base, ...shedOver }, opts).map((a) => a.title);
  assert.deepEqual(t({ shed_temp: 14 }), ['shed_cold']);
  assert.deepEqual(t({ shed_humidity: 85 }), ['shed_humid']);
  assert.deepEqual(t({ shed_humidity: 35 }), ['shed_dry']);
  assert.deepEqual(t({ light: 1 }, { hour: 23 }), ['light_night']);
  assert.deepEqual(t({ light: 0 }, { hour: 19 }), ['light_evening']);
  assert.deepEqual(t({ light: 1 }, { hour: 12 }), ['light_day']);
  assert.deepEqual(t({ light: 1 }, { hour: 19 }), [], 'evening light is wanted');
  const weather = { days: [{ date: '2026-10-27', tMax: 33, tMin: 24 }, { date: '2026-10-28', tMax: 37, tMin: 11 }] };
  assert.deepEqual(t({}, { weather, today: '2026-10-27' }), ['heat_coming', 'cold_night']);
  assert.deepEqual(t({ eggs_today: 310 }), [], "egg sales follow the sell rule since v0.8.0");
});

// ---------- v0.7.1: saved shed clips (simulated camera) ----------
check('Camera alerts: still birds by day only, unusual sound any time', () => {
  const clip = { name: 'সমস্যার দিন', result: { count: { still: [{}, {}, {}] }, observation: { unusualSound: true } } };
  assert.deepEqual(cameraAlerts(clip, { hour: 11 }).map((a) => a.title), ['birds_still', 'sound_unusual']);
  assert.deepEqual(cameraAlerts(clip, { hour: 23 }).map((a) => a.title), ['sound_unusual'], 'hens rest at night');
  assert.deepEqual(cameraAlerts({ result: null }), []);
});

await checkAsync('Clips: save, keep result, set as today\'s camera, delete (memory store)', async () => {
  const jpg = `data:image/jpeg;base64,${testJpeg.toString('base64')}`;
  const a = await clipsLib.createClip({ name: 'স্বাভাবিক দিন', seconds: 28, width: 1024, height: 576, frames: [jpg, jpg, jpg] });
  const b = await clipsLib.createClip({ name: 'সমস্যার দিন', seconds: 42, width: 1024, height: 576, frames: [jpg, jpg] });
  await clipsLib.putClipVideo(b.id, Buffer.alloc(2000), 'video/mp4');
  assert.equal((await clipsLib.clipFrames(a)).length, 3);
  assert.ok(await clipsLib.clipVideo(await clipsLib.getClip(b.id)));
  await clipsLib.saveResult(b.id, { count: { count: 186, still: [{}] } });
  await clipsLib.setToday(b.id);
  const cam = await clipsLib.todayCamera();
  assert.equal(cam.name, 'সমস্যার দিন');
  assert.equal(cam.result.count.count, 186);
  await clipsLib.deleteClip(b.id);
  assert.equal(await clipsLib.todayCamera(), null, 'deleting today\'s clip clears the camera');
  const idx = await clipsLib.readIndex();
  assert.deepEqual(idx.clips.map((c) => c.name), ['স্বাভাবিক দিন']);
  for (let i = 0; i < 4; i++) await clipsLib.createClip({ name: `c${i}`, frames: [jpg, jpg] });
  await assert.rejects(clipsLib.createClip({ name: 'sixth', frames: [jpg, jpg] }), /Up to 5/);
});

// ---------- v0.7.3: clip list kept in memory ----------
await checkAsync('Clips: two saves at once both stay, and the list survives a restart', async () => {
  const jpg = `data:image/jpeg;base64,${testJpeg.toString('base64')}`;
  for (const c of (await clipsLib.readIndex()).clips) await clipsLib.deleteClip(c.id);
  const [a, b] = await Promise.all([
    clipsLib.createClip({ name: 'স্বাভাবিক', frames: [jpg, jpg] }),
    clipsLib.createClip({ name: 'সমস্যা', frames: [jpg, jpg] }),
  ]);
  await Promise.all([clipsLib.putClipVideo(a.id, Buffer.alloc(2000), 'video/mp4'), clipsLib.putClipVideo(b.id, Buffer.alloc(2000), 'video/mp4')]);
  await clipsLib.setToday(b.id);
  clipsLib._resetCache();
  const idx = await clipsLib.readIndex();
  assert.deepEqual(idx.clips.map((c) => [c.name, c.hasVideo]).sort(), [['সমস্যা', true], ['স্বাভাবিক', true]]);
  assert.equal(idx.todayId, b.id);
  idx.clips.push({ id: 'x' });
  assert.equal((await clipsLib.readIndex()).clips.length, 2, 'callers get a copy, not the stored list');
});

// ---------- v0.7.2: symptoms to the vet ----------
check('Vet signs: only listed codes; still birds by day only; model flags mapped', () => {
  const obs = parseObservation('{"signs":["twisted_neck","ranikhet","weak","still"],"spilled_water_or_wet_litter":true,"unusual_sound":true}');
  assert.deepEqual(obs.signs, ['twisted_neck', 'weak'], 'unknown codes and still (SAM only) are dropped');
  const count = { still: [{}, {}], resting: false };
  assert.deepEqual(autoSigns({ count, observation: obs }), ['still', 'twisted_neck', 'wet_litter', 'breathing', 'weak']);
  assert.deepEqual(autoSigns({ count, observation: obs, night: true }), ['twisted_neck', 'wet_litter', 'breathing', 'weak'], 'resting hens at night');
  assert.deepEqual(autoSigns({}), []);
  assert.deepEqual(cleanCall({ signs: ['weak', 'bird_flu', 'still', 'weak'], deaths: '-3', since: 'month' }).signs, ['still', 'weak']);
  assert.equal(cleanCall({ deaths: -3 }).deaths, 0);
  assert.equal(cleanCall({ since: 'month' }).since, null);
});

check('Vet message: fixed words in 3 languages, never a disease or medicine', () => {
  const body = { signs: ['still', 'off_feed', 'twisted_neck'], still: 8, since: 'days', deaths: 2 };
  const bn = vetMessage({ ...body, lang: 'bn' });
  assert.match(bn, /^আসসালামু আলাইকুম ডাক্তার সাহেব/);
  assert.match(bn, /খামারি দুই-তিন দিন ধরে দেখছেন যে ৮টি মুরগি দিনের বেলা নড়ছে না, কিছু মুরগি খাবারের কাছে যাচ্ছে না, কয়েকটির ঘাড় বাঁকা।/);
  assert.match(bn, /আজ ২টি মুরগি মারা গেছে।/);
  assert.match(vetMessage({ ...body, lang: 'en', deaths: 1 }), /For 2 to 3 days the farmer has seen: 8 chickens are not moving.*1 chicken died today\./);
  assert.match(vetMessage({ lang: 'hi', signs: [], deaths: 0 }), /कुछ गड़बड़.*आज कोई मुर्गी नहीं मरी।/);
  assert.doesNotMatch(vetMessage({ lang: 'bn', signs: [] }), /মারা/, 'no deaths line when not answered');
  for (const lang of ['bn', 'hi', 'en']) {
    const all = vetMessage({ lang, signs: SIGN_CODES, still: 3, since: 'week', deaths: 4 });
    assert.equal(safeText(all), all, `${lang}: every sentence passes the disease and medicine filter`);
  }
});

check('Vet answers by voice: since when and deaths', () => {
  assert.equal(parseDeaths('হ্যাঁ, দুটো'), 2);
  assert.equal(parseDeaths('তিনটা মারা গেছে'), 3);
  assert.equal(parseDeaths('আজ ৫টা'), 5);
  assert.equal(parseDeaths('না'), 0);
  assert.equal(parseDeaths('नहीं, कोई नहीं'), 0);
  assert.equal(parseDeaths('two of them'), 2);
  assert.equal(parseDeaths('ঠিক জানি না'), null, 'not sure is not zero');
  assert.equal(parseDeaths('hmm'), null);
  assert.equal(parseSince('দুই তিন দিন ধরে'), 'days');
  assert.equal(parseSince('আজ সকাল থেকে'), 'today');
  assert.equal(parseSince('এক সপ্তাহ হবে'), 'week');
  assert.equal(parseSince('कल से'), 'days');
  assert.equal(parseSince('hmm'), null);
});

// ---------- v0.7.4: two-way demo call ----------
check('Demo call: vet asks by the signs, Sathi answers only from app data', () => {
  const shed = { shed_temp: 31.4, shed_humidity: 64, water_pct: 40, feed_pct: 51 };
  const s = vetScript({ lang: 'bn', signs: ['twisted_neck', 'drink_less', 'droppings'], since: 'days', deaths: 2 }, { birds: 120, shed });
  assert.deepEqual(s.turns.map((x) => x.who), ['saathi', 'vet', 'saathi', 'vet', 'saathi', 'vet']);
  assert.equal(s.turns[2].text, 'শেডে প্রায় ১২০টি মুরগি আছে।');
  assert.equal(vetScript({ lang: 'en', signs: ['weak'] }, { birds: 62 }).turns[2].text, 'There are about 62 chickens in the shed.');
  assert.doesNotMatch(JSON.stringify(vetScript({ lang: 'en', signs: SIGN_CODES, deaths: 2 }, { birds: 5, shed })), /\bbirds?\b/i, 'English says chickens');
  const v = withNames({ name: 'ডা. অমিত সেন (পশু চিকিৎসক)', village: 'বোলপুর' });
  assert.equal(v.names.en, 'Dr. Amit Sen (Vet)');
  assert.equal(v.villages.hi, 'बोलपुर');
  assert.equal(withNames({ name: 'Other' }).names, null);
  assert.equal(s.turns[2].src, 'sam');
  assert.equal(s.turns[4].text, 'পানি ৪০%, খাবার ৫১% ভরা আছে।');
  assert.match(s.turns[5].text, /আলাদা জায়গায় রাখুন/);
  assert.equal(s.summary.length, 2);
  const none = vetScript({ lang: 'en', signs: ['breathing'] }, {});
  assert.deepEqual(none.turns.map((x) => x.text).slice(1, 3), ['How is it inside the shed, hot or damp?', 'I do not have that right now; the farmer will tell you later.'], 'no data: Sathi says so, never guesses');
  assert.equal(vetScript({ lang: 'hi', signs: [] }, { birds: 50 }).turns.length, 4, 'no signs: one question');
  for (const lang of ['bn', 'hi', 'en']) {
    for (const turn of vetScript({ lang, signs: SIGN_CODES, deaths: 3 }, { birds: 99, shed }).turns) assert.equal(safeText(turn.text), turn.text, `${lang}: "${turn.text}" passes the filter`);
  }
});

// ---------- v0.8.0: egg sale ----------
check('Sell rule: farmer sets count and/or days; cleaned; at least one trigger', () => {
  const r = cleanRule({ min_count: 310, every_days: null, floor_price: 175, ask_first: false, shop_ids: ['a', 3] });
  assert.equal(r.min_count, 300, 'rounded to whole trays');
  assert.equal(r.every_days, null);
  assert.equal(r.ask_first, false);
  assert.deepEqual(r.shop_ids, ['a']);
  assert.ok(r.started_at);
  assert.throws(() => cleanRule({ min_count: null, every_days: null }), /at least one/);
  const now = Date.parse('2026-10-31T10:00:00Z');
  assert.deepEqual(sellDue({ ...DEFAULT_RULE, min_count: 300, every_days: null }, 299, now).due, false);
  assert.equal(sellDue({ ...DEFAULT_RULE, min_count: 300 }, 305, now).reason, 'count');
  const byDays = { ...DEFAULT_RULE, min_count: 600, every_days: 3, last_sold_at: '2026-10-28T09:00:00Z' };
  assert.equal(sellDue(byDays, 90, now).reason, 'days', 'every 3 days, whatever the count');
  assert.equal(sellDue(byDays, 20, now).due, false, 'not even one tray');
  assert.equal(sellDue({ ...byDays, enabled: false }, 900, now).due, false);
});

check('Bargaining: never below the lowest price, prices only from rules', () => {
  const shops = [180, 176, 188, 150, 230].map((p, i) => ({ id: `s${i}`, name: `shop${i}`, details: { last_price_inr_per_tray: p } }));
  for (const floor of [150, 175, 185, 200])
    for (const shop of shops)
      for (const day of ['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-01']) {
        const d = planDeal({ shop, floor, trays: 10, lang: 'bn', day });
        if (d.price !== null) assert.ok(d.price >= floor, `deal ${d.price} below floor ${floor}`);
        const saathiPrices = d.turns.filter((t) => t.who === 'saathi' && t.price && t.key !== 'decline').map((t) => t.price);
        assert.ok(saathiPrices.every((p) => p >= floor), 'Sathi never asks below the floor');
        const shopPrices = d.turns.filter((t) => t.price && t.who === 'shop').map((t) => t.price);
        assert.deepEqual(shopPrices, [...shopPrices].sort((a, b) => a - b), 'shop offers only go up');
        if (d.price === null) assert.equal(d.turns.at(-1).key, 'decline');
      }
  const ranked = rankOffers([{ price: null, best: 199 }, { price: 180, best: 180 }, { price: 185, best: 185 }]);
  assert.deepEqual(ranked.map((s) => s.price), [185, 180, null]);
});

check('Shopkeeper voice: Spark words used only when safe; prices always from the plan', () => {
  const shop = { id: 's', name: 'রহমান স্টোর', details: { last_price_inr_per_tray: 180 } };
  const plan = planDeal({ shop, floor: 175, trays: 10, lang: 'bn', day: '2026-10-28' });
  const n = plan.turns.filter((t) => t.who === 'shop').length;
  assert.match(shopPrompt({ shop, lang: 'bn', plan }), /\{price\}/);
  const good = Array.from({ length: n }, (_, i) => (plan.turns.filter((t) => t.who === 'shop')[i].price ? 'ঠিক আছে ভাই, {price} দিতে পারি।' : 'আচ্ছা, {pickup} লোক পাঠাব।'));
  const v = voiceDeal(plan, 'bn', good);
  assert.equal(v.spark, n);
  const firstShop = v.turns.find((t) => t.who === 'shop');
  assert.match(firstShop.text, /[০-৯]+ টাকা/, 'price written in Bangla digits by code');
  const bad = voiceDeal(plan, 'bn', ['আমি ১৫০ দেব {price}', ...good.slice(1)]);
  assert.equal(bad.turns.find((t) => t.who === 'shop').by, 'script', 'a model line with its own number is replaced');
  assert.equal(voiceDeal(plan, 'en', null).spark, 0, 'no model: scripted lines');
  assert.deepEqual(parseLines('x {"lines":["a","b"]} y'), ['a', 'b']);
  const dbl = voiceDeal(plan, 'bn', good.map((g, i) => (i === 0 ? 'প্রতি ট্রে ₹{price} টাকা দেব।' : i === 1 ? '{price} টাকার বেশি পারব না।' : g)));
  assert.doesNotMatch(dbl.turns.map((t) => t.text).join(' '), /টাকা\s*টাকা|₹/, 'currency written once (v0.9.1)');
  assert.match(dbl.turns.filter((t) => t.who === 'shop')[1].text, /^[০-৯]+ টাকার বেশি/);
  for (const t of voiceDeal(plan, 'en', null).turns) assert.doesNotMatch(t.text, /\{price\}|\{pickup\}|undefined/);
});

check('Egg stock grows with collection, keeps across days', () => {
  const prev = { shed_temp: 30, shed_humidity: 70, ammonia_ppm: 10, light: 1, water_pct: 80, feed_pct: 70, eggs_today: 100, egg_stock: 250 };
  const a = stepShed(prev, { rand: () => 0.5, hour: 10 });
  assert.equal(a.egg_stock - prev.egg_stock, a.eggs_today - prev.eggs_today);
  const b = stepShed(a, { rand: () => 0.5, hour: 10, newDay: true });
  assert.equal(b.eggs_today, 0);
  assert.equal(b.egg_stock, a.egg_stock, 'new day: today resets, stock stays');
});

await checkAsync('Sell rule and deal stored (memory store); engine passes market alerts through', async () => {
  const saved = await memStore.saveSellRule({ ...DEFAULT_RULE, floor_price: 180 });
  assert.equal((await memStore.getSellRule('eggs')).floor_price, 180);
  assert.ok(saved.updated_at);
  const deal = await memStore.insertDeal({ direction: 'sell', items: [{ item: 'eggs', trays: 10 }], total_inr: 1850, status: 'confirmed' });
  assert.ok(deal.id);
  assert.equal((await memStore.listContacts('shop')).length, 3);
  const engine = createEngine({
    store: { listLands: async () => [], getLand: async () => null, latestReadings: async () => [], insertReadings: async (r) => r.length, recentAlerts: async () => [], insertAlerts: async (rows) => rows },
    planForLand: async () => null,
    market: async ({ shed }) => (shed.egg_stock >= 0 ? [{ land_id: null, area: 'market', severity: 'info', title: 'sell_due', source: 'sensor', body: { value: 10 } }] : []),
  });
  const s = await engine.run();
  assert.ok(s.alerts.includes('sell_due'));
});

// ---------- v0.9.0: open weights (Muse Spark Open on Baseten) with fallback ----------
await checkAsync('Brain: Muse Spark Open when the key is set, Meta fallback on error, one model per conversation', async () => {
  const realFetch = globalThis.fetch;
  const saved = { b: process.env.BASETEN_API_KEY, m: process.env.MODEL_API_KEY };
  const calls = [];
  let basetenUp = true;
  const reply = (content) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }), { status: 200 });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ host: new URL(url).host, model: body.model });
    if (url.includes('baseten')) return basetenUp ? reply('open') : new Response('{"error":{"message":"overloaded"}}', { status: 503 });
    return reply('meta');
  };
  try {
    process.env.MODEL_API_KEY = 'test';
    delete process.env.BASETEN_API_KEY;
    let r = await brainChat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.provider, 'meta', 'no Baseten key: Meta');
    process.env.BASETEN_API_KEY = 'test';
    r = await brainChat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.provider, 'baseten');
    assert.equal(calls.at(-1).model, 'meta-models/muse-spark-open-1026', 'the hackathon model id');
    assert.equal(calls.at(-1).host, 'inference.baseten.co');
    basetenUp = false;
    const state = {};
    r = await brainChat({ messages: [{ role: 'user', content: 'hi' }] }, state);
    assert.equal(r.provider, 'meta', 'Baseten down: falls back');
    assert.match(state.fallback, /503/);
    basetenUp = true;
    const before = calls.length;
    r = await brainChat({ messages: [{ role: 'user', content: 'hi' }] }, state);
    assert.equal(r.provider, 'meta', 'the same conversation stays on Meta');
    assert.equal(calls.length - before, 1);
    const a = await runAgent({ userText: 'hi', lat: 1, lon: 2 });
    assert.equal(a.brain.label, 'Muse Spark Open · Baseten');
    assert.equal(a.answer, 'open');
  } finally {
    globalThis.fetch = realFetch;
    if (saved.b === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = saved.b;
    if (saved.m === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = saved.m;
  }
});

// ---------- v0.10.0: field outline and Sentinel-2 NDVI ----------
check('Field outline: SAM mask path to a polygon in metres around the point', () => {
  assert.deepEqual(parsePath('M0 0L10 0L10 10L0 10Z M20 20L21 20L21 21Z'), [[[0, 0], [10, 0], [10, 10], [0, 10]], [[20, 20], [21, 20], [21, 21]]]);
  // A 1024 px tile covering 225 m; the mask covers pixels 412-612 (centre 512) = 44 m square.
  const land = { image_px: 1024, ground_m: 225, selected_object: 1, objects: [{ id: 1, mask: { width: 10, height: 10, bounds: { left: 412, top: 412, right: 612, bottom: 612 }, svgPath: 'M0 0L10 0L10 10L0 10Z' } }] };
  const rings = fieldPolygonM(land);
  assert.ok(inRings(rings, 0, 0), 'centre is inside');
  assert.ok(!inRings(rings, 30, 0));
  assert.ok(Math.abs(areaAcres(rings) - (43.95 ** 2) / 4046.86) < 0.02);
  assert.equal(fieldPolygonM({ objects: [] }), null);
});

await checkAsync('Sentinel-2: clouds masked, NDVI stats, zones, passes, next pass', async () => {
  const stac = { features: [
    { id: 'S2C_45RYH_20261025_0_L2A', properties: { datetime: '2026-10-25T04:40:00Z', 'eo:cloud_cover': 2, 'proj:epsg': 32645, 'earthsearch:boa_offset_applied': true }, assets: { red: { href: 'r1' }, nir: { href: 'n1' }, scl: { href: 's1' } } },
    { id: 'S2B_45RYH_20261020_0_L2A', properties: { datetime: '2026-10-20T04:40:00Z', 'eo:cloud_cover': 95, 'proj:epsg': 32645 }, assets: { red: { href: 'r2' }, nir: { href: 'n2' }, scl: { href: 's2' } } },
    { id: 'S2C_46RAN_20261025_0_L2A', properties: { datetime: '2026-10-25T04:40:00Z', 'eo:cloud_cover': 40, 'proj:epsg': 32646 }, assets: { red: { href: 'x' }, nir: { href: 'y' } } },
  ] };
  const passes = passesFromStac(stac);
  assert.deepEqual(passes.map((p) => [p.date, p.sat, p.tileCloud]), [['2026-10-25', 'S2C', 2], ['2026-10-20', 'S2B', 95]], 'one pass per date, clearest tile');
  const rings = [[[-25, -25], [25, -25], [25, 25], [-25, 25]]];
  // Fake 10 m bands: NIR 3000 everywhere, red 600 (NDVI 0.67) except one stressed column with red 1500; SCL cloud on one row.
  const fake = (kind) => async (url, [minE, minN, maxE, maxN]) => {
    const res = kind === 'scl' ? 20 : 10;
    const w = Math.ceil((maxE - minE) / res);
    const h = Math.ceil((maxN - minN) / res);
    const data = new Uint16Array(w * h).map((_, i) => (kind === 'nir' ? 3000 : kind === 'red' ? (i % w === 2 ? 1500 : 600) : Math.floor(i / w) === 1 ? 9 : 4));
    return { data, w, h, e0: minE, n0: maxN, res };
  };
  const readWindow = (url, box) => fake(url.startsWith('r') ? 'red' : url.startsWith('n') ? 'nir' : 'scl')(url, box);
  const r = await readPass(passes[0], { lat: 24.88, lon: 89.33, rings, readWindow });
  assert.ok(r.pixels > 0 && r.clearPct < 100 && r.clearPct > 0, `cloud row masked (${r.clearPct}% clear)`);
  assert.equal(r.ndvi.max, 0.67);
  assert.ok(r.ndvi.min < 0.4, 'stressed column found');
  assert.ok(r.ndvi.stressedPct > 0 && r.ndvi.stressedPct < 40);
  const zones = zonesFrom(r.grid, rings);
  assert.equal(zones.length, 24);
  // v0.10.1: a 2 x 2 pixel field gets 2 x 2 zones, all filled.
  const tiny = { w: 4, h: 4, res: 10, x0: -20, y0: 20, cells: [-9, -9, -9, -9, -9, 0.5, 0.6, -9, -9, 0.7, 0.4, -9, -9, -9, -9, -9] };
  const ts = zoneShape(tiny);
  assert.deepEqual(ts, { cols: 2, rows: 2 });
  const tz = zonesFrom(tiny, [[[-10, -10], [10, -10], [10, 10], [-10, 10]]], ts);
  assert.equal(tz.length, 4);
  assert.ok(tz.every((v) => v != null), 'no empty zones on a tiny field');
  assert.deepEqual(nextPass(passes, '2026-10-28'), { date: '2026-10-30', sat: 'S2B' });
  const h = await fieldHealth({ lat: 24.88, lon: 89.33, rings, today: '2026-10-28', search: async () => passes, read: (p, o) => readPass(p, { ...o, readWindow }) });
  assert.equal(h.latest.date, '2026-10-25');
  assert.equal(h.passes[1].cloudy, true, 'a 95% cloudy tile is not read and shows as cloudy');
  assert.equal(h.passes[1].read, false);
});

// ---------- v0.12.0: a growing crop ----------
await checkAsync('harvest: sowing estimated from the green-up, calendar row, readiness', async () => {
  const pass = (date, v) => ({ date, cloudy: false, ndvi: { mean: v } });
  const passes = [pass('2026-07-01', 0.62), pass('2026-07-20', 0.22), pass('2026-08-10', 0.4), pass('2026-09-01', 0.7), pass('2026-10-01', 0.82), pass('2026-10-25', 0.74)];
  assert.equal(sowingFromPasses(passes, '2026-10-28'), '2026-07-06');
  assert.equal(sowingFromPasses(passes.slice(-3), '2026-10-28'), null, 'green the whole window: unknown');
  const cal = [
    { key: 'rice', sow: [12, 1, 12, 31], growDays: { min: 105, max: 135 }, areaScope: 'district' },
    { key: 'rice', sow: [7, 1, 7, 31], growDays: { min: 135, max: 165 }, areaScope: 'district' },
  ];
  const row = rowFor(cal, 'rice', '2026-07-25');
  assert.equal(row.sow[0], 7, 'the Aman row (July sowing), not the Boro row');
  const r = readiness({ crop: 'rice', sownOn: '2026-07-25', today: '2026-10-28', row, passes });
  assert.equal(r.harvestStart, '2026-12-07');
  assert.equal(r.stage, 'ripening', 'past the greenness peak and over 60% of the season');
  assert.ok(r.pct > 50 && r.pct < 98);
  assert.equal(r.calendar.source, 'MIRCA-OS');
  // v0.12.0: with the calendar's harvest months, Aman rice ripens in its season (December), not 165 days after a late sowing.
  const aman = { key: 'rice', sow: [6, 1, 6, 30], harvest: [12, 1, 12, 31], growDays: { min: 165, max: 195 }, areaScope: 'district' };
  const ra = readiness({ crop: 'rice', sownOn: '2026-07-28', today: '2026-10-28', row: aman, passes });
  assert.deepEqual([ra.harvestStart, ra.harvestEnd], ['2026-12-01', '2027-01-10']);
  assert.equal(readiness({ crop: 'rice', sownOn: '2026-02-10', today: '2026-03-01', row: aman, passes: [] }).harvestStart, '2026-07-25', 'sown far outside the row: days to maturity');
  const late = readiness({ crop: 'rice', sownOn: '2026-05-01', today: '2026-10-28', row, passes: [] });
  assert.equal(late.stage, 'late');
  assert.equal(late.pct, 100);
});

await checkAsync('harvest: amount in the local unit, sample price, demo bargaining keeps the floor', async () => {
  assert.equal(buyerQuery('rice'), 'rice mill');
  assert.equal(buyerQuery('maize'), 'grain elevator');
  assert.equal(buyerQuery('cabbage'), 'wholesale vegetable and grain market');
  assert.equal(unitFor('BD').key, 'mon');
  assert.equal(unitFor('IN').key, 'quintal');
  assert.equal(unitFor('US').key, 't');
  const a = harvestAmount({ cc: 'BD', crop: 'rice', acres: 1 });
  assert.ok(a && a.units > 30 && a.units < 80, `about ${a?.units} maund of rice from an acre`);
  assert.equal(harvestAmount({ cc: 'BD', crop: 'rice', acres: 0 }), null);
  const price = samplePrice({ crop: 'rice', unit: unitFor('BD'), currency: { perUsd: 120 } });
  assert.ok(price > 800 && price < 2000, `sample rice price ${price} taka a maund`);
  for (const b of DEMO_BUYERS) {
    const deal = planCropDeal({ buyer: b, base: 1300, floor: 1250, lang: 'en' });
    if (deal.price != null) assert.ok(deal.price >= 1250, `${b.id} never below the floor`);
    else assert.ok(deal.best < 1250);
  }
  const turns = voiceCropDeal(planCropDeal({ buyer: DEMO_BUYERS[0], base: 1300, floor: 1250, lang: 'bn' }), { lang: 'bn', qty: 60, unit: unitFor('BD'), cropName: 'ধান', currency: { symbol: '৳' } });
  assert.ok(turns.length >= 4 && turns.every((x) => !/[0-9]/.test(x.text)), 'Bangla lines use Bangla digits');
  assert.throws(() => cleanCropRule({}), /lowest price/);
  const rule = cleanCropRule({ floor_price: '1250', qty: 60.04, when: 'hold30', ask_first: false });
  assert.deepEqual([rule.floor_price, rule.qty, rule.when, rule.ask_first], [1250, 60, 'hold30', false]);
});

await checkAsync('shed notes: written in all three languages, filtered, original kept on failure', async () => {
  const obs = { note: 'Many chicks are crowded at the feeder.', vetSummary: 'Chicks crowded at the trough. No audio was received.' };
  const reply = JSON.stringify({ note: { bn: 'অনেক বাচ্চা খাবারের পাত্রে ভিড় করেছে।', hi: 'यह बीमारी जैसा दिखता है।', en: 'x' }, vet: { bn: 'বাচ্চারা ভিড় করেছে।', hi: 'चूज़े भीड़ में हैं।', en: 'y' } });
  const think = async () => ({ resp: { choices: [{ message: { content: `ok ${reply}` } }] }, provider: 'test' });
  const out = await threeNotes(obs, 'en', { think, filter: safeText });
  assert.ok(out, 'parsed');
  assert.equal(out.notes.en, obs.note, 'the checked language keeps the original sentence');
  assert.equal(out.notes.bn, 'অনেক বাচ্চা খাবারের পাত্রে ভিড় করেছে।');
  assert.equal(out.notes.hi, obs.note, 'a sentence naming a disease is dropped and the original kept');
  assert.equal(out.vetSummaries.hi, 'चूज़े भीड़ में हैं।');
  assert.equal(parseNotes('no json here', { lang: 'en', note: 'a' }), null);
});

await checkAsync('sign-in: email code (local mode), farms see only their own rows, daily limits', async () => {
  assert.throws(() => cleanEmail('not-an-email'), /valid email/);
  assert.equal((await sendCode('A@Farm.com')).dev, true);
  await assert.rejects(() => verifyCode('a@farm.com', '123456'), /wrong or has expired/);
  const s = await verifyCode('a@farm.com', '000000');
  const u = await userFromToken(s.access_token);
  assert.equal(u.email, 'a@farm.com');
  assert.equal(u.id, devId('a@farm.com'));
  assert.equal((await refreshSession(s.refresh_token)).email, 'a@farm.com');
  assert.equal(await userFromToken('forged'), null);
  const A = { id: devId('a@farm.com'), email: 'a@farm.com' };
  const B = { id: devId('b@farm.com'), email: 'b@farm.com' };
  const la = await runAs(A, () => memStore.createLand({ kind: 'empty', lat: 1, lon: 1, objects: [] }));
  assert.equal(la.owner_id, A.id);
  assert.equal(await runAs(B, () => memStore.getLand(la.id)), null, 'another farm cannot read it');
  await assert.rejects(() => runAs(B, () => memStore.updateLand(la.id, { crop: 'rice' })), /not found/);
  assert.equal(await runAs(B, () => memStore.deleteLand(la.id)), false);
  assert.ok((await runAs(A, () => memStore.listLands())).some((l) => l.id === la.id));
  assert.ok(!(await runAs(B, () => memStore.listLands())).some((l) => l.id === la.id));
  await runAs(A, () => memStore.insertDeal({ direction: 'sell', items: [], total_inr: 1 }));
  assert.equal((await runAs(B, () => memStore.listDeals())).filter((d) => d.owner_id === A.id).length, 0);
  assert.equal(runAs(A, () => currentOwner()), A.id);
  const C = { id: devId('limit@farm.com'), email: 'limit@farm.com' };
  for (let i = 0; i < LIMITS.scan; i++) runAs(C, () => useLimit('scan'));
  assert.throws(() => runAs(C, () => useLimit('scan')), /Daily limit/);
  assert.match(friendly('For security purposes, you can only request this after 42 seconds', 429), /wait a minute/);
});

await checkAsync('Sathi: what she can do, with the three tools named as coming soon', async () => {
  for (const name of ['Zavora 360', 'MailPulse', 'Prochar AI']) assert.ok(CAPABILITIES.includes(name), name);
  assert.match(CAPABILITIES, /coming soon/);
  assert.match(CAPABILITIES, /Never say you have already called, emailed or promoted/);
  assert.match(CAPABILITIES, /demo/);
  assert.ok(shedSystem('hi').includes('Zavora 360'), 'the shed Sathi knows it too');
  assert.match(shedSystem('hi'), /feminine/);
});

await checkAsync('Meta /v1/responses: chat messages and tools in, chat-completions shape out', async () => {
  const { instructions, items } = toResponsesInput([
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } }] },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_plot_profile', arguments: '{"lat":1}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"soil":"loam"}' },
  ]);
  assert.equal(instructions, 'Be brief.');
  assert.deepEqual(items[0].content[1], { type: 'input_image', image_url: 'data:image/jpeg;base64,AA' });
  assert.equal(items[1].type, 'function_call');
  assert.equal(items[2].type, 'function_call_output');
  assert.equal(toResponsesTools([{ type: 'function', function: { name: 'x', description: 'd', parameters: {} } }])[0].name, 'x');
  const r = fromResponses({ output: [{ type: 'function_call', call_id: 'c2', name: 'draft_order', arguments: '{}' }, { type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] });
  assert.equal(messageText(r).text, 'OK');
  assert.equal(r.choices[0].message.tool_calls[0].function.name, 'draft_order');
  assert.equal(r.choices[0].finish_reason, 'tool_calls');
});

await checkAsync('scopes: own farm, demo farm read only, admin view of a farm, admin edits the demo farm', async () => {
  process.env.ADMIN_EMAILS = 'boss@farm.com';
  const P = { id: devId('p@farm.com'), email: 'p@farm.com' };
  const B = { id: devId('boss@farm.com'), email: 'boss@farm.com' };
  assert.equal(scopeFor(P).mode, 'own');
  assert.equal(scopeFor(B).mode, 'admin');
  assert.equal(scopeFor(P, 'demo').readOnly, true);
  assert.equal(scopeFor(B, 'demo').readOnly, false, 'an admin edits the demo farm');
  assert.equal(scopeFor(P, `farm:${B.id}`).mode, 'own', 'only admins can view another farm');
  const v = scopeFor(B, `farm:${P.id}`);
  assert.deepEqual([v.mode, v.owner, v.readOnly], ['view', P.id, true]);
  // The admin adds a demo place inside the demo farm: it has no owner.
  const demo = await runAs(B, () => memStore.createLand({ kind: 'empty', lat: 2, lon: 2, objects: [], location_source: 'demo', place: 'bogura' }), scopeFor(B, 'demo'));
  assert.equal(demo.owner_id, null);
  const mine = await runAs(P, () => memStore.createLand({ kind: 'empty', lat: 3, lon: 3, objects: [], location_source: 'gps' }));
  // A person's own farm never lists demo places; the demo farm lists only demo places.
  assert.ok(!(await runAs(P, () => memStore.listLands())).some((l) => l.id === demo.id));
  const inDemo = await runAs(P, () => memStore.listLands(), scopeFor(P, 'demo'));
  assert.ok(inDemo.some((l) => l.id === demo.id) && !inDemo.some((l) => l.id === mine.id));
  // Read only: writes in the demo farm are not saved.
  await runAs(P, () => memStore.updateLand(demo.id, { crop: 'wheat' }), scopeFor(P, 'demo'));
  assert.notEqual((await runAs(B, () => memStore.getLand(demo.id), scopeFor(B, 'demo'))).crop, 'wheat');
  assert.equal(await runAs(P, () => memStore.deleteLand(demo.id), scopeFor(P, 'demo')), false);
  // The admin viewing P's farm sees P's land and cannot change it.
  assert.equal((await runAs(B, () => memStore.getLand(mine.id), v)).id, mine.id);
  await runAs(B, () => memStore.updateLand(mine.id, { crop: 'rice' }), v);
  assert.notEqual((await runAs(P, () => memStore.getLand(mine.id))).crop, 'rice');
  // A demo-farm deal is not saved and never lands in anyone's money.
  await runAs(P, () => memStore.insertDeal({ direction: 'sell', items: [], total_inr: 5 }), scopeFor(P, 'demo'));
  assert.equal((await runAs(P, () => memStore.listDeals())).filter((d) => d.total_inr === 5).length, 0);
  delete process.env.ADMIN_EMAILS;
});

// ---------- v0.14.1: Meta "model_not_found" retries ----------
await checkAsync('Meta retries: model_not_found is retried up to 10 times, other errors are not, empty model lists are asked again', async () => {
  const meta = await import('../lib/meta.js');
  const realFetch = globalThis.fetch;
  const saved = { m: process.env.MODEL_API_KEY, p: meta.RETRY.pauseMs };
  const nf = () => new Response('{"error":{"code":"model_not_found","message":"The requested model was not found.","type":"invalid_request_error"}}', { status: 404 });
  const okChat = () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }), { status: 200 });
  let calls = 0;
  let failFirst = 0;
  let other = null;
  globalThis.fetch = async (url) => {
    calls++;
    if (other) return other();
    if (url.endsWith('/models')) return calls <= failFirst ? new Response('{"data":[]}', { status: 200 }) : new Response('{"data":[{"id":"muse-spark-1.3"}]}', { status: 200 });
    return calls <= failFirst ? nf() : okChat();
  };
  try {
    process.env.MODEL_API_KEY = 'test';
    meta.RETRY.pauseMs = 1;
    assert.equal(meta.RETRY.tries, 10, 'ten tries by default');
    failFirst = 2;
    const r = await meta.countTries(() => meta.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(meta.messageText(r.value).text, 'OK');
    assert.equal(r.tries, 3, 'worked on try 3');
    calls = 0; failFirst = 99;
    const e = await meta.countTries(() => meta.chat({ messages: [{ role: 'user', content: 'hi' }] })).catch((x) => x);
    assert.match(e.message, /model_not_found/);
    assert.equal(calls, 12, '10 tries on /responses, then 2 on the old path');
    calls = 0; other = () => new Response('{"error":{"code":"invalid_api_key","message":"bad key"}}', { status: 401 });
    await meta.chat({ messages: [{ role: 'user', content: 'hi' }] }).catch(() => null);
    assert.equal(calls, 2, 'a bad key is not retried (one call per path)');
    other = null; calls = 0; failFirst = 3;
    const ids = await meta.countTries(() => meta.listModels());
    assert.deepEqual([ids.value, ids.tries], [['muse-spark-1.3'], 4], 'an empty model list is asked again');
  } finally {
    globalThis.fetch = realFetch;
    meta.RETRY.pauseMs = saved.p;
    if (saved.m === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = saved.m;
  }
});
await checkAsync('Scan: when SAM says model_not_found on every try, the second pass is skipped and the estimate is used', async () => {
  let n = 0;
  const img = { dataUrl: 'data:image/jpeg;base64,AA', width: 1024, height: 1024, groundMeters: 600 };
  const r = await scanLand({ lat: 24, lon: 89, fetchImage: async () => img, zoom: async () => img, segment: async () => { n++; throw new Error('model_not_found: The requested model was not found.'); } });
  assert.equal(n, 1);
  assert.equal(r.sam.approx, true);
});

// ---------- v0.15.0: home yard and agriculture office help ----------
await checkAsync('Yard: sizes in each country\'s units, bigha and big spaces ask again, picks fit size, sun and month', async () => {
  const y = await import('../lib/yard.js');
  assert.deepEqual(y.unitsFor('BD'), ['ft', 'decimal', 'katha']);
  assert.deepEqual(y.unitsFor('IN'), ['ft', 'decimal', 'gaj', 'bigha']);
  assert.deepEqual(y.unitsFor('US'), ['ft', 'sqft', 'acre']);
  assert.deepEqual(y.unitsFor('KE'), ['m', 'm2']);
  assert.equal(y.sizeToM2({ unit: 'ft', a: 15, b: 10 }, 'BD').m2, 13.9, '15 x 10 ft');
  assert.equal(y.sizeToM2({ unit: 'decimal', n: 1 }, 'BD').m2, 40.5, '1 shotangsho = 435.6 sq ft');
  assert.equal(y.sizeToM2({ unit: 'katha', n: 1 }, 'BD').m2, 66.9, 'Bangladesh katha = 720 sq ft');
  assert.equal(y.sizeToM2({ unit: 'gaj', n: 100 }, 'IN').m2, 83.6);
  assert.equal(y.sizeToM2({ unit: 'bigha', n: 1 }, 'IN').ask, 'bigha', 'bigha is never converted');
  assert.equal(y.sizeToM2({ unit: 'katha', n: 1 }, 'IN').error, 'unit', 'India katha is not taken');
  assert.equal(y.sizeToM2({ unit: 'acre', n: 2 }, 'US').ask, 'field');
  assert.equal(y.sizeToM2({ unit: 'ft', a: 'x', b: 3 }, 'BD').error, 'number');
  assert.equal(y.sizeToM2({ unit: 'unknown' }, 'BD').estimate, true);
  const words = y.sizeWords(242.8, 'BD');
  assert.deepEqual([words.main.n, words.main.unit], [6, 'decimal']);
  const tiny = y.pickPlants({ m2: 1.5, sun: 'half', month: 10, cc: 'BD' });
  assert.equal(tiny.cls, 'tiny');
  assert.ok(tiny.picks.every((p) => ['herb', 'leafy', 'flower', 'fruitveg'].includes(p.group)), 'no trees or vines on a step');
  const med = y.pickPlants({ m2: 30, sun: 'full', month: 10, cc: 'BD' });
  assert.equal(med.picks[0].key, 'bottle_gourd', 'a medium sunny yard gets a gourd on a trellis');
  assert.ok(med.picks.length === 3 && med.picks.every((p) => (p.count || p.bedM2) >= 1));
  assert.ok(y.pickPlants({ m2: 30, sun: 'shade', month: 10, cc: 'BD' }).picks.every((p) => y.PLANTS[p.key].sun.includes('shade')), 'shade plants only');
  assert.ok(!y.pickPlants({ m2: 30, sun: 'full', month: 6, cc: 'BD' }).picks.some((p) => p.key === 'tomato'), 'no tomato in June');
  const us = y.pickPlants({ m2: 13, sun: 'full', month: 10, cc: 'US', tMean: 12 });
  assert.ok(us.picks.every((p) => y.PLANTS[p.key].season !== 'warm'), 'cool weather outside South Asia: no warm-season plants');
  const list = y.shoppingList(med.picks, 'BD');
  assert.equal(list.currency.code, 'BDT');
  assert.ok(list.sample && list.total > 0 && list.lines.some((l) => l.item === 'trellis'));
});
await checkAsync('Yard: SAM 3.1 outline of the photo, and no outline (not an error) when SAM cannot answer', async () => {
  const y = await import('../lib/yard.js');
  const image = { dataUrl: 'data:image/jpeg;base64,AA', width: 400, height: 300 };
  const ok = await y.outlineYard(image, { segment: async () => ({ objects: [{ id: 1, box: { left: 50, top: 150, right: 350, bottom: 290 }, areaPx: 30000, containsPoint: true, mask: { width: 4, height: 4, bounds: { left: 50, top: 150, right: 350, bottom: 290 }, svgPath: 'M0 0L4 0L4 4L0 4Z' } }] }) });
  assert.equal(ok.outline.share, 25);
  assert.equal(ok.error, null);
  let n = 0;
  const down = await y.outlineYard(image, { segment: async () => { n++; throw new Error('model_not_found: The requested model was not found.'); } });
  assert.equal(down.outline, null);
  assert.equal(n, 1, 'one prompt only once SAM failed every retry');
});
await checkAsync('Help: nearest agriculture office per country, phone and directions, hotline, nothing faked', async () => {
  const o = await import('../lib/office.js');
  assert.equal(o.officeQuery('BD'), 'Upazila Agriculture Office');
  assert.equal(o.officeQuery('IN'), 'Krishi Vigyan Kendra');
  assert.equal(o.officeQuery('US'), 'cooperative extension office');
  assert.equal(o.hotlineFor('BD').number, '16123');
  assert.equal(o.hotlineFor('IN').tel, '18001801551');
  assert.equal(o.hotlineFor('US'), null, 'no hotline outside Bangladesh and India');
  const at = { lat: 24.88, lon: 89.33 };
  const list = o.officesFromPlaces({ places: [
    { id: 'a', displayName: { text: 'Upazila Agriculture Office, Shibganj' }, location: { latitude: 24.95, longitude: 89.33 }, nationalPhoneNumber: '01700-000000', internationalPhoneNumber: '+880 1700-000000', googleMapsUri: 'https://maps.google.com/?cid=1' },
    { id: 'b', displayName: { text: 'Far office' }, location: { latitude: 26.5, longitude: 89.33 } },
    { id: 'c', displayName: { text: 'Mahasthan office' }, location: { latitude: 24.9, longitude: 89.34 } },
  ] }, at, 40);
  assert.deepEqual(list.map((x) => x.id), ['g-c', 'g-a'], 'nearest first, far ones dropped');
  assert.equal(list[1].tel, '+8801700000000');
  assert.equal(list[0].phone, null);
  const help = await o.officeHelp({ ...at, cc: 'BD', lang: 'bn' }, { nearbyOffices: async () => ({ offices: list, source: 'Google Maps' }) });
  assert.equal(help.hotline.number, '16123');
  assert.match(help.offices[0].directions, /google\.com\/maps\/dir/);
  assert.match(help.note, /does not call/);
});
await checkAsync('Sathi: a crop problem calls find_agri_office (no diagnosis), with the land\'s country', async () => {
  let asked = null;
  const steps = [
    { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'find_agri_office', arguments: '{}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: 'The agriculture office 3 km away can look at it.' }, finish_reason: 'stop' }] },
  ];
  let i = 0;
  const think = async (req) => {
    if (i === 0) assert.match(req.messages[0].content, /never name a disease, pest or medicine/);
    return { resp: steps[i++], provider: 'baseten', model: 'x', label: 'Muse Spark Open' };
  };
  const r = await runAgent({ userText: 'My gourd leaves are curling', lat: 24.88, lon: 89.33, cc: 'BD', lang: 'en', think, offices: async (a) => ((asked = a), { offices: [], hotline: { number: '16123' } }) });
  assert.equal(asked.cc, 'BD');
  assert.equal(r.trace.find((s) => s.name === 'find_agri_office').output.hotline.number, '16123');
  assert.match(r.answer, /agriculture office/);
});
await checkAsync('Yards: own farm only, demo yards in the demo farm, read only writes not saved', async () => {
  process.env.ADMIN_EMAILS = 'boss@test.com';
  const B = { id: 'b0000000-0000-4000-8000-000000000001', email: 'boss@test.com' };
  const P = { id: 'b0000000-0000-4000-8000-000000000002', email: 'p@test.com' };
  const mineY = await runAs(P, () => memStore.createYard({ lat: 1, lon: 1, lang: 'bn' }));
  const demoY = await runAs(B, () => memStore.createYard({ lat: 2, lon: 2, lang: 'bn' }), scopeFor(B, 'demo'));
  assert.equal(demoY.demo, true);
  assert.equal(demoY.owner_id, null);
  assert.deepEqual((await runAs(P, () => memStore.listYards())).map((y) => y.id), [mineY.id]);
  assert.deepEqual((await runAs(P, () => memStore.listYards(), scopeFor(P, 'demo'))).map((y) => y.id), [demoY.id]);
  await runAs(P, () => memStore.updateYard(demoY.id, { sun: 'full' }), scopeFor(P, 'demo'));
  assert.notEqual((await runAs(B, () => memStore.getYard(demoY.id), scopeFor(B, 'demo'))).sun, 'full');
  assert.equal(await runAs(P, () => memStore.deleteYard(demoY.id), scopeFor(P, 'demo')), false);
  delete process.env.ADMIN_EMAILS;
});

// ---------- v0.16.0: a crop problem photo, measured, never diagnosed ----------
await checkAsync('Problem photo: share of the leaf covered by patches (outside the leaf does not count), and SAM down', async () => {
  const pb = await import('../lib/problem.js');
  // Fake masks: rectangles in image pixels, painted on the grid by the same scale rule.
  const rect = (grid, gw, gh, scale, raw) => {
    for (let y = Math.floor(raw.y0 * scale); y < Math.floor(raw.y1 * scale); y++) for (let x = Math.floor(raw.x0 * scale); x < Math.floor(raw.x1 * scale); x++) if (x < gw && y < gh) grid[y * gw + x] = 1;
  };
  const leaf = { raw: { x0: 0, y0: 0, x1: 800, y1: 800 } };
  const inside = { raw: { x0: 0, y0: 0, x1: 400, y1: 400 } };
  const outside = { raw: { x0: 800, y0: 0, x1: 1000, y1: 800 } };
  assert.equal(pb.patchShare({ width: 1000, height: 800, leaf, patches: [inside, outside] }, (g, gw, gh, s, raw) => rect(g, gw, gh, s, raw)), 25);
  const down = await pb.measureProblem({ dataUrl: 'x', width: 10, height: 10 }, { segment: async () => { throw new Error('model_not_found: The requested model was not found.'); } });
  assert.equal(down.share, null);
  assert.match(down.error, /model_not_found/);
  const noLeaf = await pb.measureProblem({ dataUrl: 'x', width: 10, height: 10 }, { segment: async () => ({ objects: [] }) });
  assert.match(noLeaf.error, /no leaf/);
  let n = 0;
  const clean = await pb.measureProblem({ dataUrl: 'x', width: 100, height: 100 }, { segment: async () => (n++ ? { objects: [] } : { objects: [{ id: 1, box: { left: 0, top: 0, right: 100, bottom: 100 }, areaPx: 5000, containsPoint: true, raw: {}, mask: { width: 4, height: 4, bounds: { left: 0, top: 0, right: 100, bottom: 100 }, svgPath: 'M0 0Z' } }] }) });
  assert.equal(clean.share, 0, 'a leaf with no patches is 0%, not unknown');
  assert.equal(clean.leaf.svgPath, 'M0 0Z');
  assert.ok(!('raw' in clean.leaf), 'masks are not sent to the browser');
});

// ---------- v0.17.0: Sathi at work (each step reported as it happens) ----------
await checkAsync('Sathi at work: model turns and tools are reported in order, with times and the model name', async () => {
  const steps = [
    { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'find_agri_office', arguments: '{}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: 'The office can look at it.' }, finish_reason: 'stop' }] },
  ];
  let i = 0;
  const seen = [];
  const r = await runAgent({ userText: 'leaves curling', lat: 24, lon: 89, cc: 'BD', think: async () => ({ resp: steps[i++], provider: 'baseten', model: 'x', label: 'Muse Spark Open · Baseten' }), offices: async () => ({ offices: [], hotline: null }), onStep: (s) => seen.push(`${s.type}:${s.phase}${s.name ? `:${s.name}` : ''}`) });
  assert.equal(r.answer, 'The office can look at it.');
  assert.deepEqual(seen, ['think:start', 'think:done', 'tool:start:find_agri_office', 'tool:done:find_agri_office', 'think:start', 'think:done']);
  // A step reporter that throws never breaks the answer.
  i = 0;
  const r2 = await runAgent({ userText: 'x', lat: 1, lon: 1, think: async () => ({ resp: steps[1], provider: 'baseten', model: 'x', label: 'L' }), onStep: () => { throw new Error('boom'); } });
  assert.equal(r2.answer, 'The office can look at it.');
});

// ---------- v0.19.0: earlier data when a source is down ----------
await checkAsync('Kept answers: a failing source returns the last good answer with its time; nothing kept passes the error on', async () => {
  const keep = await import('../lib/keep.js');
  keep._resetKeep();
  await assert.rejects(keep.withKeep('t|a', async () => { throw new Error('down'); }), /down/);
  const good = await keep.withKeep('t|a', async () => ({ rain: 12 }));
  assert.equal(good.staleAt, null);
  const bad = await keep.withKeep('t|a', async () => { throw new Error('Open-Meteo HTTP 503'); });
  assert.deepEqual(bad.value, { rain: 12 });
  assert.ok(bad.staleAt && !Number.isNaN(Date.parse(bad.staleAt)));
  assert.match(bad.reason, /503/);
  // An answer the check rejects counts as a failure too.
  const rejected = await keep.withKeep('t|a', async () => ({ rain: null }), { ok: (v) => v.rain != null });
  assert.deepEqual(rejected.value, { rain: 12 });
  // Too old: not served.
  keep.remember('t|b', 1, { now: Date.now() - 5 * 864e5 });
  await assert.rejects(keep.withKeep('t|b', async () => { throw new Error('down'); }), /down/);
});

await checkAsync('Number check: Bangla and Hindi digits, Indian thousands, rounding; figures not in the data are marked as Sathi\'s own', async () => {
  const nc = await import('../lib/numcheck.js');
  const facts = nc.factsFrom({ parts: [{ text: 'greenness 0.774 on 2026-10-25, 0.03 less', source: 'Sentinel-2' }, { text: 'rain chance 70', source: 'Open-Meteo' }, { text: '62.6', source: 'FAOSTAT' }] });
  const r = nc.checkNumbers('সবুজ ভাব ০.৭৭, ০.০৩ কম। ৭০% বৃষ্টি। প্রায় ৬৩ মণ। দাম ১,৮৫,০০০ টাকা। 1. ঠিক আছে। ২০২৬ সালে।', facts);
  assert.deepEqual(r.numbers.map((n) => [n.raw, n.source]), [['০.৭৭', 'Sentinel-2'], ['০.০৩', 'Sentinel-2'], ['৭০', 'Open-Meteo'], ['৬৩', 'FAOSTAT'], ['১,৮৫,০০০', null]]);
  assert.equal(r.matched, 4);
  assert.equal(r.total, 5);
  const hi = nc.checkNumbers('हरियाली ०.७७ है', facts);
  assert.equal(hi.numbers[0].source, 'Sentinel-2');
  // Positions point at the number in the original text, so the app can mark it.
  const ans = 'NDVI is 0.77 now';
  const one = nc.checkNumbers(ans, facts).numbers[0];
  assert.equal(ans.slice(one.i, one.i + one.len), '0.77');
  // Tool results: keys say where a number came from; coordinates are never used.
  const f2 = nc.factsFrom({ tools: [{ output: { lat: 24.85, soil: { ph: 6.4 }, rain_next_10_days_mm: 36 }, source: 'field' }], sourceForKey: (p) => (/soil/.test(p.join('.')) ? 'ISRIC SoilGrids' : /rain/.test(p.join('.')) ? 'Open-Meteo' : null) });
  assert.deepEqual(f2.map((f) => [f.value, f.source]), [[6.4, 'ISRIC SoilGrids'], [36, 'Open-Meteo']]);
});

await checkAsync('Earlier weather: when Open-Meteo fails, the plan keeps the last good forecast for the spot and says when it is from', async () => {
  (await import('../lib/keep.js'))._resetKeep();
  const land = { place: 'bogura', lat: 24.881, lon: 89.331 };
  const good = await buildPlan(land, { fetchImpl: fakeFetch(['fao']), today: TODAY, placeDeps: fakePlace('BD', 'Bangladesh'), think: noThink });
  assert.equal(good.weatherStaleAt, null);
  (await import('../lib/weather.js'))._resetWeatherCache(); // the 1-hour store has run out
  const down = await buildPlan(land, { fetchImpl: fakeFetch(['fao', 'weather']), today: TODAY, placeDeps: fakePlace('BD', 'Bangladesh'), think: noThink });
  assert.ok(down.weatherStaleAt, 'marked as earlier data');
  assert.equal(down.weatherError, null);
  assert.equal(down.rain.rainDate, good.rain.rainDate);
  // Another spot with nothing kept: no forecast, the error is shown as before.
  const other = await buildPlan({ ...land, lat: 22.1, lon: 88.2 }, { fetchImpl: fakeFetch(['fao', 'weather']), today: TODAY, placeDeps: fakePlace('BD', 'Bangladesh'), think: noThink });
  assert.equal(other.weather, null);
  assert.ok(other.weatherError);
});

await checkAsync('Meta request IDs: each Meta response is recorded with its x-request-id, path, model and time; failures carry them', async () => {
  const meta = await import('../lib/meta.js');
  const realFetch = globalThis.fetch;
  const realKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = 'test-key';
  let n = 0;
  globalThis.fetch = async (url) => {
    n++;
    const body = String(url).endsWith('/models') ? { data: [] } : { error: { code: 'model_not_found', message: 'The requested model was not found.' } };
    return new Response(JSON.stringify(body), { status: String(url).endsWith('/models') ? 200 : 404, headers: { 'content-type': 'application/json', 'x-request-id': `req-${n}` } });
  };
  const tries = meta.RETRY.tries;
  meta.RETRY.tries = 2;
  try {
    const r = await meta.countTries(() => meta.listModels());
    assert.deepEqual(r.value, []);
    assert.deepEqual(r.calls.map((c) => [c.id, c.status, c.path]), [['req-1', 200, '/v1/models'], ['req-2', 200, '/v1/models']]);
    assert.ok(!Number.isNaN(Date.parse(r.calls[0].at)));
    const err = await meta.countTries(() => meta.chat({ messages: [{ role: 'user', content: 'ok' }], model: 'muse-spark-1.3' })).catch((e) => e);
    assert.ok(err instanceof Error);
    const last = err.calls.at(-1);
    assert.equal(last.status, 404);
    assert.equal(last.model, 'muse-spark-1.3');
    assert.match(last.id, /^req-/);
    assert.ok(!JSON.stringify(err.calls).includes('test-key'), 'the key is never recorded');
  } finally {
    globalThis.fetch = realFetch;
    meta.RETRY.tries = tries;
    if (realKey === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = realKey;
  }
});

await checkAsync('Demo leaf: saved without a measurement while SAM is down, measured once later, then never asked again', async () => {
  const dl = await import('../lib/demoleaf.js');
  const files = new Map();
  const putFile = async (path, buffer) => files.set(path, { buffer: Buffer.from(buffer) });
  const getFile = async (path) => files.get(path) || null;
  const shape = { svgPath: 'M0 0L4 0L4 4Z', bounds: { left: 1, top: 2, right: 30, bottom: 40 }, mw: 4, mh: 4 };
  assert.equal(dl.cleanMeasure({ leaf: { svgPath: 'x' } }), null, 'no bounds or share: not kept');
  const clean = dl.cleanMeasure({ width: 100, height: 80, leaf: { ...shape, raw: { big: true } }, patches: [shape], share: 30.6, extra: 1 });
  assert.equal(clean.share, 31);
  assert.ok(!('raw' in clean.leaf) && !('extra' in clean));
  const saved = await dl.saveLeaf({ photo: Buffer.from('jpg'), width: 100, height: 80, measure: null }, { putFile });
  assert.equal(saved.measure, null);
  let calls = 0;
  const down = async () => { calls++; return { error: 'model_not_found' }; };
  const after1 = await dl.retryLeaf({ getFile, putFile, measure: down });
  assert.equal(after1.measure, null);
  assert.equal(after1.tries, 1);
  assert.match(after1.lastError, /model_not_found/);
  const up = async (img) => { calls++; assert.match(img.dataUrl, /^data:image\/jpeg;base64,/); return { width: 100, height: 80, leaf: shape, patches: [shape], share: 22 }; };
  const after2 = await dl.retryLeaf({ getFile, putFile, measure: up });
  assert.equal(after2.measure.share, 22);
  assert.ok(after2.measuredAt);
  const n = calls;
  const after3 = await dl.retryLeaf({ getFile, putFile, measure: up });
  assert.equal(calls, n, 'a measured leaf is never sent to SAM again');
  assert.equal(after3.measure.share, 22);
  assert.equal((await dl.loadLeaf({ getFile })).measure.share, 22, 'kept in storage');
});

await checkAsync('v0.20.1: spots asked with three short phrases and combined; Measure again; yard says SAM answered', async () => {
  const pb = await import('../lib/problem.js');
  assert.deepEqual(pb.PATCH_PROMPTS, ['brown spot', 'yellow patch', 'spot', 'brown area', 'dark patch']);
  // v0.24.1: a "leaf" mask with two pieces: only the larger piece is the leaf; spots on the smaller one do not count.
  const twoLeaves = (g, gw, gh, sc, raw) => { const put = (l, t, r, b) => { for (let yy = Math.floor(t * sc); yy < Math.floor(b * sc); yy++) for (let xx = Math.floor(l * sc); xx < Math.floor(r * sc); xx++) g[yy * gw + xx] = 1; }; if (raw.two) { put(0, 0, 60, 100); put(80, 0, 100, 30); } else put(raw.l, raw.t, raw.r, raw.b); };
  assert.equal(pb.patchShare({ width: 100, height: 100, leaf: { raw: { two: true }, bounds: {} }, patches: [{ raw: { l: 0, t: 0, r: 60, b: 50 } }] }, twoLeaves), 50);
  assert.equal(pb.onLeaf({ width: 100, height: 100, leaf: { raw: { two: true }, bounds: {} }, patches: [{ raw: { l: 82, t: 2, r: 98, b: 28 } }, { raw: { l: 10, t: 10, r: 20, b: 20 } }] }, twoLeaves).length, 1, 'a spot on the leaf behind is dropped');
  const obj = (l, t, r, b) => ({ id: 1, box: { left: l, top: t, right: r, bottom: b }, areaPx: (r - l) * (b - t), containsPoint: true, raw: { l, t, r, b }, mask: { width: 4, height: 4, bounds: { left: l, top: t, right: r, bottom: b }, svgPath: 'M0 0Z' } });
  const asked = [];
  const seg = async (img, prompt) => {
    asked.push(prompt);
    if (prompt === 'leaf') return { objects: [obj(0, 0, 100, 100)] };
    if (prompt === 'brown spot') return { objects: [obj(10, 10, 30, 30)] };
    if (prompt === 'yellow patch') throw new Error('timeout');
    if (prompt === 'brown area') return { objects: [obj(0, 0, 100, 100), obj(140, 10, 170, 40)] }; // the whole leaf again, and a spot on another leaf
    return { objects: [obj(11, 11, 30, 30), obj(60, 60, 80, 80)] }; // 'spot': one repeat, one new
  };
  const rect = (g, gw, gh, sc, raw) => { for (let yy = Math.floor(raw.t * sc); yy < Math.floor(raw.b * sc); yy++) for (let xx = Math.floor(raw.l * sc); xx < Math.floor(raw.r * sc); xx++) g[yy * gw + xx] = 1; };
  const m = await pb.measureProblem({ dataUrl: 'x', width: 200, height: 100 }, { segment: seg, paintFn: rect });
  assert.equal(m.error, null, 'one phrase failing does not fail the measurement');
  assert.deepEqual(asked.slice(1).sort(), ['brown area', 'brown spot', 'dark patch', 'spot', 'yellow patch']);
  assert.equal(m.patches.length, 2, 'the same spot found twice counts once; spots on other leaves and the whole leaf again are dropped');
  assert.equal(m.share, 8, '20x20 + 20x20 of a 100x100 leaf');
  const allDown = await pb.measureProblem({ dataUrl: 'x', width: 100, height: 100 }, { segment: async (i, p) => { if (p === 'leaf') return { objects: [obj(0, 0, 100, 100)] }; throw new Error('model_not_found'); } });
  assert.match(allDown.error, /model_not_found/, 'every phrase failing is an error, not 0%');

  const y = await import('../lib/yard.js');
  assert.ok(y.YARD_PROMPTS.includes('lawn'));
  const none = await y.outlineYard({ dataUrl: 'x', width: 10, height: 10 }, { segment: async () => ({ objects: [] }) });
  assert.equal(none.answered, true);
  const down = await y.outlineYard({ dataUrl: 'x', width: 10, height: 10 }, { segment: async () => { throw new Error('model_not_found'); } });
  assert.equal(down.answered, false);

  const dl = await import('../lib/demoleaf.js');
  const files = new Map();
  const putFile = async (p, b) => files.set(p, Buffer.from(b));
  const getFile = async (p) => (files.has(p) ? { buffer: files.get(p) } : null);
  const shape = { svgPath: 'M0 0Z', bounds: { left: 0, top: 0, right: 10, bottom: 10 }, mw: 4, mh: 4 };
  await dl.saveLeaf({ photo: Buffer.from('jpg'), width: 100, height: 80, measure: { width: 100, height: 80, leaf: shape, patches: [], share: 0 } }, { putFile, now: new Date('2026-10-28T21:30:00Z') });
  const same = await dl.retryLeaf({ getFile, putFile, measure: async () => ({ leaf: shape, patches: [shape], share: 40 }) });
  assert.equal(same.measure.share, 0, 'without force a measured leaf is left alone');
  const kept = await dl.retryLeaf({ getFile, putFile, force: true, measure: async () => ({ error: 'model_not_found' }), now: new Date('2026-10-29T00:00:00Z') });
  assert.equal(kept.measure.share, 0, 'SAM down: the earlier measurement stays');
  assert.match(kept.lastError, /model_not_found/);
  const again = await dl.retryLeaf({ getFile, putFile, force: true, measure: async () => ({ leaf: shape, patches: [shape], share: 40 }), now: new Date('2026-10-29T00:01:00Z') });
  assert.equal(again.measure.share, 40);
  assert.equal(again.measuredAt, '2026-10-29T00:01:00.000Z');
});

await checkAsync('v0.21.0: Guide and agent texts exist in Bangla, Hindi and English; every button named in the Guide exists; the agent guides state the rules', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../public/next/ks-text.js', import.meta.url), 'utf8'), box);
  vm.runInNewContext(fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8'), box);
  const T = Object.values(box.window).find((v) => v && v.en && v.bn && v.hi);
  assert.ok(T, 'app text found');
  const I = Object.values(box.window).find((v) => v && v !== T && v.en && v.bn && v.hi) || { bn: {}, hi: {}, en: {} };
  const keys = Object.keys(T.en).filter((k) => /^(gd|ag|wt)[A-Z0-9_]/.test(k) || ['askL', 'addAnyL', 'pbPickPlant'].includes(k));
  assert.ok(keys.length > 40);
  for (const L of ['bn', 'hi']) for (const k of keys) assert.ok(T[L][k], `${L} ${k}`);
  for (const L of ['bn', 'hi', 'en']) for (const k of keys.filter((x) => x.startsWith('gd'))) for (const [, ref] of String(T[L][k]).matchAll(/\{([a-zA-Z0-9]+)\}/g)) assert.ok(T[L][ref] || I[L]?.[ref], `${L} ${k} names {${ref}}`);
  const page = fs.readFileSync(new URL('../public/for-agents.html', import.meta.url), 'utf8');
  const txt = fs.readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
  for (const doc of [page, txt]) {
    assert.match(doc, /never guess one/);
    assert.match(doc, /never names a disease or a medicine/);
    assert.match(doc, /data-action/);
  }
});

await checkAsync('v0.22.0 Sathi on watch: an alert wakes her, she looks with tools, looks again later, asks the farmer, never names a disease', async () => {
  const w = await import('../lib/watch.js');
  assert.equal(w.missionFrom({ title: 'rain_skip', body: '{}' }), null, 'not every alert wakes her');
  const m0 = w.missionFrom({ title: 'birds_still', area: 'shed', owner_id: null, land_id: null, body: JSON.stringify({ value: 3, clip: 'Morning' }) }, { id: 'm1', now: () => Date.parse('2026-10-29T06:40:00Z') });
  assert.equal(m0.place_kind, 'shed');
  assert.equal(m0.steps[0].key, 'wtSawAlert');
  const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const turn = (calls) => ({ resp: { choices: [{ message: { role: 'assistant', content: '', tool_calls: calls } }] }, provider: 'baseten', label: 'Muse Spark Open · Baseten' });
  const words = (text) => ({ resp: { choices: [{ message: { role: 'assistant', content: text } }] }, provider: 'baseten', label: 'Muse Spark Open · Baseten' });
  // First run: looks at the shed, thinks it may pass, looks again in 30 minutes, tells the farmer.
  const script1 = [
    turn([call('a', 'look_at_shed', { why: '3 birds are still; I want the shed temperature first.' })]),
    turn([call('b', 'check_again_later', { why: 'They may be resting, so I will look again soon.', minutes: 30 })]),
    turn([call('c', 'tell_farmer', { why: 'Keep the farmer informed.', message: '3 hens have not moved. I will look again in 30 minutes.' })]),
  ];
  let i = 0;
  const tools = { look_at_shed: async () => ({ simulated: true, temp: 31, humidity: 70, camera: { birds: 41, still: 3, simulated: true } }), look_at_camera_again: async () => ({ simulated: true, temp: 31, humidity: 70, camera: { birds: 41, still: 3, simulated: true } }), look_at_weather: async () => ({ days: [] }) };
  let now = Date.parse('2026-10-29T06:40:00Z');
  const m1 = await w.runMission(m0, { tools, think: async () => script1[i++], now: () => now });
  assert.equal(m1.status, 'sleeping');
  assert.equal(m1.due_at, '2026-10-29T07:10:00.000Z');
  assert.ok(m1.steps.some((s) => s.kind === 'saw' && s.key === 'wtSawShed' && s.vars.still === 3 && s.simulated));
  assert.ok(m1.steps.some((s) => s.kind === 'thought' && /resting/.test(s.text.en)));
  assert.ok(m1.steps.some((s) => s.key === 'wtDidTold'));
  // Second run: still the same, asks the farmer to call the vet. A sentence naming a disease is dropped.
  now = Date.parse('2026-10-29T07:10:00Z');
  const script2 = [
    turn([call('d', 'look_at_camera_again', { why: 'Look again with SAM 3.1.' })]),
    turn([call('e', 'ask_farmer', { why: 'Still the same 3 birds; this could be newcastle disease.', action: 'call_vet', question: 'The same 3 hens still have not moved. Call the vet?' })]),
    turn([call('f', 'tell_farmer', { why: 'Tell the farmer.', message: 'They still have not moved after 30 minutes. I have asked you to call the vet.' })]),
  ];
  i = 0;
  const m2 = await w.runMission(m1, { tools, think: async () => script2[i++], now: () => now });
  assert.equal(m2.status, 'waiting');
  assert.ok(!JSON.stringify(m2.steps).toLowerCase().includes('newcastle'), 'a disease name never reaches the log');
  assert.ok(m2.messages.some((x) => x.role === 'user' && /look again/i.test(x.content)), 'the same conversation continues');
  const wait = m2.steps.find((s) => s.kind === 'wait');
  assert.equal(wait.action, 'call_vet');
  // The farmer taps yes: the vet call opens; the mission is done.
  const { mission: m3, open } = w.decide(m2, 'yes', { now: () => now });
  assert.equal(open, 'call_vet');
  assert.equal(m3.status, 'done');
  assert.equal(w.decide(m3, 'yes').open, null, 'a second tap does nothing');
  // "Tell me only": she cannot ask to call anyone.
  assert.ok(!w.watchTools('shed', 'tell').some((t) => t.function.name === 'ask_farmer'));
  assert.ok(w.watchTools('shed', 'ask').some((t) => t.function.name === 'ask_farmer'));
  // A tool she does not have is refused; she cannot look again a third time.
  i = 0;
  const m4 = await w.runMission({ ...m0, runs: 2, messages: [], steps: [...m0.steps] }, { tools, think: async () => [turn([call('g', 'check_again_later', { why: 'Again.', minutes: 30 })]), words('done')][i++], now: () => now });
  assert.notEqual(m4.status, 'sleeping');
  const v = w.missionView(m2);
  assert.ok(!('messages' in v), 'the browser never gets the model conversation');
});

await checkAsync('v0.23.0 field camera: SAM 3.1 outlines the crop, yellow counted by colour (v0.25.1); a rise that holds is found, one odd look is not; demo frames are dated in order', async () => {
  const fc = await import('../lib/fieldcam.js');
  const rect = (g, gw, gh, sc, raw) => { for (let yy = Math.floor(raw.t * sc); yy < Math.floor(raw.b * sc); yy++) for (let xx = Math.floor(raw.l * sc); xx < Math.floor(raw.r * sc); xx++) if (xx < gw && yy < gh) g[yy * gw + xx] = 1; };
  const obj = (l, t, r, b) => ({ id: 1, box: { left: l, top: t, right: r, bottom: b }, areaPx: (r - l) * (b - t), containsPoint: true, raw: { l, t, r, b }, mask: { width: 4, height: 4, bounds: { left: l, top: t, right: r, bottom: b }, svgPath: 'M0 0Z' } });
  const asked = [];
  const seg = async (img, p) => { asked.push(p); if (p === 'rice plant') return { objects: [] }; if (p === 'plant') return { objects: [obj(0, 0, 100, 50), obj(0, 50, 100, 100)] }; return { objects: [] }; };
  // v0.25.1: the yellow share is counted by colour inside SAM's outline: here the top-left 50 x 20 is straw yellow, the rest green.
  const pixels = async (img, gw, gh) => { const px = new Uint8Array(gw * gh * 3); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = (y * gw + x) * 3; const yel = x < gw / 2 && y < gh / 5; px.set(yel ? [214, 178, 60] : [70, 150, 50], i); } return px; };
  const m = await fc.measureLook({ dataUrl: 'x', width: 100, height: 100 }, { segment: seg, paint: rect, pixels });
  assert.equal(m.error, null);
  assert.equal(asked[0], 'rice plant', 'tries the plant phrases in order');
  assert.ok(!asked.includes('brown spot'), 'no leaf spot phrases on a field (live they found only the bare bund)');
  assert.equal(m.plants.length, 2);
  assert.equal(m.share, 10, '50x20 of a 100x100 plant area');
  assert.equal(m.method, 'colour');
  assert.ok(m.cells.length > 0 && m.cells.every((c) => c.x < 50 && c.y < 20), 'the yellow squares sit where the yellow is');
  assert.equal(fc.isYellow(214, 178, 60), true, 'straw gold');
  assert.equal(fc.isYellow(150, 100, 50), true, 'brown');
  assert.equal(fc.isYellow(70, 150, 50), false, 'green rice');
  assert.equal(fc.isYellow(120, 120, 110), false, 'grey stalk or haze');
  assert.equal(fc.isYellow(30, 25, 10), false, 'deep shadow');
  const none = await fc.measureLook({ dataUrl: 'x', width: 10, height: 10 }, { segment: async () => ({ objects: [] }), paint: rect });
  assert.match(none.error, /no plants/);
  const now = Date.parse('2026-10-29T08:00:00Z');
  const at = (h) => new Date(now - h * 3600e3).toISOString();
  const rising = [5, 6, 5, 12, 15, 18].map((share, i) => ({ at: at(60 - i * 10), share }));
  assert.equal(fc.trend(rising, { now }).rising, true);
  assert.equal(fc.trend(rising, { now }).to, 15);
  const blip = [5, 6, 5, 5, 20, 6].map((share, i) => ({ at: at(60 - i * 10), share }));
  assert.equal(fc.trend(blip, { now }).rising, false, 'one odd look (a shadow) does not count');
  assert.equal(fc.trend(rising.slice(0, 2), { now }).rising, false, 'two looks are not enough');
  const d = fc.demoDates(4, { now });
  assert.equal(d.length, 4);
  assert.ok(d[0] < d[1] && d[3] === new Date(now).toISOString(), 'oldest first, the last one now');
  // Stored per field; a second save waits for the first.
  const files = new Map();
  const deps = { getFileImpl: async (p) => (files.has(p) ? { buffer: files.get(p) } : null), putFileImpl: async (p, b) => files.set(p, Buffer.from(b)) };
  const land = '11111111-1111-4111-8111-111111111111';
  await Promise.all([fc.saveLooks(land, (ls) => [...ls, { id: 'a', at: at(2), share: 5 }], deps), fc.saveLooks(land, (ls) => [...ls, { id: 'b', at: at(1), share: 7 }], deps)]);
  assert.deepEqual((await fc.readLooks(land, deps)).map((l) => l.id), ['a', 'b']);
  const w = await import('../lib/watch.js');
  assert.equal(w.TRIGGERS.patch_rising, 'field', 'a rising patch wakes Sathi');
  assert.ok(w.watchTools('field', 'ask').some((x) => x.function.name === 'look_at_field_camera'));
});

await checkAsync('v0.24.0 ripening or a problem: warmth since sowing (NASA POWER), evenness, grain heads; animals in the field', async () => {
  const ag = await import('../lib/agroclimate.js');
  let asked = '';
  const fake = async (url) => { asked = url; return { ok: true, json: async () => ({ properties: { parameter: { T2M_MAX: { 20260701: 34, 20260702: 40, 20260703: -999 }, T2M_MIN: { 20260701: 26, 20260702: 8, 20260703: 25 } } } }) }; };
  const days = await ag.powerDaily({ lat: 24.85, lon: 89.37, start: '2026-07-01', end: '2026-07-03', fetchImpl: fake });
  assert.match(asked, /power\.larc\.nasa\.gov.*T2M_MAX,T2M_MIN.*start=20260701&end=20260703/);
  assert.equal(days.length, 2, 'missing days (-999) are left out');
  assert.equal(ag.gddFrom(days, ag.GDD_CROPS.rice), 33, 'rice: (34+26)/2-10 = 20, then high capped at 35 and low floored at 10: 12.5; 32.5 rounds to 33');
  const h = ag.heatStage({ crop: 'rice', days: Array.from({ length: 90 }, (_, i) => ({ date: `2026-07-${i}`, tMax: 33, tMin: 25 })) });
  assert.equal(h.gdd, 1710);
  assert.equal(h.stage, 'ripening', '86% of 2000');
  assert.equal(ag.heatStage({ crop: 'unknown', days }), null);
  const fc = await import('../lib/fieldcam.js');
  const rect = (g, gw, gh, sc, raw) => { for (let yy = Math.floor(raw.t * sc); yy < Math.floor(raw.b * sc); yy++) for (let xx = Math.floor(raw.l * sc); xx < Math.floor(raw.r * sc); xx++) if (xx < gw && yy < gh) g[yy * gw + xx] = 1; };
  const plants = [{ raw: { l: 0, t: 0, r: 100, b: 100 } }];
  assert.equal(fc.evenness({ width: 100, height: 100, plants, patches: [{ raw: { l: 0, t: 0, r: 100, b: 100 } }] }, rect), 1, 'all over: even');
  assert.equal(fc.evenness({ width: 100, height: 100, plants, patches: [{ raw: { l: 0, t: 0, r: 25, b: 25 } }] }, rect), 0.06, 'one corner: patchy');
  assert.equal(fc.classify({ look: { even: 0.9, heads: 0 }, stage: 'ripening' }), 'ripening');
  assert.equal(fc.classify({ look: { even: 0.2, heads: 6 }, stage: 'ready' }), 'ripening', 'grain heads');
  assert.equal(fc.classify({ look: { even: 0.9, heads: 0 }, stage: 'growing', heatPct: 85 }), 'ripening', 'warmth says late');
  assert.equal(fc.classify({ look: { even: 0.9, heads: 8 }, stage: 'growing', heatPct: 40 }), 'problem', 'yellow while it should be green');
  assert.equal(fc.classify({ look: { even: 0.2, heads: 0 }, stage: 'ripening' }), 'problem', 'patchy late in the season still goes to the office');
  const animals = await fc.findAnimals({ dataUrl: 'x', width: 100, height: 100 }, { segment: async (img, p) => (p === 'goat' ? { objects: [{ box: { left: 1, top: 2, right: 30, bottom: 40 }, confidence: 0.9 }, { box: { left: 50, top: 2, right: 80, bottom: 40 }, confidence: 0.2 }] } : { objects: [] }) });
  assert.deepEqual(animals.map((a) => a.kind), ['goat'], 'unsure boxes are left out');
  const w = await import('../lib/watch.js');
  assert.equal(w.TRIGGERS.crop_ripening, 'field');
  assert.equal(w.TRIGGERS.animal_in_field, 'field');
  assert.ok(w.ACTIONS.includes('plan_harvest'));
  assert.match(w.watchSystem('ask'), /ripening, not a problem/);
});

await checkAsync('Meta relay: with the two Railway variables set, calls go to the relay with the key in X-Meta-Key and the secret; without them, direct', async () => {
  const meta = await import('../lib/meta.js');
  const keep = { u: process.env.META_RELAY_URL, s: process.env.META_RELAY_SECRET };
  try {
    delete process.env.META_RELAY_URL;
    delete process.env.META_RELAY_SECRET;
    const [direct] = meta.viaRelay('https://api.meta.ai/v1/models', { headers: { Authorization: 'Bearer k1' } });
    assert.equal(direct, 'https://api.meta.ai/v1/models');
    assert.equal(meta.relayInfo(), null);
    process.env.META_RELAY_URL = 'https://abc.supabase.co/functions/v1/meta-relay/';
    process.env.META_RELAY_SECRET = 's3cret';
    const [to, opts] = meta.viaRelay('https://api.meta.ai/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer k1', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(to, 'https://abc.supabase.co/functions/v1/meta-relay/responses');
    assert.equal(opts.headers['X-Meta-Key'], 'k1');
    assert.equal(opts.headers['X-Relay-Secret'], 's3cret');
    assert.ok(!('Authorization' in opts.headers), 'no Authorization header goes to Supabase');
    assert.equal(opts.headers['Content-Type'], 'application/json');
    assert.equal(meta.relayInfo().host, 'abc.supabase.co');
    // Only Meta's own address is rerouted.
    const [other] = meta.viaRelay('https://example.com/x', {});
    assert.equal(other, 'https://example.com/x');
  } finally {
    if (keep.u === undefined) delete process.env.META_RELAY_URL; else process.env.META_RELAY_URL = keep.u;
    if (keep.s === undefined) delete process.env.META_RELAY_SECRET; else process.env.META_RELAY_SECRET = keep.s;
  }
});

await checkAsync('Storage file types: JSON records go to shed-clips, as land-images only accepts images (the demo leaf save failed live on Oct 29)', async () => {
  const st = await import('../lib/store.js');
  const keep = process.env.STORE_ENFORCE_MIME;
  process.env.STORE_ENFORCE_MIME = '1';
  try {
    await assert.rejects(st.putFile('demo/leaf.json', Buffer.from('{}'), 'application/json'), /not supported/);
    await st.putFile('demo/leaf.json', Buffer.from('{}'), 'application/json', st.CLIP_BUCKET);
    const k = await import('../lib/keep.js');
    k._resetKeep();
    k.remember('mime|test', { ok: 1 }, { persist: true });
    await new Promise((r) => setTimeout(r, 30));
    k._resetKeep();
    assert.deepEqual((await k.recall('mime|test', { persist: true }))?.value, { ok: 1 }, 'kept copies survive a restart');
  } finally {
    if (keep === undefined) delete process.env.STORE_ENFORCE_MIME; else process.env.STORE_ENFORCE_MIME = keep;
  }
});

check('Demo stories (v0.25.0): every frame the field camera card asks for ships in public/demo/fieldcam, same size, labelled as demo in the agent docs', () => {
  const card = readFileSync(new URL('../public/next/ks-fieldcam.js', import.meta.url), 'utf8');
  assert.match(card, /frames\('problem', 6\)/);
  assert.match(card, /frames\('ripe', 6\)/);
  const names = [...[1, 2, 3, 4, 5, 6].flatMap((i) => [`problem-${i}.jpg`, `ripe-${i}.jpg`]), 'goats.jpg'];
  for (const n of names) {
    const b = readFileSync(new URL(`../public/demo/fieldcam/${n}`, import.meta.url));
    assert.equal(b[0], 0xff, `${n} is a JPEG`);
    assert.ok(b.length > 50000 && b.length < 1500000, `${n} size ${b.length}`);
  }
  for (const doc of ['../public/llms.txt', '../public/for-agents.html']) assert.match(readFileSync(new URL(doc, import.meta.url), 'utf8'), /fcStory_patch/);
});

await checkAsync('Sathi on watch (v0.25.1): times reach her as local clock times, never UTC; long dashes leave her lines', async () => {
  const w = await import('../lib/watch.js');
  assert.equal(w.localStamp('2026-10-29T12:30:00Z'), '2026-10-29 18:30', 'Asia/Dhaka is UTC+6');
  assert.equal(w.cleanLine('Camera saw 2 goats \u2014 please check'), 'Camera saw 2 goats, please check');
  const seen = [];
  const think = async ({ messages }) => { seen.push(...messages.map((x) => (typeof x.content === 'string' ? x.content : ''))); return { resp: { choices: [{ message: { role: 'assistant', content: 'done' } }] }, provider: 'baseten', label: 'x' }; };
  await w.runMission({ id: 'm', trigger: 'animal_in_field', place_kind: 'field', mode: 'ask', facts: { value: 2, at: '2026-10-29T12:30:00.000Z' }, steps: [] }, { tools: {}, think, now: () => Date.parse('2026-10-29T12:31:00Z') });
  const first = seen.find((x) => x.startsWith('What woke you'));
  assert.match(first, /18:30/);
  assert.match(first, /Local time now 2026-10-29 18:31/);
  assert.doesNotMatch(first, /T12:30|Z"/);
});

await checkAsync('v0.25.2: an older copy of the looks from storage never wins over the one just written; a long question ends at a full sentence', async () => {
  const fc = await import('../lib/fieldcam.js');
  const land = '22222222-2222-4222-8222-222222222222';
  let stale = null;
  const files = new Map();
  const deps = { getFileImpl: async (p) => (stale ? { buffer: stale } : files.has(p) ? { buffer: files.get(p) } : null), putFileImpl: async (p, b) => files.set(p, Buffer.from(b)) };
  await fc.saveLooks(land, () => [{ id: 'a', at: '2026-10-27T00:00:00Z', share: 1 }], deps);
  stale = Buffer.from(JSON.stringify({ looks: [], rev: 1 })); // what the storage cache may hand back right after a write
  await fc.saveLooks(land, (ls) => [...ls, { id: 'b', at: '2026-10-28T00:00:00Z', share: 2 }], deps);
  assert.deepEqual((await fc.readLooks(land, deps)).map((l) => l.id), ['a', 'b'], 'no frame lost to a stale read');
  stale = Buffer.from(JSON.stringify({ looks: [{ id: 'z', at: '2026-10-29T00:00:00Z' }], rev: Date.now() + 60000 }));
  assert.deepEqual((await fc.readLooks(land, deps)).map((l) => l.id), ['z'], 'a newer copy (another server) still wins');
  const w = await import('../lib/watch.js');
  const long = 'I saw the share rise from 9% to 17% over two days. It is patchy with no grain heads. ' + 'More detail here. '.repeat(20);
  const q = w.cleanLine(long, 120);
  assert.ok(q.length <= 120 && /\.$/.test(q), `ends at a sentence: ${q}`);
  assert.match(JSON.stringify(w.watchTools('field', 'ask')), /at most 25 words/);
  assert.match(w.watchSystem('ask'), /trust the camera and the warmth over the regional calendar/);
  assert.match(w.watchSystem('ask'), /Demo camera frames stand in for a real camera/);
});

check('v0.25.4: a count of one reads singular ("1 chicken not moving"), in English and Hindi; Bangla has no plural', () => {
  const i18n = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
  const tx = readFileSync(new URL('../public/next/ks-text.js', import.meta.url), 'utf8');
  const ks = readFileSync(new URL('../public/next/ks.js', import.meta.url), 'utf8');
  assert.match(i18n, /a_birds_still_1: '\{value\} chicken not moving'/);
  assert.match(i18n, /a_birds_still_1: '\{value\} मुर्गी हिल नहीं रही'/);
  assert.match(tx, /b_animal_in_field_1: "The field camera saw \{value\} animal"/);
  assert.match(ks, /const k1 = `\$\{k\}_1`/, 'fmt picks key_1 for a count of one, only in the language on screen');
});

await checkAsync('v0.26.0: natural Bangla and Hindi, taka for the Bangladesh demo shed, Sathi translation retried, shed kit stays near normal', async () => {
  const tx = readFileSync(new URL('../public/next/ks-text.js', import.meta.url), 'utf8');
  const i18n = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
  for (const [name, src] of [['ks-text.js', tx], ['i18n.js', i18n]]) {
    assert.doesNotMatch(src, /নমস্কার|সিমুলেটেড|পাকা করব|পাকা ডিল|সিম্যুলেটেড|सिम्युलेटेड/, `${name}: old words gone`);
  }
  assert.match(tx, /greetGrowing: "আসসালামু আলাইকুম!/);
  const sell = await import('../lib/sell.js');
  assert.equal(sell.money(420, 'bn', 'BDT'), '৪২০ টাকা');
  assert.equal(sell.money(420, 'en', 'BDT'), '420 taka');
  assert.equal(sell.money(175, 'hi', 'INR'), '175 रुपये', 'Hindi speaks 0-9');
  const hv = await import('../lib/harvest.js');
  assert.equal(hv.priceText(1270, { code: 'BDT', symbol: '৳' }, 'bn'), '১,২৭০ টাকা', 'the money word after the number');
  const st = await import('../lib/store.js');
  assert.ok(st.DEFAULT_SHED.lat > 24.5 && st.DEFAULT_SHED.lon > 89, 'the demo shed sits near Bogura');
  const sn = await import('../lib/sensors.js');
  let shed = { shed_temp: 37.8, shed_humidity: 90, ammonia_ppm: 38, water_pct: 50, feed_pct: 50, eggs_today: 0, egg_stock: 0 };
  for (let i = 0; i < 40; i++) shed = sn.stepShed(shed, { rand: () => 0.5, hour: 1, air: 23 });
  assert.ok(shed.shed_temp < 26 && shed.ammonia_ppm < 20, `drifts back to normal: ${shed.shed_temp} C, ${shed.ammonia_ppm} ppm`);
  const w = await import('../lib/watch.js');
  let calls = 0;
  const think = async () => ({ resp: { choices: [{ message: { role: 'assistant', content: ++calls === 1 ? 'not json' : '[{"bn":"পাশের লাইন","hi":"बगल की लाइन"}]' } }] } });
  const steps = await w.translateSteps([{ kind: 'did', text: { en: 'Next line' } }], { think });
  assert.equal(calls, 2, 'a bad answer is tried once more');
  assert.equal(steps[0].text.bn, 'পাশের লাইন');
  assert.equal(w.needsTranslation({ steps: [{ text: { en: 'x' } }] }), true);
  const ag = readFileSync(new URL('../lib/agent.js', import.meta.url), 'utf8');
  assert.match(ag, /Write numbers as digits/);
});

check('v0.26.1: country in the language on screen, transactions wording, plain range dashes, Bangla digits for Sathi', () => {
  const tx = readFileSync(new URL('../public/next/ks-text.js', import.meta.url), 'utf8');
  const ks = readFileSync(new URL('../public/next/ks.js', import.meta.url), 'utf8');
  assert.match(tx, /qtyHow: "\{ac\} একর × গড় ফলন: \{crop\}, \{country\} \(FAOSTAT\)"/);
  assert.match(tx, /dealsN: "\{n\}টি লেনদেন নিশ্চিত হয়েছে"/);
  assert.match(ks, /new Intl\.DisplayNames\(\[loc\(\)\], \{ type: 'region' \}\)/);
  assert.equal(new Intl.DisplayNames(['bn-BD'], { type: 'region' }).of('BD'), 'বাংলাদেশ');
  for (const f of ['ks.js', 'ks-harvest.js', 'ks-report.js']) assert.doesNotMatch(readFileSync(new URL(`../public/next/${f}`, import.meta.url), 'utf8'), / – /, `${f}: no long dash in ranges`);
  assert.match(readFileSync(new URL('../public/next/ks-watch.js', import.meta.url), 'utf8'), /K\.digits\(s\.text\.bn\)/);
});

check('v0.26.1: asked what she can do, Sathi also says the farmer\'s own AI assistant (like Muse) can use Khet Sathi, and it still waits for their yes', () => {
  const ag = readFileSync(new URL('../lib/agent.js', import.meta.url), 'utf8');
  assert.match(ag, /your own AI assistant, like Meta's Muse, can use Khet Sathi for you/);
  assert.match(ag, /আপনার নিজের এআই সহকারী, যেমন মেটার Muse/);
  assert.match(ag, /आपका अपना एआई सहायक, जैसे मेटा का Muse/);
  assert.match(ag, /never say an AI assistant has already done something/);
});

for (const [s, n] of results) console.log(`${s}  ${n}`);
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
