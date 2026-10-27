// Sathi for a poultry shed (v0.11.3): answers about the farmer's shed from its facts (sensor kit,
// eggs, sell rule, the last camera check). Muse Spark Open (or 1.3), no tools. Every sentence goes
// through the same filter as the shed camera, so no disease or medicine name ever reaches the farmer.
import { brainChat } from './brain.js';
import { messageText } from './meta.js';
import { safeText, SAFE_VET_LINE } from './poultry.js';
import { CAPABILITIES } from './agent.js';

const LANG_NAME = { bn: 'Bangla', hi: 'Hindi', en: 'English' };

export function shedFacts({ shed, kit, stock, tray = 30, rule, check, night }) {
  const k = (m, unit = '') => (kit?.[m] ? `${kit[m].value}${unit}` : 'unknown');
  return [
    `Shed: ${shed?.name || 'the shed'}${shed?.chickens ? `, about ${shed.chickens} chickens` : ''}${shed?.demo ? ' (demo shed)' : ''}.`,
    `Sensor kit (simulated): temperature ${k('shed_temp', ' C')}, humidity ${k('shed_humidity', '%')}, ammonia ${k('ammonia_ppm', ' ppm')}, water ${k('water_pct', '%')} full, feed ${k('feed_pct', '%')} full, eggs today ${k('eggs_today')}, light ${kit?.light ? (kit.light.value ? 'on' : 'off') : 'unknown'}.`,
    `Comfortable ranges: temperature 16-32 C, humidity 40-80%, ammonia under 25 ppm, refill water or feed under 20%.`,
    `Eggs in stock to sell: ${stock ?? 'unknown'} (${stock != null ? Math.floor(stock / tray) : '?'} trays of ${tray}).`,
    rule ? `Farmer's sell rule: ${[rule.min_count ? `sell when ${rule.min_count} eggs` : '', rule.every_days ? `or every ${rule.every_days} days` : '', `never below ${rule.floor_price} rupees a tray`, rule.ask_first !== false ? 'ask the farmer first' : ''].filter(Boolean).join(', ')}.` : 'No sell rule yet.',
    check
      ? `Last camera check (${check.when}): ${check.count ?? '?'} chickens counted, ${check.resting ? 'resting at night so stillness is normal' : `${check.still ?? 0} not moving for a while`}${check.unusualSound ? ', an unusual sound was heard' : ''}.`
      : 'No camera check yet.',
    night ? 'It is night now: chickens rest, so not moving is normal.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function shedSystem(lang) {
  return `You are Sathi, the helper in the Khet Sathi app, speaking as a woman (feminine verb forms in Hindi), for a small poultry farmer. Answer only about this shed, from the facts given, except when asked what you can do.
${CAPABILITIES}
Reply in ${LANG_NAME[lang] || 'Bangla'}, in under 60 words (130 for what you can do), plain sentences, no lists, symbols or markdown; the reply is read aloud.
Never name any disease, medicine, vaccine or dose. If chickens seem unwell or not moving in daytime, say to keep them apart and call the vet.
Say when a reading is outside its comfortable range and what to do (refill water or feed, open vents, and so on).
For selling eggs, follow the farmer's sell rule; the egg shops and calls in this app are a demo.`;
}

export async function shedAnswer({ text, lang = 'bn', facts }, { think = brainChat } = {}) {
  const state = {};
  const turn = await think(
    {
      messages: [
        { role: 'system', content: shedSystem(lang) },
        { role: 'user', content: `${String(text).slice(0, 1000)}\n\n(Facts about the shed:\n${facts})` },
      ],
      maxTokens: 4000,
      effort: 'low',
    },
    state
  );
  const raw = messageText(turn.resp).text;
  const safe = safeText(raw);
  return {
    answer: safe || SAFE_VET_LINE[lang] || SAFE_VET_LINE.bn,
    filtered: Boolean(raw) && safe !== raw.trim(),
    brain: { provider: turn.provider, model: turn.model, label: turn.label, fallback: state.fallback || null },
  };
}
