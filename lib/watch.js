// v0.22.0: Sathi on watch. When the alert engine raises something worth acting on (birds that have not
// moved, a hot shed, a dry field), Sathi wakes up by herself: Muse Spark looks closer with tools, decides,
// does the safe steps, schedules a second look, and asks the farmer only for what is theirs (calling the vet,
// sending a summary to the agriculture office). Every step is kept as a log the farmer sees on Home.
//
// Safety: she never names a disease or medicine (safeText drops such sentences), never contacts a real person
// herself (calls and sends always wait for the farmer's tap), and the farmer's setting limits what she does:
// tell = look and tell only; ask = act, ask before calls and money (default); rules = act within the farmer's
// own rules (selling, later releases).
import { brainChat } from './brain.js';
import { messageText } from './meta.js';
import { safeText } from './poultry.js';

// Alert titles that wake Sathi, and which place they belong to.
export const TRIGGERS = {
  watch_round: 'shed', // the admin's "Wake Sathi now" in the demo farm when nothing is wrong
  birds_still: 'shed', sound_unusual: 'shed', shed_hot: 'shed', shed_cold: 'shed', shed_ammonia: 'shed', shed_water: 'shed', shed_feed: 'shed', heat_coming: 'shed', cold_night: 'shed',
  soil_dry: 'field', fungus_watch: 'field', sow_closing: 'field', patch_rising: 'field', crop_ripening: 'field', animal_in_field: 'field',
};
export const MODES = ['tell', 'ask', 'rules'];
export const DEFAULT_MODE = 'ask';
export const ACTIONS = ['call_vet', 'send_office_summary', 'check_yourself', 'plan_harvest'];
const MAX_TURNS = 6; // model turns in one run
const MAX_RUNS = 3; // a mission looks again at most twice
const LATER = { min: 10, max: 180 };
const MINUTE_MS = Number(process.env.WATCH_MINUTE_MS) || 60000; // tests shorten the wait for a second look

export const watchSystem = (mode) => `You are Sathi, a farm helper for smallholder farmers, now on watch by yourself. Something on the farm changed and woke you up. Look closer with your tools, decide what it means for the farmer, and act.
Rules:
- Every tool call has "why": one short plain sentence in English saying what you think and why you take this step. The farmer reads it.
- Never name a disease, an illness, a cause of illness, a medicine, a spray or a dose. Describe only what you see and measure. Animal health goes to the vet; a crop problem goes to the agriculture office.
- Never contact a real person yourself. ${mode === 'tell' ? 'In this farm\'s setting you only look and tell the farmer; you do not ask to call anyone.' : 'To call the vet or send a summary to the agriculture office, use ask_farmer; the farmer decides with one tap.'}
- If it may be passing (a shadow, a short heat spike, hens resting), use check_again_later instead of alarming the farmer.
- A crop turning yellow or golden evenly late in its season, with grain heads, is ripening, not a problem: check the season (look_at_field) and the camera's evenness and grain heads. Then tell the farmer when the harvest window starts and ask with plan_harvest. A patchy yellow or spots while the crop should be green, or patches on the green leaves left late in the season, still go to the agriculture office.
- When the field camera reads ripening (looksLike ripening) and the warmth since sowing is 80% or more, trust the camera and the warmth over the regional calendar date (an average for the area) and over a satellite pass several days old: the camera is closer and newer. Grain heads are often too small for the camera to count; their absence alone is no reason to doubt.
- Animals in the field: tell the farmer what the camera saw and when; ask check_yourself.
- Say clock times in the farmer's local time, as given to you (for example 18:30), never in UTC. Do not use long dashes.
- Data marked simulated comes from the demo sensor kit or a saved demo video; you may use it, it is labelled for the farmer. Demo camera frames stand in for a real camera: treat them as what the camera saw, and say they are demo when you tell the farmer.
- Plain farmer words: say chickens or hens, never birds. Write temperatures like 37°C and humidity like 83%, rounded. Never quote raw scores such as evenness 0.25; say it in words (evenly yellow, patchy). Write dates like 30 Oct, never 2026-10-30.
- Your question in ask_farmer is one short sentence (at most 25 words); put the details in tell_farmer.
- Finish with tell_farmer: two short sentences on what you saw and what happens next. Then answer with one word: done.`;

const why = { why: { type: 'string', description: 'One short plain sentence: what you think and why you take this step.' } };
const fn = (name, description, props = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: { ...why, ...props }, required: ['why', ...required] } } });
export function watchTools(kind, mode) {
  const tools = [];
  if (kind === 'shed') {
    tools.push(fn('look_at_shed', 'The shed now: temperature, humidity, ammonia, water, feed and eggs (demo sensor kit), and the last camera check (birds counted, birds that have not moved, unusual sound).'));
    tools.push(fn('look_at_camera_again', 'Runs a fresh camera check now: SAM 3.1 counts the birds again and finds the ones that have not moved. Takes about a minute.'));
  }
  if (kind === 'field') {
    tools.push(fn('look_at_field', 'The field now: crop, greenness from the Sentinel-2 satellite and its trend, soil moisture.'));
    tools.push(fn('look_at_field_camera', 'The field camera: its recent looks at one patch (SAM 3.1 outlines the crop; the share of it that is yellow or brown is counted by colour), how evenly it is spread, and whether it is rising.'));
  }
  tools.push(fn('look_at_weather', 'Weather for the next 3 days at this place (Open-Meteo).'));
  tools.push(fn('check_again_later', 'Pause and look again after some minutes, to see if it passes.', { minutes: { type: 'integer', minimum: LATER.min, maximum: LATER.max } }, ['minutes']));
  tools.push(fn('tell_farmer', 'Tell the farmer something in two short sentences.', { message: { type: 'string' } }, ['message']));
  if (mode !== 'tell')
    tools.push(fn('ask_farmer', 'Ask the farmer to decide one action. call_vet: call the vet (the farmer taps). send_office_summary: send a summary to the agriculture office. check_yourself: the farmer looks in person. plan_harvest: open the harvest steps (booking and selling).', { action: { type: 'string', enum: ACTIONS }, question: { type: 'string', description: 'One short question to the farmer, at most 25 words. The details go in tell_farmer.' } }, ['action', 'question']));
  return tools;
}

// One clean line from the model, or nothing (too long, empty, or naming a disease or medicine).
export function cleanLine(s, max = 280) {
  const t = safeText(String(s || '').replace(/["“”]/g, '').replace(/\s*[—–]\s*/g, ', ').trim());
  if (t.length <= max) return t;
  // v0.25.2: too long: end at the last full sentence that fits, never in the middle of one.
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('।'));
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).trim()}…`;
}

// Short facts from tool outputs, written by code (not the model), shown as "Saw" lines.
export function sawLine(name, out) {
  if (!out || out.error) return { key: 'wtSawFailed', vars: { what: name } };
  if (name === 'look_at_shed' || name === 'look_at_camera_again') {
    const c = out.camera || {};
    return { key: name === 'look_at_shed' ? 'wtSawShed' : 'wtSawCamera', vars: { temp: out.temp ?? '-', humidity: out.humidity ?? '-', ammonia: out.ammonia ?? '-', birds: c.birds ?? '-', still: c.still ?? 0 }, simulated: Boolean(out.simulated || c.simulated) };
  }
  if (name === 'look_at_weather') {
    const d = (out.days || [])[1] || (out.days || [])[0] || {};
    return { key: 'wtSawWeather', vars: { max: d.tMax ?? '-', min: d.tMin ?? '-', rain: d.rainChance ?? 0 } };
  }
  if (name === 'look_at_field_camera') return { key: out.looksLike === 'ripening' ? 'wtSawFieldCamRipe' : 'wtSawFieldCam', vars: { now: out.now ?? '-', from: out.from ?? '-', looks: out.looks ?? 0, heads: out.grainHeads ?? 0 }, simulated: Boolean(out.demo) };
  if (name === 'look_at_field') return { key: out.season?.stage ? 'wtSawFieldStage' : 'wtSawField', vars: { ndvi: out.ndvi ?? '-', trend: out.trend ?? '-', moisture: out.moisture ?? '-', stage: out.season?.stage || '', days: out.season?.daysToHarvest ?? '-', heat: out.season?.warmthSinceSowing?.pct ?? '-' }, simulated: Boolean(out.simulated) };
  return null;
}

const nowIso = (now) => new Date(now()).toISOString();
// v0.25.1: the model saw UTC stamps and told the farmer "12:30 UTC". It now gets local clock times.
export const WATCH_TZ = process.env.WATCH_TZ || 'Asia/Dhaka';
export function localStamp(t) {
  try {
    // v0.27.1: "29 Oct 18:30" so the farmer never reads an ISO date the model copied.
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: WATCH_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.day} ${p.month} ${p.hour}:${p.minute}`;
  } catch {
    return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  }
}
const localFacts = (f) => JSON.stringify(f || {}, (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) ? localStamp(v) : v));

// Runs (or resumes) one mission. deps: tools by name (async (args, mission) => output), think, now.
// The mission keeps its Muse conversation so a second look continues the same thinking.
export async function runMission(mission, { tools, think = brainChat, now = Date.now, translate = null } = {}) {
  const m = { ...mission, steps: [...(mission.steps || [])], messages: [...(mission.messages || [])] };
  const step = (s) => m.steps.push({ at: nowIso(now), ...s });
  m.runs = (m.runs || 0) + 1;
  if (!m.messages.length) {
    m.messages.push({ role: 'system', content: watchSystem(m.mode) });
    m.messages.push({ role: 'user', content: `What woke you: ${m.trigger} (${localFacts(m.facts)}). Place: ${m.place_kind}. Farmer's setting: ${m.mode}. Local time now ${localStamp(now())} (${WATCH_TZ}).` });
  } else {
    m.messages.push({ role: 'user', content: `It is now ${localStamp(now())} local time, the time you asked to look again. Look again and decide.` });
  }
  const toolDefs = watchTools(m.place_kind, m.mode);
  const allowed = new Set(toolDefs.map((t) => t.function.name));
  const state = {};
  let ended = null;
  for (let turn = 1; turn <= MAX_TURNS && !ended; turn++) {
    const r = await think({ messages: m.messages, tools: toolDefs, maxTokens: 4000, effort: 'low' }, state);
    m.model = r.label || m.model || null;
    const msg = r.resp?.choices?.[0]?.message;
    if (!msg) throw new Error('Empty response from Muse Spark');
    m.messages.push(r.provider === 'meta' ? msg : { role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      ended = 'done';
      break;
    }
    for (const call of calls) {
      const name = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {}
      const thought = cleanLine(args.why);
      if (thought) step({ kind: 'thought', text: { en: thought } });
      let out;
      if (!allowed.has(name)) out = { error: `not allowed: ${name}` };
      else if (name === 'check_again_later') {
        const mins = Math.max(LATER.min, Math.min(LATER.max, Number(args.minutes) || 30));
        if (m.runs >= MAX_RUNS) out = { error: 'You already looked again twice. Decide now.' };
        else {
          m.due_at = new Date(now() + mins * MINUTE_MS).toISOString();
          step({ kind: 'did', key: 'wtDidLater', vars: { at: m.due_at } });
          ended = 'sleeping';
          out = { ok: true, at: m.due_at };
        }
      } else if (name === 'tell_farmer') {
        const text = cleanLine(args.message, 400);
        if (text) step({ kind: 'did', key: 'wtDidTold', text: { en: text } });
        out = { ok: Boolean(text) };
      } else if (name === 'ask_farmer') {
        const action = ACTIONS.includes(args.action) ? args.action : null;
        const q = cleanLine(args.question, 300);
        if (!action || !q) out = { error: 'action and question are needed' };
        else {
          step({ kind: 'wait', action, text: { en: q }, status: 'open' });
          ended = 'waiting';
          out = { ok: true, note: 'The farmer will decide. Now tell the farmer, then finish.' };
        }
      } else {
        out = await Promise.resolve(tools[name]?.(args, m)).catch((err) => ({ error: err.message || String(err) }));
        const saw = sawLine(name, out);
        if (saw) step({ kind: 'saw', ...saw });
      }
      m.messages.push({ role: 'tool', tool_call_id: call.id, content: localFacts(out ?? { ok: true }) });
    }
    // After asking the farmer or scheduling a second look, give the model one turn to tell the farmer, then stop.
    const toldAfter = () => { const i = m.steps.map((x) => x.kind).lastIndexOf('wait'); const j = m.steps.findLastIndex((x) => x.key === 'wtDidLater'); const from = Math.max(i, j); return from >= 0 && m.steps.slice(from).some((x) => x.key === 'wtDidTold'); };
    if (ended && ended !== 'done' && turn < MAX_TURNS && !toldAfter()) {
      const tail = await think({ messages: m.messages, tools: toolDefs.filter((t) => t.function.name === 'tell_farmer'), maxTokens: 2000, effort: 'low' }, state).catch(() => null);
      const tmsg = tail?.resp?.choices?.[0]?.message;
      for (const call of tmsg?.tool_calls || []) {
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || '{}');
        } catch {}
        const text = cleanLine(args.message, 400);
        if (call.function?.name === 'tell_farmer' && text) step({ kind: 'did', key: 'wtDidTold', text: { en: text } });
      }
      if (tmsg) {
        m.messages.push(tmsg);
        for (const call of tmsg.tool_calls || []) m.messages.push({ role: 'tool', tool_call_id: call.id, content: '{"ok":true}' });
      }
    }
  }
  m.status = ended === 'sleeping' ? 'sleeping' : m.steps.some((s) => s.kind === 'wait' && s.status === 'open') ? 'waiting' : 'done';
  if (m.status !== 'sleeping') m.due_at = null;
  m.updated_at = nowIso(now);
  if (translate) await translate(m.steps).catch(() => null);
  return m;
}

// The model's own lines in Bangla and Hindi too (one call per run); lines already translated are skipped.
// v0.26.0: live, a shed mission stayed in English when the one translation call came back unusable. Two tries,
// and the server fills in what is still missing when the log is opened (fillTranslations).
export async function translateSteps(steps, { think = brainChat, tries = 2 } = {}) {
  const todo = steps.filter((s) => s.text?.en && !(s.text.bn && s.text.hi));
  if (!todo.length) return steps;
  const prompt = `Translate each English line into Bangla (bn, the everyday spoken Bangla of Bangladesh: পানি not জল, no word-for-word copies of English phrases) and Hindi (hi, everyday spoken Hindi; Sathi is a woman, so feminine verb forms for her) for a farmer: plain words, the same meaning, numbers as digits, no added advice, no disease or medicine names, no quotes. Use these words: chickens or hens = মুরগি / मुर्गियाँ (never पक्षी), agriculture office = কৃষি অফিস / कृषि कार्यालय, vet = পশু ডাক্তার / पशु डॉक्टर, temperature as 37°C. Answer only JSON: [{"bn":"...","hi":"..."}, ...] in the same order.\n${JSON.stringify(todo.map((s) => s.text.en))}`;
  let arr = null;
  for (let i = 0; i < tries && !arr; i++) {
    const r = await think({ messages: [{ role: 'user', content: prompt }], maxTokens: 3000, effort: 'low' }).catch(() => null);
    const raw = r ? messageText(r.resp).text || '' : '';
    const m = raw.match(/\[[\s\S]*\]/);
    try {
      const a = m ? JSON.parse(m[0]) : null;
      if (Array.isArray(a) && a.length) arr = a;
    } catch {
      arr = null;
    }
  }
  if (!arr) return steps;
  todo.forEach((s, i) => {
    const bn = cleanLine(arr[i]?.bn, 500);
    const hi = cleanLine(arr[i]?.hi, 500);
    if (bn) s.text.bn = bn;
    if (hi) s.text.hi = hi;
  });
  return steps;
}

export const needsTranslation = (m) => (m?.steps || []).some((s) => s.text?.en && !(s.text.bn && s.text.hi));

// A new mission from an alert row (null when the alert does not wake Sathi).
export function missionFrom(alert, { mode = DEFAULT_MODE, now = Date.now, id } = {}) {
  const kind = TRIGGERS[alert?.title];
  if (!kind) return null;
  let facts = {};
  try {
    facts = typeof alert.body === 'string' ? JSON.parse(alert.body || '{}') : alert.body || {};
  } catch {}
  return {
    id,
    owner_id: alert.owner_id || null,
    place_kind: kind,
    place_id: kind === 'field' ? alert.land_id || null : null,
    trigger: alert.title,
    facts,
    mode: MODES.includes(mode) ? mode : DEFAULT_MODE,
    status: 'running',
    runs: 0,
    created_at: nowIso(now),
    updated_at: nowIso(now),
    due_at: null,
    steps: [{ at: nowIso(now), kind: 'saw', key: 'wtSawAlert', alert: { title: alert.title, body: JSON.stringify(facts) }, source: alert.source || null }],
    messages: [],
  };
}

// The farmer's tap on a waiting step. Returns the updated mission and what the screen should open.
export function decide(mission, choice, { now = Date.now } = {}) {
  const m = { ...mission, steps: mission.steps.map((s) => ({ ...s })) };
  const w = [...m.steps].reverse().find((s) => s.kind === 'wait' && s.status === 'open');
  if (!w) return { mission: m, open: null };
  w.status = choice === 'yes' ? 'yes' : 'no';
  w.decided_at = nowIso(now);
  m.steps.push({ at: nowIso(now), kind: 'did', key: choice === 'yes' ? 'wtDidYes' : 'wtDidNo', vars: { action: w.action } });
  m.status = 'done';
  m.updated_at = nowIso(now);
  return { mission: m, open: choice === 'yes' ? w.action : null };
}

// v0.27.1: a question nobody answered for WAIT_HOURS closes itself, so an old "call the vet?" does not
// sit on Home for half a day. Returns null when nothing changed.
export const WAIT_HOURS = 6;
export function expireStale(mission, { now = Date.now, hours = WAIT_HOURS } = {}) {
  if (mission?.status !== 'waiting') return null;
  const w = [...(mission.steps || [])].reverse().find((s) => s.kind === 'wait' && s.status === 'open');
  if (!w || now() - new Date(w.at).getTime() < hours * 3600 * 1000) return null;
  const steps = mission.steps.map((s) => (s === w ? { ...s, status: 'expired' } : { ...s }));
  steps.push({ at: nowIso(now), kind: 'did', key: 'wtDidExpired', vars: { hours } });
  return { ...mission, steps, status: 'done', due_at: null, updated_at: nowIso(now) };
}

// What the browser gets: no Muse conversation, just the log.
export const missionView = (m) => (m ? { id: m.id, place_kind: m.place_kind, place_id: m.place_id, trigger: m.trigger, status: m.status, mode: m.mode, model: m.model || null, due_at: m.due_at, created_at: m.created_at, updated_at: m.updated_at, steps: m.steps } : null);
