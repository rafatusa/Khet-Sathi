// Khet Saathi agent loop on Muse Spark with tool calling.
// get_plot_profile and get_crop_windows return REAL data (SoilGrids, Open-Meteo, FAO).
// check_input_prices and draft_order still return clearly labelled DEMO data.
import { messageText } from './meta.js';
import { brainChat } from './brain.js';
import { profileForAgent, windowsForAgent } from './plan.js';

const SYSTEM = `You are Khet Saathi, a farming assistant for smallholder farmers in India and Bangladesh.
Your reply is read aloud, so keep it under 60 words, plain sentences, no lists, symbols or markdown.
Always reply in the same language the farmer used.

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

Never place or pay for an order yourself: draft_order only creates a DRAFT the farmer must confirm.
Do not give medical, veterinary or pesticide-dosage advice.

If the plot note says no farm field was found, do not recommend crops or draft orders for that spot.
Say you could not see a farm field there and ask the farmer to stand in their field and add it again,
or to open the demo land.`;

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
                unit_price_inr: { type: 'number' },
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
];

// Prices and orders are DEMO data, labelled so they are never mistaken for real offers.
const handlers = {
  check_input_prices: ({ items = [] }) => ({
    demo_data: true,
    prices: items.map((item, i) => ({
      item,
      unit: /fertili|dap|urea/i.test(item) ? '50 kg bag' : '40 kg bag',
      price_inr: 1200 + i * 150,
      supplier: 'Demo Krishi Kendra',
    })),
  }),
  draft_order: ({ lines = [], note = '' }) => {
    const total = lines.reduce((s, l) => s + (l.unit_price_inr || 0) * (l.quantity || 0), 0);
    return {
      demo_data: true,
      status: 'DRAFT - awaiting farmer confirmation',
      order_id: `DRAFT-${Date.now().toString(36).toUpperCase()}`,
      lines,
      total_inr: total,
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
  if (!plan?.aez) return { rows: [], note: 'No FAO sowing calendar for this area yet.' };
  const q = String(crop || '').toLowerCase();
  const pick = q ? rows.filter((r) => r.faoName.toLowerCase().includes(q)) : rows;
  return {
    zone: plan.aez,
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

export async function runAgent({ userText, lat, lon, context = '', noField = false, plan = null, maxSteps = 7, think = brainChat }) {
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
    const turn = await think({ messages, tools: TOOLS, maxTokens: 8000, effort: 'medium' }, state);
    const resp = turn.resp;
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
      return { answer: text, trace, steps: step, finishReason, usage: resp.usage || null, brain };
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
        : handlers[name];
      const output = fn ? fn(args) : { error: `unknown tool ${name}` };
      trace.push({ step, type: 'tool', name: call.function.name, args, output });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return { answer: null, trace, steps: maxSteps, note: 'Stopped at step limit', brain };
}
