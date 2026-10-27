// Offline self-test: no API key or network needed.
// Run: npm test
import assert from 'node:assert/strict';
import { collectSegments } from '../lib/segment.js';
import { transcriptText, messageText } from '../lib/meta.js';
import { bboxFor, minHalfSide } from '../lib/tile.js';
import { cleanForSpeech, extractAudio, ensureWav } from '../lib/tts.js';
import { acresFromPx, pickPlot, inSouthAsia } from '../lib/plot.js';

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

for (const [s, n] of results) console.log(`${s}  ${n}`);
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
