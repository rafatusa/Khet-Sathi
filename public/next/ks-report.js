// Khet Sathi v0.18.0: the weekly farm report for the place on screen (a field, a shed or a yard), built only from
// data the app already has loaded. Send on WhatsApp shares a short text through the phone's own share sheet;
// "Save as PDF" opens the phone's print screen (Save as PDF is built in) with the report laid out for one A4 page.
// Anything from the demo farm or the simulated shed kit is marked as such.
(() => {
  'use strict';
  const K = window.KS;
  if (!K) return;
  const { S, $, t, fmt, num, esc, fd, money } = K;
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (iso, n) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
  const within7 = (iso) => iso && iso.slice(0, 10) >= addDays(today(), -6) && iso.slice(0, 10) <= today();
  const isDemo = () => S.view === 'demo' || S.cur?.location_source === 'demo';
  let R = null; // the report on screen: { title, sub, kpis, chart, done, next, note }

  // ---------- small charts ----------
  function line(values, labels) {
    const v = values.filter((x) => Number.isFinite(x));
    if (v.length < 2) return '';
    const mn = Math.min(...v);
    const mx = Math.max(...v);
    const pts = values.map((x, i) => `${((i * 300) / (values.length - 1)).toFixed(1)},${(52 - ((x - mn) / (mx - mn || 1)) * 40).toFixed(1)}`).join(' ');
    const last = pts.split(' ').pop().split(',');
    return `<svg viewBox="-6 0 312 72" class="repchart" role="img" aria-label="${esc(t('repChartL'))}"><polyline points="${pts}" fill="none" stroke="#2f7a2a" stroke-width="3" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="#e0a21f"/><text x="0" y="70" font-size="10" fill="#5a6553">${esc(labels[0] || '')}</text><text x="300" y="70" font-size="10" fill="#5a6553" text-anchor="end">${esc(labels[labels.length - 1] || '')}</text></svg>`;
  }
  function bars(values, labels) {
    if (!values.some((x) => x != null)) return '';
    const mx = Math.max(1, ...values.map((x) => x || 0));
    const w = 300 / values.length;
    return `<svg viewBox="0 0 300 80" class="repchart" role="img" aria-label="${esc(t('repChartL'))}">${values
      .map((x, i) => {
        const h = ((x || 0) / mx) * 52;
        return `<rect x="${(i * w + w * 0.15).toFixed(1)}" y="${(60 - h).toFixed(1)}" width="${(w * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${i === values.length - 1 ? '#e0a21f' : '#2f7a2a'}" opacity="${x == null ? 0.2 : 0.9}"/><text x="${(i * w + w / 2).toFixed(1)}" y="76" font-size="9" fill="#5a6553" text-anchor="middle">${esc(labels[i] || '')}</text>`;
      })
      .join('')}</svg>`;
  }

  // ---------- one report per kind of place ----------
  function fieldReport() {
    const l = S.cur;
    const p = S.plan;
    const passes = [...(S.field?.health?.passes || [])].filter((x) => !x.cloudy && x.ndvi).reverse();
    const nd = passes.map((x) => x.ndvi.mean);
    const last = nd.at(-1);
    const prev = nd.at(-2);
    const days = p?.weather?.days || [];
    const rain7 = days.slice(0, 7).reduce((a, d) => a + (d.rainMm || 0), 0);
    const growing = Boolean(l?.kind === 'crop' && l?.crop);
    const hv = growing ? window.KSHarvest?.data?.()?.ready : null;
    const crop = growing ? K.cropName(l.crop) : p?.crops?.[0] ? K.cropName(p.crops[0].key) : '';
    const toHarvest = hv?.harvestStart ? Math.max(0, Math.round((Date.parse(`${hv.harvestStart}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 864e5)) : null;
    const kpis = [
      [t('repNdvi'), Number.isFinite(last) ? `${num(last, 2)}${Number.isFinite(prev) ? ` ${last >= prev ? '▲' : '▼'}${num(Math.abs(last - prev), 2)}` : ''}` : '—'],
      [t('repRain7'), days.length ? `${num(rain7)} ${t('mm')}` : '—'],
      growing ? [t('repToHarvest'), toHarvest != null ? fmt('repDays', { n: num(toHarvest) }) : '—'] : [t('repNextPass'), S.field?.health?.next ? fd(S.field.health.next.date) : '—'],
    ];
    const done = [];
    passes.filter((x) => within7(x.date)).forEach((x) => done.push(fmt('repPassDone', { date: fd(x.date), v: num(x.ndvi.mean, 2) })));
    (S.deals || []).filter((d) => d.land_id === l?.id && within7(d.created_at)).forEach((d) => done.push(`${fmt(d.direction === 'sell' ? 'repSold' : 'repBought', { total: money(Number(d.total_inr || 0), (d.items || [])[0]?.symbol || K.curSym()) })}${d.items?.[0]?.simulated !== false ? ` (${t('demoTag')})` : ''}`));
    const al = (S.alerts || []).filter((a) => a.land_id === l?.id && within7(a.created_at)).length;
    if (al) done.push(fmt('repAlerts', { n: num(al) }));
    const next = [];
    if (p?.rain?.rainDate) next.push(fmt('repRainOn', { date: fd(p.rain.rainDate, { weekday: 'long', day: 'numeric', month: 'short' }) }));
    else if (days.length) next.push(t('repNoRain'));
    if (S.field?.health?.next) next.push(fmt('repNextPassOn', { date: fd(S.field.health.next.date) }));
    if (hv?.harvestStart) next.push(fmt('repHarvestFrom', { crop, date: fd(hv.harvestStart) }));
    else if (!growing && p?.crops?.[0]?.windowEnd) next.push(fmt('repSowBy', { crop, date: fd(p.crops[0].windowEnd) }));
    return {
      title: `${K.landTitle(l)} · ${t('repTitle')}`,
      sub: [l?.acres ? `${num(l.acres, 2)} ${t('acShort')}` : '', crop].filter(Boolean).join(' · '),
      kpis,
      chart: line(nd.slice(-8), [passes.slice(-8)[0]?.date, passes.at(-1)?.date].map((d) => (d ? fd(d) : ''))),
      chartH: t('repChartNdvi'),
      done,
      next,
      sources: 'Sentinel-2 · Open-Meteo · FAO',
    };
  }
  function shedReport() {
    const d = window.KSShed?.reportData?.() || {};
    const eggs = (d.eggs || []).slice(-7);
    const have = eggs.filter((x) => x.eggs != null);
    const avg = have.length ? have.reduce((a, x) => a + x.eggs, 0) / have.length : null;
    const sales = (S.deals || []).filter((x) => (x.items || [])[0]?.item === 'eggs' && within7(x.created_at));
    const total = sales.reduce((a, x) => a + Number(x.total_inr || 0), 0);
    const checks = (d.clips || []).filter((c) => within7(c.result?.checkedAt));
    const done = [];
    checks.forEach((c) => done.push(fmt('repCheck', { date: fd(c.result.checkedAt.slice(0, 10)), n: num(c.result.count?.count ?? 0) })));
    sales.forEach((x) => done.push(`${fmt('repSold', { total: money(Number(x.total_inr || 0), K.shedSym()) })} (${t('simulated')})`));
    return {
      title: `${K.shedLine(S.shed)} · ${t('repTitle')}`,
      sub: t('repShedSub'),
      kpis: [
        [t('repEggsToday'), have.length ? num(have.at(-1).eggs) : '—'],
        [t('repEggsAvg'), avg != null ? num(avg) : '—'],
        [t('repSales'), sales.length ? money(total, K.shedSym()) : '—'],
      ],
      chart: bars(eggs.map((x) => x.eggs ?? null), eggs.map((x) => fd(x.date, { weekday: 'short' }))),
      chartH: t('repChartEggs'),
      done,
      next: [t('repShedNext')],
      sources: t('repShedSrc'),
    };
  }
  function yardReport() {
    const y = S.yard;
    const d = window.KSYard?.details?.() || {};
    const w = d.weather;
    return {
      title: `${window.KSYard?.yardTitle(y) || ''} · ${t('repTitle')}`,
      sub: y?.size_m2 ? `${num(Math.round(y.size_m2))} ${t('yu_m2')} · ${t(`ydSun_${y.sun || 'half'}`)}` : '',
      kpis: [
        [t('ydSize'), y?.size_m2 ? `${num(Math.round(y.size_m2))} ${t('yu_m2')}` : '—'],
        [t('kTemp'), w && Number.isFinite(w.tMax) ? `${num(w.tMax)}° / ${num(w.tMin)}°` : '—'],
        [t('repPicks'), num((d.picks || []).length)],
      ],
      chart: '',
      chartH: '',
      done: (d.picks || []).map((p) => `${t(`pl_${p.key}`)}: ${p.count ? fmt('ydCount', { n: num(p.count) }) : fmt('ydBed', { n: num(p.bedM2) })}`),
      doneH: t('repPlantNow'),
      next: [w?.rainDate ? fmt('ydRainTip', { date: fd(w.rainDate, { weekday: 'long', day: 'numeric', month: 'short' }) }) : w?.hot ? t('ydHotTip') : t('ydWaterTip')],
      sources: 'Open-Meteo',
    };
  }

  function build() {
    const r = S.mode === 'shed' ? shedReport() : S.mode === 'yard' ? yardReport() : fieldReport();
    r.range = `${fd(addDays(today(), -6))} – ${fd(today())}`;
    r.note = isDemo() || S.mode === 'shed' ? t('repDemoNote') : '';
    return r;
  }
  function html(r) {
    const li = (a, empty) => (a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="muted small">${esc(empty)}</p>`);
    return `<div class="rep" id="repCard">
      <div class="rhead"><img src="/icons/icon.svg" alt="" width="40" height="40"><div><b>${esc(r.title)}</b><small>${esc([r.range, r.sub].filter(Boolean).join(' · '))}</small></div></div>
      <div class="rk">${r.kpis.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
      ${r.chart ? `<div class="rsec"><h4>${esc(r.chartH)}</h4>${r.chart}</div>` : ''}
      <div class="rsec"><h4>${esc(r.doneH || t('repDone'))}</h4>${li(r.done, t('repQuiet'))}</div>
      <div class="rsec"><h4>${esc(t('repNext'))}</h4>${li(r.next, '—')}</div>
      <div class="rfoot">Khet Sathi · ${esc(r.sources)}${r.note ? ` · ${esc(r.note)}` : ''}</div>
    </div>`;
  }
  function text(r) {
    return [
      `${r.title}`,
      `${r.range}${r.sub ? ` · ${r.sub}` : ''}`,
      ...r.kpis.map(([k, v]) => `${k}: ${v}`),
      '',
      `${r.doneH || t('repDone')}:`,
      ...(r.done.length ? r.done.map((x) => `- ${x}`) : [`- ${t('repQuiet')}`]),
      '',
      `${t('repNext')}:`,
      ...r.next.map((x) => `- ${x}`),
      '',
      `(Khet Sathi${r.note ? ` · ${r.note}` : ''})`,
    ].join('\n');
  }

  function open() {
    R = build();
    $('#repBody').innerHTML = html(R);
    $('#repSheet').hidden = false;
    $('#repSheet').scrollTop = 0;
  }
  $('#repClose').addEventListener('click', () => ($('#repSheet').hidden = true));
  $('#repShare').addEventListener('click', () => R && window.KSProblem?.share(text(R)));
  $('#repPdf').addEventListener('click', () => {
    document.body.classList.add('printing-report');
    window.print();
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-report'));
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-report]')) open();
  });
  window.KSReport = { open, build, text };
})();
