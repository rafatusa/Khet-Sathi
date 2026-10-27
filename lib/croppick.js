// Saathi's local judgement on the data's crop list (v0.11.0).
// The data says which crops the country grows (FAOSTAT) and when they are sown at this spot (GGCMI).
// A big country hides local truth (cotton is big in India but not in Birbhum), so Muse Spark picks, from
// that list only, the crops farmers in this district really sow in this season, with a one-line reason.
// It can never add a crop that is not in the list. If the model fails, the data order stands.
import { brainChat } from './brain.js';
import { messageText } from './meta.js';

const cache = new Map();

export function pickPrompt({ place, today, candidates, soil, rain }) {
  const where = [place?.village, place?.district, place?.state, place?.country].filter(Boolean).join(', ') || 'unknown place';
  const list = candidates.map((c) => `${c.key}: sow ${c.windowStart} to ${c.windowEnd} (${c.status}), grows about ${c.growDays?.min}-${c.growDays?.max} days${c.hectares ? `, ${Math.round(c.hectares)} ha grown in ${c.areaScope === 'country' ? 'the whole country' : c.areaName || 'this district'}` : ''}`).join('\n');
  return `A farmer is standing on an empty field at ${where}. Today is ${today}.
Soil: ${soil ? `${soil.texture}, pH ${soil.ph}` : 'unknown'}. Rain in the next 10 days: ${rain ?? 'unknown'} mm.
These crops are grown here (MIRCA-OS 2020 crop data for this district, or this country when the district is unknown), with their sowing months:
${list}

Pick up to 3 of these crops that farmers in this district really sow now or within the next month.
Drop any crop that is not normally grown in this district or season, even if the country grows a lot of it.
Use only crop keys from the list. Reply with JSON only, no other text:
{"picks":[{"key":"...","why_en":"under 12 words","why_bn":"Bangla, under 12 words","why_hi":"Hindi, under 12 words"}]}`;
}

export function parsePicks(text, candidates) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const keys = new Set(candidates.map((c) => c.key));
  const out = [];
  for (const p of j.picks || []) {
    if (!keys.has(p.key) || out.some((o) => o.key === p.key)) continue;
    out.push({ key: p.key, why: { en: String(p.why_en || '').slice(0, 120), bn: String(p.why_bn || '').slice(0, 120), hi: String(p.why_hi || '').slice(0, 120) } });
    if (out.length === 3) break;
  }
  return out;
}

// Returns { picks: [{key, why}], by } or null (then the caller keeps the data order).
export async function pickCrops({ cacheKey, place, today, candidates, soil, rain }, { think = brainChat } = {}) {
  if (!candidates.length) return null;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 12 * 3600 * 1000) return hit.value;
  try {
    const turn = await think({ messages: [{ role: 'user', content: pickPrompt({ place, today, candidates, soil, rain }) }], maxTokens: 3000, effort: 'low', timeoutMs: 30000 }, {});
    const { text } = messageText(turn.resp);
    const picks = parsePicks(text, candidates);
    const value = picks ? { picks, by: turn.label } : null;
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}
