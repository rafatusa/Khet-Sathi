// Khet Saathi agent loop on Muse Spark with tool calling.
// Tools return clearly labelled DEMO data. Real soil, weather and
// marketplace sources replace them in later milestones.
import { chat, messageText } from './meta.js';

const SYSTEM = `You are Khet Saathi, a farming assistant for smallholder farmers in India and Bangladesh.
Your reply is read aloud, so keep it under 60 words, plain sentences, no lists, symbols or markdown.
Always reply in the same language the farmer used.

If the farmer is only greeting you, checking you can hear them, or asking a simple question,
just answer briefly and use no tools.

If the farmer asks what to grow, what to buy, or for a plan, work through the whole plan before
replying, without asking questions first:
1. call get_plot_profile for the plot,
2. pick the best crop for the season and call check_input_prices for its seed and fertilizer,
3. call draft_order with sensible quantities for the land size they mentioned (assume 1 acre if not said).
Then say the crop and why in one sentence, the draft order total, and ask them to confirm or change it.

Never place or pay for an order yourself: draft_order only creates a DRAFT the farmer must confirm.
Do not give medical, veterinary or pesticide-dosage advice.`;

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
    const resp = await chat({ messages, tools: TOOLS, maxTokens: 8000, effort: 'medium' });
    const msg = resp.choices?.[0]?.message;
    if (!msg) throw new Error('Empty response from Muse Spark');
    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const { text, finishReason } = messageText(resp);
      if (!text) throw new Error(`Muse Spark returned no answer (finish_reason: ${finishReason || 'unknown'})`);
      trace.push({ step, type: 'answer', text });
      return { answer: text, trace, steps: step, finishReason, usage: resp.usage || null };
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
