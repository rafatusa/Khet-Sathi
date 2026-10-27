// Thin client for Meta Model API (https://api.meta.ai/v1).
// Every call returns { ok, status, ms, data | error } so the UI can show a verification row.
import { env } from './env.js';

const BASE = env('META_API_BASE', 'https://api.meta.ai/v1');

export const MODELS = {
  spark: env('SPARK_MODEL', 'muse-spark-1.3'),
  voice: env('VOICE_MODEL', 'muse-voice-transcribe-1.0'),
  sam: env('SAM_MODEL', 'sam-3.1'),
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
export async function chat({ messages, tools, maxTokens = 8000, effort = 'low' }) {
  const body = { model: MODELS.spark, messages, max_tokens: maxTokens, reasoning_effort: effort };
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
export async function segmentStream({ imageDataUrl, prompt }) {
  const body = {
    model: MODELS.sam,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: imageDataUrl },
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
  if (!res.ok) throw new Error(await readError(res));
  return sseEvents(res.body);
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
