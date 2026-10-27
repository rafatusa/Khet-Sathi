// Symptoms to the vet (v0.7.2). Sathi ticks the signs the video showed, the farmer confirms
// or changes them, answers two questions, agrees, and a SIMULATED call speaks a fixed-template
// message. SAFETY: signs are plain observations from a fixed list. The message never names a
// disease, cause or medicine, and no free model text goes into it.

// Every sign the farmer can pick, in display order.
export const SIGN_CODES = ['still', 'off_feed', 'crowding', 'twisted_neck', 'wet_litter', 'breathing', 'swollen_face', 'weak', 'drink_less', 'droppings', 'fewer_eggs'];
// Signs Muse Spark may report from the video (the rest only the farmer knows; 'still' comes from SAM).
export const MODEL_SIGNS = ['off_feed', 'crowding', 'twisted_neck', 'wet_litter', 'breathing', 'swollen_face', 'weak'];
export const SINCE_CODES = ['today', 'days', 'week'];

const order = (codes) => SIGN_CODES.filter((c) => codes.includes(c));

// Contact names in each language live in names.js (shared with the egg sale).
export { withNames } from './names.js';

// Signs from one camera check: SAM still birds (daytime only) + what Spark saw or heard.
export function autoSigns({ count, observation, night = false } = {}) {
  const out = [];
  if (count?.still?.length && !count.resting && !night) out.push('still');
  const o = observation?.ok ? observation : null;
  if (o) {
    out.push(...(o.signs || []).filter((s) => MODEL_SIGNS.includes(s)));
    if (o.wetLitter) out.push('wet_litter');
    if (o.unusualSound) out.push('breathing');
    if (o.crowding) out.push('crowding');
  }
  return order([...new Set(out)]);
}

// Sentence parts for the vet. Fixed text only.
const PHRASE = {
  bn: {
    still: (n) => (n ? `${n}টি মুরগি দিনের বেলা নড়ছে না` : 'কিছু মুরগি দিনের বেলা নড়ছে না'),
    off_feed: () => 'কিছু মুরগি খাবারের কাছে যাচ্ছে না',
    crowding: () => 'মুরগিগুলো এক জায়গায় গাদাগাদি করে আছে',
    twisted_neck: () => 'কয়েকটির ঘাড় বাঁকা',
    wet_litter: () => 'লিটার ভেজা',
    breathing: () => 'কাশি বা শ্বাসে শব্দ শোনা যাচ্ছে',
    swollen_face: () => 'চোখ-মুখ ফোলা',
    weak: () => 'কিছু মুরগি ঝিমাচ্ছে, দাঁড়াতে পারছে না',
    drink_less: () => 'পানি কম খাচ্ছে',
    droppings: () => 'পায়খানা সবুজ বা পাতলা',
    fewer_eggs: () => 'ডিম কমে গেছে',
    since: { today: 'আজ থেকে', days: '২-৩ দিন ধরে', week: 'এক সপ্তাহের বেশি সময় ধরে' },
    open: 'ডাক্তার সাহেব, আমি খেত সাথী, একটি মুরগির খামার থেকে বলছি।',
    seen: (since, list) => `${since ? `${since} ` : ''}খামারি এগুলো দেখছেন: ${list}।`,
    nothing: 'খামারি মুরগির মধ্যে অস্বাভাবিক কিছু দেখছেন।',
    deaths: (n, d) => (n === 0 ? 'আজ কোনো মুরগি মারা যায়নি।' : `আজ ${d}টি মুরগি মারা গেছে।`),
    close: 'খামারি আপনার পরামর্শ চান।',
    join: ', ',
  },
  hi: {
    still: (n) => (n ? `${n} मुर्गियाँ दिन में हिल नहीं रहीं` : 'कुछ मुर्गियाँ दिन में हिल नहीं रहीं'),
    off_feed: () => 'कुछ मुर्गियाँ दाने के पास नहीं जा रहीं',
    crowding: () => 'मुर्गियाँ एक जगह झुंड बनाकर बैठी हैं',
    twisted_neck: () => 'कुछ की गर्दन मुड़ी हुई है',
    wet_litter: () => 'बिछावन गीला है',
    breathing: () => 'खाँसी या साँस की आवाज़ सुनाई दे रही है',
    swollen_face: () => 'आँख और चेहरा सूजा है',
    weak: () => 'कुछ मुर्गियाँ सुस्त हैं, खड़ी नहीं हो पा रहीं',
    drink_less: () => 'पानी कम पी रही हैं',
    droppings: () => 'बीट हरी या पतली है',
    fewer_eggs: () => 'अंडे कम हो गए हैं',
    since: { today: 'आज से', days: '2-3 दिन से', week: 'एक हफ़्ते से ज़्यादा समय से' },
    open: 'डॉक्टर साहब, मैं खेत साथी हूँ, एक मुर्गी फ़ार्म से बोल रही हूँ।',
    seen: (since, list) => `${since ? `${since} ` : ''}किसान यह देख रहे हैं: ${list}।`,
    nothing: 'किसान मुर्गियों में कुछ असामान्य देख रहे हैं।',
    deaths: (n, d) => (n === 0 ? 'आज कोई मुर्गी नहीं मरी।' : n === 1 ? 'आज 1 मुर्गी मर गई।' : `आज ${d} मुर्गियाँ मर गईं।`),
    close: 'किसान आपकी सलाह चाहते हैं।',
    join: ', ',
  },
  en: {
    still: (n) => (n ? `${n} chickens are not moving in the daytime` : 'some chickens are not moving in the daytime'),
    off_feed: () => 'some chickens stay away from the feed',
    crowding: () => 'the chickens are huddled together',
    twisted_neck: () => 'a few have a twisted neck',
    wet_litter: () => 'the litter is wet',
    breathing: () => 'coughing or noisy breathing can be heard',
    swollen_face: () => 'eyes and face look swollen',
    weak: () => 'some chickens are drowsy and cannot stand',
    drink_less: () => 'they are drinking less',
    droppings: () => 'droppings are green or watery',
    fewer_eggs: () => 'fewer eggs',
    since: { today: 'Since today', days: 'For 2-3 days', week: 'For more than a week' },
    open: 'Doctor, this is Khet Sathi calling from a poultry farm.',
    seen: (since, list) => `${since ? `${since} the farmer has seen` : 'The farmer has seen'}: ${list}.`,
    nothing: 'The farmer sees something unusual in the chickens.',
    deaths: (n, d) => (n === 0 ? 'No chickens died today.' : n === 1 ? '1 chicken died today.' : `${d} chickens died today.`),
    close: 'The farmer would like your advice.',
    join: '; ',
  },
};

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const digits = (n, lang) => (lang === 'bn' ? String(n).replace(/\d/g, (d) => BN_DIGITS[d]) : String(n));

// Cleans what the phone sends: known signs only, whole numbers in range.
export function cleanCall(body = {}) {
  const lang = ['bn', 'hi', 'en'].includes(body.lang) ? body.lang : 'bn';
  const signs = order([...new Set((Array.isArray(body.signs) ? body.signs : []).filter((s) => SIGN_CODES.includes(s)))]);
  const int = (v, max) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(max, Math.round(Number(v)))));
  return {
    lang,
    signs,
    still: int(body.still, 100000),
    since: SINCE_CODES.includes(body.since) ? body.since : null,
    deaths: int(body.deaths, 100000),
  };
}

// The exact words Sathi says to the vet.
export function vetMessage(input) {
  const { lang, signs, still, since, deaths } = cleanCall(input);
  const P = PHRASE[lang];
  const list = signs.map((s) => (s === 'still' ? P.still(still ? digits(still, lang) : 0) : P[s]()));
  const parts = [P.open];
  parts.push(list.length ? P.seen(since ? P.since[since] : '', list.join(P.join)) : P.nothing);
  if (deaths !== null) parts.push(P.deaths(deaths, digits(deaths, lang)));
  parts.push(P.close);
  return parts.join(' ');
}

// ---------- the two-way demo call (v0.7.4): every vet line is scripted ----------
// The simulated vet asks at most two questions, picked by the signs; Sathi answers only from data
// the app has (SAM bird count, simulated shed sensors) and says so when it has none.
const CALL = {
  bn: {
    q_count: 'শেডে মোট কতগুলো মুরগি আছে?',
    a_count: (n) => `শেডে প্রায় ${n}টি মুরগি আছে।`,
    q_feed: 'শেডে পানি আর খাবার আছে তো?',
    a_feed: (w, f) => `পানি ${w}%, খাবার ${f}% ভরা আছে।`,
    q_climate: 'শেডের ভেতরটা কেমন, গরম না ভেজা?',
    a_climate: (t, h) => `শেডে এখন ${t} ডিগ্রি, আর্দ্রতা ${h}%।`,
    unknown: 'এটা আমার কাছে এখন নেই, খামারি আপনাকে পরে জানাবেন।',
    close: 'ঠিক আছে। অসুস্থ মুরগিগুলো আলাদা জায়গায় রাখুন। আমি কাল সকালে এসে দেখব।',
    summary: ['অসুস্থ মুরগিগুলো আলাদা জায়গায় রাখুন', 'ডাক্তার কাল সকালে আসবেন'],
  },
  hi: {
    q_count: 'शेड में कुल कितनी मुर्गियाँ हैं?',
    a_count: (n) => `शेड में लगभग ${n} मुर्गियाँ हैं।`,
    q_feed: 'शेड में पानी और दाना है ना?',
    a_feed: (w, f) => `पानी ${w}%, दाना ${f}% भरा है।`,
    q_climate: 'शेड के अंदर कैसा है, गर्म या गीला?',
    a_climate: (t, h) => `शेड में अभी ${t} डिग्री, नमी ${h}% है।`,
    unknown: 'यह अभी मेरे पास नहीं है, किसान आपको बाद में बताएँगे।',
    close: 'ठीक है। बीमार मुर्गियों को अलग जगह रखें। मैं कल सुबह आकर देखूँगा।',
    summary: ['बीमार मुर्गियों को अलग जगह रखें', 'डॉक्टर कल सुबह आएँगे'],
  },
  en: {
    q_count: 'How many chickens are in the shed in total?',
    a_count: (n) => `There are about ${n} chickens in the shed.`,
    q_feed: 'Do they have water and feed?',
    a_feed: (w, f) => `Water is ${w}% full and feed ${f}% full.`,
    q_climate: 'How is it inside the shed, hot or damp?',
    a_climate: (t, h) => `The shed is ${t} degrees now, humidity ${h}%.`,
    unknown: 'I do not have that right now; the farmer will tell you later.',
    close: 'All right. Keep the sick chickens apart. I will come and see them tomorrow morning.',
    summary: ['Keep the sick chickens apart', 'The vet comes tomorrow morning'],
  },
};

const ok = (v) => Number.isFinite(Number(v)) && v !== null && v !== '';

// Turns of the call: [{ who: 'saathi' | 'vet', text, src? }] plus the summary for the farmer.
// data: { birds, shed: { shed_temp, shed_humidity, water_pct, feed_pct } } (numbers or null).
export function vetScript(input, data = {}) {
  const call = cleanCall(input);
  const { lang, signs, deaths } = call;
  const C = CALL[lang];
  const d = (n) => digits(Math.round(Number(n)), lang);
  const has = (...xs) => xs.some((x) => signs.includes(x));
  const s = data.shed || {};
  const asks = [];
  if (deaths > 0 || has('weak', 'still')) asks.push('count');
  if (has('drink_less', 'off_feed')) asks.push('feed');
  if (has('breathing', 'crowding', 'wet_litter', 'swollen_face')) asks.push('climate');
  if (!asks.length) asks.push('count');
  const turns = [{ who: 'saathi', text: vetMessage(call) }];
  for (const q of asks.slice(0, 2)) {
    turns.push({ who: 'vet', text: C[`q_${q}`] });
    if (q === 'count') turns.push(ok(data.birds) && Number(data.birds) > 0 ? { who: 'saathi', text: C.a_count(d(data.birds)), src: 'sam' } : { who: 'saathi', text: C.unknown });
    if (q === 'feed') turns.push(ok(s.water_pct) && ok(s.feed_pct) ? { who: 'saathi', text: C.a_feed(d(s.water_pct), d(s.feed_pct)), src: 'sensor' } : { who: 'saathi', text: C.unknown });
    if (q === 'climate') turns.push(ok(s.shed_temp) && ok(s.shed_humidity) ? { who: 'saathi', text: C.a_climate(d(s.shed_temp), d(s.shed_humidity)), src: 'sensor' } : { who: 'saathi', text: C.unknown });
  }
  turns.push({ who: 'vet', text: C.close });
  return { turns, summary: C.summary };
}

// ---------- the farmer's spoken answers ----------
const WORD_NUM = {
  1: ['এক', 'একটা', 'একটি', 'एक', 'one'],
  2: ['দুই', 'দুটো', 'দুটি', 'দুইটা', 'दो', 'two'],
  3: ['তিন', 'তিনটা', 'তিনটি', 'तीन', 'three'],
  4: ['চার', 'চারটা', 'চারটি', 'चार', 'four'],
  5: ['পাঁচ', 'পাঁচটা', 'পাঁচটি', 'पांच', 'पाँच', 'five'],
  6: ['ছয়', 'ছয়টা', 'ছয়টি', 'छह', 'six'],
  7: ['সাত', 'सात', 'seven'],
  8: ['আট', 'आठ', 'eight'],
  9: ['নয়', 'नौ', 'nine'],
  10: ['দশ', 'दस', 'ten'],
};
const NO = /(^|\s)(না|নাহ|নেই|নাই|কোনো\s*না|কেউ\s*না|नहीं|नही|कोई\s*नहीं|no|none|nothing)(?=$|[\s,.।!?])/i;

const DONT_KNOW = /(জানি\s*না|জানিনা|বলতে পারব না|पता नहीं|मालूम नहीं|don't know|dont know|not sure)/i;

const toLatin = (s) => String(s).replace(/[০-৯]/g, (d) => BN_DIGITS.indexOf(d)).replace(/[०-९]/g, (d) => '०१२३४५६७८९'.indexOf(d));

// "হ্যাঁ, দুটো" -> 2, "না" -> 0, unclear -> null.
export function parseDeaths(text) {
  const s = toLatin(String(text || '').toLowerCase());
  if (DONT_KNOW.test(s)) return null;
  const d = s.match(/\d+/);
  if (d) return Math.min(100000, Number(d[0]));
  const words = s.split(/[\s,.।!?]+/).filter(Boolean);
  for (const [n, list] of Object.entries(WORD_NUM)) if (words.some((w) => list.includes(w))) return Number(n);
  if (NO.test(` ${s}`)) return 0;
  return null;
}

// "দুই তিন দিন" -> days, "আজ সকাল থেকে" -> today, "এক সপ্তাহ" -> week, unclear -> null.
export function parseSince(text) {
  const s = String(text || '').toLowerCase();
  if (/(সপ্তাহ|হপ্তা|week|हफ़्ते|हफ्ते|हफ़्ता|हफ्ता|सप्ताह)/.test(s)) return 'week';
  if (/(দিন|day|दिन|yesterday)/.test(s) || /(^|\s)(গত)?কাল/.test(s) || /(^|\s)कल/.test(s)) return 'days';
  if (/(আজ|today|आज)/.test(s)) return 'today';
  return null;
}
