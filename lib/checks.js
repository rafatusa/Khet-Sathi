// Model and service checks for the admin Settings tab (v0.14.0). Each check sends one tiny real request
// and reports working or the error, with how long it took. Results are kept 10 minutes unless re-run.
import sharp from 'sharp';
import { chat, transcribe, segmentStream, hasKey, MODELS, messageText } from './meta.js';
import { openChat, hasOpenKey, OPEN } from './brain.js';
import { synthesize, hasTtsKey, TTS } from './tts.js';
import { pingDb, dbConfigured } from './store.js';
import { env } from './env.js';
import { placesToday, PLACES_DAILY_CAP, landCover } from './place.js';
import { fetchSatelliteImage } from './tile.js';
import { fetchSoil } from './soil.js';
import { fetchWeather } from './weather.js';
import { listModels, countTries } from './meta.js';

// The Bogura demo point, for the data-source checks.
const PT = { lat: 24.88, lon: 89.33 };

const SAY_OK = [{ role: 'user', content: 'Reply with the single word OK.' }];

// One second of silence as a 16 kHz mono WAV.
export function silentWav(seconds = 1, rate = 16000) {
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}

async function tinyJpeg() {
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 60, g: 120, b: 50 } } }).jpeg().toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

const short = (e) => String(e?.message || e || 'failed').replace(/\s+/g, ' ').slice(0, 140);

// Which Meta key the server is using: its first 8 and last 4 characters only, to match against the console.
export function keyFingerprint() {
  const name = env('MODEL_API_KEY') ? 'MODEL_API_KEY' : env('META_API_KEY') ? 'META_API_KEY' : null;
  const k = name ? env(name) : '';
  return name ? `${k.slice(0, 8)}…${k.slice(-4)} (from ${name})` : null;
}

export const CHECKS = [
  { key: 'key', label: 'Meta API key in use (compare with the Meta console)', ready: hasKey, run: async () => keyFingerprint(), noTime: true },
  {
    key: 'models',
    label: 'Meta API key can see the models (GET /v1/models)',
    ready: hasKey,
    run: async () => {
      const ids = await listModels();
      const need = [MODELS.spark, MODELS.media, MODELS.sam, MODELS.voice];
      const missing = need.filter((m) => !ids.includes(m));
      if (!ids.length) throw new Error('The model list came back empty every time: Meta has not enabled the models for this team yet. Follow up on the Meta support ticket');
      if (missing.length) throw new Error(`Missing for this key: ${missing.join(', ')}`);
      return `${ids.length} models listed`;
    },
  },
  { key: 'open', label: `Muse Spark Open · Baseten (${OPEN.model})`, ready: hasOpenKey, run: async () => messageText(await openChat({ messages: SAY_OK, maxTokens: 600, effort: 'low', timeoutMs: 40000 })).text || 'answered' },
  { key: 'spark', label: `Muse Spark · Meta API (${MODELS.spark})`, ready: hasKey, run: async () => messageText(await chat({ messages: SAY_OK, maxTokens: 600, model: MODELS.spark })).text || 'answered' },
  { key: 'media', label: `Muse Spark video and sound (${MODELS.media})`, ready: hasKey, run: async () => messageText(await chat({ messages: SAY_OK, maxTokens: 600, model: MODELS.media })).text || 'answered' },
  {
    key: 'sam',
    label: `SAM 3.1 field outline (${MODELS.sam})`,
    ready: hasKey,
    run: async () => {
      const events = await segmentStream({ imageDataUrl: await tinyJpeg(), prompt: 'field' });
      let n = 0;
      for await (const e of events) {
        if (e?.type === 'error' || e?.error) throw new Error(e.error?.message || e.message || 'SAM error');
        if (++n > 400) break;
      }
      return 'answered';
    },
  },
  { key: 'voice', label: `Muse Voice Transcribe (${MODELS.voice})`, ready: hasKey, run: async () => (await transcribe(silentWav()), 'answered') },
  { key: 'tts', label: `Gemini voice for speaking (${TTS.model})`, ready: hasTtsKey, run: async () => (await synthesize('OK'), 'answered') },
  { key: 'db', label: 'Supabase database and storage', ready: dbConfigured, run: async () => ((await pingDb()).bucket === false ? Promise.reject(new Error('Storage bucket not found')) : 'answered') },
  { key: 'esri', label: 'Satellite image (Esri World Imagery)', ready: () => true, run: async () => ((await fetchSatelliteImage({ ...PT, halfSideMeters: 300, size: 512 })).width ? 'image received' : 'answered') },
  { key: 'cover', label: 'Land cover (ESA WorldCover)', ready: () => true, run: async () => (await landCover(PT.lat, PT.lon), 'answered') },
  { key: 'soil', label: 'Soil (ISRIC SoilGrids)', ready: () => true, run: async () => ((await fetchSoil(PT.lat, PT.lon, { timeoutMs: 20000 })) ? 'answered' : 'no data') },
  { key: 'weather', label: 'Weather and soil moisture (Open-Meteo)', ready: () => true, run: async () => ((await fetchWeather(PT.lat, PT.lon)) ? 'answered' : 'no data') },
  { key: 'places', label: 'Google Places (shops near a field)', ready: () => Boolean(env('GOOGLE_PLACES_KEY')), run: async () => `${placesToday()} of ${PLACES_DAILY_CAP} searches today`, noTime: true },
];

let last = null;
export async function runChecks({ force = false, list = CHECKS } = {}) {
  if (!force && last && Date.now() - last.at < 10 * 60 * 1000) return last;
  const rows = await Promise.all(
    list.map(async (c) => {
      if (!c.ready()) return { key: c.key, label: c.label, status: 'off', note: 'Not set up (key missing in Railway)' };
      const t0 = Date.now();
      try {
        // v0.14.1: Meta calls retry "model_not_found"; the row says how many tries it took.
        const { value: note, tries } = await countTries(() => Promise.race([c.run(), new Promise((_, no) => setTimeout(() => no(new Error('No answer in 45 s')), 45000))]));
        const at = tries > 1 ? ` (worked on try ${tries})` : '';
        return { key: c.key, label: c.label, status: 'ok', ms: c.noTime ? null : Date.now() - t0, tries, note: (String(note).slice(0, 80) + at).slice(0, 110) };
      } catch (err) {
        const n = err?.tries > 1 ? `Failed ${err.tries} tries in a row. ` : '';
        // v0.19.2: the last Meta response of this check, with Meta's request ID, for the support ticket.
        const lastCall = [...(err?.calls || [])].reverse().find((x) => x.id) || null;
        return { key: c.key, label: c.label, status: 'fail', ms: Date.now() - t0, tries: err?.tries || 1, note: n + short(err), call: lastCall };
      }
    })
  );
  last = { at: Date.now(), rows };
  return last;
}
