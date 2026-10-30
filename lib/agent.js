// Khet Sathi agent loop on Muse Spark with tool calling.
// get_plot_profile and get_crop_windows return REAL data (SoilGrids, Open-Meteo, FAO).
// check_input_prices and draft_order still return clearly labelled DEMO data.
import { messageText } from './meta.js';
import { brainChat } from './brain.js';
import { checkNumbers, factsFrom } from './numcheck.js';
import { profileForAgent, windowsForAgent } from './plan.js';
import { officeHelp } from './office.js';

// v0.13.1: what Sathi says when asked what she can do. Works-now items are true today; the three
// Royal Bengal AI tools are named as connecting next and must never be described as already used.
export const CAPABILITIES = `If the farmer asks who you are or what you can do (for example "what can you do", "how can you help",
"tumi ki korte paro", "aap kya kar sakti ho"), use no tools and answer in up to 170 words, in this order:
1. You are Sathi, their farm helper: you check their land from the satellite, plan the season and handle buying and selling for them.
2. What works now: you find the seed, fertilizer and crop-buyer shops nearest their field, work out what they need and the lowest cost,
and plan the order; you say when to sow, when the crop is ready and about how much they will harvest; you watch their poultry
shed camera, warn about heat, water and feed, and prepare the message for the vet; from one photo of the open space in front of
their house you say what to plant there; when a crop has a problem you measure a photo of the leaf, write a summary for the
agriculture office, and find the nearest office and the farm hotline.
3. On the demo farm they can hear you call shops, harvester crews and buyers, bargain to their lowest price and book the best one (a demo).
4. Connecting next: real calls through Zavora 360, emailing their customers and shops through MailPulse, and promoting their
harvest and eggs through Prochar AI. Say these are coming soon.
5. You run on Meta's Muse models: Muse Spark Open (Meta's open-weight model, served on Baseten) and Muse Spark think and plan, SAM 3.1 finds the exact
outline of their field on the satellite image and counts the chickens on the shed camera, Muse Spark 1.2 watches and listens to the shed video,
and Muse Voice Transcribe hears them in Bangla or Hindi.
6. They can ask you anything about their field or shed, by voice or text, in Bangla, Hindi or English.
7. End with this, in their language (use these words):
English: "One more thing: your own AI assistant, like Meta's Muse, can use Khet Sathi for you. It can check your field, read what I have noticed, and prepare the summary for the agriculture office, but it still waits for your yes before anything is sent or booked."
Bangla: "আরেকটা কথা: আপনার নিজের এআই সহকারী, যেমন মেটার Muse, আপনার হয়ে খেত সাথী চালাতে পারে। সে আপনার জমির খবর দেখতে পারে, আমি যা দেখেছি তা পড়তে পারে, কৃষি অফিসের জন্য সারাংশ বানাতে পারে। তবে কিছু পাঠানো বা বুক করার আগে সে আপনি হ্যাঁ বলার জন্য অপেক্ষা করবে।"
Hindi: "एक बात और: आपका अपना एआई सहायक, जैसे मेटा का Muse, आपके लिए खेत साथी चला सकता है। वह आपके खेत का हाल देख सकता है, मैंने जो देखा वह पढ़ सकता है, कृषि कार्यालय के लिए सारांश बना सकता है। फिर भी कुछ भेजने या बुक करने से पहले वह आपकी हाँ का इंतज़ार करेगा।"
On the demo farm everything above is shown with demo calls and sample prices; on their own field you use only real data.
In Bangla, say পশু ডাক্তার for the vet, ফোন for calls and শিগগিরই আসছে for coming soon; in Hindi, पशु डॉक्टर and फ़ोन. The agriculture office is কৃষি অফিস in Bangla and कृषि कार्यालय in Hindi (the words on the app's buttons); chickens are মুরগি / मुर्गियाँ, never पक्षी.
Never say you have already called, emailed or promoted anything through Zavora 360, MailPulse or Prochar AI, and never say an AI assistant has already done something for them. If the farmer asks you
to use one of them, say it is connecting soon and offer to write the message or plan the call for them now.`;

const SYSTEM = `You are Sathi, the farm helper of the Khet Sathi app, for smallholder farmers. You speak as a woman
(in Hindi use feminine verb forms such as "मैं कर सकती हूँ"). get_plot_profile says where the farmer is;
only talk about crops, prices and money that fit that country (use its currency).
Your reply is read aloud, so keep it under 60 words (except the answer about what you can do), plain sentences, no lists or markdown.
Write numbers as digits with their unit or %, for example 77% or 32 days (the voice reads them); never spell numbers out in words.
Always reply in the same language the farmer used, in the everyday words a farmer there uses: in Bangla, plain spoken Bangladeshi Bangla
(পানি, not জল; ফসল কাটার সময়, not a word-for-word "harvest window"; no English words where a common Bangla word exists);
in Hindi, plain spoken Hindi with feminine verb forms for yourself.

If the farmer is only greeting you, checking you can hear them, or asking a simple question,
just answer briefly and use no tools.

If the farmer asks what to grow, what to buy, or for a plan, work through the whole plan before
replying, without asking questions first:
1. call get_plot_profile for the plot (real soil and weather),
2. call get_crop_windows and pick one of the crops it returns, preferring one whose sowing window is closing,
3. call check_input_prices for its seed and fertilizer,
4. call draft_order with sensible quantities for the land size they mentioned (assume 1 acre if not said).
Then say the crop and why in one sentence (soil, days left to sow, any rain warning), the draft order total,
and ask them to confirm or change it. Only recommend crops that get_crop_windows returned; if it returns none,
say there is no sowing calendar for this area yet and do not draft an order.
If get_plot_profile says the spot is not farmland (houses, roads or water), say so and do not suggest crops.
Orders, shop calls and payments in this app are demo simulations: never say money was paid.
Never tell the farmer to sow after a crop's sowing window closes. If rain is coming before the window
closes, say to sow before the rain if there is time, otherwise pick another crop from get_crop_windows.

Never place or pay for an order yourself: draft_order only creates a DRAFT the farmer must confirm.
Do not give medical, veterinary or pesticide-dosage advice.

If the farmer describes a problem with a crop, plant, soil or insects (for example yellow or curling leaves, spots, holes,
wilting, insects, rot), never guess the cause and never name a disease, pest or medicine. Call find_agri_office, then say in
one or two sentences that the agriculture office can look at it, name the nearest office and how far it is, and say the
hotline number if there is one. Say they can tap Call on the screen to phone them. Never say you have called the office.
If find_agri_office finds no office, give the hotline, or say to visit the nearest government agriculture office.

If the plot note says it is a home yard, it is the open space in front of the house, not a farm field: talk only about the
yard plants it lists (how many, when to sow, sun and water), never draft an order, and never suggest field crops for it.

If the plot note says no farm field was found, do not recommend crops or draft orders for that spot.
Say you could not see a farm field there and ask the farmer to stand in their field and add it again,
or to open the demo land.

${CAPABILITIES}`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_plot_profile',
      description: 'Get the real soil (texture, pH), topsoil moisture and rain forecast for the farmer plot.',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number' },
          lon: { type: 'number' },
        },
        required: ['lat', 'lon'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_crop_windows',
      description: 'Get the crops that can be sown on this plot now or within 10 days, with days left to sow and days to harvest (FAO crop calendar, filtered by soil).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sowing_calendar',
      description: 'Get the full FAO sowing and harvest calendar for the farmer zone: for every crop, the sowing window, the harvest window (when it comes to market) and whether it can be sown now. Use it for questions about when to sow or when a crop will be ready to sell.',
      parameters: { type: 'object', properties: { crop: { type: 'string', description: 'Optional English crop name to filter, e.g. "Mustard", "Potato"' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_input_prices',
      description: 'Look up current prices for seeds or fertilizer at nearby suppliers.',
      parameters: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' }, description: 'e.g. ["wheat seed HD-3086", "DAP fertilizer"]' },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_order',
      description: 'Create a DRAFT purchase order for the farmer to confirm. Does not buy anything.',
      parameters: {
        type: 'object',
        properties: {
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                item: { type: 'string' },
                quantity: { type: 'number' },
                unit: { type: 'string' },
                unit_price: { type: 'number', description: 'in the local currency from check_input_prices' },
              },
              required: ['item', 'quantity', 'unit'],
            },
          },
          note: { type: 'string' },
        },
        required: ['lines'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_agri_office',
      description: 'Find the nearest government agriculture offices to the farmer (from Google Maps) and the country farm hotline. Use it whenever the farmer describes a problem with a crop or plant.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// Prices and orders are DEMO data, labelled so they are never mistaken for real offers.
const handlers = {
  check_input_prices: ({ items = [] }, plan) => {
    if (plan && !plan.demoLand) return { error: 'No live price source yet for this real location. Do not quote any prices and do not draft an order. Say Sathi can look up nearby shops in the Market tab, and that calling shops is coming soon.' };
    const cur = plan?.currency || { code: 'INR', perUsd: 84 };
    return {
      demo_data: true,
      currency: cur.code,
      prices: items.map((item, i) => ({
        item,
        unit: /fertili|dap|urea|npk/i.test(item) ? '50 kg bag' : '1 kg',
        price: Math.round((/fertili|dap|urea|npk/i.test(item) ? 25 : 3 + i) * cur.perUsd),
        supplier: 'Demo seed shop (simulated)',
      })),
    };
  },
  draft_order: ({ lines = [], note = '' }, plan) => {
    if (plan && !plan.demoLand) return { error: 'Orders are not available for real locations yet (coming soon). Do not say an order was drafted.' };
    const total = lines.reduce((s, l) => s + (l.unit_price ?? l.unit_price_inr ?? 0) * (l.quantity || 0), 0);
    return {
      demo_data: true,
      status: 'DRAFT - awaiting farmer confirmation',
      order_id: `DRAFT-${Date.now().toString(36).toUpperCase()}`,
      lines,
      total,
      note,
    };
  },
};

// With no field found, the plot tools refuse instead of describing soil for a rooftop.
export function plotProfile({ lat, lon }, { noField = false, plan = null } = {}) {
  if (noField) return { lat, lon, error: 'No farm field was found at this location. Do not recommend crops for it.' };
  if (!plan) return { lat, lon, error: 'Plot data is unavailable right now.' };
  return profileForAgent(plan);
}

export function cropWindows({ noField = false, plan = null } = {}) {
  if (noField) return { crops: [], error: 'No farm field was found at this location.' };
  if (!plan) return { crops: [], error: 'Sowing calendar is unavailable right now.' };
  return windowsForAgent(plan);
}

// Full zone calendar for timing questions ("when do I sow X, when can I sell it?").
export function sowingCalendar({ crop } = {}, { plan = null } = {}) {
  const rows = plan?.calendar || [];
  if (!rows.length) return { rows: [], note: 'No crop calendar for this area yet.' };
  const q = String(crop || '').toLowerCase();
  const pick = q ? rows.filter((r) => r.faoName.toLowerCase().includes(q)) : rows;
  return {
    zone: plan.aez || 'this spot (FAOSTAT + GGCMI)',
    today: plan.today,
    rows: pick.slice(0, 12).map((r) => ({
      crop: r.faoName, season: r.season, status: r.status,
      sow_from_month_day: `${r.sow[0]}-${r.sow[1]}`, sow_until_month_day: `${r.sow[2]}-${r.sow[3]}`,
      harvest_from_month_day: `${r.harvest[0]}-${r.harvest[1]}`, harvest_until_month_day: `${r.harvest[2]}-${r.harvest[3]}`,
      days_left_to_sow: r.daysLeft, starts_in_days: r.daysUntil,
    })),
    source: plan.calendarSource,
  };
}

// v0.17.0: onStep reports each step as it happens (model turns and tools), for the live "Sathi at work" list.
// v0.19.0: where the numbers in each tool's answer come from, for the number check.
const TOOL_SOURCE = { get_plot_profile: 'field', get_crop_windows: 'calendar', get_sowing_calendar: 'calendar', find_agri_office: 'Google Places' };
function keySource(path, plan) {
  const k = path.join('.').toLowerCase();
  const cal = /fao/i.test(plan?.calendarSource || '') ? 'FAO crop calendar' : 'MIRCA-OS';
  if (/soil|ph\b|clay|sand|silt|texture|organic/.test(k)) return 'ISRIC SoilGrids';
  if (/rain|moist|weather|temp|chance|forecast/.test(k)) return 'Open-Meteo';
  if (/sow|window|calendar|harvest|season|days|month|status/.test(k)) return cal;
  if (/price|cost|total|profit|rupee|taka|amount/.test(k)) return 'sample prices';
  if (/km|distance|office|hotline|phone/.test(k)) return 'Google Places';
  if (/acre|hectare|area|size/.test(k)) return 'SAM 3.1';
  return null;
}

export async function runAgent({ userText, lat, lon, context = '', parts = null, noField = false, plan = null, cc = null, lang = 'en', maxSteps = 7, think = brainChat, offices = officeHelp, onStep = null }) {
  const report = (s) => {
    try {
      onStep?.({ ...s, at: Date.now() });
    } catch {}
  };
  const facts = [`lat ${lat}, lon ${lon}`, context].filter(Boolean).join('; ');
  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${userText}\n\n(Farmer's plot: ${facts})`,
    },
  ];
  const trace = [];
  const state = {}; // which model answers: Muse Spark Open on Baseten, or Muse Spark 1.3 after a fallback
  let brain = null;

  for (let step = 1; step <= maxSteps; step++) {
    report({ type: 'think', phase: 'start', step });
    const t0 = Date.now();
    const turn = await think({ messages, tools: TOOLS, maxTokens: 8000, effort: 'medium' }, state);
    const resp = turn.resp;
    report({ type: 'think', phase: 'done', step, ms: Date.now() - t0, tools: (resp.choices?.[0]?.message?.tool_calls || []).length, label: turn.label || null });
    brain = { provider: turn.provider, model: turn.model, label: turn.label, fallback: state.fallback || null };
    const msg = resp.choices?.[0]?.message;
    if (!msg) throw new Error('Empty response from Muse Spark');
    // Meta turns go back as they came (as before v0.9.0); Baseten turns keep only the standard fields.
    messages.push(turn.provider === 'meta' ? msg : { role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const { text, finishReason } = messageText(resp);
      if (!text) throw new Error(`Muse Spark returned no answer (finish_reason: ${finishReason || 'unknown'})`);
      trace.push({ step, type: 'answer', text });
      // v0.19.0: every number in the answer, checked against the data Sathi was given.
      const checks = checkNumbers(text, factsFrom({ parts: parts || (context ? [{ text: context, source: 'farm' }] : []), tools: trace.filter((x) => x.type === 'tool').map((x) => ({ output: x.output, source: TOOL_SOURCE[x.name] || null })), sourceForKey: (path) => keySource(path, plan) }));
      return { answer: text, trace, steps: step, finishReason, usage: resp.usage || null, brain, checks };
    }

    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      const name = call.function.name;
      const fn =
        name === 'get_plot_profile' ? (a) => plotProfile({ lat, lon, ...a }, { noField, plan })
        : name === 'get_crop_windows' ? () => cropWindows({ noField, plan })
        : name === 'get_sowing_calendar' ? (a) => sowingCalendar(a, { plan })
        : name === 'find_agri_office' ? () => offices({ lat, lon, cc: cc || plan?.place?.cc || null, lang })
        : handlers[name] && ((a) => handlers[name](a, plan));
      report({ type: 'tool', phase: 'start', name, step });
      const t1 = Date.now();
      const output = fn ? await Promise.resolve(fn(args)).catch((err) => ({ error: err.message || String(err) })) : { error: `unknown tool ${name}` };
      report({ type: 'tool', phase: 'done', name, step, ms: Date.now() - t1, ok: !output?.error });
      trace.push({ step, type: 'tool', name: call.function.name, args, output });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return { answer: null, trace, steps: maxSteps, note: 'Stopped at step limit', brain };
}
