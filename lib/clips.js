// Saved shed clips: the simulated shed camera. Each clip (the farmer's own video) is stored once
// in the private 'shed-clips' bucket with its frames; its last check result lives in index.json.
// One clip can be "today's camera": the alerts engine then raises that clip's warnings by itself.
import { putFile, getFile, deleteFiles, newId, isId, CLIP_BUCKET } from './store.js';

export const MAX_CLIPS = 5;
const INDEX = 'index.json';

// Storage serves a cached index.json for about 20 s after a save (seen live in v0.7.2), so the
// server keeps the index in memory and reads storage only once after a start. Railway runs one server.
let cache = null;
const copy = (i) => JSON.parse(JSON.stringify(i));

async function loadIndex() {
  const f = await getFile(INDEX, CLIP_BUCKET).catch(() => null);
  if (!f) return { clips: [], todayId: null };
  try {
    const j = JSON.parse(f.buffer.toString('utf8'));
    return { clips: Array.isArray(j.clips) ? j.clips : [], todayId: j.todayId || null };
  } catch {
    return { clips: [], todayId: null };
  }
}

export async function readIndex() {
  if (!cache) cache = await loadIndex();
  return copy(cache);
}

// Saves run one after another, so two quick saves can't overwrite each other.
let queue = Promise.resolve();
function update(change) {
  const run = queue.then(async () => {
    const index = await readIndex();
    const out = await change(index);
    await putFile(INDEX, Buffer.from(JSON.stringify(index)), 'application/json', CLIP_BUCKET, 'no-cache');
    cache = copy(index);
    return out;
  });
  queue = run.catch(() => null);
  return run;
}

// Tests only: forget the in-memory copy, as after a restart.
export function _resetCache() {
  cache = null;
}

const dataUrlBuffer = (d) => {
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(d || '');
  return m ? Buffer.from(m[1], 'base64') : null;
};

export async function createClip({ name, seconds, width, height, frames }) {
  if ((await readIndex()).clips.length >= MAX_CLIPS) throw new Error(`Up to ${MAX_CLIPS} clips can be saved; delete one first`);
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) throw new Error('Give the clip a name');
  const imgs = (frames || []).map(dataUrlBuffer).filter(Boolean).slice(0, 8);
  if (imgs.length < 2) throw new Error('Send at least 2 frames');
  const id = newId();
  for (let i = 0; i < imgs.length; i++) await putFile(`${id}/f${i}.jpg`, imgs[i], 'image/jpeg', CLIP_BUCKET);
  const clip = { id, name: clean, seconds: Math.round(Number(seconds) || 0), width: Number(width) || 1024, height: Number(height) || 576, frames: imgs.length, hasVideo: false, createdAt: new Date().toISOString(), result: null };
  return update((index) => {
    if (index.clips.length >= MAX_CLIPS) throw new Error(`Up to ${MAX_CLIPS} clips can be saved; delete one first`);
    index.clips.push(clip);
    return clip;
  });
}

const findIn = (index, id) => {
  const clip = index.clips.find((c) => c.id === id);
  if (!clip) throw new Error('Clip not found');
  return clip;
};

export async function putClipVideo(id, buffer, mime) {
  if (!isId(id)) throw new Error('Invalid clip id');
  findIn(await readIndex(), id);
  await putFile(`${id}/video.mp4`, buffer, mime === 'video/quicktime' ? 'video/quicktime' : 'video/mp4', CLIP_BUCKET);
  return update((index) => {
    const clip = findIn(index, id);
    clip.hasVideo = true;
    return clip;
  });
}

export async function clipFrames(clip) {
  const out = [];
  for (let i = 0; i < clip.frames; i++) {
    const f = await getFile(`${clip.id}/f${i}.jpg`, CLIP_BUCKET);
    if (f) out.push(`data:image/jpeg;base64,${f.buffer.toString('base64')}`);
  }
  return out;
}

export async function clipVideo(clip) {
  return clip.hasVideo ? getFile(`${clip.id}/video.mp4`, CLIP_BUCKET) : null;
}

export async function getClip(id) {
  if (!isId(id)) return null;
  return (await readIndex()).clips.find((c) => c.id === id) || null;
}

export async function saveResult(id, result) {
  return update((index) => {
    const clip = findIn(index, id);
    clip.result = { ...(clip.result || {}), ...result, checkedAt: new Date().toISOString() };
    return clip;
  });
}

export async function deleteClip(id) {
  const clip = findIn(await readIndex(), id);
  await update((index) => {
    index.clips = index.clips.filter((c) => c.id !== id);
    if (index.todayId === id) index.todayId = null;
  });
  const paths = [`${id}/video.mp4`, ...Array.from({ length: clip.frames }, (_, i) => `${id}/f${i}.jpg`)];
  await deleteFiles(paths, CLIP_BUCKET).catch(() => 0);
  return true;
}

export async function setToday(id) {
  return update((index) => {
    if (id) findIn(index, id);
    index.todayId = id || null;
    return copy(index);
  });
}

// Clip set as today's camera, with its saved result (null if none).
export async function todayCamera() {
  const index = await readIndex();
  return index.clips.find((c) => c.id === index.todayId) || null;
}
