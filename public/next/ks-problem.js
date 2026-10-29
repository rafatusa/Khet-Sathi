// Khet Sathi v0.16.0: a photo of a crop problem. SAM 3.1 outlines the leaf and the yellow or brown patches and
// Sathi works out how much of the leaf they cover: a measurement, never a diagnosis. The farmer taps what they
// see, since when and on how many plants; Sathi puts it into a summary for the agriculture office that the
// farmer sends themselves (WhatsApp through the phone's own share sheet, or copy). Nothing is saved, except
// (v0.19.3) the one demo leaf the admin keeps for the demo farm.
(() => {
  'use strict';
  const K = window.KS;
  if (!K) return;
  const { S, $, $$, I, t, fmt, num, esc, toast, api, postJson } = K;
  const P = { photo: null, m: null, plant: null, signs: new Set(), since: null, many: null, other: '' };
  const SIGNS = ['yellow', 'curl', 'spots', 'holes', 'insects', 'wilt'];
  const SINCE = ['today', 'days', 'week'];
  const MANY = ['one', 'few', 'most'];

  // ---------- sharing (also used by the yard list and the office card) ----------
  async function dataUrlFile(dataUrl, name) {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: blob.type || 'image/jpeg' });
  }
  // The phone's own share sheet (WhatsApp, Messenger, SMS …) with the photo when it can; otherwise WhatsApp
  // with the text, and a note to attach the photo. Sathi never sends anything herself.
  async function share(text, photoDataUrl = null) {
    try {
      if (photoDataUrl && navigator.canShare) {
        const file = await dataUrlFile(photoDataUrl, 'khet-sathi-photo.jpg');
        if (navigator.canShare({ files: [file] })) return void (await navigator.share({ text, files: [file] }));
      }
      if (navigator.share) return void (await navigator.share({ text }));
    } catch (err) {
      if (err?.name === 'AbortError') return; // the farmer closed the share sheet
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    if (photoDataUrl) toast(t('pbAttachPhoto'));
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('copied'));
    } catch {
      toast(t('error'));
    }
  }

  // ---------- where, and which plants to offer ----------
  const placeName = () => (S.mode === 'yard' ? window.KSYard?.yardTitle(S.yard) : S.mode === 'shed' ? '' : S.cur ? K.landTitle(S.cur) : '');
  const kindName = () => t(S.mode === 'yard' ? 'pbInYard' : 'pbInField');
  function plantChoices() {
    if (S.mode === 'yard') return (window.KSYard?.picks() || []).map((p) => ({ key: `pl_${p.key}`, name: t(`pl_${p.key}`) }));
    const key = S.cur?.crop || S.plan?.crops?.[0]?.key;
    return key ? [{ key: `crop_${key}`, name: K.cropName(key) }] : [];
  }
  function cropAge() {
    if (S.mode !== 'field' || !S.cur?.sown_on) return '';
    const w = Math.round((Date.now() - Date.parse(`${S.cur.sown_on}T12:00:00Z`)) / (7 * 864e5));
    return w > 0 ? fmt('pbWeeks', { n: num(w) }) : '';
  }
  const whereParams = () => (S.mode === 'yard' ? `yardId=${S.yard?.id}` : S.mode === 'shed' ? `shedId=${S.shed?.id}` : `landId=${S.cur?.id}`);

  // ---------- the photo with SAM's outlines ----------
  function maskPath(o, cls) {
    const sx = (o.bounds.right - o.bounds.left) / (o.mw || 1);
    const sy = (o.bounds.bottom - o.bounds.top) / (o.mh || 1);
    return `<g transform="translate(${o.bounds.left} ${o.bounds.top}) scale(${sx} ${sy})"><path d="${esc(o.svgPath)}" class="${cls}"/></g>`;
  }
  function picHtml() {
    const m = P.m;
    const W = m?.width || 1024;
    const H = m?.height || 768;
    const base = m?.leaf ? [m.leaf] : m?.plants || []; // v0.23.0: a field camera look outlines the plants, not one leaf
    const svg = base.length ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${base.map((b) => maskPath(b, 'pbleaf')).join('')}${(m.patches || []).map((p) => maskPath(p, 'pbpatch')).join('')}</svg>` : '';
    return `<div class="ydframe" style="aspect-ratio:${W}/${H};width:min(100%, ${Math.round((360 * W) / H)}px)"><img src="${esc(P.photo)}" alt="${esc(t('pbPhotoAlt'))}">${svg}${base.length ? `<span class="ydbadge">${esc(t('pbSamBadge'))}</span>` : ''}</div>`;
  }
  const measured = () => P.m && (P.m.leaf || (P.m.plants || []).length) && Number.isFinite(P.m.share);
  // v0.20.1: a leaf where SAM found no patch says so, instead of "about 0%".
  const noPatch = () => measured() && !(P.m.patches || []).length;

  // ---------- steps ----------
  function step(n) {
    [1, 2, 3, 4].forEach((i) => ($(`#pb${i}`).hidden = i !== n));
    $('#probSheet').scrollTop = 0;
  }
  function open() {
    Object.assign(P, { photo: null, m: null, plant: null, signs: new Set(), since: null, many: null, other: '', demo: false });
    $('#pbIntro').textContent = t('pbIntro');
    $('#pbOffices').innerHTML = '';
    $('#probSheet').hidden = false;
    step(1);
    loadDemoLeaf();
  }

  // ---------- v0.19.3: the demo farm's sample leaf ----------
  // Saved once by the admin (with its SAM measurement, or measured later by the server when SAM is back);
  // everyone in the demo farm can try it. Real farms' photos are still never stored.
  let demoLeaf = null;
  async function loadDemoLeaf() {
    const card = $('#pbDemoLeaf');
    card.hidden = true;
    demoLeaf = null;
    if (S.view !== 'demo') return;
    const r = await api('/api/problem/demo-leaf').catch(() => null);
    if (!r?.ok || !r.leaf || S.view !== 'demo') return;
    demoLeaf = r.leaf;
    const m = demoLeaf.measure;
    const date = m ? K.fd(String(demoLeaf.measuredAt).slice(0, 10)) : '';
    const sub = !m ? t('pbDemoNotYet') : m.patches?.length ? fmt('pbDemoMeasured', { date, n: num(m.share) }) : fmt('pbDemoNoPatch', { date });
    card.innerHTML = `<img src="${esc(K.imgUrl(demoLeaf.photoUrl))}" alt=""><span><b>${esc(t('pbDemoTry'))}</b><small>${esc(sub)}</small></span><span class="tag">${esc(t('demoTag'))}</span>`;
    card.hidden = false;
  }
  async function blobToDataUrl(blob) {
    return new Promise((done, fail) => {
      const fr = new FileReader();
      fr.onload = () => done(fr.result);
      fr.onerror = () => fail(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  $('#pbDemoLeaf').addEventListener('click', async () => {
    if (!demoLeaf) return;
    const res = await fetch(K.imgUrl(demoLeaf.photoUrl)).catch(() => null);
    if (!res?.ok) return toast(t('error'));
    P.photo = await blobToDataUrl(await res.blob());
    P.demo = true;
    step(2);
    showMeasure(demoLeaf.measure || { error: 'not measured yet', width: demoLeaf.width, height: demoLeaf.height });
  });
  $('#pbSaveDemoBtn').addEventListener('click', async () => {
    if (!P.photo) return;
    $('#pbSaveDemoBtn').disabled = true;
    const r = await postJson('/api/problem/demo-leaf', { photoDataUrl: P.photo, measure: measured() ? P.m : null }).catch((err) => ({ ok: false, error: err.message }));
    $('#pbSaveDemoBtn').disabled = false;
    if (!r.ok) return toast(`${t('error')}: ${r.error}`);
    toast(t(r.leaf.measured ? 'pbSavedDemo' : 'pbSavedDemoLater'));
  });
  function showMeasure(m) {
    P.m = m;
    $('#pbPic').innerHTML = picHtml();
    $('#pbMeasure').innerHTML = measured()
      ? `<div class="kpis pbstats"><div class="kpi"><div class="lab"><span>${esc(t(P.m.plants ? 'pbPlants' : 'pbLeaf'))}</span></div><div class="kv ydkv">${esc(t(P.m.plants ? 'pbPlantsOk' : 'pbLeafOk'))}</div></div><div class="kpi"><div class="lab"><span>${esc(t('pbPatch'))}</span></div><div class="kv ydkv">${esc(noPatch() ? t('pbPatchNone') : `≈ ${num(P.m.share)}%`)}</div></div></div><div class="msg bot pbsay">${esc(P.m.share ? fmt(P.m.plants ? 'pbSaysCam' : 'pbSays', { n: num(P.m.share), k: num(P.m.patches.length) }) : t('pbSaysNone'))}</div>`
      : `<p class="note">${esc(t(P.demo ? 'pbDemoNotYetLong' : 'pbNoMeasure'))}</p>`;
    // v0.20.1: the admin, inside the demo farm, can have SAM 3.1 measure the demo leaf again.
    if (P.demo && S.view === 'demo' && S.admin) $('#pbMeasure').insertAdjacentHTML('beforeend', `<div class="dsave"><button class="btn ghost" type="button" id="pbRemeasure">${esc(t('pbRemeasure'))}</button><small>${esc(t('pbRemeasureS'))}</small></div>`);
    $('#pbNext').disabled = false;
  }
  $('#pbMeasure').addEventListener('click', async (e) => {
    const b = e.target.closest('#pbRemeasure');
    if (!b) return;
    b.disabled = true;
    b.textContent = t('pbMeasuring');
    const r = await postJson('/api/problem/demo-leaf/measure', {}).catch((err) => ({ ok: false, error: err.message }));
    if (!r.ok) {
      b.disabled = false;
      b.textContent = t('pbRemeasure');
      return toast(`${t('error')}: ${r.error}`);
    }
    demoLeaf = r.leaf;
    toast(r.measured ? t('pbRemeasured') : `${t('pbRemeasureKept')} (${r.error || ''})`);
    showMeasure(demoLeaf.measure || { error: 'not measured yet', width: demoLeaf.width, height: demoLeaf.height });
    loadDemoLeaf();
  });
  $('#probClose').addEventListener('click', () => ($('#probSheet').hidden = true));
  $('#pbJustOffice').addEventListener('click', () => {
    $('#probSheet').hidden = true;
    K.ask(t('qHelp'));
  });
  $('#pbPhotoIn').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    P.photo = await K.shrink(f, 1280);
    P.demo = false;
    e.target.value = '';
    step(2);
    $('#pbPic').innerHTML = picHtml();
    $('#pbMeasure').innerHTML = `<div class="maploading" style="position:static;margin:8px 0"><span class="spin"></span><span>${esc(t('pbMeasuring'))}</span></div>`;
    $('#pbNext').disabled = true;
    const r = await postJson('/api/problem/measure', { photoDataUrl: P.photo }).catch((err) => ({ ok: false, error: err.message }));
    showMeasure(r.ok ? r.measure : { error: r.error });
  });
  $('#pbNext').addEventListener('click', () => {
    step(3);
    const plants = plantChoices();
    // v0.21.0: nothing is picked in advance (the demo leaf is not the field's rice); the field's crop stays first.
    P.plant = P.plant || null;
    $('#pbPlants').innerHTML = [...plants, { key: 'other', name: t('pbOther') }].map((p) => `<button class="chip" type="button" data-plant="${esc(p.key)}" aria-pressed="${p.key === P.plant}">${esc(p.name)}</button>`).join('');
    $('#pbOtherBox').hidden = P.plant !== 'other';
    $('#pbSigns').innerHTML = SIGNS.map((s) => `<button class="chip" type="button" data-sign="${s}" aria-pressed="${P.signs.has(s)}">${esc(t(`pbSign_${s}`))}</button>`).join('');
    $('#pbSince').innerHTML = SINCE.map((s) => `<button class="chip" type="button" data-since="${s}" aria-pressed="${P.since === s}">${esc(t(`pbSince_${s}`))}</button>`).join('');
    $('#pbMany').innerHTML = MANY.map((s) => `<button class="chip" type="button" data-many="${s}" aria-pressed="${P.many === s}">${esc(t(`pbMany_${s}`))}</button>`).join('');
  });
  $('#pb3').addEventListener('click', (e) => {
    const b = e.target.closest('[data-plant],[data-sign],[data-since],[data-many]');
    if (!b) return;
    if (b.dataset.plant) {
      P.plant = b.dataset.plant;
      $$('#pbPlants .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      $('#pbOtherBox').hidden = P.plant !== 'other';
    } else if (b.dataset.sign) {
      P.signs.has(b.dataset.sign) ? P.signs.delete(b.dataset.sign) : P.signs.add(b.dataset.sign);
      b.setAttribute('aria-pressed', String(P.signs.has(b.dataset.sign)));
    } else if (b.dataset.since) {
      P.since = b.dataset.since;
      $$('#pbSince .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    } else {
      P.many = b.dataset.many;
      $$('#pbMany .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    }
  });

  // ---------- the summary ----------
  function rows() {
    const plant = P.plant === 'other' ? $('#pbOtherIn').value.trim() || t('pbOther') : t(P.plant);
    // v0.19.3: the age is the field crop's (from its sowing date), so it is shown only for that crop.
    const age = P.plant === 'other' ? '' : cropAge();
    const seen = [...P.signs].map((s) => t(`pbSign_${s}`)).join(', ');
    return [
      [t('pbRCrop'), [plant, age].filter(Boolean).join(', ')],
      [t('pbRSeen'), [seen || t('pbNotSaid'), P.many ? t(`pbMany_${P.many}`) : ''].filter(Boolean).join(' · ')],
      [t('pbRMeas'), !measured() ? t('pbNotMeasured') : noPatch() ? t('pbMeasNone') : fmt('pbMeasLine', { n: num(P.m.share) })],
      [t('pbRSince'), P.since ? t(`pbSince_${P.since}`) : t('pbNotSaid')],
      // v0.19.3: the place name alone ("Bolpur land"); "field" or "home yard" only when it has no name.
      [t('pbRWhere'), placeName() || kindName()],
    ];
  }
  const summaryText = () => [t('pbShareH'), ...rows().map(([k, v]) => `${k}: ${v}`), t('pbSentFrom')].join('\n');
  $('#pbMake').addEventListener('click', () => {
    if (!P.plant) return toast(t('pbPickPlant'));
    if (!P.signs.size) return toast(t('pbPickSign'));
    step(4);
    $('#pbSum').innerHTML = `<div class="pbsumtop">${P.photo ? `<img src="${esc(P.photo)}" alt="">` : ''}<b>${esc(t('pbSumH'))}</b></div>${rows().map(([k, v]) => `<div class="pbrow"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}`;
    $('#pbOffices').innerHTML = '';
    // v0.19.3: the admin, inside the demo farm, can keep this photo as the demo leaf (not the demo leaf itself).
    $('#pbSaveDemo').hidden = !(S.view === 'demo' && S.admin && P.photo && !P.demo);
  });
  $('#pbShare').addEventListener('click', () => share(summaryText(), P.photo));
  $('#pbCopy').addEventListener('click', () => copy(summaryText()));
  $('#pbOffice').addEventListener('click', async () => {
    $('#pbOffices').innerHTML = `<div class="maploading" style="position:static;margin:8px 0"><span class="spin"></span><span>${esc(t('pbFinding'))}</span></div>`;
    const r = await api(`/api/help/offices?${whereParams()}&lang=${K.lang()}`).catch((err) => ({ ok: false, error: err.message }));
    $('#pbOffices').innerHTML = `<div class="offices">${window.KSYard.officeHtml(r.ok ? r.help : { error: r.error })}</div>`;
  });

  // Entry points: "Take a photo of the problem" buttons anywhere in the app, and share buttons with ready text.
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-problem]')) open();
    const s = e.target.closest('[data-sharetext]');
    if (s) share(decodeURIComponent(s.dataset.sharetext));
  });

  // v0.23.0: Sathi asked to send the field camera's look to the office: the sheet opens on that look, measured.
  function openWith({ photo, measure }) {
    open();
    P.photo = photo;
    step(2);
    showMeasure(measure);
  }
  window.KSProblem = { open, openWith, share, copy };
})();
