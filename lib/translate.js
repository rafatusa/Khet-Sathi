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

// The shed camera's note and vet summary in all three app languages (v0.12.2). A clip is checked in the
// farmer's language at that moment; the other two are written once, in the background, and every
// sentence goes through the shed filter (no disease or medicine names). A failed sentence keeps the original.
const LANG_NAME = { bn: 'Bangla', hi: 'Hindi', en: 'English' };
export function notesPrompt({ note, vetSummary }, from = 'en') {
  return `Translate these two short notes from a poultry shed camera check from ${LANG_NAME[from] || 'English'} into Bangla, Hindi and English.
Keep the meaning exactly, plain words a farmer uses, no added advice, no disease or medicine names, no quotes, no emoji.
Note: ${String(note || '').slice(0, 400)}
Vet summary: ${String(vetSummary || '').slice(0, 600)}
Reply with JSON only: {"note":{"bn":"...","hi":"...","en":"..."},"vet":{"bn":"...","hi":"...","en":"..."}}`;
}
export function parseNotes(text, orig, filter = (s) => s) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const pick = (obj, base, lang) => {
    if (!base) return '';
    if (lang === orig.lang) return base;
    const s = filter(String(obj?.[lang] || '').replace(/["“”]/g, '').trim().slice(0, 600));
    return s || base;
  };
  const out = { notes: {}, vetSummaries: {} };
  for (const L of ['bn', 'hi', 'en']) {
    out.notes[L] = pick(j.note, orig.note, L);
    if (orig.vetSummary) out.vetSummaries[L] = pick(j.vet, orig.vetSummary, L);
  }
  return out;
}
export async function threeNotes(obs, lang, { think = brainChat, filter = (s) => s } = {}) {
  const turn = await think({ messages: [{ role: 'user', content: notesPrompt(obs, lang) }], maxTokens: 2500, effort: 'low', timeoutMs: 40000 }, {});
  return parseNotes(messageText(turn.resp).text, { lang, note: obs.note, vetSummary: obs.vetSummary }, filter);
}
