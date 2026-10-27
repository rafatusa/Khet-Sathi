// Poultry shed: count birds with SAM 3.1, flag birds that hardly move, and let Muse Spark 1.2
// watch the video (with its sound) or listen to a sound clip.
// SAFETY (hackathon rules + farmer safety): never name a disease or a medicine. Warning signs
// only ever lead to "isolate these birds and call the vet".
import { dropBlobs } from './plot.js';
import { MODEL_SIGNS } from './vetcall.js';

export const MAX_FRAMES = 8;
const STILL_SHARE = 0.015; // moved less than 1.5% of the picture width over the clip
const MATCH_SHARE = 0.06; // a bird in the next frame within 6% of the width is the same bird

const centre = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

// frames: [{ width, objects: [{ box }] }] in time order. Returns count and still birds (last-frame boxes).
export function analyseFrames(frames) {
  const usable = frames.filter((f) => f && Array.isArray(f.objects));
  if (!usable.length) return { count: 0, perFrame: [], still: [], frames: 0 };
  const perFrame = usable.map((f) => f.objects.length);
  const width = usable[0].width || 1024;
  const match = MATCH_SHARE * width;
  // Follow each bird of the first frame through the clip by nearest centre.
  const tracks = usable[0].objects.map((o) => ({ points: [centre(o.box)], box: o.box, seen: 1 }));
  for (let i = 1; i < usable.length; i++) {
    const pool = usable[i].objects.map((o) => ({ c: centre(o.box), box: o.box, used: false }));
    for (const t of tracks) {
      const last = t.points[t.points.length - 1];
      let best = null;
      let bestD = Infinity;
      for (const p of pool) {
        if (p.used) continue;
        const d = Math.hypot(p.c.x - last.x, p.c.y - last.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best && bestD <= match) {
        best.used = true;
        t.points.push(best.c);
        t.box = best.box;
        t.seen++;
      }
    }
  }
  const minSeen = Math.max(2, Math.ceil(usable.length * 0.7));
  const still = usable.length < 3 ? [] : tracks
    .filter((t) => t.seen >= minSeen)
    .filter((t) => {
      const xs = t.points.map((p) => p.x);
      const ys = t.points.map((p) => p.y);
      return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < STILL_SHARE * width;
    })
    .map((t) => t.box);
  return { count: median(perFrame), perFrame, still, frames: usable.length };
}

export function framesFromSegments(segs, width) {
  return segs.map((s) => ({ width, objects: dropBlobs(s.objects || [], width, 0.25) }));
}

// Words that must never reach the farmer from the model (disease and medicine names).
const BLOCK = /(newcastle|ranikhet|রানীক্ষেত|রানিক্ষেত|रानीखेत|avian influenza|bird flu|বার্ড ফ্লু|बर्ड फ्लू|h5n1|gumboro|গামবোরো|coccidi|ককসিডি|marek|salmonell|mycoplasma|bronchitis|cholera|কলেরা|pox|বসন্ত|disease|রোগ|बीमारी|infect|সংক্রম|संक्रम|antibiotic|অ্যান্টিবায়োটিক|एंटीबायोटिक|vaccine|টিকা|टीका|medicine|ওষুধ|दवा|dose|ডোজ|खुराक|tablet|injection)/i;

// Keeps only sentences free of disease or medicine words.
export function safeText(text) {
  const sentences = String(text || '').split(/(?<=[.!?।])\s+/);
  return sentences.filter((s) => s.trim() && !BLOCK.test(s)).join(' ').trim();
}

export const SAFE_VET_LINE = {
  bn: 'এদের আলাদা জায়গায় রাখুন আর পশু ডাক্তারকে ফোন করুন।',
  hi: 'इन्हें अलग रखें और पशु डॉक्टर को फ़ोन करें।',
  en: 'Keep these chickens apart and call the vet.',
};

const LANG_NAME = { bn: 'Bangla', hi: 'Hindi', en: 'English' };

export function observePrompt(lang = 'bn', { withVideo = true } = {}) {
  return `You are watching a ${withVideo ? 'short video from a small poultry shed, including its sound' : 'short sound recording from a small poultry shed'}.
Report only what you can see or hear. Do NOT name any disease, illness, infection or medicine, and do not guess causes.
Reply with JSON only, no other text:
{"heard_audio": true or false (did you receive any sound at all),
 "unusual_sound": true or false (coughing, sneezing, gasping or rattling sounds from birds),
 ${withVideo ? '"crowding": true or false, "birds_at_feeder_or_water": "few" | "some" | "many", "spilled_water_or_wet_litter": true or false,' : ''}
 "signs": a list with only the codes below that you clearly ${withVideo ? 'see or hear' : 'hear'}, or [] if none. Leave a code out when unsure:
   ${withVideo ? '"off_feed" (birds staying away from feed and water), "crowding" (birds huddled tightly together), "twisted_neck" (a bird with its head or neck twisted), "wet_litter" (wet floor bedding), "swollen_face" (swollen eyes or face), "weak" (birds drowsy, drooping or unable to stand), ' : ''}"breathing" (coughing, sneezing, gasping or rattling sounds),
 "note": "one short sentence in ${LANG_NAME[lang] || 'Bangla'} for the farmer, plain words, what you noticed${lang === 'en' ? ' (say chickens, not birds)' : ''}",
 "vet_summary": "one or two short sentences in ${LANG_NAME[lang] || 'Bangla'} describing only what was seen and heard, for the farmer to read to a vet"}`;
}

// Parses the model's JSON reply and makes every text field safe.
export function parseObservation(text) {
  let j = null;
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (m) {
    try {
      j = JSON.parse(m[0]);
    } catch {
      j = null;
    }
  }
  if (!j) return { ok: false, raw: String(text || '').slice(0, 300) };
  return {
    ok: true,
    heardAudio: j.heard_audio === true,
    unusualSound: j.unusual_sound === true,
    crowding: j.crowding === true,
    atFeeder: ['few', 'some', 'many'].includes(j.birds_at_feeder_or_water) ? j.birds_at_feeder_or_water : null,
    wetLitter: j.spilled_water_or_wet_litter === true,
    signs: [...new Set((Array.isArray(j.signs) ? j.signs : []).filter((x) => MODEL_SIGNS.includes(x)))],
    note: safeText(j.note),
    vetSummary: safeText(j.vet_summary),
  };
}
