// Khet Sathi v0.15.0: the home yard (বাড়ির উঠোন, the open space in front of the house) and help with a
// crop problem. Yard: one photo, SAM 3.1 outlines the open ground, the farmer gives the size in their own
// units, and Sathi picks what to plant from the weather and the month. Help: the nearest agriculture
// office from Google Maps and the country's farm hotline; "Call" opens the farmer's own phone dialer.
// Shops and offices are real; prices are samples and say so; Sathi never calls a real shop or office.
(() => {
  'use strict';
  const K = window.KS;
  if (!K) return;
  const { S, $, $$, I, t, fmt, num, esc, money, toast, api, postJson, imgUrl } = K;
  S.yards = S.yards || [];
  S.yard = S.yard || null;
  const Y = { d: null, shops: null, sure: false, add: null };
  const plantName = (k) => t(`pl_${k}`);
  const unitWord = (u) => t(`yu_${u}`);
  const sunWord = (s) => t(`ydSun_${s || 'half'}`);
  const monthName = (m) => new Date(2026, (m || 1) - 1, 15).toLocaleDateString(K.loc(), { month: 'long' });
  const yardTitle = (y) => y?.place_info?.village || y?.place_info?.district || t('myYard');

  // ---------- loading ----------
  async function loadYards() {
    const view = K.viewParam();
    const r = await api('/api/yards').catch(() => null);
    if (view !== K.viewParam()) return S.yards; // v0.19.0: the farm changed while loading
    S.yards = r?.ok ? r.yards || [] : [];
    return S.yards;
  }
  async function open(id) {
    K.stopAudio?.();
    S.yard = S.yards.find((y) => y.id === id) || S.yard;
    S.mode = 'yard';
    K.store.set('ks_mode', 'yard');
    K.store.set('ks_yard', id);
    Y.d = null;
    Y.shops = null;
    Y.sure = false;
    if (['field', 'shed', 'market'].includes(S.tab)) K.show('home');
    K.renderAll();
    const r = await api(`/api/yards/${id}`).catch((e) => ({ ok: false, error: e.message }));
    if (S.yard?.id !== id && S.mode !== 'yard') return;
    Y.d = r.ok ? r : { error: r.error };
    if (r.ok) S.yard = r.yard;
    K.renderAll();
  }

  // ---------- the photo with SAM's outline ----------
  function picHtml(y) {
    if (!y?.photoUrl) return '';
    const o = y.outline;
    const W = o?.width || 1024;
    const H = o?.height || 768;
    let svg = '';
    if (o?.svgPath && o.bounds) {
      const sx = (o.bounds.right - o.bounds.left) / (o.mw || 1);
      const sy = (o.bounds.bottom - o.bounds.top) / (o.mh || 1);
      svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(${o.bounds.left} ${o.bounds.top}) scale(${sx} ${sy})"><path d="${esc(o.svgPath)}" class="ydmask"/></g></svg>`;
    }
    return `<div class="ydframe" style="aspect-ratio:${W}/${H};width:min(100%, ${Math.round((360 * W) / H)}px)"><img src="${esc(imgUrl(y.photoUrl))}" alt="${esc(t('ydPhotoH'))}">${svg}${o ? `<span class="ydbadge">${esc(t('ydSamBadge'))}</span>` : ''}</div>`;
  }
  // v0.20.1: no outline says which it was: SAM answered and found no open ground, or SAM did not answer.
  const samLine = (y) => (y?.outline ? fmt('ydSamOk', { n: num(y.outline.share || 0) }) : t(y?.sam?.answered ? 'ydSamNone' : 'ydSamNo'));

  // ---------- size in the farmer's words ----------
  function sizeText(d, y) {
    if (!d?.size) return t('ydNoSize');
    const m = d.size.main;
    const a = d.size.also;
    return `${y?.size?.estimate ? `${t('ydEstimate')} ` : ''}${num(m.n, m.unit === 'decimal' ? 1 : 0)} ${unitWord(m.unit)}${a ? ` · ${t('about')} ${num(a.n)} ${unitWord(a.unit)}` : ''}`;
  }

  // ---------- Home ----------
  function headerLine() {
    const y = S.yard;
    return y ? `${yardTitle(y)} · ${y.size_m2 ? sizeText(Y.d, y) : t('ydNoSize')}` : t('myYard');
  }
  function hero() {
    const y = S.yard;
    if (!y) return { big: t('ydHeroAdd'), sub: '', cta: t('addYard'), icon: 'plus', go: openAdd };
    if (!y.size_m2) return { big: t('ydHeroSize'), sub: yardTitle(y), cta: t('ydGiveSize'), icon: 'pin', go: () => openAdd(y) };
    const p = Y.d?.picks || [];
    if (!p.length) return { big: Y.d ? t('ydNoPicks') : '', sub: yardTitle(y), cta: t('askSaathi'), icon: 'chat', go: () => K.ask(t('qYard')) };
    return { big: fmt('ydHero', { plants: p.map((x) => plantName(x.key)).join(', ') }), sub: `${sizeText(Y.d, y)} · ${sunWord(y.sun)}`, cta: t('askSaathi'), icon: 'chat', go: () => K.ask(t('qYard')) };
  }
  function renderHome() {
    const y = S.yard;
    const d = Y.d;
    $('#ydPic').innerHTML = picHtml(y);
    $('#ydSam').textContent = y ? samLine(y) : '';
    const w = d?.weather;
    const stats = [
      ['eye', t('ydSize'), y?.size_m2 ? sizeText(d, y) : t('ydNoSize')],
      ['sun', t('ydSunK'), y?.sun ? sunWord(y.sun) : '-'],
      ['suncloud', t('kTemp'), w && Number.isFinite(w.tMax) ? `${num(w.tMax)}° / ${num(w.tMin)}°` : '-'],
      ['clock', t('ydMonth'), d?.month ? monthName(d.month) : '-'],
    ];
    $('#ydStats').innerHTML = stats.map(([ic, k, v]) => `<div class="kpi"><div class="lab"><span>${I[ic] || ''}</span><span>${esc(k)}</span></div><div class="kv ydkv">${esc(v)}</div></div>`).join('');
    queueMicrotask(() => K.applyStale?.());
    $('#ydTip').textContent = !w ? '' : w.rainDate ? fmt('ydRainTip', { date: K.fd(w.rainDate, { weekday: 'long', day: 'numeric', month: 'short' }) }) : w.hot ? t('ydHotTip') : t('ydWaterTip');
    const picks = d?.picks || [];
    $('#ydPicks').innerHTML = !y?.size_m2
      ? `<div class="emptybox">${esc(t('ydNeedSize'))}</div><button class="btn" type="button" data-ydsize>${esc(t('ydGiveSize'))}</button>`
      : !d
        ? K.skelBox()
        : d.error
          ? `<div class="emptybox">${esc(`${t('error')}: ${d.error}`)}</div>`
          : picks.length
            ? picks.map((p, i) => `<div class="ydpick" style="animation-delay:${i * 80}ms"><span class="ic">${I.sprout}</span><div><b>${esc(plantName(p.key))}</b><div class="muted small">${esc([t('ydSowNow'), p.count ? fmt('ydCount', { n: num(p.count) }) : fmt('ydBed', { n: num(p.bedM2) }), fmt('ydDays', { a: num(p.days[0]), b: num(p.days[1]) })].join(' · '))}</div>${p.trellis || p.pot || p.stake ? `<div class="muted small">${esc([p.trellis ? t('ydNeedTrellis') : '', p.stake ? t('ydNeedStake') : '', p.pot ? t('ydNeedPot') : ''].filter(Boolean).join(' · '))}</div>` : ''}</div></div>`).join('')
            : `<div class="emptybox">${esc(t('ydNoPicks'))}</div>`;
    $('#ydWhy').textContent = d?.cls ? `${fmt('ydWhyT', { size: t(`ydCls_${d.cls}`), sun: sunWord(y.sun), month: monthName(d.month) })}${d.southAsia ? '' : ` ${t('ydTuned')}`}` : '';
    const L = d?.list;
    $('#ydList').innerHTML = L
      ? `<div class="ydlines">${L.lines.map((l) => `<div><span>${esc(lineName(l))}</span><span>${esc(money(l.price, L.currency.symbol))}</span></div>`).join('')}<div class="tot"><span>${esc(t('ydTotal'))}</span><span>${esc(money(L.total, L.currency.symbol))}</span></div></div>`
      : '';
    $('#ydShops').innerHTML = Y.shops ? shopsHtml(Y.shops) : '';
    $('#ydFindShops').hidden = !L || Boolean(Y.shops);
    $('#ydCopy').hidden = !L;
    $('#ydShare').hidden = !L;
    $('#ydRemove').textContent = t(Y.sure ? 'ydRemoveSure' : 'ydRemove');
    $('#ydRemove').hidden = S.view === 'demo' && !S.admin;
  }
  function lineName(l) {
    const p = l.plant ? plantName(l.plant) : '';
    if (l.item === 'seed') return fmt('ydSeedL', { p });
    if (l.item === 'sapling' || l.item === 'tree') return fmt('ydSaplingL', { p, n: num(l.qty) });
    if (l.item === 'trellis') return fmt('ydTrellisL', { p });
    if (l.item === 'stake') return fmt('ydStakeL', { n: num(l.qty) });
    if (l.item === 'pot') return fmt('ydPotL', { n: num(l.qty) });
    return t('ydCompostL');
  }
  function shopsHtml(r) {
    if (r.error) return `<p class="muted small">${esc(`${t('error')}: ${r.error}`)}</p>`;
    if (!r.shops?.length) return `<p class="muted small">${esc(t('ydNoShops'))}</p>`;
    return `<div class="ydshops">${r.shops.map((s) => `<div class="ydshop"><b>${esc(s.name)}</b><span class="km">${esc(num(s.km, 1))} km</span>${s.address ? `<div class="muted small">${esc(s.address)}</div>` : ''}</div>`).join('')}<div class="muted small">${esc(fmt('fromSrc', { src: r.source || '' }))}</div></div>`;
  }
  function listText() {
    const L = Y.d?.list;
    if (!L) return '';
    return [`${t('ydBuyH')} (${yardTitle(S.yard)})`, ...L.lines.map((l) => `- ${lineName(l)}: ${money(l.price, L.currency.symbol)}`), `${t('ydTotal')}: ${money(L.total, L.currency.symbol)} (${t('samplePrices')})`].join('\n');
  }
  $('#ydFindShops').addEventListener('click', async () => {
    if (!S.yard) return;
    $('#ydFindShops').disabled = true;
    const r = await api(`/api/yards/${S.yard.id}/shops`).catch((e) => ({ ok: false, error: e.message }));
    $('#ydFindShops').disabled = false;
    Y.shops = r.ok ? r : { error: r.error };
    renderHome();
  });
  $('#ydCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(listText());
      toast(t('copied'));
    } catch {
      toast(t('error'));
    }
  });
  $('#ydResize').addEventListener('click', () => S.yard && openAdd(S.yard));
  $('#dashYard').addEventListener('click', (e) => {
    if (e.target.closest('[data-ydsize]') && S.yard) openAdd(S.yard);
  });
  $('#ydRemove').addEventListener('click', async () => {
    if (!S.yard) return;
    if (!Y.sure) {
      Y.sure = true;
      renderHome();
      return setTimeout(() => {
        Y.sure = false;
        if (S.mode === 'yard') renderHome();
      }, 4000);
    }
    const r = await api(`/api/yards/${S.yard.id}`, { method: 'DELETE' }).catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) return toast(r.error || t('error'));
    S.yard = null;
    await loadYards();
    if (S.yards[0]) return open(S.yards[0].id);
    K.store.set('ks_mode', 'field');
    if (S.lands[0]) return K.openLand(S.lands[0].id);
    S.mode = 'field';
    K.renderAll();
  });

  // ---------- the farm list ----------
  function listHtml() {
    return S.yards.length
      ? S.yards.map((y, i) => `<button class="fitem ${S.mode === 'yard' && y.id === S.yard?.id ? 'on' : ''}" data-yard="${y.id}" style="animation-delay:${i * 60}ms"><span class="th">${I.home}</span><span class="m"><b>${esc(yardTitle(y))}</b><div>${esc(y.size_m2 ? `${num(Math.round(y.size_m2))} ${unitWord('m2')}` : t('ydNoSize'))} · ${esc(new Date(y.created_at).toLocaleDateString(K.loc(), { day: 'numeric', month: 'short' }))}</div></span></button>`).join('')
      : `<div class="muted">${esc(t('noYards'))}</div>`;
  }

  // ---------- adding a yard ----------
  function step(n) {
    [1, 2, 3].forEach((i) => ($(`#yd${i}`).hidden = i !== n));
    $('#yardSheet').scrollTop = 0;
  }
  function setLoc(lat, lon, label, place = null) {
    Object.assign(Y.add, { lat, lon, place });
    $('#ydLoc').textContent = label || (lat != null ? `${num(lat, 4)}, ${num(lon, 4)}` : '');
    $('#ydNext').disabled = !(Y.add.photo && (place || (Number.isFinite(lat) && Number.isFinite(lon))));
  }
  function openAdd(existing = null) {
    Y.add = { lat: null, lon: null, place: null, photo: null, yard: existing || null, unit: null, sun: existing?.sun || 'half' };
    $('#ydPrev').hidden = true;
    $('#ydLoc').textContent = '';
    $('#ydNext').disabled = true;
    $('#ydPresets').hidden = S.view !== 'demo';
    $('#ydPresets').innerHTML = ['bogura', 'bolpur'].map((p) => `<button class="chip" type="button" data-pre="${p}">${I.pin}${esc(t(`place_${p}`))}</button>`).join('');
    $('#yardSheet').hidden = false;
    if (existing) return askSize(existing);
    step(1);
  }
  $('#yardClose').addEventListener('click', () => ($('#yardSheet').hidden = true));
  $('#ydPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pre]');
    if (!b) return;
    $$('#ydPresets .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    setLoc(null, null, `${t(`place_${b.dataset.pre}`)} · ${t('demoPlot')}`, b.dataset.pre);
  });
  $('#ydGps').addEventListener('click', () => {
    if (!navigator.geolocation) return toast(t('locDenied'));
    $('#ydLoc').textContent = t('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc(p.coords.latitude, p.coords.longitude, fmt('gpsOk', { lat: num(p.coords.latitude, 4), lon: num(p.coords.longitude, 4), m: num(p.coords.accuracy) })),
      () => ($('#ydLoc').textContent = t('locDenied')),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
  $('#ydPhotoIn').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const gps = K.exifGPS(await f.arrayBuffer());
    Y.add.photo = await K.shrink(f, 1280);
    $('#ydPimg').src = Y.add.photo;
    $('#ydPrev').hidden = false;
    if (gps) setLoc(gps.lat, gps.lon, t('gpsFromPhoto'));
    else {
      setLoc(Y.add.lat, Y.add.lon, Y.add.lat != null ? '' : t('noPhotoGps'), Y.add.place);
      if (Y.add.lat == null && !Y.add.place) $('#ydGps').click();
    }
  });
  $('#ydNext').addEventListener('click', async () => {
    step(2);
    const body = { photoDataUrl: Y.add.photo, lang: K.lang() };
    if (Y.add.place) body.place = Y.add.place;
    else Object.assign(body, { lat: Y.add.lat, lon: Y.add.lon });
    const r = await postJson('/api/yards', body).catch((err) => ({ ok: false, error: err.message }));
    if (!r.ok) {
      step(1);
      return toast(`${t('error')}: ${r.error}`);
    }
    Y.add.yard = r.yard;
    askSize(r.yard);
  });

  // The size question, in the units of the yard's country (feet first; শতাংশ / डिसमिल / square feet for bigger spaces).
  const PAIR = { ft: true, m: true };
  function askSize(y) {
    step(3);
    $('#ydPic2').innerHTML = `${picHtml(y)}<div class="zinfo">${esc(samLine(y))}</div>`;
    const units = y.units || ['m', 'm2'];
    Y.add.unit = Y.add.unit || units[0];
    $('#ydQ').textContent = fmt('ydQ', { small: unitWord(units[0]), big: unitWord(units[1] || units[0]) });
    $('#ydUnits').innerHTML = [...units, 'unknown'].map((u) => `<button class="chip" type="button" data-unit="${u}" aria-pressed="${u === Y.add.unit}">${esc(u === 'unknown' ? t('ydDontKnow') : PAIR[u] ? fmt('ydByUnit', { u: unitWord(u) }) : unitWord(u))}</button>`).join('');
    $('#ydSun').innerHTML = ['full', 'half', 'shade'].map((s) => `<button class="chip" type="button" data-sun="${s}" aria-pressed="${s === Y.add.sun}">${esc(sunWord(s))}</button>`).join('');
    if (y.size) {
      if (y.size.a != null) $('#ydA').value = y.size.a;
      if (y.size.b != null) $('#ydB').value = y.size.b;
      if (y.size.n != null) $('#ydN').value = y.size.n;
    }
    paintUnit();
  }
  function paintUnit() {
    const u = Y.add.unit;
    $('#ydAB').hidden = !PAIR[u];
    $('#ydNBox').hidden = PAIR[u] || u === 'unknown' || u === 'bigha';
    $('#ydAL').textContent = fmt('ydLen', { u: unitWord(u) });
    $('#ydBL').textContent = fmt('ydWid', { u: unitWord(u) });
    $('#ydNL').textContent = fmt('ydHowMany', { u: unitWord(u) });
    $('#ydAsk').hidden = !['bigha', 'unknown'].includes(u);
    $('#ydAsk').textContent = u === 'bigha' ? t('ydBigha') : u === 'unknown' ? t('ydUnknownNote') : '';
    $('#ydShow').disabled = u === 'bigha';
  }
  $('#ydUnits').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unit]');
    if (!b) return;
    Y.add.unit = b.dataset.unit;
    $$('#ydUnits .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    paintUnit();
  });
  $('#ydSun').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sun]');
    if (!b) return;
    Y.add.sun = b.dataset.sun;
    $$('#ydSun .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
  });
  $('#ydShow').addEventListener('click', async () => {
    const y = Y.add.yard;
    if (!y) return;
    const u = Y.add.unit;
    const size = PAIR[u] ? { unit: u, a: $('#ydA').value, b: $('#ydB').value } : u === 'unknown' ? { unit: 'unknown' } : { unit: u, n: $('#ydN').value };
    $('#ydShow').disabled = true;
    const r = await api(`/api/yards/${y.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size, sun: Y.add.sun }) }).catch((err) => ({ ok: false, error: err.message }));
    $('#ydShow').disabled = false;
    if (!r.ok) return toast(r.error || t('error'));
    if (r.ask || r.sizeError) {
      $('#ydAsk').hidden = false;
      $('#ydAsk').textContent = r.ask === 'field' ? t('ydIsField') : r.ask === 'bigha' ? t('ydBigha') : t(r.sizeError === 'tiny' ? 'ydTooSmall' : 'ydNumErr');
      return;
    }
    $('#yardSheet').hidden = true;
    await loadYards();
    await open(y.id);
    K.show('home');
  });

  // ---------- help: the nearest agriculture office ----------
  function officeHtml(h) {
    if (!h || h.error) return esc(t('helpNone'));
    const offices = h.offices || [];
    const rows = offices
      .map(
        (o) =>
          `<div class="office"><div class="top2"><b>${esc(o.name)}</b><span class="km">${esc(num(o.km, 1))} km</span></div>${o.address ? `<div class="muted small">${esc(o.address)}</div>` : ''}${o.phone ? '' : `<div class="muted small">${esc(t('noPhoneMaps'))}</div>`}<div class="btns">${o.tel ? `<a class="btn" href="tel:${esc(o.tel)}">${I.phone}${esc(t('callBtn'))}</a>` : ''}<a class="btn ghost" href="${esc(o.directions)}" target="_blank" rel="noopener">${esc(t('dirBtn'))}</a></div></div>`
      )
      .join('');
    const src = offices.length ? `<div class="muted small">${esc(fmt('fromSrc', { src: h.source || '' }))}</div>` : `<div class="muted small">${esc(t('noOffice'))}</div>`;
    const hot = h.hotline ? `<div class="hot"><b>${esc(h.hotline.name)}</b><div class="num">${esc(K.digits(h.hotline.number))}</div><div class="small">${esc(h.hotline.hours)}</div><a class="btn" href="tel:${esc(h.hotline.tel)}">${I.phone}${esc(fmt('callNum', { n: K.digits(h.hotline.number) }))}</a></div>` : '';
    // v0.16.0: send the offices on (WhatsApp, through the phone's own share sheet), or photograph the problem.
    const text = [t('helpH'), ...offices.map((o) => `${o.name} (${num(o.km, 1)} km)${o.phone ? `: ${o.phone}` : ''}${o.address ? `, ${o.address}` : ''}`), h.hotline ? `${h.hotline.name}: ${h.hotline.number}` : ''].filter(Boolean).join('\n');
    const acts = `<div class="btns"><button class="btn turm" type="button" data-problem>${I.camera}${esc(t('pbTake'))}</button><button class="btn ghost" type="button" data-sharetext="${esc(encodeURIComponent(text))}">${esc(t('shareWa'))}</button></div>`;
    return `${rows}${src}${hot}${acts}<div class="muted small">${esc(t('helpSoon'))}</div>`;
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-help]')) K.ask(t('qHelp'));
  });

  $('#ydShare').addEventListener('click', () => window.KSProblem?.share(listText()));
  window.KSYard = { loadYards, open, hero, renderHome, headerLine, listHtml, openAdd, officeHtml, yardTitle, picks: () => Y.d?.picks || [], details: () => Y.d || {} };
})();
