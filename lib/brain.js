// Sathi's brain (v0.9.0): Meta's open-weight Muse Spark Open on Baseten when BASETEN_API_KEY is set,
// with an automatic fallback to Muse Spark 1.3 on the Meta Model API, so the app never stops answering.
// Baseten is OpenAI compatible; the hackathon key works only with meta-models/muse-spark-open-1026.
import { env } from './env.js';
import { chat, MODELS } from './meta.js';

export const OPEN = {
  base: env('BASETEN_BASE', 'https://inference.baseten.co/v1').replace(/\/+$/, ''),
  model: env('OPEN_MODEL', 'meta-models/muse-spark-open-1026'),
};

export const hasOpenKey = () => Boolean(env('BASETEN_API_KEY'));

export async function openChat({ messages, tools, maxTokens = 8000, effort = 'low', timeoutMs = 60000 }) {
  const body = { model: OPEN.model, messages, max_tokens: maxTokens, reasoning_effort: effort };
  if (tools && tools.length) body.tools = tools;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${OPEN.base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('BASETEN_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        msg = j.error?.message || j.message || j.detail || msg;
      } catch {}
      throw new Error(`Baseten HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    return JSON.parse(text);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Baseten timed out after ${timeoutMs / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const META_LABEL = () => ({ provider: 'meta', model: MODELS.spark, label: 'Muse Spark 1.3' });
export const OPEN_LABEL = () => ({ provider: 'baseten', model: OPEN.model, label: 'Muse Spark Open · Baseten' });

// One chat turn. state.provider sticks to Meta after a fallback, so one conversation stays on one model.
export async function brainChat(opts, state = {}) {
  if (hasOpenKey() && state.provider !== 'meta') {
    try {
      const resp = await openChat(opts);
      state.provider = 'baseten';
      return { resp, ...OPEN_LABEL() };
    } catch (err) {
      state.fallback = err.message;
      state.provider = 'meta';
      console.log('open weights fallback:', err.message);
    }
  }
  const resp = await chat(opts);
  state.provider = 'meta';
  return { resp, ...META_LABEL() };
}
