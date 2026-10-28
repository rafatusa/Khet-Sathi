// Khet Sathi v0.16.0: a photo of a crop problem. SAM 3.1 outlines the leaf and the yellow or brown patches and
// Sathi works out how much of the leaf they cover: a measurement, never a diagnosis. The farmer taps what they
// see, since when and on how many plants; Sathi puts it into a summary for the agriculture office that the
// farmer sends themselves (WhatsApp through the phone's own share sheet, or copy). Nothing is saved.
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
    const svg = m?.leaf ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${maskPath(m.leaf, 'pbleaf')}${(m.patches || []).map((p) => maskPath(p, 'pbpatch')).join('')}</svg>` : '';
    return `<div class="ydframe" style="aspect-ratio:${W}/${H}"><img src="${esc(P.photo)}" alt="${esc(t('pbPhotoAlt'))}">${svg}${m?.leaf ? `<span class="ydbadge">${esc(t('pbSamBadge'))}</span>` : ''}</div>`;
  }
  const measured = () => P.m && P.m.leaf && Number.isFinite(P.m.share);

  // ---------- steps ----------
  function step(n) {
    [1, 2, 3, 4].forEach((i) => ($(`#pb${i}`).hidden = i !== n));
    $('#probSheet').scrollTop = 0;
  }
  function open() {
    Object.assign(P, { photo: null, m: null, plant: null, signs: new Set(), since: null, many: null, other: '' });
    $('#pbIntro').textContent = t('pbIntro');
    $('#pbOffices').innerHTML = '';
    $('#probSheet').hidden = false;
    step(1);
  }
  $('#probClose').addEventListener('click', () => ($('#probSheet').hidden = true));
  $('#pbJustOffice').addEventListener('click', () => {
    $('#probSheet').hidden = true;
    K.ask(t('qHelp'));
  });
  $('#pbPhotoIn').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    P.photo = await K.shrink(f, 1280);
    e.target.value = '';
    step(2);
    $('#pbPic').innerHTML = picHtml();
    $('#pbMeasure').innerHTML = `<div class="maploading" style="position:static;margin:8px 0"><span class="spin"></span><span>${esc(t('pbMeasuring'))}</span></div>`;
    $('#pbNext').disabled = true;
    const r = await postJson('/api/problem/measure', { photoDataUrl: P.photo }).catch((err) => ({ ok: false, error: err.message }));
    P.m = r.ok ? r.measure : { error: r.error };
    $('#pbPic').innerHTML = picHtml();
    $('#pbMeasure').innerHTML = measured()
      ? `<div class="kpis pbstats"><div class="kpi"><div class="lab"><span>${esc(t('pbLeaf'))}</span></div><div class="kv ydkv">${esc(t('pbLeafOk'))}</div></div><div class="kpi"><div class="lab"><span>${esc(t('pbPatch'))}</span></div><div class="kv ydkv">≈ ${esc(num(P.m.share))}%</div></div></div><div class="msg bot pbsay">${esc(P.m.share ? fmt('pbSays', { n: num(P.m.share), k: num(P.m.patches.length) }) : t('pbSaysNone'))}</div>`
      : `<p class="note">${esc(t('pbNoMeasure'))}</p>`;
    $('#pbNext').disabled = false;
  });
  $('#pbNext').addEventListener('click', () => {
    step(3);
    const plants = plantChoices();
    P.plant = P.plant || plants[0]?.key || 'other';
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
    const age = cropAge();
    const seen = [...P.signs].map((s) => t(`pbSign_${s}`)).join(', ');
    return [
      [t('pbRCrop'), [plant, age].filter(Boolean).join(', ')],
      [t('pbRSeen'), [seen || t('pbNotSaid'), P.many ? t(`pbMany_${P.many}`) : ''].filter(Boolean).join(' · ')],
      [t('pbRMeas'), measured() ? fmt('pbMeasLine', { n: num(P.m.share) }) : t('pbNotMeasured')],
      [t('pbRSince'), P.since ? t(`pbSince_${P.since}`) : t('pbNotSaid')],
      [t('pbRWhere'), [kindName(), placeName()].filter(Boolean).join(', ')],
    ];
  }
  const summaryText = () => [t('pbShareH'), ...rows().map(([k, v]) => `${k}: ${v}`), t('pbSentFrom')].join('\n');
  $('#pbMake').addEventListener('click', () => {
    if (!P.signs.size) return toast(t('pbPickSign'));
    step(4);
    $('#pbSum').innerHTML = `<div class="pbsumtop">${P.photo ? `<img src="${esc(P.photo)}" alt="">` : ''}<b>${esc(t('pbSumH'))}</b></div>${rows().map(([k, v]) => `<div class="pbrow"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}`;
    $('#pbOffices').innerHTML = '';
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

  window.KSProblem = { open, share, copy };
})();
