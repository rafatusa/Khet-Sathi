// v0.23.0: the field camera card on a field's Home. Shows the latest look at the watched patch with SAM 3.1's
// outlines (plants dashed, yellow or brown parts in red), how the share has moved, and every look in a popup.
// A farm can add a look (a photo of the same patch); an admin can load saved demo frames into the demo field.
// When the share keeps rising, the server raises patch_rising and Sathi takes it from there (ks-watch.js).
(() => {
  const K = window.KS;
  if (!K) return;
  const { $, t, fmt, esc, num, S, api, postJson, toast } = K;
  const C = { landId: null, looks: [], trend: null, busy: '' };
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
  function frameHtml(l, { badge = true } = {}) {
    const W = l.width || 1024;
    const H = l.height || 768;
    const m = l.measure || {};
    if (l.motion) {
      const boxes = (l.animals || []).map((a) => `<g><rect x="${a.box.left}" y="${a.box.top}" width="${a.box.right - a.box.left}" height="${a.box.bottom - a.box.top}" class="fcbox"/><text x="${a.box.left + 6}" y="${Math.max(18, a.box.top - 6)}" class="fcboxt">${esc(t(`fcKind_${a.kind}`))}</text></g>`).join('');
      return `<div class="ydframe" style="aspect-ratio:${W}/${H}"><img src="${esc(imgUrl(l))}" alt="${esc(t('fcMotionH'))}" loading="lazy">${boxes ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${boxes}</svg>` : ''}</div>`;
    }
    const svg = (m.plants || []).length ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${(m.plants || []).map((p) => maskPath(p, 'pbleaf')).join('')}${(m.patches || []).map((p) => maskPath(p, 'pbpatch')).join('')}</svg>` : '';
    return `<div class="ydframe" style="aspect-ratio:${W}/${H}"><img src="${esc(imgUrl(l))}" alt="${esc(t('fcH'))}" loading="lazy">${svg}${badge && svg ? `<span class="ydbadge">${esc(t('fcSamBadge'))}</span>` : ''}</div>`;
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
    const measured = C.looks.filter((l) => !l.motion);
    const moves = C.looks.filter((l) => l.motion);
    const tools = `<div class="btns fcbtns">${C.looks.length ? `<button class="btn ghost" type="button" id="fcHist">${esc(t('fcHistory'))}</button>` : ''}${canAdd ? `<label class="btn ghost fcfile">${esc(t('fcAdd'))}<input type="file" accept="image/*" id="fcIn" hidden></label>` : ''}${canDemo ? `<label class="btn ghost fcfile">${esc(t('fcDemoLoad'))}<input type="file" accept="image/*" multiple id="fcDemoIn" hidden></label><label class="btn ghost fcfile">${esc(t('fcMotionLoad'))}<input type="file" accept="image/*" id="fcMotionIn" hidden></label>` : ''}</div>${canDemo ? `<p class="muted small">${esc(t('fcDemoHint'))}</p>` : ''}`;
    if (C.busy) {
      card.innerHTML = `<div class="lab"><span data-icon="camera"></span><span>${esc(t('fcH'))}</span>${tag}</div><div class="maploading" style="position:static;margin:8px 0"><span class="spin"></span><span>${esc(C.busy)}</span></div>`;
      return K.icons?.(card);
    }
    const last = measured.at(-1);
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
      <div class="zinfo">${esc(last.error ? t('fcNoPlants') : fmt('fcLast', { time: hhmm(last.at) }))}${tr.rising ? ` · <b>${esc(t(tr.kind === 'ripening' ? 'fcRipening' : 'fcRising'))}</b>` : ''}</div>
      <div class="kpis fckpis"><div class="kpi"><div class="lab"><span>${esc(t('fcNow'))}</span></div><div class="kv">${Number.isFinite(last.share) ? `${num(last.share)}%` : '-'}</div></div><div class="kpi"><div class="lab"><span>${esc(t('fcSince'))}</span></div><div class="kv">${change == null ? '-' : `${change > 0 ? '+' : ''}${esc(fmt('fcPts', { n: num(Math.round(change)) }))}`}</div></div><div class="kpi"><div class="lab"><span>${esc(t('fcLooks'))}</span></div><div class="kv">${num(measured.length)}</div></div></div>
      ${chartHtml(C.looks)}
      ${moveHtml}
      ${tools}`;
    K.icons?.(card);
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
  $('#fcCard')?.addEventListener('click', (e) => {
    if (e.target.closest('#fcHist')) history();
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
    if (e.target.id === 'fcMotionIn' && e.target.files[0]) {
      const photo = await K.shrink(e.target.files[0], 1280);
      C.busy = t('fcLookingAnimals');
      render();
      const r = await postJson(`/api/lands/${landId}/camera/look`, { photoDataUrl: photo, motion: true }).catch((err) => ({ ok: false, error: err.message }));
      C.busy = '';
      if (!r.ok) toast(`${t('error')}: ${r.error}`);
      await load(landId, true);
      return window.KSWatch?.load(true);
    }
    if (e.target.id === 'fcDemoIn' && e.target.files.length) {
      const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 12);
      if (files.length < 2) return toast(t('fcDemoHint'));
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
    return { photo, measure: { width: l.width, height: l.height, plants: l.measure?.plants || [], patches: l.measure?.patches || [], share: l.share, error: l.error } };
  }

  window.KSFieldCam = { load, render, latestForProblem, count: () => (S.mode === 'field' ? C.looks.length : 0) };
})();
