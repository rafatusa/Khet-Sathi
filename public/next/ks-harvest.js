// Khet Sathi v0.12.0: a crop already growing on a field, followed to harvest and sale.
// When: the sowing date (the farmer's, or estimated from Sentinel-2 greenness) and the district's crop
// calendar (MIRCA-OS, FAO in Bangladesh). How much: acres x the country's average yield (FAOSTAT).
// Demo lands: sample prices and scripted demo calls to fictional buyers and crews, always tagged Demo.
// Real lands: no price, real buyers only, and "Sathi will call and update you" with a coming-soon note.
(() => {
  'use strict';
  const K = window.KS;
  if (!K) return;
  const { S, $, I, t, fmt, num, esc, fd, money, toast, api, postJson, emptyBox, cropName } = K;
  const L = () => K.lang();
  const H = { data: null, key: null, loading: null, run: null, pick: null, rule: null };
  const keyOf = () => (S.cur ? `${S.cur.id}|${S.cur.crop}|${S.cur.sown_on || ''}` : null);
  const unitT = (u) => t(`u_${u?.key || 't'}`);
  const sym = () => H.data?.currency?.symbol || '';
  const m = (n) => money(n, sym());
  const isDemo = () => Boolean(H.data?.demoLand);
  const soon = (title) => window.KSShed?.comingSoon(title || t('callSoonH'), t('callSoonT'));

  // ================= data =================
  function load(force = false) {
    const key = keyOf();
    if (!key) return null;
    if (!force && H.key === key && (H.data || H.loading)) return H.loading;
    H.key = key;
    H.buyersFor = null;
    H.data = null;
    H.run = null;
    H.pick = null;
    H.loading = api(`/api/lands/${S.cur.id}/harvest`)
      .then((r) => {
        if (keyOf() !== key) return;
        H.data = r.ok ? r : { error: r.error || 'error' };
        H.rule = H.data.rule ? { ...H.data.rule } : defaultRule();
        if (H.data.rule?.last_run?.status === 'open') H.run = H.data.rule.last_run;
        K.renderAll();
      })
      .catch((err) => (H.data = { error: err.message }))
      .finally(() => (H.loading = null));
    return H.loading;
  }
  function defaultRule() {
    const d = H.data || {};
    return { floor_price: d.samplePrice ? Math.round((d.samplePrice * 0.97) / 10) * 10 : null, qty: d.amount?.units || null, when: 'harvest', ask_first: true };
  }
  const ready = () => H.data?.ready || null;

  // ================= Home =================
  function hero() {
    load();
    const r = ready();
    const crop = cropName(S.cur.crop);
    const ask = () => K.ask(fmt('qPlanHarvest', { crop }));
    if (!H.data) return { big: crop, sub: '', cta: t('askSaathi'), icon: 'chat', go: ask };
    if (!r) return { big: crop, sub: t('noSowDate'), cta: t('setSowDate'), icon: 'clock', go: () => openGrow({ land: S.cur, plan: S.plan }) };
    const big = r.stage === 'ready' ? fmt('heroHarvestNow', { crop }) : r.stage === 'late' ? fmt('heroHarvestLate', { crop }) : fmt('heroHarvestIn', { crop, n: num(r.daysLeft) });
    const sub = [fmt('harvestWin', { a: fd(r.harvestStart), b: fd(r.harvestEnd) }), r.stage === 'ripening' ? t('turning') : ''].filter(Boolean).join(' · ');
    return { big, sub, cta: t('bookHarvester'), icon: 'harvester', go: () => book('harvester') };
  }

  function ringSvg(pct) {
    return `<div class="ringwrap"><svg viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="50" class="rbg" pathLength="100"/><circle cx="60" cy="60" r="50" class="rfg hv" pathLength="100" style="stroke-dasharray:${pct} 100"/></svg><div class="ringv"><b>${esc(num(pct))}%</b></div></div>`;
  }
  function renderHome() {
    load();
    const d = H.data;
    if (!d) {
      ['#hvReady', '#hvBook', '#hvSell'].forEach((s) => ($(s).innerHTML = K.skelBox()));
      return;
    }
    if (d.error) {
      $('#hvReady').innerHTML = emptyBox(`${t('error')}: ${d.error}`);
      $('#hvBook').innerHTML = '';
      $('#hvSell').innerHTML = '';
      return;
    }
    const r = d.ready;
    $('#hvCalSrc').textContent = r?.calendar?.source || 'MIRCA-OS';
    if (!r) {
      $('#hvReady').innerHTML = `${emptyBox(t('noSowDate'))}<button class="btn" type="button" data-hv="sow">${esc(t('setSowDate'))}</button>`;
    } else {
      const lines = [
        fmt('daysGrown', { a: num(r.grown), b: num(r.total) }),
        r.peak && r.now && r.now.date > r.peak.date ? fmt('peakLine', { date: fd(r.peak.date), v: num(r.peak.ndvi, 2), w: num(r.now.ndvi, 2) }) : '',
        r.stage === 'growing' || r.stage === 'ripening' ? fmt('winOpens', { date: fd(r.harvestStart) }) : fmt('harvestWin', { a: fd(r.harvestStart), b: fd(r.harvestEnd) }),
        d.estimated ? fmt('sownEst', { date: fd(d.sownOn) }) : fmt('sownOnL', { date: fd(d.sownOn) }),
      ].filter(Boolean);
      const tone = r.stage === 'late' ? 'bad' : r.stage === 'ready' ? 'ok' : 'warn';
      $('#hvReady').innerHTML = `<div class="hvready">${ringSvg(r.pct)}<div><span class="pill ${tone}">${esc(t(`st_${r.stage}`))}</span>${lines.map((x) => `<div class="muted small">${esc(x)}</div>`).join('')}${d.estimated ? `<button class="linkbtn" type="button" data-hv="sow">${esc(t('setSowDate'))}</button>` : ''}</div></div>${curveSvg(r.curve, r.sownOn)}`;
    }
    const ac = Number(S.cur.acres) || 0;
    const q = d.amount?.units;
    $('#hvBookTag').hidden = !isDemo();
    $('#hvBook').innerHTML =
      [
        ['harvester', I.harvester, t('harvesterL'), fmt('harvesterS', { ac: num(ac, 2), date: fd(r?.harvestStart) })],
        ['transport', I.tractor, t('transportL'), fmt('transportS', { q: num(q || 0, 1), u: unitT(d.unit) })],
      ]
        .map(([w, ic, a, b]) => `<div class="bookrow"><span class="bic">${ic}</span><span class="nm"><b>${esc(a)}</b><small>${esc(b)}</small></span><button class="btn" type="button" data-book="${w}" aria-label="${esc(`${t('book')}: ${a}`)}">${esc(t('book'))}</button></div>`)
        .join('') + `<p class="muted small">${esc(t(isDemo() ? 'bookNoteDemo' : 'bookNoteReal'))}</p>`;
    $('#hvSellTag').hidden = !isDemo();
    $('#hvSell').innerHTML = q
      ? `<div class="bigstat"><b>${esc(fmt('aboutQty', { q: num(q, 1), u: unitT(d.unit) }))}</b></div><div class="muted small">${esc(fmt('qtyHow', { ac: num(ac, 2), crop: cropName(S.cur.crop), country: S.plan?.place?.country || '' }))}${d.samplePrice ? ` · ${esc(fmt('samplePriceLine', { p: m(d.samplePrice), u: unitT(d.unit) }))}` : ''}</div><div class="btns"><button class="btn" type="button" data-hv="rule">${esc(t('setRule'))}</button><button class="btn ghost" type="button" data-hv="buyers">${esc(t('seeBuyers'))}</button></div>`
      : `${emptyBox(t('noYield'))}<div class="btns"><button class="btn ghost" type="button" data-hv="buyers">${esc(t('seeBuyers'))}</button></div>`;
  }
  // Greenness this season (Sentinel-2 NDVI), from the sowing date.
  function curveSvg(curve) {
    if (!curve || curve.length < 2) return '';
    const W = 320;
    const Hh = 70;
    const x = (i) => 6 + (i / (curve.length - 1)) * (W - 12);
    const y = (v) => Hh - 6 - Math.max(0, Math.min(1, v)) * (Hh - 14);
    const d = curve.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.ndvi).toFixed(1)}`).join(' ');
    return `<svg class="chart hvcurve" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="NDVI"><path class="ln draw" pathLength="1" d="${d}" stroke="var(--leaf)"/><circle class="end" cx="${x(curve.length - 1)}" cy="${y(curve.at(-1).ndvi)}" r="4" fill="var(--turmeric)"/><text x="6" y="10">NDVI · ${esc(fd(curve[0].date))} – ${esc(fd(curve.at(-1).date))}</text></svg>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hv],[data-book]');
    if (!b || !b.closest('#dashCrop')) return;
    if (b.dataset.book) return book(b.dataset.book);
    if (b.dataset.hv === 'sow') return openGrow({ land: S.cur, plan: S.plan });
    K.show('market');
  });

  // Season steps from the real sowing date: sow, fertilizer, irrigate, harvest, transport, sell.
  function steps() {
    const r = ready();
    if (!r) return null;
    const a = K.addDays;
    return [
      { id: 'sow', icon: 'tractor', date: r.sownOn },
      { id: 'fert', icon: 'fert', date: a(r.sownOn, 21) },
      { id: 'water', icon: 'drop', date: a(r.sownOn, 35) },
      { id: 'harvest', icon: 'harvester', date: r.harvestStart },
      { id: 'transport', icon: 'tractor', date: a(r.harvestStart, 1) },
      { id: 'sell', icon: 'rupee', date: a(r.harvestStart, 1) },
    ];
  }

  // ================= booking the harvest =================
  async function book(what) {
    if (!H.data || H.data.error) return;
    if (!isDemo()) return soon(t(what === 'harvester' ? 'harvesterL' : 'transportL'));
    try {
      const r = await postJson(`/api/lands/${S.cur.id}/harvest/book`, { what, lang: L() });
      if (!r.ok) throw new Error(r.error);
      if (r.comingSoon) return soon();
      const s = r.currency?.symbol || sym();
      await K.loadSide();
      window.KSShed?.playCalls(
        r.calls.map((c) => ({ name: c.to, av: t('shopInitial'), turns: c.turns })),
        { summary: { title: t('bookedH'), items: r.calls.map((c) => `${c.to}: ${money(c.total, s)} · ${fd(c.when)}`) } }
      );
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    }
  }

  // ================= Market: rule, demo buyers, real buyers =================
  function renderMarket() {
    load();
    const d = H.data;
    if (!d) {
      $('#mcRule').innerHTML = K.skelBox();
      $('#mcOffers').innerHTML = '';
      $('#mcBuyers').innerHTML = emptyBox(t('findingBuyers'));
      return;
    }
    if (d.error) return ($('#mcRule').innerHTML = emptyBox(`${t('error')}: ${d.error}`));
    const r = H.rule;
    const u = unitT(d.unit);
    $('#mcTag').hidden = !isDemo();
    $('#mcRule').innerHTML = `
      <div class="ruleopt"><span>${esc(t('sellQtyL'))}</span><div class="stepper"><button type="button" class="iconbtn" data-mc="qty:-1" aria-label="${esc(`${t('agLess')}: ${t('sellQtyL')}`)}">−</button><b>${esc(r.qty ? `${num(r.qty, 1)} ${u}` : '-')}</b><button type="button" class="iconbtn" data-mc="qty:1" aria-label="${esc(`${t('agMore')}: ${t('sellQtyL')}`)}">+</button></div>${d.amount ? `<small class="muted">${esc(fmt('aboutQty', { q: num(d.amount.units, 1), u }))}</small>` : ''}</div>
      <label class="ruleopt"><span>${esc(fmt('floorL', { u }))}</span><span class="floorin"><span>${esc(sym())}</span><input id="mcFloor" inputmode="numeric" value="${r.floor_price ?? ''}" placeholder="${esc(d.samplePrice ? String(d.samplePrice) : '')}"></span><small class="muted">${esc(d.samplePrice ? t('floorHint') : t('noRealPrice'))}</small></label>
      <div class="ruleopt"><span>${esc(t('whenL'))}</span><div class="chips">${['harvest', 'hold30'].map((w) => `<button type="button" class="chip" data-when="${w}" aria-pressed="${r.when === w}">${esc(t(w === 'harvest' ? 'whenHarvest' : 'whenHold'))}</button>`).join('')}</div></div>
      <label class="ruleopt"><label><input type="checkbox" id="mcAsk" ${r.ask_first !== false ? 'checked' : ''}><span>${esc(t('askMe'))}</span></label></label>
      <div class="btns"><button class="btn ghost" type="button" id="mcSave">${esc(t('saveRule'))}</button></div>
      <button class="cta wide" type="button" id="mcCall"><span>${I.chat}</span><span>${esc(t(isDemo() ? 'callBuyers' : 'callBuyersReal'))}</span></button>
      <p class="muted small">${esc(t(isDemo() ? 'buyerNoteDemo' : 'buyerNoteReal'))}</p>`;
    renderOffers();
    renderBuyers();
  }
  function renderOffers() {
    const run = H.run;
    $('#mcOffersH').closest('.lab').hidden = !isDemo();
    if (!isDemo()) return ($('#mcOffers').innerHTML = '');
    if (!run) return ($('#mcOffers').innerHTML = `<div class="emptybox">${esc(t('buyerNoteDemo'))}</div>`);
    const u = unitT(run.unit);
    const ranked = (run.ranked || []).map((id) => run.shops.find((s) => s.contact_id === id)).filter(Boolean);
    if (!H.pick) H.pick = ranked.find((s) => s.price)?.contact_id || null;
    const pick = run.shops.find((s) => s.contact_id === H.pick);
    const name = (s) => s.names?.[L()] || s.name;
    $('#mcOffers').innerHTML =
      `<div class="offers" role="radiogroup">${ranked
        .map((s, i) => `<button type="button" class="offer" role="radio" aria-checked="${s.contact_id === H.pick}" data-offer="${s.contact_id}" ${s.price ? '' : 'disabled'}><div><b>${esc(name(s))}</b>${s.price && i === 0 ? ` <span class="pill ok">${esc(t('bestTag'))}</span>` : ''}<div class="muted small">${esc(s.price ? fmt('collects', { when: s.pickup }) : fmt('belowFloor', { p: money(s.best, run.currency.symbol) }))}</div></div>${s.price ? `<b>${esc(fmt('perUnit', { p: money(s.price, run.currency.symbol), u }))}</b>` : `<span class="pill bad">${esc(t('noDealT'))}</span>`}</button>`)
        .join('')}</div>` +
      (pick
        ? `<div class="mktotal"><span>${esc(fmt('qtyTotal', { q: num(run.qty, 1), u, p: money(pick.price, run.currency.symbol) }))}</span><b>${esc(money(pick.price * run.qty, run.currency.symbol))}</b></div><button class="cta wide" type="button" id="mcSell"><span>${I.check}</span><span>${esc(t('agreeSell'))}</span></button>`
        : `<div class="emptybox">${esc(t('offersNone'))}</div>`) +
      `<div class="btns"><button class="btn ghost" type="button" id="mcReplay">${esc(t('hearCalls'))}</button></div>`;
  }
  // v0.13.0: real buyers are looked up only when the Market opens (one shop search per visit).
  function renderBuyers() {
    const d = H.data;
    if (H.buyersFor !== H.key) {
      H.buyersFor = H.key;
      $('#mcBuyers').innerHTML = emptyBox(t('findingBuyers'));
      const key = H.key;
      api(`/api/lands/${S.cur.id}/harvest?buyers=1`)
        .then((r) => {
          if (H.key !== key || !H.data) return;
          Object.assign(H.data, { buyers: r.ok ? r.buyers || [] : [], buyerSource: r.buyerSource || null, buyerError: r.ok ? r.buyerError : r.error });
          if (K.S.tab === 'market') renderBuyers();
        })
        .catch(() => null);
      return;
    }
    const list = d.buyers || [];
    const credit = d.buyerSource === 'Google Places' ? '<div class="gattr" translate="no" aria-label="Google Maps">Google Maps</div>' : '<div class="gattr osm" translate="no">© OpenStreetMap contributors</div>';
    $('#mcBuyers').innerHTML = list.length
      ? `<div class="shopbox real">${list.map((s, i) => `<button type="button" class="shopb" data-buyer="${i}"><span>${I.pin}</span><span class="nm"><b>${esc(s.name)}</b><small>${esc([s.km != null ? fmt('kmAway', { km: num(s.km, 1) }) : '', s.address || ''].filter(Boolean).join(' · '))}</small></span></button>`).join('')}${credit}</div>`
      : `<div class="emptybox">${esc(d.buyerError ? t('shopSearchDown') : t('noBuyersNear'))}</div>`;
  }
  function readRule() {
    const f = Number(String($('#mcFloor')?.value || '').replace(/[^\d.]/g, ''));
    H.rule.floor_price = f > 0 ? Math.round(f) : null;
    H.rule.ask_first = $('#mcAsk') ? $('#mcAsk').checked : H.rule.ask_first;
  }
  async function saveRule(quiet = false) {
    readRule();
    if (!H.rule.floor_price) {
      toast(t('floorNeed'));
      return false;
    }
    const r = await postJson(`/api/lands/${S.cur.id}/harvest/rule`, H.rule).catch((err) => ({ ok: false, error: err.message }));
    if (!r.ok) {
      toast(`${t('error')}: ${r.error}`);
      return false;
    }
    H.rule = { ...r.rule };
    if (!quiet) toast(t('ruleSaved'));
    return true;
  }
  function playRun() {
    const run = H.run;
    const u = unitT(run.unit);
    window.KSShed?.playCalls(
      run.shops.map((s, i) => ({ name: s.names?.[L()] || s.name, av: t('shopInitial'), info: fmt('buyerCallInfo', { i: num(i + 1), n: num(run.shops.length), q: num(run.qty, 1), u, floor: money(run.floor, run.currency.symbol) }), turns: s.turns })),
      { next: { label: t('offersH'), go: () => K.show('market') } }
    );
  }
  async function callBuyers() {
    if (!isDemo()) return soon(t('callBuyersReal'));
    if (!(await saveRule(true))) return;
    $('#mcCall').disabled = true;
    try {
      const r = await postJson(`/api/lands/${S.cur.id}/harvest/run`, { lang: L(), cropName: cropName(S.cur.crop) });
      if (!r.ok) throw new Error(r.error);
      if (r.comingSoon) return soon();
      H.run = r.run;
      H.pick = null;
      renderOffers();
      playRun();
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    } finally {
      if ($('#mcCall')) $('#mcCall').disabled = false;
    }
  }
  async function sell() {
    if (!H.run || !H.pick) return;
    $('#mcSell').disabled = true;
    try {
      const r = await postJson(`/api/lands/${S.cur.id}/harvest/confirm`, { runId: H.run.id, buyerId: H.pick });
      if (!r.ok) throw new Error(r.error);
      const s = H.run.shops.find((x) => x.contact_id === H.pick);
      const msg = fmt('soldMsg', { shop: s.names?.[L()] || s.name, total: money(r.total, H.run.currency.symbol) });
      toast(msg);
      K.speak(msg);
      H.run = null;
      H.pick = null;
      await K.loadSide();
      renderMarket();
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
      if ($('#mcSell')) $('#mcSell').disabled = false;
    }
  }
  $('#mkCrop').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mc) {
      readRule();
      const step = Number(b.dataset.mc.split(':')[1]);
      const base = H.rule.qty ?? H.data?.amount?.units ?? 1;
      const by = base >= 10 ? 1 : 0.5;
      H.rule.qty = Math.max(by, Math.round((base + step * by) * 10) / 10);
      return renderMarket();
    }
    if (b.dataset.when) {
      readRule();
      H.rule.when = b.dataset.when;
      return renderMarket();
    }
    if (b.dataset.offer && !b.disabled) {
      H.pick = b.dataset.offer;
      return renderOffers();
    }
    if (b.dataset.buyer) {
      const s = (H.data?.buyers || [])[+b.dataset.buyer];
      return soon(s ? fmt('willCall', { shop: s.name }) : null);
    }
    if (b.id === 'mcSave') return saveRule();
    if (b.id === 'mcCall') return callBuyers();
    if (b.id === 'mcSell') return sell();
    if (b.id === 'mcReplay' && H.run) return playRun();
  });

  // ================= "Something is growing": crop and sowing date =================
  const G = { land: null, plan: null, done: null, crop: null, when: null };
  const FALLBACK = ['rice', 'wheat', 'maize', 'potato', 'mustard', 'lentil'];
  const today = () => G.plan?.today || new Date().toISOString().slice(0, 10);
  function monthsAgo(n) {
    const d = new Date(`${today()}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - n);
    if (n === 0) d.setUTCDate(Math.max(1, d.getUTCDate() - 10));
    return d.toISOString().slice(0, 10);
  }
  function openGrow({ land, plan, done = null }) {
    if (!land) return;
    Object.assign(G, { land, plan, done, crop: land.kind === 'crop' ? land.crop : null, when: null });
    // Crops grown in this district, largest area first (MIRCA-OS); else the suggestions and the calendar.
    const keys = [...new Set([...(plan?.growCalendar || []).map((c) => c.key), ...(plan?.crops || []).map((c) => c.key), ...(plan?.calendar || []).map((c) => c.key)])].slice(0, 10);
    const list = keys.length ? keys : FALLBACK;
    if (G.crop && !list.includes(G.crop)) list.unshift(G.crop);
    $('#growCrops').innerHTML = list.map((k) => `<button type="button" class="chip" data-gc="${k}" aria-pressed="${k === G.crop}">${esc(cropName(k))}</button>`).join('');
    const opts = [['m0', t('sownThis')], ['m1', t('sownAgo1')], ['m2', fmt('sownAgo', { n: num(2) })], ['m3', fmt('sownAgo', { n: num(3) })], ['m4', fmt('sownAgo', { n: num(4) })], ['date', t('pickDate')], ['unsure', t('notSure')]];
    $('#growWhen').innerHTML = opts.map(([k, v]) => `<button type="button" class="chip" data-gw="${k}" aria-pressed="false">${esc(v)}</button>`).join('');
    $('#growDateBox').hidden = true;
    $('#growDate').max = today();
    $('#growDate').value = land.sown_on || '';
    const area = keys.length ? K.cropArea(plan) : '';
    $('#growNote').textContent = area ? fmt('growNote', { area }) : '';
    $('#growSheet').hidden = false;
  }
  $('#growCrops').addEventListener('click', (e) => {
    const b = e.target.closest('[data-gc]');
    if (!b) return;
    G.crop = b.dataset.gc;
    $('#growCrops').querySelectorAll('[data-gc]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#growWhen').addEventListener('click', (e) => {
    const b = e.target.closest('[data-gw]');
    if (!b) return;
    G.when = b.dataset.gw;
    $('#growWhen').querySelectorAll('[data-gw]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#growDateBox').hidden = G.when !== 'date';
  });
  $('#growClose').addEventListener('click', () => ($('#growSheet').hidden = true));
  $('#growSave').addEventListener('click', async () => {
    if (!G.crop) return toast(t('pickCropNeed'));
    let sown = null;
    if (G.when === 'date') sown = $('#growDate').value || null;
    else if (G.when && G.when.startsWith('m')) sown = monthsAgo(Number(G.when.slice(1)));
    if (sown && sown > today()) sown = today();
    $('#growSave').disabled = true;
    try {
      const r = await api(`/api/lands/${G.land.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'crop', crop: G.crop, sown_on: sown }) });
      if (!r.ok) throw new Error(r.error);
      $('#growSheet').hidden = true;
      if (G.done) return G.done();
      await K.loadLands();
      await K.openLand(G.land.id);
      K.show('home');
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    } finally {
      $('#growSave').disabled = false;
    }
  });

  window.KSHarvest = { load, hero, renderHome, renderMarket, steps, openGrow, data: () => H.data };
})();
