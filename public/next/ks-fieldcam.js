// v0.23.0: the field camera card on a field's Home. Shows the latest look at the watched patch with SAM 3.1's
// crop outline (dashed) and, since v0.25.1, the squares that are mostly yellow or brown (counted by colour), how the share has moved, and every look in a popup.
// A farm can add a look (a photo of the same patch); an admin can load saved demo frames into the demo field,
// or (v0.25.0) play a demo story whose frames ship with the site.
// When the share keeps rising, the server raises patch_rising and Sathi takes it from there (ks-watch.js).
(() => {
  const K = window.KS;
  if (!K) return;
  const { $, t, fmt, esc, num, S, api, postJson, toast, fd } = K;
  const C = { landId: null, looks: [], trend: null, busy: '', show: null };
  let P = null; // v0.27.0: the story being played
  const L = () => K.lang();
  const hhmm = (iso) => {
    try {
      return new Intl.DateTimeFormat(L() === 'en' ? 'en-GB' : L() === 'hi' ? 'hi-IN' : 'bn-BD', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    } catch {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  };
  const maskPath = (o, cls) => {
    const sx = (o.bounds.right - o.bounds.left) / (o.mw || 1);
    const sy = (o.bounds.bottom - o.bounds.top) / (o.mh || 1);
    return `<g transform="translate(${o.bounds.left} ${o.bounds.top}) scale(${sx} ${sy})"><path d="${esc(o.svgPath)}" class="${cls}"/></g>`;
  };
  const imgUrl = (l) => K.imgUrl(l.photoUrl);
  // v0.25.0: the demo stories. AI-generated frames of one fixed camera on the demo rice field (public/demo/fieldcam).
  const frames = (name, n) => Array.from({ length: n }, (_, i) => `/demo/fieldcam/${name}-${i + 1}.jpg`);
  const STORIES = { patch: { files: frames('problem', 6) }, ripe: { files: frames('ripe', 6) }, goats: { files: ['/demo/fieldcam/goats.jpg'], motion: true } };
  function frameHtml(l, { badge = true } = {}) {
    const W = l.width || 1024;
    const H = l.height || 768;
    const m = l.measure || {};
    if (l.motion) {
      const boxes = (l.animals || []).map((a) => `<g><rect x="${a.box.left}" y="${a.box.top}" width="${a.box.right - a.box.left}" height="${a.box.bottom - a.box.top}" class="fcbox"/><text x="${a.box.left + 6}" y="${Math.max(18, a.box.top - 6)}" class="fcboxt">${esc(t(`fcKind_${a.kind}`))}</text></g>`).join('');
      return `<div class="ydframe" style="aspect-ratio:${W}/${H};width:min(100%, ${Math.round((360 * W) / H)}px)"><img src="${esc(imgUrl(l))}" alt="${esc(t('fcMotionH'))}" loading="lazy">${boxes ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${boxes}</svg>` : ''}</div>`;
    }
    // v0.25.1: the yellow parts are counted by colour; the squares that are mostly yellow are drawn on the photo.
    const cells = (m.cells || []).map((c) => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" class="fccell"/>`).join('');
    const svg = (m.plants || []).length ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${(m.plants || []).map((p) => maskPath(p, 'pbleaf')).join('')}${cells}${(m.patches || []).map((p) => maskPath(p, 'pbpatch')).join('')}</svg>` : '';
    return `<div class="ydframe" style="aspect-ratio:${W}/${H};width:min(100%, ${Math.round((360 * W) / H)}px)"><img src="${esc(imgUrl(l))}" alt="${esc(t('fcH'))}" loading="lazy">${svg}${badge && svg ? `<span class="ydbadge">${esc(t('fcSamBadge'))}</span>` : ''}</div>`;
  }
  // The share over the looks: one line, a dot per look, the last one labelled.
  function chartHtml(looks) {
    const pts = looks.filter((l) => !l.motion && Number.isFinite(l.share));
    if (pts.length < 2) return '';
    const W = 520;
    const H = 150;
    const top = Math.max(20, Math.ceil(Math.max(...pts.map((p) => p.share)) / 10) * 10);
    const x = (i) => 44 + (i * (W - 70)) / (pts.length - 1);
    const y = (v) => 128 - (v / top) * 112;
    const grid = [0, top / 2, top].map((v) => `<line x1="44" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" class="fcg"/><text x="36" y="${y(v) + 4}" text-anchor="end" class="fct">${num(v)}%</text>`).join('');
    const line = pts.map((p, i) => `${x(i)},${y(p.share)}`).join(' ');
    const dots = pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.share)}" r="5" class="fcd"><title>${esc(`${hhmm(p.at)}: ${num(p.share)}%`)}</title></circle>`).join('');
    const last = pts.at(-1);
    return `<div class="fcchart"><b>${esc(t('fcChartH'))}</b><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${t('fcChartH')}: ${pts.map((p) => `${num(p.share)}%`).join(', ')}`)}">${grid}<polyline points="${line}" class="fcl"/>${dots}<text x="${x(pts.length - 1)}" y="${y(last.share) - 12}" text-anchor="end" class="fcv">${esc(`${num(last.share)}%`)}</text><text x="44" y="146" class="fct">${esc(hhmm(pts[0].at))}</text><text x="${W - 10}" y="146" text-anchor="end" class="fct">${esc(hhmm(last.at))}</text></svg></div>`;
  }
  function render() {
    const card = $('#fcCard');
    if (!card) return;
    const on = S.mode === 'field' && S.cur;
    card.hidden = !on;
    if (!on) return;
    const demo = C.looks.some((l) => l.demo);
    const tag = demo ? `<span class="src-tag sim">${esc(t('fcDemoTag'))}</span>` : `<span class="src-tag">SAM 3.1</span>`;
    const canAdd = !S.view;
    const canDemo = S.view === 'demo' && S.admin;
    const canStory = S.view === 'demo' && S.cur?.location_source === 'demo'; // v0.27.0: every visitor of the demo farm
    const measured = C.looks.filter((l) => !l.motion);
    const moves = C.looks.filter((l) => l.motion);
    // v0.25.0: demo stories, frames that ship with the site, so one press (by a person or an agent) runs a story.
    const stories = canStory ? `<div class="fcstories" role="group" aria-label="${esc(t('fcStoriesH'))}"><b>${esc(t(S.admin ? 'fcStoriesH' : 'fcStoriesMine'))}</b><div class="btns">${Object.keys(STORIES).map((k) => `<button class="btn" type="button" id="fcStory_${k}" data-story="${k}"${P ? ' disabled' : ''}>${esc(t(`fcStory_${k}`))}</button>`).join('')}</div></div>` : '';
    const tools = `${stories}<div class="btns fcbtns">${C.looks.length ? `<button class="btn ghost" type="button" id="fcHist">${esc(t('fcHistory'))}</button>` : ''}${canAdd ? `<label class="btn ghost fcfile">${esc(t('fcAdd'))}<input type="file" accept="image/*" id="fcIn" hidden></label>` : ''}${canDemo ? `<label class="btn ghost fcfile">${esc(t('fcDemoLoad'))}<input type="file" accept="image/*" multiple id="fcDemoIn" hidden></label><label class="btn ghost fcfile">${esc(t('fcMotionLoad'))}<input type="file" accept="image/*" id="fcMotionIn" hidden></label>` : ''}</div>${canDemo ? `<p class="muted small">${esc(t('fcDemoHint'))}</p>` : ''}`;
    if (C.busy) {
      card.innerHTML = `<div class="lab"><span data-icon="camera"></span><span>${esc(t('fcH'))}</span>${tag}</div><div class="maploading" style="position:static;margin:8px 0"><span class="spin"></span><span>${esc(C.busy)}</span></div>`;
      return K.icons?.(card);
    }
    // v0.27.0: while a story plays, or when the farmer steps back, the photo on screen can be an earlier one.
    const at = C.show == null ? measured.length - 1 : Math.max(0, Math.min(measured.length - 1, C.show));
    const last = measured[at];
    const move = moves.at(-1);
    const moveHtml = move ? `<div class="fcmove"><b>${esc((move.animals || []).length ? fmt('fcAnimals', { list: animalList(move.animals), time: hhmm(move.at) }) : fmt('fcNoAnimals', { time: hhmm(move.at) }))}</b>${frameHtml(move)}</div>` : '';
    if (!last) {
      card.innerHTML = `<div class="lab"><span data-icon="camera"></span><span>${esc(t('fcH'))}</span>${tag}</div>${moveHtml || `<p class="muted small">${esc(t('fcNone'))}</p>`}${tools}`;
      return K.icons?.(card);
    }
    const tr = C.trend || {};
    const change = Number.isFinite(tr.from) && Number.isFinite(last.share) ? last.share - tr.from : null;
    card.innerHTML = `<div class="lab"><span data-icon="camera"></span><span>${esc(t('fcH'))}</span>${tag}</div>
      ${frameHtml(last)}
      ${playerHtml(measured, at)}
      <div class="zinfo">${esc(last.error ? t('fcNoPlants') : fmt('fcLast', { time: hhmm(last.at) }))}${tr.rising ? ` · <b>${esc(t(tr.kind === 'ripening' ? 'fcRipening' : 'fcRising'))}</b>` : ''}</div>
      <div class="kpis fckpis"><div class="kpi"><div class="lab"><span>${esc(t('fcNow'))}</span></div><div class="kv">${Number.isFinite(last.share) ? `${num(last.share)}%` : '-'}</div></div><div class="kpi"><div class="lab"><span>${esc(t('fcSince'))}</span></div><div class="kv">${change == null ? '-' : `${change > 0 ? '+' : ''}${esc(fmt('fcPts', { n: num(Math.round(change)) }))}`}</div></div><div class="kpi"><div class="lab"><span>${esc(t('fcLooks'))}</span></div><div class="kv">${num(measured.length)}</div></div></div>
      ${chartHtml(C.looks)}
      ${moveHtml}
      ${tools}`;
    K.icons?.(card);
  }
  // v0.27.0: the story player: which photo of how many, back, pause or play, next; and when SAM measured them.
  function playerHtml(measured, at) {
    const story = measured[at]?.story;
    if (!story || STORIES[story]?.motion) return '';
    const n = STORIES[story].files.length;
    const dots = Array.from({ length: n }, (_, i) => `<i class="${i < measured.length ? (i === at ? 'on' : 'done') : ''}"></i>`).join('');
    const playing = P && !P.paused && !P.done;
    const when = measured[at].measuredAt ? fmt('fcMeasuredAt', { date: fd(new Date(measured[at].measuredAt).toLocaleDateString('en-CA')) }) : '';
    return `<div class="fcplayer"><div class="fcdots" aria-hidden="true">${dots}</div><span class="fcpos">${esc(fmt('fcFrameOf', { i: num(at + 1), n: num(n), p: num(measured[at].share ?? 0) }))}</span>${P?.loading ? `<span class="spin"></span>` : ''}
      <div class="btns fcctl"><button class="btn ghost" type="button" id="fcPrev"${at === 0 ? ' disabled' : ''}>${esc(t('fcPrev'))}</button>${P && !P.done ? `<button class="btn ghost" type="button" id="fcPause">${esc(t(playing ? 'fcPause' : 'fcPlay'))}</button>` : ''}<button class="btn ghost" type="button" id="fcNext"${at >= measured.length - 1 && !(P && !P.done) ? ' disabled' : ''}>${esc(t('fcNext'))}</button></div>
      ${when ? `<small class="muted">${esc(when)}</small>` : ''}</div>`;
  }
  async function load(landId, force = false) {
    if (!landId) return render();
    if (!force && landId === C.landId && Date.now() - (C.at || 0) < 30000) return render();
    C.landId = landId;
    C.at = Date.now();
    const r = await api(`/api/lands/${landId}/camera`).catch(() => null);
    if (C.landId !== landId) return;
    if (r?.ok) {
      C.looks = r.looks || [];
      C.trend = r.trend || null;
    } else {
      C.looks = [];
      C.trend = null;
    }
    render();
    window.KSWatch?.render();
  }
  const animalList = (as) => Object.entries(as.reduce((m, a) => ((m[a.kind] = (m[a.kind] || 0) + 1), m), {})).map(([k, n]) => `${num(n)} ${t(n > 1 ? `fcKinds_${k}` : `fcKind_${k}`)}`).join(', ');
  function history() {
    $('#camList').innerHTML = [...C.looks].reverse().map((l) => `<div class="camrow">${frameHtml(l, { badge: false })}<div><b>${l.motion ? esc((l.animals || []).length ? animalList(l.animals) : t('fcMotionH')) : Number.isFinite(l.share) ? `${num(l.share)}%` : '-'}</b><small>${esc(hhmm(l.at))}${l.demo ? ` · ${esc(t('fcDemoTag'))}` : ''}</small></div></div>`).join('');
    $('#camSheet').hidden = false;
  }
  $('#camClose')?.addEventListener('click', () => ($('#camSheet').hidden = true));
  // A series of demo frames, oldest first: the first one starts a fresh series; the rise check runs after the last.
  async function runDemo(landId, files) {
    for (let i = 0; i < files.length; i++) {
      C.busy = fmt('fcMeasuring', { i: num(i + 1), n: num(files.length) });
      render();
      const photo = await K.shrink(files[i], 1280);
      const r = await postJson(`/api/lands/${landId}/camera/demo`, { photoDataUrl: photo, index: i, total: files.length }).catch((err) => ({ ok: false, error: err.message }));
      if (!r.ok) {
        C.busy = '';
        toast(`${t('error')}: ${r.error}`);
        return load(landId, true);
      }
    }
    C.busy = '';
    await load(landId, true);
    window.KSWatch?.load(true);
  }
  // One frame where the camera noticed movement: checked for animals only.
  async function runMotion(landId, file) {
    const photo = await K.shrink(file, 1280);
    C.busy = t('fcLookingAnimals');
    render();
    const r = await postJson(`/api/lands/${landId}/camera/look`, { photoDataUrl: photo, motion: true }).catch((err) => ({ ok: false, error: err.message }));
    C.busy = '';
    if (!r.ok) toast(`${t('error')}: ${r.error}`);
    await load(landId, true);
    return window.KSWatch?.load(true);
  }
  // v0.27.0: a story plays frame by frame from the server (each frame measured by SAM 3.1 once and kept), a new
  // photo every 5 seconds. Back, pause and next work by hand. A visitor's story is kept for that visitor.
  const STEP_MS = 5000;
  async function stepStory() {
    if (!P || P.paused || P.done || P.loading) return;
    const landId = C.landId;
    P.loading = true;
    const t0 = Date.now();
    render();
    const r = await postJson(`/api/lands/${landId}/camera/story`, { story: P.story, index: P.next }).catch((err) => ({ ok: false, error: err.message }));
    if (!P) return;
    P.loading = false;
    if (!r.ok) {
      toast(r.error === 'story_limit' ? t('fcStoryLimit') : `${t('error')}: ${r.error}`);
      P = null;
      return load(landId, true);
    }
    P.next = r.index + 1;
    await load(landId, true);
    C.show = null;
    if (r.done) {
      P.done = true;
      render();
      // Sathi looks closer by herself (about half a minute); her log on Home picks it up.
      [8000, 20000, 35000, 50000].forEach((ms) => setTimeout(() => window.KSWatch?.load(true), ms));
      setTimeout(() => {
        P = null;
        render();
      }, 1500);
      return;
    }
    render();
    P.timer = setTimeout(stepStory, Math.max(0, STEP_MS - (Date.now() - t0)));
  }
  function playStory(key) {
    const st = STORIES[key];
    if (!st || !C.landId || P) return;
    C.show = null;
    P = { story: key, next: 0, paused: false, done: false, loading: false, timer: null };
    stepStory();
  }
  function storyControl(id) {
    const measured = C.looks.filter((l) => !l.motion);
    const at = C.show == null ? measured.length - 1 : C.show;
    if (id === 'fcPrev') {
      if (P) {
        P.paused = true;
        clearTimeout(P.timer);
      }
      C.show = Math.max(0, at - 1);
      return render();
    }
    if (id === 'fcNext') {
      if (at < measured.length - 1) {
        C.show = at + 1 === measured.length - 1 ? null : at + 1;
        return render();
      }
      if (P && !P.done) {
        P.paused = true;
        clearTimeout(P.timer);
        P.paused = false;
        P.once = true;
        stepStory().then(() => {
          if (P && P.once) {
            P.paused = true;
            P.once = false;
            clearTimeout(P.timer);
            render();
          }
        });
      }
      return;
    }
    if (id === 'fcPause' && P) {
      P.paused = !P.paused;
      clearTimeout(P.timer);
      if (!P.paused) {
        C.show = null;
        stepStory();
      } else render();
    }
  }
  $('#fcCard')?.addEventListener('click', (e) => {
    if (e.target.closest('#fcHist')) history();
    const story = e.target.closest('[data-story]');
    if (story) playStory(story.dataset.story);
    const ctl = e.target.closest('#fcPrev, #fcNext, #fcPause');
    if (ctl) storyControl(ctl.id);
  });
  $('#fcCard')?.addEventListener('change', async (e) => {
    const landId = C.landId;
    if (e.target.id === 'fcIn' && e.target.files[0]) {
      const photo = await K.shrink(e.target.files[0], 1280);
      C.busy = fmt('fcMeasuring', { i: num(1), n: num(1) });
      render();
      const r = await postJson(`/api/lands/${landId}/camera/look`, { photoDataUrl: photo }).catch((err) => ({ ok: false, error: err.message }));
      C.busy = '';
      if (!r.ok) toast(`${t('error')}: ${r.error}`);
      return load(landId, true);
    }
    if (e.target.id === 'fcMotionIn' && e.target.files[0]) return runMotion(landId, e.target.files[0]);
    if (e.target.id === 'fcDemoIn' && e.target.files.length) {
      const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 12);
      if (files.length < 2) return toast(t('fcDemoHint'));
      return runDemo(landId, files);
    }
  });
  document.querySelectorAll('.lang [data-lang]').forEach((b) => b.addEventListener('click', () => setTimeout(render, 0)));

  // Sathi's "Make the office summary" opens the crop problem with the camera's latest look.
  async function latestForProblem() {
    const l = C.looks.filter((x) => !x.motion).at(-1);
    if (!l) return null;
    const res = await fetch(imgUrl(l)).catch(() => null);
    if (!res?.ok) return null;
    const blob = await res.blob();
    const photo = await new Promise((done) => {
      const fr = new FileReader();
      fr.onload = () => done(fr.result);
      fr.readAsDataURL(blob);
    });
    return { photo, measure: { width: l.width, height: l.height, plants: l.measure?.plants || [], patches: l.measure?.patches || [], cells: l.measure?.cells || [], share: l.share, error: l.error } };
  }

  window.KSFieldCam = { load, render, latestForProblem, play: playStory, count: () => (S.mode === 'field' ? C.looks.length : 0) };
})();
