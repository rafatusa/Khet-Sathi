// Buying for a field (v0.11.0): seed, fertilizer and a plough crew for the farmer's crop.
// The shop names can be real (OpenStreetMap or Google Places), but NOTHING is called, emailed or paid:
// the call is a scripted demo with labelled sample prices, and the booking is a simulated record.

// Rough seed need per acre and unit (sample figures, shown as approximate).
const SEED = {
  rice: [12, 'kg'], wheat: [45, 'kg'], maize: [8, 'kg'], mustard: [2, 'kg'], rapeseed: [2, 'kg'], potato: [600, 'kg'], soybean: [30, 'kg'],
  lentil: [15, 'kg'], barley: [40, 'kg'], sorghum: [4, 'kg'], millet: [2, 'kg'], peanut: [40, 'kg'], pea: [35, 'kg'], beans: [30, 'kg'],
  chickpea: [30, 'kg'], cassava: [4000, 'cuttings'], cotton: [2, 'kg'], sunflower: [3, 'kg'], sugar_beet: [1.5, 'kg'], sugarcane: [1600, 'kg'],
  rye: [40, 'kg'], cabbage: [0.2, 'kg'], cauliflower: [0.2, 'kg'], carrot: [2, 'kg'], bottle_gourd: [1, 'kg'],
};
// Sample price per seed unit in US dollars, converted with the country's fixed sample rate.
const SEED_USD = {
  rice: 0.8, wheat: 0.5, maize: 4, mustard: 3, rapeseed: 3, potato: 0.4, soybean: 1, lentil: 1.5, barley: 0.5, sorghum: 2, millet: 2, peanut: 1.5,
  pea: 1.2, beans: 1.5, chickpea: 1.2, cassava: 0.02, cotton: 8, sunflower: 6, sugar_beet: 30, sugarcane: 0.05, rye: 0.6, cabbage: 60, cauliflower: 60, carrot: 10, bottle_gourd: 15,
};
const FERT_USD = 15; // one 50 kg bag of NPK
const PLOUGH_USD = 30; // one acre

const round = (v) => (v >= 100 ? Math.round(v / 5) * 5 : Math.round(v * 10) / 10);

export function needsFor({ crop, acres, currency }) {
  const a = Math.max(0.05, Number(acres) || 1);
  const r = currency?.perUsd || 1;
  const [rate, unit] = SEED[crop] || [10, 'kg'];
  const seedQty = round(rate * a);
  const bags = Math.max(1, Math.round(2 * a));
  return [
    { id: 'seed', crop, qty: seedQty, unit, price: Math.round(seedQty * (SEED_USD[crop] || 2) * r) },
    { id: 'fert', qty: bags, unit: 'bag50', price: Math.round(bags * FERT_USD * r) },
    { id: 'plough', qty: Math.round(a * 100) / 100, unit: 'acre', price: Math.max(Math.round(PLOUGH_USD * r * 0.25), Math.round(a * PLOUGH_USD * r)) },
  ];
}

const T = {
  en: {
    hello: 'Hello, this is Sathi, calling for a farmer near {place}.',
    ask: 'Do you have {items}?',
    yes: 'Yes, I have it. That comes to {total}.',
    keep: 'Please keep it ready. The farmer will pick it up {when}.',
    done: 'Done, it will be ready {when}. Thank you.',
    crewAsk: 'Can you plough {acres} acres {when}?',
    crewYes: 'Yes, my crew can come {when}. {total} for the job.',
    crewKeep: 'Please book it. Thank you.',
    tomorrow: 'tomorrow at 10 am', dayAfter: 'the day after tomorrow at 8 am',
    seed: '{qty} {unit} of {crop} seed', fert: '{qty} bags of NPK fertilizer', kg: 'kg', cuttings: 'cuttings',
  },
  bn: {
    hello: 'নমস্কার, আমি সাথী, {place}-এর কাছের একজন কৃষকের হয়ে ফোন করছি।',
    ask: 'আপনার কাছে {items} আছে?',
    yes: 'হ্যাঁ, আছে। সব মিলিয়ে {total}।',
    keep: 'দয়া করে রেখে দিন। কৃষক {when} নিয়ে যাবেন।',
    done: 'ঠিক আছে, {when} তৈরি থাকবে। ধন্যবাদ।',
    crewAsk: '{when} {acres} একর জমি চাষ করে দিতে পারবেন?',
    crewYes: 'হ্যাঁ, আমার দল {when} যাবে। পুরো কাজ {total}।',
    crewKeep: 'বুক করে দিন। ধন্যবাদ।',
    tomorrow: 'কাল সকাল ১০টায়', dayAfter: 'পরশু সকাল ৮টায়',
    seed: '{qty} {unit} {crop}-এর বীজ', fert: '{qty} বস্তা NPK সার', kg: 'কেজি', cuttings: 'কাটিং',
  },
  hi: {
    hello: 'नमस्ते, मैं साथी हूँ, {place} के पास के एक किसान की ओर से फ़ोन कर रहा हूँ।',
    ask: 'क्या आपके पास {items} है?',
    yes: 'हाँ, है। सब मिलाकर {total}।',
    keep: 'कृपया रख दीजिए। किसान {when} ले जाएँगे।',
    done: 'ठीक है, {when} तैयार रहेगा। धन्यवाद।',
    crewAsk: 'क्या आप {when} {acres} एकड़ जुताई कर सकते हैं?',
    crewYes: 'हाँ, मेरी टीम {when} आएगी। पूरे काम के {total}।',
    crewKeep: 'कृपया बुक कर दीजिए। धन्यवाद।',
    tomorrow: 'कल सुबह 10 बजे', dayAfter: 'परसों सुबह 8 बजे',
    seed: '{qty} {unit} {crop} का बीज', fert: '{qty} बोरी NPK खाद', kg: 'किलो', cuttings: 'कटिंग',
  },
};
const fill = (s, v) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(String(x)), s);
const DIG = { bn: '০১২৩৪৫৬৭৮৯', hi: '०१२३४५६७८९' };
const digits = (s, lang) => (DIG[lang] ? String(s).replace(/[0-9]/g, (c) => DIG[lang][c]) : String(s));
export const moneyText = (n, currency, lang = 'en') => digits(`${currency?.symbol || ''}${Math.round(n).toLocaleString('en-IN')}`, lang);

// The scripted demo calls: one to the shop (seed and fertilizer), one to the plough crew.
export function orderCalls({ lines, shop, crew, place, cropName, currency, lang = 'en' }) {
  const L = T[lang] || T.en;
  const d = (s) => digits(s, lang);
  const goods = lines.filter((l) => l.id !== 'plough');
  const plough = lines.find((l) => l.id === 'plough');
  const calls = [];
  const where = place || '';
  if (goods.length) {
    const items = goods.map((l) => (l.id === 'seed' ? fill(L.seed, { qty: d(l.qty), unit: L[l.unit] || l.unit, crop: cropName || l.crop }) : fill(L.fert, { qty: d(l.qty) }))).join(lang === 'en' ? ' and ' : lang === 'bn' ? ' আর ' : ' और ');
    const total = goods.reduce((a, l) => a + l.price, 0);
    calls.push({
      to: shop,
      total,
      when: L.tomorrow,
      turns: [
        { who: 'saathi', text: fill(L.hello, { place: where }) },
        { who: 'saathi', text: fill(L.ask, { items }) },
        { who: 'shop', text: fill(L.yes, { total: moneyText(total, currency, lang) }) },
        { who: 'saathi', text: fill(L.keep, { when: L.tomorrow }) },
        { who: 'shop', text: fill(L.done, { when: L.tomorrow }) },
      ],
    });
  }
  if (plough) {
    calls.push({
      to: crew,
      total: plough.price,
      when: L.dayAfter,
      turns: [
        { who: 'saathi', text: fill(L.hello, { place: where }) },
        { who: 'saathi', text: fill(L.crewAsk, { acres: d(plough.qty), when: L.dayAfter }) },
        { who: 'shop', text: fill(L.crewYes, { when: L.dayAfter, total: moneyText(plough.price, currency, lang) }) },
        { who: 'saathi', text: L.crewKeep },
      ],
    });
  }
  return calls;
}

// A demo crew and shop for places where no real shop is listed.
export const DEMO_SHOP = { id: 'demo-shop', name: { en: 'Krishi seed and fertilizer shop', bn: 'কৃষি বীজ ও সার ভাণ্ডার', hi: 'कृषि बीज और खाद भंडार' }, km: null, source: 'demo', real: false };
export const DEMO_CREW = { id: 'demo-crew', name: { en: 'Village plough crew', bn: 'গ্রামের চাষের দল', hi: 'गाँव की जुताई टीम' }, source: 'demo', real: false };
