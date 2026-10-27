// Short names in the three app languages (v0.11.2): a clip name typed in one language is shown in
// Bangla, Hindi and English. Muse Spark translates once; the result is saved with the clip.
import { brainChat } from './brain.js';
import { messageText } from './meta.js';

export function namesPrompt(text) {
  return `Translate this short label for a poultry shed camera clip into Bangla, Hindi and English.
Keep it short (under 5 words), plain, no quotes, no emoji. If it is a person's or a place's name, keep the name and only write it in each script.
Label: ${text}
Reply with JSON only: {"bn":"...","hi":"...","en":"..."}`;
}

export function parseNames(text, fallback) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const clean = (s) => String(s || '').replace(/["“”]/g, '').trim().slice(0, 40);
    const out = { bn: clean(j.bn), hi: clean(j.hi), en: clean(j.en) };
    if (!out.bn || !out.hi || !out.en) return null;
    return out;
  } catch {
    return fallback ?? null;
  }
}

export async function threeNames(text, { think = brainChat } = {}) {
  const turn = await think({ messages: [{ role: 'user', content: namesPrompt(text) }], maxTokens: 1500, effort: 'low', timeoutMs: 30000 }, {});
  return parseNames(messageText(turn.resp).text);
}
