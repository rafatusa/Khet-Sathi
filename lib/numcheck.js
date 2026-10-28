// v0.19.0: checks every number in Sathi's answer against the data she was given (the field, weather,
// satellite, calendar and tool results), each with its source. Plain code, no model call: a number found in
// the data is marked with where it came from; a number not found is marked as Sathi's own figure.

const D = '0-9০-৯०-९'; // Western, Bangla and Devanagari digits
const DATA_NUM = new RegExp(`(?<![${D}.])[${D}]+(?:\\.[${D}]+)?`, 'g');
const NUM = new RegExp(`(?<![${D}.,])(?:[${D}]{1,3}(?:,[${D}]{2,3})+|[${D}]+)(?:\\.[${D}]+)?`, 'g');
export const toAscii = (s) => String(s).replace(/[০-৯]/g, (d) => d.charCodeAt(0) - 0x09e6).replace(/[०-९]/g, (d) => d.charCodeAt(0) - 0x0966);
const parse = (raw) => Number(toAscii(raw).replace(/,/g, ''));
const decimals = (raw) => (toAscii(raw).split('.')[1] || '').length;

// A day of the month as written in an answer: "29 Oct", "২৯ অক্টোবর", "२९ अक्टूबर".
const MONTH = /^\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|জানু|ফেব্রু|মার্চ|এপ্রি|মে|জুন|জুলা|জুল|আগ|সেপ্টে|অক্টো|নভে|ডিসে|जन|फ़र|फर|मार्च|अप्रै|मई|जून|जुला|अग|सित|अक्टू|नव|दिस)/i;
const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:T[0-9:.]+Z?)?\b/g;

// Every number in a piece of text, with where it sits. Dates in the data ("2026-10-29") give one fact:
// the day, marked as a date, so a date matches only a date and the 10 in a month never matches "10 kg".
export function numbersIn(text, { data = false } = {}) {
  const out = [];
  let str = String(text || '');
  if (data) {
    for (const m of str.matchAll(ISO)) out.push({ raw: m[3], i: m.index, value: Number(m[3]), dec: 0, date: true });
    str = str.replace(ISO, (m) => ' '.repeat(m.length));
  }
  // Data (JSON, context lines) has no thousands commas, so "12.4,70" is two numbers there.
  for (const m of str.matchAll(data ? DATA_NUM : NUM)) {
    const after = str.slice(m.index + m[0].length, m.index + m[0].length + 12);
    out.push({ raw: m[0], i: m.index, value: parse(m[0]), dec: decimals(m[0]), date: !data && MONTH.test(after) });
  }
  return out;
}

// Numbers worth checking: 10 and up, any decimal, or a percent. Years, phone-length numbers and list
// markers ("1.") are left alone.
export function worthChecking(n, text) {
  if (!Number.isFinite(n.value)) return false;
  if (n.date) return true;
  const after = String(text).slice(n.i + n.raw.length, n.i + n.raw.length + 2);
  if (/^\.\s/.test(after) && n.dec === 0 && n.value < 20) return false;
  if (toAscii(n.raw).replace(/[^0-9]/g, '').length >= 7) return false;
  if (n.dec === 0 && n.value >= 1900 && n.value <= 2100) return false;
  return n.dec > 0 || n.value >= 10 || /^\s?%/.test(after);
}

// Facts: [{ value, source }] from a list of { text, source } and from tool results.
const SKIP_KEY = /^(lat|lon|latitude|longitude|id|place_id|contact_id|step|tool_call_id)$/i;
export function factsFrom({ parts = [], tools = [], sourceForKey = () => null } = {}) {
  const facts = [];
  for (const p of parts) for (const n of numbersIn(p.text, { data: true })) facts.push({ value: n.value, date: n.date, source: p.source });
  const walk = (v, path, fallback) => {
    if (v == null) return;
    if (typeof v === 'number') return Number.isFinite(v) && facts.push({ value: v, date: false, source: sourceForKey(path) || fallback });
    if (typeof v === 'string') return numbersIn(v, { data: true }).forEach((n) => facts.push({ value: n.value, date: n.date, source: sourceForKey(path) || fallback }));
    if (Array.isArray(v)) return v.forEach((x) => walk(x, path, fallback));
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!SKIP_KEY.test(k)) walk(x, [...path, k], fallback);
  };
  for (const t of tools) walk(t.output, [], t.source);
  return facts.filter((f) => f.source);
}

// A number in the answer matches a fact when the fact, rounded to the answer's decimals, is that number.
const matches = (n, f) => {
  if (Boolean(n.date) !== Boolean(f.date)) return false;
  const r = Math.round(f.value * 10 ** n.dec) / 10 ** n.dec;
  return Math.abs(r - n.value) < 1e-9 || Math.abs(f.value - n.value) < 1e-9;
};

export function checkNumbers(answer, facts) {
  const numbers = numbersIn(answer)
    .filter((n) => worthChecking(n, answer))
    .map((n) => {
      const f = facts.find((x) => matches(n, x));
      return { raw: n.raw, i: n.i, len: n.raw.length, value: n.value, source: f?.source || null };
    });
  const sources = [...new Set(numbers.map((n) => n.source).filter(Boolean))];
  return { numbers, sources, matched: numbers.filter((n) => n.source).length, total: numbers.length };
}
