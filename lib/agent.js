// Khet Saathi agent loop on Muse Spark with tool calling.
// v0.1.0: tools return clearly labelled DEMO data. Real soil, weather and
// marketplace sources replace them in later milestones.
import { chat } from './meta.js';

const SYSTEM = `You are Khet Saathi, a farming assistant for smallholder farmers in India and Bangladesh.
Plan with the tools provided. Never place or pay for an order yourself: use draft_order, which
creates a DRAFT the farmer must confirm. Reply to the farmer in the same language they used,
in short, simple sentences. Do not give medical, veterinary or pesticide-dosage advice.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_plot_profile',
      description: 'Get soil type, irrigation and current season for a farm plot by coordinates.',
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

// DEMO data, labelled so it is never mistaken for real advice in the demo video.
const handlers = {
  get_plot_profile: ({ lat, lon }) => ({
    demo_data: true,
    lat,
    lon,
    soil: 'alluvial loam',
    irrigation: 'tubewell',
    season: 'Rabi (Oct-Mar)',
    typical_crops: ['wheat', 'mustard', 'chickpea'],
  }),
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

export async function runAgent({ userText, lat, lon, maxSteps = 6 }) {
  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${userText}\n\n(Plot location: lat ${lat}, lon ${lon})`,
    },
  ];
  const trace = [];

  for (let step = 1; step <= maxSteps; step++) {
    const resp = await chat({ messages, tools: TOOLS });
    const msg = resp.choices?.[0]?.message;
    if (!msg) throw new Error('Empty response from Muse Spark');
    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      trace.push({ step, type: 'answer', text: msg.content });
      return { answer: msg.content, trace, steps: step, usage: resp.usage || null };
    }

    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      const fn = handlers[call.function.name];
      const output = fn ? fn(args) : { error: `unknown tool ${call.function.name}` };
      trace.push({ step, type: 'tool', name: call.function.name, args, output });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return { answer: null, trace, steps: maxSteps, note: 'Stopped at step limit' };
}
