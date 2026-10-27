// Egg sale (v0.8.0): the farmer sets when to sell (eggs reach N, or every N days, whichever comes
// first), the lowest price per tray and which shops to call. Saathi then "calls" the shops and
// bargains. SIMULATED: shops, calls and money. Saathi's lines and every price follow fixed rules
// here (never below the farmer's lowest price); Muse Spark only voices the shopkeeper's lines.
import { nameIn } from './names.js';

export const TRAY = 30; // eggs per tray
export const DEFAULT_RULE = { kind: 'eggs', enabled: true, min_count: 300, every_days: 3, floor_price: 175, shop_ids: [], ask_first: true, started_at: null, last_sold_at: null, last_run: null };

const int = (v, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : null);

// What the phone sends for the rule, cleaned. At least one trigger must stay on.
export function cleanRule(body = {}, prev = DEFAULT_RULE) {
  const min = body.min_count === null ? null : int(body.min_count ?? prev.min_count, TRAY, 5000);
  const days = body.every_days === null ? null : int(body.every_days ?? prev.every_days, 1, 30);
  if (!min && !days) throw new Error('Pick at least one: an egg count or a number of days');
  const floor = int(body.floor_price ?? prev.floor_price, 1, 10000);
  if (!floor) throw new Error('Set the lowest price per tray');
  const ids = Array.isArray(body.shop_ids) ? body.shop_ids.filter((x) => typeof x === 'string').slice(0, 10) : prev.shop_ids || [];
  return {
    ...prev,
    kind: 'eggs',
    enabled: body.enabled === undefined ? prev.enabled !== false : body.enabled !== false,
    min_count: min ? Math.round(min / TRAY) * TRAY || TRAY : null,
    every_days: days,
    floor_price: floor,
    shop_ids: ids,
    ask_first: body.ask_first === undefined ? prev.ask_first !== false : body.ask_first !== false,
    started_at: prev.started_at || new Date().toISOString(),
  };
}

// Is it time to sell? stock = eggs collected and not sold yet.
export function sellDue(rule, stock, now = Date.now()) {
  const trays = Math.floor((Number(stock) || 0) / TRAY);
  if (!rule?.enabled || trays < 1) return { due: false, trays };
  if (rule.min_count && stock >= rule.min_count) return { due: true, reason: 'count', trays };
  const base = rule.last_sold_at || rule.started_at;
  if (rule.every_days && base && now - new Date(base).getTime() >= rule.every_days * 86400000) return { due: true, reason: 'days', trays };
  return { due: false, trays };
}

const round5 = (n) => Math.round(n / 5) * 5;
function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}

// The most each simulated shop will pay today: its last price, moved a little each day.
export function shopMax(shop, day) {
  const last = Number(shop?.details?.last_price_inr_per_tray) || 180;
  return round5(last + ((hash(`${shop?.id || shop?.name}|${day}`) % 21) - 12));
}

const PICKUP = {
  bn: ['আজ বিকেল ৪টায়', 'আজ সন্ধ্যা ৬টায়', 'কাল সকাল ৮টায়'],
  hi: ['आज शाम 4 बजे', 'आज शाम 6 बजे', 'कल सुबह 8 बजे'],
  en: ['today at 4 pm', 'today at 6 pm', 'tomorrow at 8 am'],
};

// The bargaining for one shop. Every price is decided here; nothing is left to the model.
// Returns the turns (Saathi lines with text, shop lines with a kind and price for Spark to voice).
export function planDeal({ shop, floor, trays, lang = 'bn', day, slot = 0 }) {
  const last = Number(shop?.details?.last_price_inr_per_tray) || null;
  const target = Math.max(floor, last || floor + 10);
  const max = shopMax(shop, day);
  const pickup = PICKUP[lang][slot % 3];
  const turns = [{ who: 'saathi', key: 'greet', trays }];
  const offers = [];
  const o1 = Math.min(max, round5(max - 10 - (hash(`${shop?.name}|${day}|o`) % 2) * 5));
  offers.push(o1);
  turns.push({ who: 'shop', kind: 'open', price: o1 });
  let price = null;
  const accept = (p) => {
    price = p;
    turns.push({ who: 'saathi', key: 'accept', price: p });
    turns.push({ who: 'shop', kind: 'deal', pickup });
  };
  if (o1 >= target) accept(o1);
  else {
    turns.push({ who: 'saathi', key: 'counter', price: target, last });
    const o2 = Math.min(max, Math.max(o1 + 5, round5((o1 + target) / 2)));
    offers.push(o2);
    turns.push({ who: 'shop', kind: 'raise', price: o2 });
    if (o2 >= target) accept(o2);
    else {
      turns.push({ who: 'saathi', key: 'last', price: target });
      const o3 = Math.max(o2, max);
      offers.push(o3);
      turns.push({ who: 'shop', kind: 'final', price: o3 });
      if (o3 >= floor) accept(o3);
      else turns.push({ who: 'saathi', key: 'decline', price: floor });
    }
  }
  return { turns, price, best: Math.max(...offers), pickup: price ? pickup : null };
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const dg = (n, lang) => (lang === 'bn' ? String(n).replace(/\d/g, (d) => BN_DIGITS[d]) : String(n));
export const money = (n, lang) => (lang === 'bn' ? `${dg(n, lang)} টাকা` : lang === 'hi' ? `${n} रुपये` : `₹${n}`);

const SAATHI = {
  bn: {
    greet: (t) => `নমস্কার, আমি খেত সাথী, একটি মুরগির খামার থেকে বলছি। আজ ${dg(t, 'bn')} ট্রে তাজা ডিম আছে। আপনি ট্রে প্রতি কত দেবেন?`,
    counter: (p, last) => (last === p ? `গত বার আপনি ${money(p, 'bn')} দিয়েছিলেন, এবারও তাই হলে দিতে পারি।` : `${last ? `গত বার আপনি ${money(last, 'bn')} দিয়েছিলেন। ` : ''}${money(p, 'bn')} হলে দিতে পারি।`),
    last: (p) => `শেষ কথা বলি, ${money(p, 'bn')} হলে আজই সব ডিম আপনার।`,
    accept: (p) => `ঠিক আছে, ট্রে প্রতি ${money(p, 'bn')}। খামারিকে জানিয়ে আপনাকে পাকা করব।`,
    decline: (p) => `${money(p, 'bn')}র কম হবে না। আজ থাক, ধন্যবাদ।`,
  },
  hi: {
    greet: (t) => `नमस्ते, मैं खेत साथी हूँ, एक मुर्गी फ़ार्म से बोल रहा हूँ। आज ${t} ट्रे ताज़े अंडे हैं। आप प्रति ट्रे कितना देंगे?`,
    counter: (p, last) => (last === p ? `पिछली बार आपने ${money(p, 'hi')} दिए थे, इस बार भी उतने हों तो दे सकते हैं।` : `${last ? `पिछली बार आपने ${money(last, 'hi')} दिए थे। ` : ''}${money(p, 'hi')} हों तो दे सकते हैं।`),
    last: (p) => `आख़िरी बात, ${money(p, 'hi')} हों तो आज ही सारे अंडे आपके।`,
    accept: (p) => `ठीक है, प्रति ट्रे ${money(p, 'hi')}। किसान को बताकर आपसे पक्का करूँगा।`,
    decline: (p) => `${money(p, 'hi')} से कम नहीं होगा। आज रहने दीजिए, धन्यवाद।`,
  },
  en: {
    greet: (t) => `Hello, this is Khet Saathi calling from a poultry farm. We have ${t} trays of fresh eggs today. What will you pay per tray?`,
    counter: (p, last) => (last === p ? `Last time you paid ${money(p, 'en')}; the same again and the eggs are yours.` : `${last ? `Last time you paid ${money(last, 'en')}. ` : ''}We can do it for ${money(p, 'en')}.`),
    last: (p) => `Final word: at ${money(p, 'en')} all the eggs are yours today.`,
    accept: (p) => `All right, ${money(p, 'en')} per tray. I will check with the farmer and confirm with you.`,
    decline: (p) => `We cannot go below ${money(p, 'en')}. Not today then, thank you.`,
  },
};

// Fallback shopkeeper lines when Spark is not available. {price} is filled in by code.
const SHOP = {
  bn: { open: 'এখন বাজার একটু নরম। ট্রে প্রতি {price} দিতে পারি।', raise: 'আচ্ছা, {price} পর্যন্ত দিতে পারি।', final: '{price}, এর বেশি পারব না।', deal: 'ঠিক আছে, {pickup} লোক পাঠাব।' },
  hi: { open: 'अभी बाज़ार थोड़ा नरम है। प्रति ट्रे {price} दे सकता हूँ।', raise: 'अच्छा, {price} तक दे सकता हूँ।', final: '{price}, इससे ज़्यादा नहीं हो पाएगा।', deal: 'ठीक है, {pickup} आदमी भेज दूँगा।' },
  en: { open: 'The market is a bit soft now. I can give {price} per tray.', raise: 'All right, I can go up to {price}.', final: '{price}, I cannot do more than that.', deal: 'Fine, I will send someone {pickup}.' },
};

// Spark prompt: voice the shopkeeper's lines only, with {price} where the price goes.
export function shopPrompt({ shop, lang, plan }) {
  const LANG = { bn: 'Bangla', hi: 'Hindi', en: 'English' }[lang] || 'Bangla';
  const script = plan.turns
    .map((t, i) => (t.who === 'saathi' ? `${i}. FARM ASSISTANT: ${saathiText(t, lang)}` : `${i}. YOU (${t.kind}${t.price ? `, price ${t.price} rupees per tray` : ''}${t.pickup ? `, pickup ${t.pickup}` : ''}): ???`))
    .join('\n');
  return `You play ${nameIn(shop, 'en') || 'a shopkeeper'}, a small shop owner in a West Bengal village who buys eggs by the tray. This is a short phone call; the prices are already decided.
Write each of YOUR lines marked ??? in ${LANG}: one or two short, natural, friendly sentences, like a real village shopkeeper. Where a line has a price, write the placeholder {price} exactly once instead of the number. Do not write any other numbers, prices or times${plan.turns.some((t) => t.pickup) ? ', except write {pickup} where you say when you will collect' : ''}. No emojis.
Call:
${script}
Reply with JSON only: {"lines": ["line for the first ???", "line for the second ???", ...]}`;
}

export function saathiText(t, lang) {
  const S = SAATHI[lang] || SAATHI.bn;
  return t.key === 'greet' ? S.greet(t.trays) : t.key === 'counter' ? S.counter(t.price, t.last) : t.key === 'last' ? S.last(t.price) : t.key === 'accept' ? S.accept(t.price) : S.decline(t.price);
}

// Fills the shop lines: Spark's wording when it is usable, else the fallback. Prices always from the plan.
export function voiceDeal(plan, lang, modelLines = null) {
  const shopTurns = plan.turns.filter((t) => t.who === 'shop');
  let spark = 0;
  const turns = plan.turns.map((t) => {
    if (t.who === 'saathi') return { who: 'saathi', text: saathiText(t, lang) };
    const i = shopTurns.indexOf(t);
    let line = typeof modelLines?.[i] === 'string' ? modelLines[i].trim().slice(0, 220) : '';
    const needsPrice = Boolean(t.price);
    const okLine = line && (!needsPrice || line.split('{price}').length === 2) && !/[0-9০-৯०-९]/.test(line.replace(/\{price\}|\{pickup\}/g, ''));
    if (okLine) spark++;
    else line = SHOP[lang][t.kind];
    if (t.pickup && !line.includes('{pickup}')) line = SHOP[lang].deal;
    return { who: 'shop', text: line.replace('{price}', t.price ? money(t.price, lang) : '').replace('{pickup}', t.pickup || ''), by: okLine ? 'spark' : 'script' };
  });
  return { turns, spark };
}

export function parseLines(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return Array.isArray(j.lines) ? j.lines : null;
  } catch {
    return null;
  }
}

// Offers best first: deals at or above the floor, then the rest by best offer.
export function rankOffers(shops) {
  return [...shops].sort((a, b) => (b.price ? 1 : 0) - (a.price ? 1 : 0) || (b.price || b.best) - (a.price || a.best));
}
