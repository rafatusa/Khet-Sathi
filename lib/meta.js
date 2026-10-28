// Thin client for Meta Model API (https://api.meta.ai/v1).
// Every call returns { ok, status, ms, data | error } so the UI can show a verification row.
import { AsyncLocalStorage } from 'node:async_hooks';
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

// v0.14.1: Meta's servers sometimes answer "model_not_found" (HTTP 404) for a model the team can use,
// and the same request works on a later try (reported by several builders in the hackathon Discord,
// most often from cloud servers). Every Meta call retries that one error up to RETRY.tries times (10 by
// default, META_TRIES in Railway) with pauses of 0.5 s, then 1 s, so at worst about 9 s is added; any other error (bad key, no credit, too many requests) is returned at once.
export const RETRY = { tries: Math.max(1, Number(env('META_TRIES', '10')) || 10), pauseMs: Number(env('META_RETRY_PAUSE_MS', '500')) };
const tryLog = new AsyncLocalStorage();
const pause = (i) => new Promise((r) => setTimeout(r, Math.min(RETRY.pauseMs * i, RETRY.pauseMs * 2)));
const noteTry = (i) => {
  const s = tryLog.getStore();
  if (s && i > s.max) s.max = i;
};
// Runs fn and reports how many tries its Meta calls needed: { value, tries, calls }. On failure the error
// gets .tries and .calls. v0.19.2: calls lists every Meta response with Meta's x-request-id and its time,
// which Meta support asks for to trace model_not_found (never the key).
export async function countTries(fn) {
  const s = { max: 1, calls: [] };
  return tryLog.run(s, async () => {
    try {
      return { value: await fn(), tries: s.max, calls: s.calls };
    } catch (err) {
      if (err && typeof err === 'object') {
        err.tries = s.max;
        err.calls = s.calls;
      }
      throw err;
    }
  });
}
const noteCall = (url, init, res) => {
  const s = tryLog.getStore();
  if (!s?.calls) return;
  let model = null;
  try {
    model = typeof init?.body === 'string' ? JSON.parse(init.body).model || null : init?.body instanceof FormData ? init.body.get('model') : null;
  } catch {}
  s.calls.push({ id: res.headers?.get?.('x-request-id') || null, at: new Date().toISOString(), status: res.status, path: new URL(url).pathname, model });
  if (s.calls.length > 40) s.calls.shift();
};
export const isModelNotFound = (status, text) => status === 404 && /model_not_found/.test(text || '');
// v0.20.0: with META_RELAY_URL and META_RELAY_SECRET set in Railway, every Meta call goes through the
// meta-relay Supabase Edge Function (Meta refused calls from Railway's addresses on Oct 28; the same key
// worked elsewhere). The key moves from Authorization to X-Meta-Key and the relay passes it on to Meta.
// Remove the two variables to call Meta directly again.
export function relayInfo() {
  const url = env('META_RELAY_URL', '').replace(/\/+$/, '');
  return url && env('META_RELAY_SECRET') ? { url, host: (() => { try { return new URL(url).host; } catch { return url; } })() } : null;
}
export function viaRelay(url, init = {}) {
  const r = relayInfo();
  if (!r || !String(url).startsWith(BASE)) return [url, init];
  const headers = { ...(init.headers || {}) };
  const auth = headers.Authorization || headers.authorization;
  delete headers.Authorization;
  delete headers.authorization;
  if (auth) headers['X-Meta-Key'] = String(auth).replace(/^Bearer\s+/i, '');
  headers['X-Relay-Secret'] = env('META_RELAY_SECRET');
  return [r.url + String(url).slice(BASE.length), { ...init, headers }];
}
// v0.20.0: one Railway log line per Meta call (model, path, status, route, Meta's request ID, time, tries),
// never the key. META_LOG=errors keeps only failures; META_LOG=off stops them.
const metaLog = () => env('META_LOG', 'all');
async function logCall(url, init, res, i, t0) {
  if (metaLog() === 'off' || (metaLog() === 'errors' && res.ok)) return;
  let model = null;
  try {
    model = typeof init?.body === 'string' ? JSON.parse(init.body).model || null : init?.body instanceof FormData ? init.body.get('model') : null;
  } catch {}
  const path = new URL(url).pathname;
  if (!model && path.endsWith('/asr/transcribe')) model = MODELS.voice;
  if (res.ok && path === '/v1/models') return; // the model list logs itself (empty or not) in listModels
  let code = '';
  if (!res.ok) code = (await res.clone().text().then((x) => JSON.parse(x).error?.code).catch(() => '')) || '';
  const route = relayInfo() ? 'via relay' : 'direct';
  const id = res.headers?.get?.('x-request-id');
  console.log(`meta ${res.ok ? 'OK  ' : 'FAIL'} ${model ? `${model} ` : ''}${init?.method || 'GET'} ${path} ${res.status}${code ? ` ${code}` : ''} ${route}${id ? ` · request ${id}` : ''} · ${((Date.now() - t0) / 1000).toFixed(1)} s${i > 1 ? ` · ${i} tries` : ''}`);
}
async function metaFetch(url, init, tries = RETRY.tries) {
  const [to, opts] = viaRelay(url, init);
  const t0 = Date.now();
  for (let i = 1; ; i++) {
    const res = await fetch(to, opts);
    noteTry(i);
    noteCall(url, init, res);
    if (res.status !== 404 || i >= tries) {
      await logCall(url, init, res, i, t0).catch(() => null);
      return res;
    }
    const text = await res.clone().text().catch(() => '');
    if (!isModelNotFound(res.status, text)) return res;
    await pause(i);
  }
}

// GET /models - which models this team can call. An empty list is asked again, as it flips between
// empty and full on Meta's side.
export async function listModels() {
  for (let i = 1; ; i++) {
    const res = await metaFetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    if (!res.ok) throw new Error(await readError(res));
    const json = await res.json();
    const ids = (json.data || []).map((m) => m.id);
    noteTry(i);
    if (ids.length || i >= RETRY.tries) {
      if (metaLog() !== 'off' && (!ids.length || metaLog() === 'all')) console.log(`meta ${ids.length ? 'OK  ' : 'FAIL'} GET /v1/models 200 ${ids.length ? `${ids.length} models` : 'empty list'} ${relayInfo() ? 'via relay' : 'direct'}${res.headers?.get?.('x-request-id') ? ` · request ${res.headers.get('x-request-id')}` : ''}${i > 1 ? ` · ${i} tries` : ''}`);
      return ids;
    }
    await pause(i);
  }
}

// POST /chat/completions - Muse Spark (text, images, tools).
// max_tokens caps hidden reasoning PLUS the visible answer, so budgets must be generous
// or the model can spend everything thinking and return empty content.
// v0.13.3: Meta's playground now calls the chat models through /v1/responses ("Get code"), and
// /chat/completions answers "model_not_found". chat() tries /responses first and returns the same
// chat-completions shape as before, so every caller stays unchanged; /chat/completions is the fallback.
export async function chat({ messages, tools, maxTokens = 8000, effort = 'low', model = MODELS.spark }) {
  try {
    return await chatViaResponses({ messages, tools, maxTokens, effort, model });
  } catch (err) {
    const body = { model, messages, max_tokens: maxTokens, reasoning_effort: effort };
    // Only "auto" tool choice is used: forced tool_choice has been reported to return HTTP 400.
    if (tools && tools.length) body.tools = tools;
    // The old path is only a fallback, so it gets two tries rather than the full count.
    const res = await metaFetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, Math.min(2, RETRY.tries));
    if (!res.ok) throw new Error(`${err.message} (and /chat/completions: ${await readError(res)})`);
    return res.json();
  }
}

// Chat-completions messages and tools -> Responses API input items.
export function toResponsesInput(messages) {
  const items = [];
  let instructions = '';
  const part = (p) =>
    typeof p === 'string'
      ? { type: 'input_text', text: p }
      : p.type === 'text'
        ? { type: 'input_text', text: p.text }
        : p.type === 'image_url'
          ? { type: 'input_image', image_url: p.image_url?.url || p.image_url }
          : p.type === 'input_audio'
            ? { type: 'input_audio', input_audio: p.input_audio }
            : p;
  for (const m of messages || []) {
    if (m.role === 'system') instructions += (instructions ? '\n\n' : '') + (typeof m.content === 'string' ? m.content : (m.content || []).map((x) => x.text || '').join(''));
    else if (m.role === 'tool') items.push({ type: 'function_call_output', call_id: m.tool_call_id, output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
    else if (m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : (m.content || []).map((x) => x.text || '').join('');
      if (text) items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
      for (const c of m.tool_calls || []) items.push({ type: 'function_call', call_id: c.id, name: c.function?.name, arguments: c.function?.arguments || '{}' });
    } else items.push({ type: 'message', role: 'user', content: Array.isArray(m.content) ? m.content.map(part) : [part(String(m.content ?? ''))] });
  }
  return { instructions, items };
}
export const toResponsesTools = (tools) => (tools || []).map((t) => (t.function ? { type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters } : t));
// Responses API result -> the chat-completions shape the app reads (choices[0].message).
export function fromResponses(json) {
  const out = json?.output || [];
  const text = out
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === 'output_text' || c.type === 'text')
    .map((c) => c.text || '')
    .join('');
  const calls = out.filter((o) => o.type === 'function_call').map((o) => ({ id: o.call_id || o.id, type: 'function', function: { name: o.name, arguments: o.arguments || '{}' } }));
  const message = { role: 'assistant', content: text || (typeof json?.output_text === 'string' ? json.output_text : '') };
  if (calls.length) message.tool_calls = calls;
  return { id: json?.id, model: json?.model, choices: [{ index: 0, message, finish_reason: calls.length ? 'tool_calls' : json?.status === 'incomplete' ? 'length' : 'stop' }], usage: json?.usage || null };
}
async function chatViaResponses({ messages, tools, maxTokens, effort, model }) {
  const { instructions, items } = toResponsesInput(messages);
  const body = { model, input: items, max_output_tokens: maxTokens, reasoning: { effort } };
  if (instructions) body.instructions = instructions;
  if (tools && tools.length) body.tools = toResponsesTools(tools);
  const res = await metaFetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`/responses: ${await readError(res)}`);
  return fromResponses(await res.json());
}

// POST /files - upload a video clip once, then reference it by id. Deleted again after analysis.
export async function uploadFile(buffer, filename, mime) {
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const res = await metaFetch(`${BASE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey()}` }, body: form });
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  if (!json.id) throw new Error('Files API returned no file id');
  return json.id;
}

export async function deleteFile(id) {
  const res = await metaFetch(`${BASE}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey()}` } });
  return res.ok;
}

// POST /responses (no streaming) - Muse Spark with any mix of text, image, video, audio parts.
export async function respond({ content, model = MODELS.media, maxTokens = 6000 }) {
  const body = { model, input: [{ type: 'message', role: 'user', content }], max_output_tokens: maxTokens };
  const res = await metaFetch(`${BASE}/responses`, {
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
  const res = await metaFetch(`${BASE}/asr/transcribe`, {
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
  const res = await metaFetch(`${BASE}/responses`, {
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

