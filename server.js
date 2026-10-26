// Khet Saathi - v0.1.0 smoke-test server.
// Proves every Meta model the product depends on works from this deployment.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, hasKey, listModels, chat, transcribe, transcriptText, segmentStream } from './lib/meta.js';
import { collectSegments } from './lib/segment.js';
import { fetchSatelliteImage } from './lib/tile.js';
import { runAgent } from './lib/agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '0.1.0';

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Optional passcode so a public URL can't burn API credits.
function guard(req, res, next) {
  const code = process.env.APP_PASSCODE;
  if (!code) return next();
  if (req.get('x-app-passcode') === code) return next();
  return res.status(401).json({ ok: false, error: 'Passcode required' });
}

// Wraps a handler so every response has { ok, ms, ... } for the verification table.
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

// 1. Server + key configured (no external call)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    keyConfigured: hasKey(),
    passcodeRequired: Boolean(process.env.APP_PASSCODE),
    models: MODELS,
  });
});

// 2. Which models this API key can reach
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

// 3. Muse Spark agent with tool calling
app.post(
  '/api/agent',
  guard,
  timed(async (req) => {
    const { text, lat, lon } = req.body || {};
    if (!text) throw new Error('text is required');
    return runAgent({ userText: String(text).slice(0, 2000), lat: Number(lat), lon: Number(lon) });
  })
);

// 4. Satellite image for a plot
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

// 5. Muse Spark vision on the plot image
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
      maxTokens: 600,
    });
    return { text: resp.choices?.[0]?.message?.content || '', usage: resp.usage || null };
  })
);

// 6. SAM 3.1 segmentation of the plot image
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

// 7. Muse Voice Transcribe (browser sends a mono 16-bit WAV)
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

app.listen(PORT, () => {
  console.log(`Khet Saathi v${VERSION} listening on :${PORT} (key configured: ${hasKey()})`);
});
