// Spoken replies via Gemini text-to-speech (Gemini API, Interactions endpoint).
// Meta's lineup has speech-to-text but no text-to-speech, so replies are voiced here.
// The model detects Bangla / Hindi / English from the text itself.

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export const TTS = {
  model: process.env.TTS_MODEL || 'gemini-3.8-flash-tts',
  voice: process.env.TTS_VOICE || 'Kore',
};

export function hasTtsKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Speech sounds wrong reading markdown symbols aloud.
export function cleanForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#>`~|]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, 1500);
}

// Finds the base64 audio in an Interactions response.
export function extractAudio(json) {
  if (json?.output_audio?.data) return json.output_audio.data;
  for (const step of json?.steps || []) {
    for (const c of step?.content || []) {
      if (c?.type === 'audio' && c.data) return c.data;
    }
  }
  return null;
}

export async function synthesize(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on the server');
  const transcript = cleanForSpeech(text);
  if (!transcript) throw new Error('Nothing to speak');

  const body = {
    model: TTS.model,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text: transcript,
            annotations: [{ type: 'speech_metadata', style: 'warm, calm and clear, like a helpful village advisor' }],
          },
        ],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: TTS.voice }] },
  };

  const res = await fetch(process.env.GEMINI_TTS_URL || DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // fall through
  }
  if (!res.ok) {
    const err = Array.isArray(json) ? json[0]?.error : json?.error;
    const msg = err?.message || raw.slice(0, 400) || `HTTP ${res.status}`;
    throw new Error(`Gemini TTS ${res.status}: ${msg}`);
  }
  const b64 = extractAudio(json);
  if (!b64) throw new Error(`Gemini TTS returned no audio: ${raw.slice(0, 300)}`);
  const audio = Buffer.from(b64, 'base64');
  return { wav: ensureWav(audio), chars: transcript.length };
}

// Unary responses are documented as WAV; if raw 24 kHz PCM arrives instead, add a header.
export function ensureWav(buf, sampleRate = 24000) {
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'RIFF') return buf;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + buf.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(buf.length, 40);
  return Buffer.concat([h, buf]);
}
