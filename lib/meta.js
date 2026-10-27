// Thin client for Meta Model API (https://api.meta.ai/v1).
// Every call returns { ok, status, ms, data | error } so the UI can show a verification row.
import { env } from './env.js';

const BASE = env('META_API_BASE', 'https://api.meta.ai/v1');

export const MODELS = {
  spark: env('SPARK_MODEL', 'muse-spark-1.3'),
  voice: env('VOICE_MODEL', 'muse-voice-transcribe-1.0'),
  sam: env('SAM_MODEL', 'sam-3.1'),
  // Meta's docs: audio understanding on 1.3 is not fully supported, so audio and video-with-sound use 1.2.
  media: env('MEDIA_MODEL', 'muse-spark-1.2'),
};

function apiKey() {
  const key = env('MODEL_API_KEY') || env('META_API_KEY');
  if (!key) throw new Error('MODEL_API_KEY is not set on the server');
  return key;
}

export function hasKey() {
  return Boolean(env('MODEL_API_KEY') || env('META_API_KEY'));
}

async function readError(res) {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json.error?.message ? `${json.error.code || res.status}: ${json.error.message}` : text.slice(0, 500);
  } catch {
    return text.slice(0, 500) || `HTTP ${res.status}`;
  }
}

// GET /models - which models this team can call.
export async function listModels() {
  const res = await fetch(`${BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  return (json.data || []).map((m) => m.id);
}

// POST /chat/completions - Muse Spark (text, images, tools).
// max_tokens caps hidden reasoning PLUS the visible answer, so budgets must be generous
// or the model can spend everything thinking and return empty content.
export async function chat({ messages, tools, maxTokens = 8000, effort = 'low', model = MODELS.spark }) {
  const body = { model, messages, max_tokens: maxTokens, reasoning_effort: effort };
  // Only "auto" tool choice is used: forced tool_choice has been reported to return HTTP 400.
  if (tools && tools.length) body.tools = tools;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// POST /files - upload a video clip once, then reference it by id. Deleted again after analysis.
export async function uploadFile(buffer, filename, mime) {
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`${BASE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey()}` }, body: form });
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  if (!json.id) throw new Error('Files API returned no file id');
  return json.id;
}

export async function deleteFile(id) {
  const res = await fetch(`${BASE}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey()}` } });
  return res.ok;
}

// POST /responses (no streaming) - Muse Spark with any mix of text, image, video, audio parts.
export async function respond({ content, model = MODELS.media, maxTokens = 6000 }) {
  const body = { model, input: [{ type: 'message', role: 'user', content }], max_output_tokens: maxTokens };
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// Visible text of a Responses API result without assuming one exact shape.
export function responseText(json) {
  if (typeof json?.output_text === 'string' && json.output_text.trim()) return json.output_text.trim();
  const parts = [];
  for (const item of json?.output || []) {
    if (typeof item?.text === 'string') parts.push(item.text);
    for (const c of item?.content || []) if (typeof c?.text === 'string') parts.push(c.text);
  }
  return parts.join('').trim();
}

// POST /asr/transcribe - Muse Voice Transcribe, one finished WAV recording.
export async function transcribe(wavBuffer) {
  const form = new FormData();
  const settings = { model: MODELS.voice, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' };
  form.append('request', new Blob([JSON.stringify(settings)], { type: 'application/json' }));
  form.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), 'recording.wav');
  const res = await fetch(`${BASE}/asr/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: 'application/json' },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// Visible text of a chat completion, plus why it stopped.
export function messageText(resp) {
  const choice = resp?.choices?.[0] || {};
  const c = choice.message?.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) text = c.map((p) => p?.text ?? '').join('');
  return { text: text.trim(), finishReason: choice.finish_reason || null };
}

// Pull plain text out of a transcribe response without assuming one exact schema.
export function transcriptText(json) {
  if (!json || typeof json !== 'object') return '';
  if (typeof json.transcript === 'string') return json.transcript;
  if (typeof json.text === 'string') return json.text;
  const turns = json.turns || json.segments || [];
  if (Array.isArray(turns) && turns.length) {
    return turns
      .map((t) => t.transcript ?? t.text ?? '')
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

// POST /responses (stream: true) - SAM 3.1. Returns an async iterable of SSE event objects.
// v0.14.0: like Meta's own playground ("Get code"), the picture is uploaded to /files first and SAM 3.1
// gets its file_id; sending the picture inline as image_url now returns "model_not_found". The upload is
// deleted again once SAM's answer has been read.
export async function segmentStream({ imageDataUrl, prompt }) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(imageDataUrl || '');
  let fileId = null;
  if (m) fileId = await uploadFile(Buffer.from(m[2], 'base64'), m[1].includes('png') ? 'upload.png' : 'upload.jpg', m[1]);
  const body = {
    model: MODELS.sam,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          fileId ? { type: 'input_image', file_id: fileId } : { type: 'input_image', image_url: imageDataUrl },
        ],
      },
    ],
    stream: true,
    metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
  };
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(await readError(res));
    if (fileId) deleteFile(fileId).catch(() => null);
    throw err;
  }
  return withCleanup(sseEvents(res.body), () => fileId && deleteFile(fileId).catch(() => null));
}
async function* withCleanup(events, done) {
  try {
    yield* events;
  } finally {
    done();
  }
}

// Server-sent events -> JSON event objects.
export async function* sseEvents(stream) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {
        // ignore keep-alives or partial junk
      }
    }
  }
}
