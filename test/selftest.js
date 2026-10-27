// Offline self-test: no API key or network needed.
// Run: npm test
import assert from 'node:assert/strict';
import { collectSegments } from '../lib/segment.js';
import { transcriptText, messageText } from '../lib/meta.js';
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
import { fieldAlerts, shedAlerts, cameraAlerts, dedupe } from '../lib/alerts.js';
import * as clipsLib from '../lib/clips.js';
import { autoSigns, vetMessage, cleanCall, parseDeaths, parseSince, SIGN_CODES } from '../lib/vetcall.js';
import { createEngine } from '../lib/engine.js';
import * as memStore from '../lib/store.js';
import sharp from 'sharp';
import { createLand, getLand, putFile, getFile, deleteLand, deleteFiles } from '../lib/store.js';

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
  assert.equal(r.objects.length, 0);
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
  const p = await buildPlan({ place: 'bogura', lat: 24.88, lon: 89.33 }, { fetchImpl: fakeFetch(['fao']), today: TODAY });
  assert.equal(p.soil.texture, 'silty_clay_loam');
  assert.equal(p.weather.soilMoistureLevel, 'dry');
  assert.equal(p.rain.rainDate, '2026-10-29');
  assert.equal(p.aez, '4. Karatoya-Bangali Floodplain');
  assert.match(p.calendarSource, /saved copy/);
  assert.equal(p.crops.length, 3);
});
await checkAsync('Plan: Bolpur gets soil and weather but no crops (no FAO data for India)', async () => {
  const p = await buildPlan({ place: 'bolpur', lat: 23.64, lon: 87.73 }, { fetchImpl: fakeFetch(), today: TODAY });
  assert.equal(p.soil.texture, 'clay_loam');
  assert.ok(p.weather);
  assert.equal(p.aez, null);
  assert.deepEqual(p.crops, []);
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
  const p = await buildPlan({ place: 'bogura', lat: 24.88, lon: 89.33 }, { fetchImpl: fakeFetch(['fao']), today: TODAY });
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
  const land = await memStore.createLand({ kind: 'empty', place: 'bogura', lat: 24.88, lon: 89.33, objects: [{ id: '1' }] });
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
  assert.deepEqual(t({ eggs_today: 310 }), ['eggs_ready']);
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
  assert.match(bn, /^ডাক্তার সাহেব/);
  assert.match(bn, /২-৩ দিন ধরে খামারি এগুলো দেখছেন: ৮টি মুরগি দিনের বেলা নড়ছে না, কিছু মুরগি খাবারের কাছে যাচ্ছে না, কয়েকটির ঘাড় বাঁকা।/);
  assert.match(bn, /আজ ২টি মুরগি মারা গেছে।/);
  assert.match(vetMessage({ ...body, lang: 'en', deaths: 1 }), /For 2-3 days the farmer has seen: 8 birds are not moving.*1 bird died today\./);
  assert.match(vetMessage({ lang: 'hi', signs: [], deaths: 0 }), /कुछ असामान्य.*आज कोई मुर्गी नहीं मरी।/);
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

for (const [s, n] of results) console.log(`${s}  ${n}`);
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
