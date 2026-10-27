// Khet Saathi app shell (v0.10.0). Layout and look from the team's Khet_Saathi.html design; every number
// here comes from the server: Sentinel-2 NDVI, Esri + SAM 3.1 outline, SoilGrids, Open-Meteo, FAO calendar,
// Muse Spark Open (Baseten) for Saathi. Simulated parts (sensor kit, shops, money) are labelled.
(() => {
  'use strict';
  const I = window.KS_ICONS;
  const TX = window.KS_TEXT;
  const CL = window.KS_I18N || {};
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- language ----------
  let lang = ['bn', 'hi', 'en'].includes(store.get('ks_lang')) ? store.get('ks_lang') : 'bn';
  const DIG = { bn: '০১২৩৪৫৬৭৮৯', hi: '०१२३४५६७८९' };
  const loc = () => ({ bn: 'bn-BD', hi: 'hi-IN', en: 'en-IN' })[lang];
  const digits = (s) => (DIG[lang] ? String(s).replace(/[0-9]/g, (c) => DIG[lang][c]) : String(s));
  const num = (n, dp = 0) => (n == null || !Number.isFinite(Number(n)) ? '—' : digits(Number(n).toFixed(dp).replace(/\.0+$/, '')));
  const t = (k) => TX[lang]?.[k] ?? CL[lang]?.[k] ?? TX.en?.[k] ?? CL.en?.[k] ?? k;
  const fmt = (k, v = {}) => Object.entries(v).reduce((s, [a, b]) => s.split(`{${a}}`).join(b), t(k));
  const dateOf = (iso) => new Date(`${iso}T12:00:00`); // local noon: no day shift in any time zone
  const fd = (iso, o = { day: 'numeric', month: 'short' }) => (iso ? digits(dateOf(iso).toLocaleDateString(loc(), o)) : '—');
  const addDays = (iso, n) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 864e5);
  const money = (n, cur = '₹') => {
    const s = Math.round(Math.abs(n)).toLocaleString('en-IN');
    return `${n < 0 ? '−' : ''}${cur}${digits(s)}`;
  };
  const cropName = (key) => t(`crop_${key}`);

  // ---------- small helpers from the design ----------
  function icons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((e) => (e.innerHTML = I[e.dataset.icon] || ''));
  }
  function count(el, to, f = (v) => v, dur = 800) {
    if (!el) return;
    if (RM || !Number.isFinite(to)) return (el.textContent = Number.isFinite(to) ? f(to) : '—');
    const from = parseFloat(el.dataset.v || 0);
    const t0 = performance.now();
    el.dataset.v = to;
    (function step(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = f(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  let toastT;
  function toast(m) {
    const el = $('#toast');
    el.hidden = true;
    void el.offsetWidth;
    el.textContent = m;
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (el.hidden = true), 2600);
  }

  // ---------- server ----------
  let passcode = store.get('ks_passcode') || '';
  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'x-app-passcode': passcode, ...(opts.headers || {}) } });
    const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (res.status === 401) {
      showPass();
      throw new Error(t('passH'));
    }
    return json;
  }
  const postJson = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const imgUrl = (u) => (u ? `${u}${u.includes('?') ? '&' : '?'}k=${encodeURIComponent(passcode)}` : '');

  // ---------- state ----------
  const S = { tab: 'home', lands: [], cur: null, plan: null, field: null, sensors: null, deals: [], alerts: [], health: null, pass: 0, layer: 'sat', zoom: 1, playing: null, chat: [] };

  // ---------- text on the page ----------
  function applyLang() {
    document.documentElement.lang = lang;
    $$('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
    $$('[data-tl]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tl)));
    $$('[data-tp]').forEach((el) => el.setAttribute('placeholder', t(el.dataset.tp)));
    $$('.lang [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  }
  $$('.lang [data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      lang = b.dataset.lang;
      store.set('ks_lang', lang);
      applyLang();
      renderAll();
    })
  );

  // ---------- tabs ----------
  function show(tab) {
    if (tab !== 'field') stopPlay();
    S.tab = tab;
    $$('[role=tabpanel]').forEach((p) => {
      const on = p.id === tab;
      if (on && p.hidden) {
        p.hidden = false;
        p.style.animation = 'none';
        void p.offsetWidth;
        p.style.animation = '';
      } else p.hidden = !on;
    });
    $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('nav.bottom').hidden = tab === 'pass';
    if (tab === 'home') renderHome();
    if (tab === 'field') renderField();
    if (tab === 'saathi') renderSaathi();
    if (tab === 'money') renderMoney();
    window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' });
  }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) show(b.dataset.tab);
  });

  function showPass() {
    show('pass');
    $('#passIn').focus();
  }
  $('#passForm').addEventListener('submit', (e) => {
    e.preventDefault();
    passcode = $('#passIn').value.trim();
    store.set('ks_passcode', passcode);
    boot();
  });

  // ---------- loading a land ----------
  const hasField = (l) => Boolean(l && (l.objects || []).length);
  async function loadLands() {
    const r = await api('/api/lands');
    S.lands = r.ok ? r.lands || [] : [];
  }
  async function openLand(id) {
    stopPlay();
    const r = await api(`/api/lands/${id}`);
    if (!r.ok) throw new Error(r.error);
    S.cur = r.land;
    store.set('ks_land', id);
    S.plan = null;
    S.field = null;
    S.pass = 0;
    renderHeader();
    renderAll();
    const jobs = [
      hasField(S.cur) ? api(`/api/lands/${id}/plan`).then((p) => (S.plan = p.ok ? p.plan : null)).catch(() => null) : null,
      api(`/api/sensors?landId=${id}`).then((s) => (S.sensors = s.ok ? s : null)).catch(() => null),
    ].filter(Boolean);
    Promise.all(jobs).then(() => renderAll());
    // Sentinel-2 reads take a few seconds on the first visit; the server caches them for 6 hours.
    $('#mapLoading').hidden = false;
    api(`/api/lands/${id}/field`)
      .then((f) => {
        if (S.cur?.id !== id) return;
        S.field = f.ok ? f : { error: f.error };
        const clear = (S.field.health?.passes || []).filter((p) => !p.cloudy);
        S.pass = Math.max(0, clear.length - 1);
        renderAll();
      })
      .catch(() => null)
      .finally(() => ($('#mapLoading').hidden = true));
  }
  async function loadSide() {
    const [d, a, s] = await Promise.all([api('/api/deals').catch(() => null), api('/api/alerts').catch(() => null), api('/api/sell').catch(() => null)]);
    S.sale = s?.ok ? s : null;
    S.deals = d?.ok ? d.deals || [] : [];
    S.alerts = a?.ok ? a.alerts || [] : [];
    renderAll();
  }

  // Clear passes, oldest first (the order charts and the player use).
  const clearPasses = () => [...(S.field?.health?.passes || [])].filter((p) => !p.cloudy && p.ndvi).reverse();
  const latest = () => S.field?.health?.latest || null;
  const placeName = (l) => (l?.place ? t(`land_${l.place}`) : l ? `${num(l.lat, 3)}, ${num(l.lon, 3)}` : '');
  const landTitle = (l) => (l?.place ? t(`land_${l.place}`) : t('yourLand'));
  const topCrop = () => {
    const key = S.cur?.crop || S.plan?.crops?.[0]?.key;
    return key ? (S.plan?.calendar || []).find((c) => c.key === key) || S.plan?.crops?.find((c) => c.key === key) || null : null;
  };

  function renderHeader() {
    const l = S.cur;
    $('#farmLine').textContent = l ? `${landTitle(l)} · ${l.acres ? `${num(l.acres, 2)} ${t('acShort')}` : t('noOutlineShort')}` : t('noLandYet');
  }
  function renderAll() {
    renderHeader();
    if (S.tab === 'home') renderHome();
    if (S.tab === 'field') renderField();
    if (S.tab === 'saathi') renderPending();
    if (S.tab === 'money') renderMoney();
    renderBadge();
  }

  // ================= HOME =================
  function plantSVG() {
    return `<svg viewBox="0 0 120 160" class="plant"><ellipse cx="60" cy="152" rx="50" ry="8" fill="var(--soil)" opacity=".35"/><g class="sway"><path class="stem" d="M60 150 L60 150" stroke="var(--leaf)" stroke-width="5" stroke-linecap="round" fill="none"/>${[0, 1, 2, 3, 4, 5].map((i) => `<ellipse class="lf" data-i="${i}" cx="60" cy="150" rx="0" ry="0" fill="var(--leaf)"/>`).join('')}</g></svg>`;
  }
  // The plant grows with real NDVI: bare soil (<0.2) is a small sprout, dense crop (>0.7) is tall and full.
  function updatePlant(box, ndvi) {
    if (!box) return;
    if (!box.querySelector('svg')) box.innerHTML = plantSVG();
    const svg = box.querySelector('svg');
    const g = clamp(((ndvi ?? 0.25) - 0.1) / 0.7, 0.05, 1);
    const h = 20 + g * 110;
    const top = 150 - h;
    const dry = ndvi != null && ndvi < 0.25;
    const col = dry ? '#c9a24a' : 'var(--leaf)';
    svg.querySelector('.stem').setAttribute('d', `M60 150 Q${58 + g * 4} ${150 - h / 2} 60 ${top}`);
    svg.querySelectorAll('.lf').forEach((l) => {
      const i = +l.dataset.i;
      const on = i < 2 + g * 4;
      const side = i % 2 ? 1 : -1;
      const y = 150 - ((i + 1) * h) / 7;
      l.setAttribute('cx', 60 + side * 18);
      l.setAttribute('cy', y);
      l.setAttribute('rx', on ? 16 : 0);
      l.setAttribute('ry', on ? 7 : 0);
      l.setAttribute('fill', col);
      l.setAttribute('transform', `rotate(${side * -25} ${60 + side * 18} ${y})`);
    });
  }

  function hero() {
    const l = S.cur;
    if (!l) return { big: t('heroAddH'), sub: t('heroAddS'), cta: t('addLand'), icon: 'plus', go: openAdd };
    if (!hasField(l)) return { big: t('heroNoFieldH'), sub: t('heroNoFieldS'), cta: t('rescan'), icon: 'pin', go: rescan };
    const sale = S.alerts.find((a) => a.title === 'sell_due' || a.title === 'sell_offers');
    if (sale) return { big: t(`a_${sale.title}`).replace('{value}', num(JSON.parse(sale.body || '{}').value)), sub: t(`b_${sale.title}`), cta: t('seeIt'), icon: 'rupee', go: () => show('saathi') };
    const c = S.plan?.crops?.[0];
    if (c) {
      const sub = c.status === 'soon' ? fmt('startsIn', { n: num(c.daysUntil) }) : fmt('sowBy', { date: fd(c.windowEnd), n: num(c.daysLeft) });
      return { big: fmt('heroSow', { crop: cropName(c.key) }), sub, cta: t('askSaathi'), icon: 'chat', go: () => ask(fmt('qPlan', { crop: cropName(c.key) })) };
    }
    return { big: t('heroWatchH'), sub: t('heroWatchS'), cta: t('askSaathi'), icon: 'chat', go: () => ask(t('qField')) };
  }
  let heroGo = null;
  $('#heroCta').addEventListener('click', () => heroGo && heroGo());

  function renderHome() {
    const h = hero();
    heroGo = h.go;
    $('#heroBig').textContent = h.big;
    $('#heroSub').textContent = h.sub;
    $('#heroCtaT').textContent = h.cta;
    $('#heroIc').innerHTML = I[h.icon] || '';
    updatePlant($('#plantHome'), latest()?.ndvi?.mean);
    renderScore();
    renderKpis();
    renderNdviChart();
    renderZones();
    renderShed();
    renderGrow();
    renderRain();
    renderDonut();
    renderNextPass();
    renderJourney();
  }

  function healthWord(v) {
    if (v == null) return { k: 'noData', c: '' };
    if (v < 0.2) return { k: 'hBare', c: 'warn' };
    if (v < 0.4) return { k: 'hSparse', c: 'warn' };
    if (v < 0.6) return { k: 'hMid', c: 'ok' };
    return { k: 'hDense', c: 'ok' };
  }
  function renderScore() {
    const v = latest()?.ndvi?.mean;
    $('#ringFg').style.strokeDashoffset = v == null ? 100 : 100 - clamp(v, 0, 1) * 100;
    if (v == null) $('#scoreV').textContent = S.field ? '—' : '…';
    else count($('#scoreV'), v, (x) => num(x, 2), 1200);
    const w = healthWord(v);
    $('#scoreTag').textContent = S.field?.error ? t('satError') : t(w.k);
    $('#scoreTag').className = `pill ${w.c}`;
  }

  function mini(el, arr) {
    if (!el) return;
    if (!arr || arr.length < 2) return (el.innerHTML = '');
    const mn = Math.min(...arr);
    const mx = Math.max(...arr);
    const d = arr.map((v, i) => `${i ? 'L' : 'M'}${((i * 100) / (arr.length - 1)).toFixed(1)} ${(27 - ((v - mn) / (mx - mn || 1)) * 24).toFixed(1)}`).join(' ');
    el.innerHTML = `<path class="a" d="${d} L100 30 L0 30Z"/><path class="l draw" pathLength="1" d="${d}"/>`;
  }
  function renderKpis() {
    const days = S.plan?.weather?.days || [];
    const cp = clearPasses();
    const nd = cp.map((p) => p.ndvi.mean);
    const kitM = S.sensors?.field?.soil_moisture?.value;
    const om = S.plan?.weather?.soilMoisture;
    const rain7 = days.slice(0, 7).reduce((a, d) => a + (d.rainMm || 0), 0);
    const k = [
      { i: 'leaf', k: 'kNdvi', v: nd.at(-1), f: (x) => num(x, 2), sp: nd, d: nd.length > 1 ? `${nd.at(-1) >= nd.at(-2) ? '▲' : '▼'} ${num(Math.abs(nd.at(-1) - nd.at(-2)), 2)}` : t('srcS2'), dir: nd.length > 1 && nd.at(-1) < nd.at(-2) ? 'down' : 'up' },
      { i: 'drop', k: 'kMoist', v: om != null ? om * 100 : kitM, f: (x) => `${num(x)}%`, sp: null, d: om != null ? t(`moist_${S.plan.weather.soilMoistureLevel}`) : t('simulated'), dir: S.plan?.weather?.soilMoistureLevel === 'dry' ? 'down' : 'up' },
      { i: 'rain', k: 'kRain', v: days.length ? rain7 : null, f: (x) => `${num(x)} ${t('mm')}`, sp: days.slice(0, 7).map((d) => d.rainMm || 0), d: S.plan?.rain?.rainDate ? fmt('rainOn', { date: fd(S.plan.rain.rainDate, { weekday: 'short' }) }) : t('noRainSoon'), dir: 'up' },
      { i: 'sun', k: 'kTemp', v: days[0]?.tMax, f: (x) => `${num(x)}°`, sp: days.slice(0, 7).map((d) => d.tMax), d: days[1] ? `${t('tomorrow')} ${num(days[1].tMax)}°` : '', dir: days[1] && days[1].tMax < days[0].tMax ? 'down' : 'up' },
    ];
    $('#kpis').innerHTML = k
      .map((x, i) => `<div class="kpi"><div class="lab"><span data-icon="${x.i}"></span><span>${esc(t(x.k))}</span></div><div class="kv" id="kv${i}">—</div><svg class="ks" id="ks${i}" viewBox="0 0 100 30" preserveAspectRatio="none"></svg><div class="kd ${x.dir}">${esc(x.d || '')}</div></div>`)
      .join('');
    icons($('#kpis'));
    k.forEach((x, i) => {
      mini($(`#ks${i}`), x.sp);
      if (x.v != null) count($(`#kv${i}`), x.v, x.f, 1000);
    });
  }

  function lineChart({ data, min, max, color = 'var(--leaf)', soft = 'var(--leaf-soft)', xl = [], f = (v) => v, pin }) {
    const W = 320;
    const H = 150;
    const L = 36;
    const R = 12;
    const T = 14;
    const B = 22;
    const n = data.length - 1 || 1;
    const xs = (i) => L + (i * (W - L - R)) / n;
    const ys = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
    const d = data.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(' ');
    const ex = xs(data.length - 1);
    const ey = ys(data.at(-1));
    const ticks = [min, (min + max) / 2, max].map((v) => `<line class="g" x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}"/><text x="${L - 6}" y="${ys(v) + 3}" text-anchor="end">${f(v)}</text>`).join('');
    const xlab = xl.map(([i, s]) => `<text x="${xs(i)}" y="${H - 6}" text-anchor="middle">${esc(s)}</text>`).join('');
    const pw = Math.max(44, String(pin || '').length * 7 + 14);
    const pinS = pin ? `<g class="end"><rect x="${ex - pw + 6}" y="${ey - 30}" width="${pw}" height="18" rx="9" fill="${color}"/><text class="tag" x="${ex - pw / 2 + 6}" y="${ey - 17.5}" text-anchor="middle">${esc(pin)}</text></g>` : '';
    const dots = data.length < 12 ? data.map((v, i) => `<circle cx="${xs(i)}" cy="${ys(v)}" r="2.6" fill="${color}"/>`).join('') : '';
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${ticks}${xlab}<path class="ar" d="${d} L${ex} ${H - B} L${L} ${H - B}Z" fill="${soft}"/><path class="ln draw" pathLength="1" d="${d}" stroke="${color}"/>${dots}<circle class="pulse" cx="${ex}" cy="${ey}" r="5" stroke="${color}"/><circle class="end" cx="${ex}" cy="${ey}" r="5.5" fill="${color}" stroke="var(--surface)" stroke-width="2.5"/>${pinS}</svg>`;
  }
  function emptyBox(text) {
    return `<div class="emptybox">${esc(text)}</div>`;
  }
  function renderNdviChart() {
    const cp = clearPasses();
    if (!S.field) return ($('#chNdvi').innerHTML = emptyBox(t('readingSat')));
    if (S.field.error) return ($('#chNdvi').innerHTML = emptyBox(`${t('satError')}: ${S.field.error}`));
    if (cp.length < 2) return ($('#chNdvi').innerHTML = emptyBox(cp.length ? fmt('oneClear', { date: fd(cp[0].date) }) : t('allCloudy')));
    const data = cp.map((p) => p.ndvi.mean);
    const idx = [0, Math.floor((cp.length - 1) / 2), cp.length - 1];
    $('#chNdvi').innerHTML = lineChart({ data, min: 0, max: 1, f: (v) => num(v, 1), xl: [...new Set(idx)].map((i) => [i, fd(cp[i].date)]), pin: num(data.at(-1), 2) });
  }

  const RAMP = [[139, 90, 52], [214, 170, 60], [160, 196, 80], [46, 120, 46], [18, 78, 32]];
  function ramp(tv) {
    tv = clamp(tv, 0, 1);
    const n = RAMP.length - 1;
    const i = Math.min(n - 1, Math.floor(tv * n));
    const f = tv * n - i;
    return RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
  }
  const zoneCols = () => latest()?.zoneCols || 6;
  const zoneName = (i) => `${String.fromCharCode(65 + Math.floor(i / zoneCols()))}${(i % zoneCols()) + 1}`;
  function renderZones() {
    const z = latest()?.zones;
    if (!z) {
      $('#zones').innerHTML = '';
      $('#zoneTag').textContent = '';
      $('#zinfo').textContent = S.field ? t('noZones') : t('readingSat');
      return;
    }
    $('#zones').style.gridTemplateColumns = `repeat(${zoneCols()},minmax(0,1fr))`;
    const vals = z.filter((v) => v != null);
    let bi = z.findIndex((v) => v === Math.min(...vals));
    const spread = Math.max(...vals) - Math.min(...vals);
    const flag = spread > 0.08;
    $('#zones').innerHTML = z.map((v, i) => `<button class="zc ${flag && i === bi ? 'bad' : ''}" ${v == null ? 'disabled' : ''} style="background:${v == null ? 'var(--line)' : `rgb(${ramp(v / 0.85)})`};animation-delay:${i * 30}ms" data-z="${i}" aria-label="${t('zone')} ${zoneName(i)}${v == null ? '' : ` NDVI ${v}`}"></button>`).join('');
    $('#zoneTag').textContent = flag ? t('oneWatch') : t('even');
    $('#zoneTag').className = `pill ${flag ? 'warn' : 'ok'}`;
    $('#zinfo').textContent = `${t('zone')} ${zoneName(bi)} · NDVI ${num(z[bi], 2)} · ${t('lowest')} · ${fd(latest().date)}`;
  }
  $('#zones').addEventListener('click', (e) => {
    const b = e.target.closest('.zc');
    const z = latest()?.zones;
    if (!b || !z) return;
    $$('.zc').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const i = +b.dataset.z;
    $('#zinfo').textContent = `${t('zone')} ${zoneName(i)} · NDVI ${num(z[i], 2)} · ${fd(latest().date)}`;
  });

  // Poultry shed summary (v0.10.1): the simulated shed kit and the egg stock; the full shed opens in the classic screen until v0.11.0.
  function renderShed() {
    const sh = S.sensors?.shed;
    const cells = [
      ['shed_temp', 's_shed_temp', (v) => `${num(v, 1)}°`, (v) => v > 32 || v < 16],
      ['shed_humidity', 's_shed_humidity', (v) => `${num(v)}%`, (v) => v > 80 || v < 40],
      ['ammonia_ppm', 's_ammonia_ppm', (v) => num(v), (v) => v > 25],
      ['water_pct', 's_water_pct', (v) => `${num(v)}%`, (v) => v < 20],
      ['feed_pct', 's_feed_pct', (v) => `${num(v)}%`, (v) => v < 20],
      ['eggs_today', 'eggsToday', (v) => num(v), () => false],
    ];
    const html = sh
      ? cells.filter(([m]) => sh[m]).map(([m, k, f, bad]) => `<div class="tile ${bad(sh[m].value) ? 'warn' : ''}"><div class="k">${esc(t(k))}</div><div class="v">${esc(f(sh[m].value))}</div></div>`).join('')
      : emptyBox(t('shedWaiting'));
    const st = S.sale;
    const info = st ? fmt('eggStockText', { n: num(st.stock), trays: num(st.trays) }) : '';
    for (const [g, i] of [['#shedGrid', '#shedInfo'], ['#camsGrid', '#camsInfo']]) {
      $(g).innerHTML = html;
      $(i).textContent = info;
    }
  }

  function renderGrow() {
    const p = S.plan;
    const box = $('#grow');
    $('#growSrc').textContent = p?.aez ? 'FAO' : '';
    if (!S.cur) return (box.innerHTML = emptyBox(t('heroAddS')));
    if (!hasField(S.cur)) return (box.innerHTML = emptyBox(t('heroNoFieldS')));
    if (!p) return (box.innerHTML = emptyBox(t('loadingPlan')));
    if (!p.aez) {
      box.innerHTML = `${emptyBox(t('noFaoHere'))}<button class="btn ghost" id="aiEstimate">${esc(t('aiEstimate'))}</button>`;
      $('#aiEstimate').addEventListener('click', () => ask(t('qAiEstimate')));
      return;
    }
    const cur = p.aez && S.cur.place !== 'bogura' && S.cur.place ? '₹' : '৳';
    box.innerHTML =
      (p.crops || [])
        .map((c) => {
          const when = c.status === 'soon' ? fmt('startsIn', { n: num(c.daysUntil) }) : fmt('sowBy', { date: fd(c.windowEnd), n: num(c.daysLeft) });
          const harvest = c.growDays ? fmt('harvestIn', { a: num(c.growDays.min), b: num(c.growDays.max) }) : '';
          return `<button class="growrow" data-crop="${c.key}"><span class="gname">${esc(cropName(c.key))}</span><span class="gwhen">${esc(when)}<br><small>${esc(harvest)}</small></span><span class="gp">${esc(money(c.sampleProfitBdtPerAcre || 0, cur))}<small>${esc(t('perAcreSample'))}</small></span></button>`;
        })
        .join('') || emptyBox(t('noCropsText'));
    box.querySelectorAll('[data-crop]').forEach((b) => b.addEventListener('click', () => ask(fmt('qPlan', { crop: cropName(b.dataset.crop) }))));
  }

  function rainChart(days) {
    const W = 320;
    const H = 150;
    const L = 30;
    const R = 30;
    const T = 14;
    const B = 22;
    const bw = (W - L - R) / days.length;
    const rain = days.map((d) => d.rainMm || 0);
    const temp = days.map((d) => d.tMax);
    const mx = Math.max(20, ...rain);
    const yr = (v) => T + (1 - v / mx) * (H - T - B);
    const tmin = Math.floor(Math.min(...temp) - 2);
    const tmax = Math.ceil(Math.max(...temp) + 2);
    const yt = (v) => T + (1 - (v - tmin) / (tmax - tmin)) * (H - T - B);
    const bars = rain.map((r, i) => `<rect class="bar" style="animation-delay:${i * 80}ms" x="${L + i * bw + bw * 0.18}" y="${yr(r)}" width="${bw * 0.64}" height="${H - B - yr(r)}" rx="4" fill="var(--sky-ink)" opacity=".75"/><text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(fd(days[i].date, { weekday: 'short' }))}</text>${r >= 5 ? `<text x="${L + i * bw + bw / 2}" y="${yr(r) - 4}" text-anchor="middle">${num(r)}</text>` : ''}`).join('');
    const d = temp.map((v, i) => `${i ? 'L' : 'M'}${L + i * bw + bw / 2} ${yt(v)}`).join(' ');
    const g = [0, mx / 2, mx].map((v) => `<line class="g" x1="${L}" x2="${W - R}" y1="${yr(v)}" y2="${yr(v)}"/><text x="${L - 5}" y="${yr(v) + 3}" text-anchor="end">${num(v)}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}<text x="${W - R + 4}" y="${yt(tmax - 2) + 3}">${num(tmax - 2)}°</text><text x="${W - R + 4}" y="${yt(tmin + 2) + 3}">${num(tmin + 2)}°</text>${bars}<path class="ln draw" pathLength="1" d="${d}" stroke="var(--turmeric)" style="animation-delay:.6s"/>${temp.map((v, i) => `<circle class="end" cx="${L + i * bw + bw / 2}" cy="${yt(v)}" r="3.5" fill="var(--turmeric)"/>`).join('')}<text x="${L}" y="9">${esc(t('mm'))}</text></svg>`;
  }
  function renderRain() {
    const days = S.plan?.weather?.days || [];
    if (!days.length) {
      $('#chRain').innerHTML = emptyBox(S.cur && hasField(S.cur) ? t('loadingPlan') : t('heroAddS'));
      $('#wx').innerHTML = '';
      return;
    }
    $('#chRain').innerHTML = rainChart(days.slice(0, 7));
    $('#wx').innerHTML = days
      .slice(0, 5)
      .map((d) => `<div><b>${esc(fd(d.date, { weekday: 'short' }))}</b>${I[d.rainChance >= 60 ? 'rain' : d.rainChance >= 30 ? 'suncloud' : 'sun']}<span>${num(d.tMax)}°</span><br><span style="color:var(--muted)">${num(d.tMin)}°</span><br><small style="color:var(--sky-ink)">${num(d.rainChance)}%</small></div>`)
      .join('');
  }

  function dealTotals() {
    const conf = S.deals.filter((d) => d.status === 'confirmed');
    const inc = conf.filter((d) => d.direction === 'sell').reduce((a, d) => a + Number(d.total_inr || 0), 0);
    const out = conf.filter((d) => d.direction === 'buy').reduce((a, d) => a + Number(d.total_inr || 0), 0);
    return { conf, inc, out };
  }
  function renderDonut() {
    const { conf, inc, out } = dealTotals();
    const tot = Math.max(inc + out, 1);
    const box = $('#donut');
    const pIn = (inc / tot) * 100;
    box.innerHTML = `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" stroke="var(--line)" pathLength="100"/><circle cx="60" cy="60" r="48" pathLength="100" stroke="var(--leaf)" stroke-dasharray="${Math.max(pIn - 0.6, 0)} ${100 - pIn}"/><circle cx="60" cy="60" r="48" pathLength="100" stroke="var(--soil)" stroke-dasharray="${Math.max(100 - pIn - 0.6, 0)} ${pIn}" stroke-dashoffset="${-pIn}" ${out ? '' : 'hidden'}/></svg><div class="c"><b>${esc(money(inc - out))}</b><span>${esc(t('net'))}</span></div>`;
    $('#dleg').innerHTML = `<div><i style="background:var(--leaf)"></i>${esc(t('moneyIn'))}<b class="in-c">${inc ? `+${esc(money(inc))}` : '—'}</b></div><div><i style="background:var(--soil)"></i>${esc(t('moneyOut'))}<b class="out-c">${out ? `−${esc(money(out))}` : '—'}</b></div><div class="muted small">${esc(fmt('dealsN', { n: num(conf.length) }))}</div>`;
  }

  let cdT;
  function renderNextPass() {
    clearInterval(cdT);
    const nx = S.field?.health?.next;
    const lab = [t('cdDays'), t('cdHrs'), t('cdMin'), t('cdSec')];
    $('#cd').innerHTML = lab.map((l, i) => `<div><b id="cd${i}">--</b><span>${esc(l)}</span></div>`).join('');
    if (!nx) return ($('#nextInfo').textContent = S.field ? '' : t('readingSat'));
    // Sentinel-2 crosses Bengal at about 10:30 local time (04:40 UTC).
    const tgt = new Date(`${nx.date}T04:40:00Z`).getTime();
    $('#nextInfo').textContent = fmt('nextPassInfo', { sat: nx.sat.replace('S2', 'Sentinel-2'), date: fd(nx.date) });
    const prev = {};
    const tick = () => {
      const s = Math.max(0, Math.floor((tgt - Date.now()) / 1000));
      [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60].forEach((x, i) => {
        const e = $(`#cd${i}`);
        const v = digits(String(x).padStart(2, '0'));
        if (e && prev[i] !== v) {
          e.textContent = v;
          prev[i] = v;
        }
      });
    };
    tick();
    cdT = setInterval(tick, 1000);
  }

  // Season steps for the chosen crop, dated from its real FAO sowing and harvest windows.
  function seasonSteps(c, today) {
    if (!c) return [];
    const sowStart = c.windowStart && c.windowStart > today ? c.windowStart : today;
    const sowEnd = c.windowEnd || addDays(sowStart, 20);
    const sow = sowStart <= sowEnd ? sowStart : sowEnd;
    const g = c.growDays || { min: 90, max: 110 };
    return [
      { id: 'seed', icon: 'seed', date: addDays(sow, -1) < today ? today : addDays(sow, -1) },
      { id: 'sow', icon: 'tractor', date: sow },
      { id: 'fert', icon: 'fert', date: addDays(sow, 21) },
      { id: 'water', icon: 'drop', date: addDays(sow, 35) },
      { id: 'harvest', icon: 'harvester', date: addDays(sow, g.min) },
      { id: 'sell', icon: 'rupee', date: addDays(sow, Math.round((g.min + g.max) / 2) + 3) },
    ];
  }
  function renderJourney() {
    const c = topCrop();
    const today = S.plan?.today || new Date().toISOString().slice(0, 10);
    const steps = seasonSteps(c, today);
    $('#journeyH').textContent = c ? fmt('seasonOf', { crop: cropName(c.key) }) : t('seasonNone');
    if (!steps.length) {
      $('#journey').innerHTML = emptyBox(S.cur ? t('loadingPlan') : t('heroAddS'));
      $('#trackFill').style.width = '0%';
      return;
    }
    const next = steps.find((s) => s.date >= today) || steps.at(-1);
    const done = steps.filter((s) => s.date < today).length;
    $('#trackFill').style.width = `${(done / steps.length) * 100}%`;
    $('#journey').innerHTML = steps
      .map((s) => `<button class="stop ${s.date < today ? 'done' : s === next ? 'now' : ''}" data-step="${s.id}"><span class="ring">${I[s.icon]}</span><span class="lbl">${esc(t(`step_${s.id}`))}</span><span class="st">${s === next ? esc(t('next')) : esc(fd(s.date))}</span></button>`)
      .join('');
    $('#journey')
      .querySelectorAll('[data-step]')
      .forEach((b) => b.addEventListener('click', () => ask(fmt(`q_${b.dataset.step}`, { crop: cropName(c.key) }))));
  }

  // ================= FIELD =================
  const tileImg = new Image();
  let tileFor = null;
  function ensureTile() {
    const u = S.cur?.tileUrl;
    if (!u || tileFor === u) return;
    tileFor = u;
    tileImg.onload = () => drawMap();
    tileImg.src = imgUrl(u);
  }
  const ZOOMS = [1, 1.6, 2.6, 4];
  // Map scale: the tile covers ground_m metres across its width; zoom crops around the centre.
  function mapGeom() {
    const cv = $('#map');
    const W = cv.width;
    const H = cv.height;
    const ground = Number(S.cur?.ground_m) || 225;
    const z = ZOOMS[S.zoom];
    const ppm = (W / ground) * z; // canvas px per metre
    return { cv, W, H, ground, z, ppm, toPx: (x, y) => [W / 2 + x * ppm, H / 2 - y * ppm] };
  }
  function drawMap() {
    const g = mapGeom();
    const ctx = g.cv.getContext('2d');
    ctx.fillStyle = '#3a4a32';
    ctx.fillRect(0, 0, g.W, g.H);
    if (tileImg.complete && tileImg.naturalWidth && tileFor) {
      const src = tileImg.naturalWidth;
      const view = src / g.z; // source px shown across the canvas width
      const viewH = view * (g.H / g.W);
      ctx.drawImage(tileImg, (src - view) / 2, (src - viewH) / 2, view, viewH, 0, 0, g.W, g.H);
    }
    const rings = S.field?.outline;
    const pass = selectedPass();
    if (S.layer === 'ndvi' && pass?.grid && rings) {
      const gr = pass.grid;
      ctx.save();
      clipRings(ctx, rings, g);
      for (let r = 0; r < gr.h; r++) {
        for (let c = 0; c < gr.w; c++) {
          const v = gr.cells[r * gr.w + c];
          if (v < -1) continue;
          const [x, y] = g.toPx(gr.x0 + c * gr.res, gr.y0 - r * gr.res);
          ctx.fillStyle = `rgba(${ramp(v / 0.85).join(',')},.85)`;
          ctx.fillRect(x, y, gr.res * g.ppm + 0.5, gr.res * g.ppm + 0.5);
        }
      }
      ctx.restore();
    }
    if (rings) {
      ctx.beginPath();
      for (const ring of rings) ring.forEach(([x, y], i) => (i ? ctx.lineTo(...g.toPx(x, y)) : ctx.moveTo(...g.toPx(x, y))));
      ctx.closePath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash(S.field?.outlineFound ? [] : [8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    scaleBar();
  }
  function clipRings(ctx, rings, g) {
    ctx.beginPath();
    for (const ring of rings) ring.forEach(([x, y], i) => (i ? ctx.lineTo(...g.toPx(x, y)) : ctx.moveTo(...g.toPx(x, y))));
    ctx.closePath();
    ctx.clip();
  }
  function scaleBar() {
    const g = mapGeom();
    const want = 110 / g.ppm;
    const m = [5, 10, 20, 25, 50, 100, 200, 250, 500].find((x) => x >= want) || 500;
    $('#sbar').style.width = `${((m * g.ppm) / g.W) * $('#map').clientWidth}px`;
    $('#sbarT').textContent = `${num(m)} ${t('mShort')}`;
  }
  $('#zIn').addEventListener('click', () => {
    S.zoom = Math.min(ZOOMS.length - 1, S.zoom + 1);
    drawMap();
  });
  $('#zOut').addEventListener('click', () => {
    S.zoom = Math.max(0, S.zoom - 1);
    drawMap();
  });
  window.addEventListener('resize', () => S.tab === 'field' && scaleBar());

  const selectedPass = () => clearPasses()[S.pass] || null;
  function renderPassChips() {
    const all = [...(S.field?.health?.passes || [])].reverse(); // oldest first
    const cp = clearPasses();
    const sel = selectedPass();
    const out = all.map((p) => (p.cloudy ? `<span class="pchip cloudy" title="${esc(t('cloudy'))}"><b>${esc(fd(p.date))}</b><small>☁ ${num(p.fieldCloud ?? p.tileCloud)}%</small></span>` : `<button class="pchip" data-pass="${cp.indexOf(p)}" aria-pressed="${p === sel}"><b>${esc(fd(p.date))}</b><small>☁ ${num(p.fieldCloud ?? 0)}%</small></button>`));
    const nx = S.field?.health?.next;
    if (nx) out.push(`<span class="pchip next"><b>${esc(fd(nx.date))}</b><small>${esc(t('nextPass'))}</small></span>`);
    $('#passes').innerHTML = out.join('') || `<span class="muted small">${esc(S.field ? t('allCloudy') : t('readingSat'))}</span>`;
    const a = $('#passes [aria-pressed="true"]');
    if (a) a.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  $('#passes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pass]');
    if (!b) return;
    stopPlay();
    S.pass = +b.dataset.pass;
    if (S.layer === 'sat') setLayer('ndvi');
    renderField();
  });
  function setLayer(l) {
    S.layer = l;
    $$('#layers [data-layer]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.layer === l)));
  }
  $('#layers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layer]');
    if (!b) return;
    setLayer(b.dataset.layer);
    renderField();
  });
  $('#passSlider').addEventListener('input', (e) => {
    stopPlay();
    S.pass = +e.target.value;
    if (S.layer === 'sat') setLayer('ndvi');
    renderField();
  });
  function stopPlay() {
    if (S.playing) {
      clearInterval(S.playing);
      S.playing = null;
      $('#play').innerHTML = I.play;
    }
  }
  $('#play').addEventListener('click', () => {
    if (S.playing) return stopPlay();
    const last = clearPasses().length - 1;
    if (last < 1) return;
    setLayer('ndvi');
    if (S.pass >= last) S.pass = -1;
    $('#play').innerHTML = I.pause;
    const step = () => {
      S.pass++;
      renderField();
      if (S.pass >= last) stopPlay();
    };
    step();
    S.playing = setInterval(step, 1300);
  });

  function sRow(label, val, frac, tone) {
    return `<div class="srow"><span>${esc(label)}</span><b>${esc(val)}</b>${frac != null ? `<div class="sb"><i class="${tone || ''}" style="width:${clamp(frac, 0, 1) * 100}%"></i></div>` : ''}</div>`;
  }
  function renderStatus() {
    const p = selectedPass();
    const L = latest();
    const acres = Number(S.cur?.acres) || S.field?.outlineAcres || null;
    const w = S.plan?.weather;
    const d0 = w?.days?.[0];
    const kit = S.sensors?.field;
    const soil = S.plan?.soil;
    const sec = [];
    const satRows = [];
    if (p) {
      satRows.push(sRow(t('passL'), `${fd(p.date)} · ${p.sat.replace('S2', 'Sentinel-2')}`));
      satRows.push(sRow(t('cloudL'), `${num(p.fieldCloud ?? 0)}%`, (p.fieldCloud ?? 0) / 100, 'sky'));
      satRows.push(sRow(t('ndviMean'), num(p.ndvi.mean, 2), p.ndvi.mean, 'leaf'));
      satRows.push(sRow(t('ndviMinMax'), `${num(p.ndvi.min, 2)} / ${num(p.ndvi.max, 2)}`));
      satRows.push(sRow(t('stressed'), `${num(p.ndvi.stressedPct)}%${acres ? ` · ${num((p.ndvi.stressedPct / 100) * acres, 2)} ${t('acShort')}` : ''}`, p.ndvi.stressedPct / 100, 'warn'));
      satRows.push(sRow(t('canopy'), `${num(p.ndvi.canopyPct)}%`, p.ndvi.canopyPct / 100, 'leaf'));
    } else satRows.push(sRow(t('passL'), S.field ? (S.field.error ? t('satError') : t('allCloudy')) : t('readingSat')));
    if (S.field?.health?.next) satRows.push(sRow(t('nextPass'), fmt('inDays', { n: num(daysBetween(S.plan?.today || new Date().toISOString().slice(0, 10), S.field.health.next.date)) })));
    sec.push(['sat', t('secSat'), satRows]);
    const soilRows = [];
    if (w) soilRows.push(sRow(t('topsoilMoist'), `${num((w.soilMoisture ?? 0) * 100)}% · ${t(`moist_${w.soilMoistureLevel}`)}`, clamp((w.soilMoisture ?? 0) / 0.45, 0, 1), 'sky'));
    if (soil) soilRows.push(sRow(t('soilType'), t(`soil_${soil.texture}`)));
    if (soil?.ph) soilRows.push(sRow('pH', num(soil.ph, 1), clamp((soil.ph - 4) / 5, 0, 1)));
    if (w) soilRows.push(sRow(t('rain10'), `${num(w.rainNext10Mm)} ${t('mm')}`));
    if (kit?.soil_moisture) soilRows.push(sRow(`${t('kitProbe')} · ${t('simulated')}`, `${num(kit.soil_moisture.value)}%`, kit.soil_moisture.value / 60, 'sky'));
    sec.push(['drop', t('secSoil'), soilRows.length ? soilRows : [sRow(t('soilType'), S.plan ? t('soilUnknown') : '…')]]);
    const wxRows = [];
    if (d0) {
      wxRows.push(sRow(t('tempToday'), `${num(d0.tMax)}° / ${num(d0.tMin)}°`, clamp((d0.tMax - 10) / 35, 0, 1), 'warn'));
      wxRows.push(sRow(t('humidity'), `${num(d0.humidity)}%`, d0.humidity / 100, 'sky'));
      wxRows.push(sRow(t('rainChance'), `${num(d0.rainChance)}%`, d0.rainChance / 100, 'sky'));
    }
    if (kit?.air_temp) wxRows.push(sRow(`${t('kitAir')} · ${t('simulated')}`, `${num(kit.air_temp.value, 1)}°`));
    sec.push(['sun', t('secWx'), wxRows.length ? wxRows : [sRow(t('tempToday'), '…')]]);
    sec.push(['eye', t('secField'), [sRow(t('fieldSize'), acres ? `${num(acres, 2)} ${t('acShort')}` : '—'), sRow(t('outlineBy'), S.field?.outlineFound ? 'SAM 3.1' : t('noOutlineShort')), sRow(t('place'), placeName(S.cur))]]);
    $('#status').innerHTML = sec.map(([ic, h, rows], i) => `<div class="ssec" style="animation-delay:${i * 60}ms"><h5>${I[ic]}${esc(h)}</h5>${rows.join('')}</div>`).join('');
  }
  function renderSpark() {
    const cp = clearPasses();
    const svg = $('#spark');
    if (cp.length < 2) {
      svg.innerHTML = '';
      $('#fNote').textContent = S.field ? t('allCloudy') : t('readingSat');
      return;
    }
    const W = 320;
    const H = 90;
    const pad = 14;
    const data = cp.map((p) => p.ndvi.mean);
    const n = data.length - 1;
    const xs = (i) => pad + (i * (W - 2 * pad)) / n;
    const ys = (v) => H - 14 - v * (H - 26);
    const d = data.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(' ');
    const ci = clamp(S.pass, 0, n);
    svg.innerHTML = `<path class="ar" d="${d} L${xs(n)} ${H - 14} L${xs(0)} ${H - 14}Z"/><path class="ln" d="${d}"/><text x="${xs(0)}" y="${H - 1}" text-anchor="start">${esc(fd(cp[0].date))}</text><text x="${xs(n)}" y="${H - 1}" text-anchor="end">${esc(fd(cp[n].date))}</text><circle class="dot" r="7" cx="${xs(ci)}" cy="${ys(data[ci])}"/>`;
    const last = data.at(-1);
    const prev = data.at(-2);
    const trend = last - prev > 0.05 ? 'trendUp' : last - prev < -0.05 ? 'trendDown' : 'trendFlat';
    const w = healthWord(last);
    $('#fNote').innerHTML = `<span class="pill ${w.c}">${esc(t(w.k))}</span> ${esc(fmt(trend, { a: num(prev, 2), b: num(last, 2) }))}`;
  }
  function renderField() {
    if (!S.cur) {
      $('#scanTxt').textContent = t('heroAddS');
      return;
    }
    ensureTile();
    const cp = clearPasses();
    S.pass = clamp(S.pass, 0, Math.max(0, cp.length - 1));
    const p = selectedPass();
    $('#player').hidden = cp.length < 2;
    $('#passSlider').max = Math.max(0, cp.length - 1);
    $('#passSlider').value = S.pass;
    $('#passDate').textContent = p ? fd(p.date) : '';
    $('#scanTxt').textContent = S.layer === 'ndvi' && p ? `SENTINEL-2 L2A · NDVI · 10 ${t('mShort')} · ${fd(p.date)}` : `${t('satBase')} · Esri`;
    $('#legendRow').style.visibility = S.layer === 'ndvi' ? 'visible' : 'hidden';
    $('#ramp').style.background = `linear-gradient(90deg,${RAMP.map((c) => `rgb(${c})`).join(',')})`;
    $('#lgLo').textContent = t('bare');
    $('#lgHi').textContent = t('dense');
    $('#fNdvi').textContent = p ? num(p.ndvi.mean, 2) : '—';
    const w = S.plan?.weather;
    $('#fMoist').textContent = w?.soilMoisture != null ? `${num(w.soilMoisture * 100)}%` : '—';
    $('#fStageK').textContent = p ? `${t('srcS2')} · ${fd(p.date)}` : t('srcS2');
    $('#fStage').textContent = t(healthWord(p?.ndvi?.mean).k);
    updatePlant($('#plantField'), p?.ndvi?.mean);
    renderPassChips();
    renderStatus();
    renderSpark();
    drawMap();
    $('#satpassHost').innerHTML = S.layer === 'ndvi' && p ? `<div class="satpass">${I.sat}${esc(p.sat.replace('S2', 'Sentinel-2'))} · ${esc(fd(p.date))}</div>` : '';
  }
  async function rescan() {
    if (!S.cur) return;
    toast(t('rescanning'));
    const r = await postJson(`/api/lands/${S.cur.id}/rescan`, {});
    if (!r.ok) return toast(`${t('error')}: ${r.error}`);
    await loadLands();
    openLand(r.land.id);
  }
  $('#rescanBtn').addEventListener('click', rescan);

  // ================= SAATHI =================
  function bubble(text, who = 'bot', meta = '') {
    const m = document.createElement('div');
    m.className = `msg ${who}`;
    m.textContent = text;
    if (meta) {
      const s = document.createElement('div');
      s.className = 'meta';
      s.textContent = meta;
      m.appendChild(s);
    }
    $('#thread').appendChild(m);
    $('#thread').scrollTop = 1e9;
    return m;
  }
  function typing() {
    const m = document.createElement('div');
    m.className = 'msg bot typing';
    m.innerHTML = '<i></i><i></i><i></i>';
    $('#thread').appendChild(m);
    $('#thread').scrollTop = 1e9;
    return m;
  }
  function renderSaathi() {
    if (!$('#thread').children.length) {
      const c = S.plan?.crops?.[0];
      bubble(c ? fmt('greetCrop', { land: landTitle(S.cur), crop: cropName(c.key) }) : t('saathiHello'));
    }
    renderQuick();
    renderPending();
    renderHow();
  }
  function renderQuick() {
    const c = S.plan?.crops?.[0];
    const q = [['sat', t('chipField'), t('qField')], ['sprout', t('chipGrow'), t('qGrow')], ...(c ? [['seed', fmt('chipPlan', { crop: cropName(c.key) }), fmt('qPlan', { crop: cropName(c.key) })]] : []), ['sun', t('chipWeather'), t('qWeather')]];
    $('#quick').innerHTML = q.map(([ic, label, text]) => `<button class="chip" type="button" data-q="${esc(text)}">${I[ic]}${esc(label)}</button>`).join('');
  }
  $('#quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (b) ask(b.dataset.q);
  });
  $('#askForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#askInput').value.trim();
    if (!v) return;
    $('#askInput').value = '';
    ask(v);
  });
  let busy = false;
  async function ask(text) {
    if (S.tab !== 'saathi') show('saathi');
    if (busy) return;
    busy = true;
    bubble(text, 'me');
    const tp = typing();
    try {
      const r = await postJson('/api/ask', { text, landId: S.cur?.id || null });
      tp.remove();
      if (!r.ok) throw new Error(r.error);
      const tools = (r.trace || []).filter((s) => s.type === 'tool').map((s) => s.name.replace(/_/g, ' '));
      const m = bubble(r.answer || t('noAnswer'), 'bot', [r.brain?.label ? fmt('answeredBy', { model: r.brain.label }) : '', tools.length ? `✓ ${tools.join(' · ')}` : ''].filter(Boolean).join('  '));
      $('#brainLine').textContent = r.brain?.label ? `${t('online')} · ${r.brain.label}` : t('online');
      if (r.answer) speak(r.answer, m);
    } catch (err) {
      tp.remove();
      bubble(`${t('error')}: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  let player = null;
  const audioCache = new Map();
  async function speak(text, el) {
    try {
      let url = audioCache.get(text);
      if (!url) {
        const r = await postJson('/api/speak', { text });
        if (!r.ok) throw new Error(r.error);
        url = r.audioDataUrl;
        audioCache.set(text, url);
      }
      if (player) player.pause();
      player = new Audio(url);
      el?.classList.add('speaking');
      player.onended = () => el?.classList.remove('speaking');
      await player.play();
    } catch {
      el?.classList.remove('speaking');
    }
  }

  // Tap the mic to talk, tap again to send (Muse Voice Transcribe).
  let rec = null;
  $('#mic').addEventListener('click', async () => {
    if (rec) return rec.state === 'recording' && rec.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const parts = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      const stopT = setTimeout(() => rec?.state === 'recording' && rec.stop(), 15000);
      rec.onstop = async () => {
        clearTimeout(stopT);
        stream.getTracks().forEach((x) => x.stop());
        rec = null;
        $('#listen').hidden = true;
        $('#mic').classList.remove('on');
        try {
          const wav = await toWav(new Blob(parts, { type: parts[0]?.type || 'audio/webm' }));
          const r = await api('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
          if (!r.ok || !r.text) throw new Error(r.error || t('tryAgain'));
          ask(r.text);
        } catch (err) {
          toast(err.message);
        }
      };
      rec.start();
      $('#listen').hidden = false;
      $('#mic').classList.add('on');
    } catch (err) {
      rec = null;
      toast(`Mic: ${err.message}`);
    }
  });
  async function toWav(blob) {
    const ctx = new AudioContext({ sampleRate: 16000 });
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close();
    const len = audio.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / audio.numberOfChannels;
    }
    const buf = new ArrayBuffer(44 + len * 2);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + len * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const s = clamp(mono[i], -1, 1);
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // Alerts waiting for the farmer (from the alerts engine; sensors and shops are simulated).
  function alertText(a) {
    let v = {};
    try {
      v = JSON.parse(a.body || '{}');
    } catch {}
    const vars = { land: landTitle(S.cur), chance: num(v.chance ?? 0), mm: num(v.mm ?? 0), humidity: num(v.humidity ?? 0), value: num(v.value ?? 0, a.title === 'soil_dry' || a.title.startsWith('sell_') ? 0 : 1), days: num(v.days ?? 0), crop: v.crop ? cropName(v.crop) : '', date: v.date ? fd(v.date) : '' };
    return { title: fmt(`a_${a.title}`, vars), body: fmt(`b_${a.title}`, vars) };
  }
  function renderPending() {
    const box = $('#pending');
    if (!S.alerts.length) return (box.innerHTML = `<div class="muted" style="text-align:center;padding:14px">${esc(t('nothingWaiting'))}</div>`);
    box.innerHTML = S.alerts
      .slice(0, 6)
      .map((a) => {
        const { title, body } = alertText(a);
        return `<div class="action"><div class="ah">${I[a.area === 'market' ? 'rupee' : a.area === 'shed' ? 'warn' : a.source === 'weather' ? 'rain' : 'drop']}<div><b>${esc(title)}</b><div class="muted small">${esc(body)}</div></div></div><div class="btns"><button class="btn ghost" data-read="${a.id}">${esc(t('gotIt'))}</button>${a.area === 'market' ? `<a class="btn" href="/#sell">${esc(t('seeIt'))}</a>` : ''}</div></div>`;
      })
      .join('');
    box.querySelectorAll('[data-read]').forEach((b) =>
      b.addEventListener('click', async () => {
        await postJson(`/api/alerts/${b.dataset.read}/read`, {}).catch(() => null);
        S.alerts = S.alerts.filter((a) => a.id !== b.dataset.read);
        renderPending();
        renderBadge();
      })
    );
  }
  function renderBadge() {
    $('#badge').hidden = !S.alerts.length;
    $('#badge').textContent = num(S.alerts.length);
  }
  function renderHow() {
    $('#how').innerHTML = [['sat', 'how1'], ['chat', 'how2'], ['check', 'how3'], ['tractor', 'how4']].map(([ic, k]) => `<div class="entry">${I[ic]}<div class="t">${esc(t(k))}</div></div>`).join('');
  }

  // ================= MONEY =================
  function renderMoney() {
    const { conf, inc, out } = dealTotals();
    const mx = Math.max(inc, out, 1);
    $('#mIn').textContent = money(inc);
    $('#mOut').textContent = money(out);
    $('#cIn').style.height = `${(inc / mx) * 100}%`;
    $('#cOut').style.height = `${(out / mx) * 100}%`;
    $('#entries').innerHTML = conf.length
      ? conf
          .map((d) => {
            const it = (d.items || [])[0] || {};
            const label = it.item === 'eggs' ? fmt('dealEggs', { trays: num(it.trays), shop: it.shop || '' }) : it.item || d.direction;
            return `<div class="entry">${I[d.direction === 'sell' ? 'rupee' : 'cart']}<div class="t"><b>${esc(label)}</b><div class="who">${esc(new Date(d.created_at).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }))} · ${esc(t('simulated'))}</div></div><span class="a ${d.direction === 'sell' ? 'in-c' : 'out-c'}">${d.direction === 'sell' ? '+' : '−'}${esc(money(Number(d.total_inr || 0)))}</span></div>`;
          })
          .join('')
      : `<div class="muted" style="text-align:center;padding:16px">${esc(t('noMoney'))}</div>`;
  }

  // ================= LAND SWITCHER =================
  $('#farmBtn').addEventListener('click', () => {
    $('#farmList').innerHTML = S.lands.length
      ? S.lands.map((l, i) => `<button class="fitem ${l.id === S.cur?.id ? 'on' : ''}" data-id="${l.id}" style="animation-delay:${i * 60}ms"><span class="th">${I.sprout}</span><span class="m"><b>${esc(landTitle(l))}</b><div>${esc(l.acres ? `${num(l.acres, 2)} ${t('acShort')}` : t('noOutlineShort'))}${l.crop ? ` · ${esc(cropName(l.crop))}` : ''} · ${esc(new Date(l.created_at).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }))}</div></span></button>`).join('')
      : `<div class="muted">${esc(t('noLands'))}</div>`;
    $('#farmSheet').hidden = false;
  });
  $('#farmList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    $('#farmSheet').hidden = true;
    openLand(b.dataset.id);
  });
  $('#farmClose').addEventListener('click', () => ($('#farmSheet').hidden = true));
  $('#addFromList').addEventListener('click', () => {
    $('#farmSheet').hidden = true;
    openAdd();
  });

  // ================= ADD LAND (photo + GPS -> satellite + SAM -> soil, weather, crops -> season) =================
  const AD = { lat: null, lon: null, place: null, photo: null, land: null, plan: null, crop: null };
  function stepTo(n) {
    [1, 2, 3, 4].forEach((i) => ($(`#a${i}`).hidden = i !== n));
    $$('#addDots i').forEach((d, i) => d.classList.toggle('on', i < n));
    $('#addSheet').scrollTop = 0;
  }
  function openAdd() {
    Object.assign(AD, { lat: null, lon: null, place: null, photo: null, land: null, plan: null, crop: null });
    $('#preview').hidden = true;
    $('#latIn').value = '';
    $('#lonIn').value = '';
    $('#placeTag').textContent = '';
    $('#findBtn').disabled = true;
    $('#presets').innerHTML = ['bogura', 'bolpur', 'punjab'].map((p) => `<button class="chip" type="button" data-pre="${p}">${I.pin}${esc(t(`place_${p}`))}</button>`).join('');
    $('#addSheet').hidden = false;
    stepTo(1);
  }
  $('#addBtn').addEventListener('click', openAdd);
  $('#addClose').addEventListener('click', () => ($('#addSheet').hidden = true));
  function setLoc(lat, lon, { place = null, label = '' } = {}) {
    AD.lat = lat;
    AD.lon = lon;
    AD.place = place;
    if (lat != null) {
      $('#latIn').value = lat.toFixed(5);
      $('#lonIn').value = lon.toFixed(5);
    }
    $('#placeTag').textContent = label || (lat != null ? `${num(lat, 4)}, ${num(lon, 4)}` : '');
    $('#findBtn').disabled = !(place || (Number.isFinite(lat) && Number.isFinite(lon)));
  }
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pre]');
    if (!b) return;
    $$('#presets .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    setLoc(null, null, { place: b.dataset.pre, label: `${t(`place_${b.dataset.pre}`)} · ${t('demoPlot')}` });
  });
  ['#latIn', '#lonIn'].forEach((s) =>
    $(s).addEventListener('input', () => {
      const la = parseFloat($('#latIn').value);
      const lo = parseFloat($('#lonIn').value);
      AD.place = null;
      $$('#presets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      const ok = Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
      AD.lat = ok ? la : null;
      AD.lon = ok ? lo : null;
      $('#findBtn').disabled = !ok;
      $('#placeTag').textContent = ok ? `${num(la, 4)}, ${num(lo, 4)}` : '';
    })
  );
  $('#gpsPick').addEventListener('click', () => {
    if (!navigator.geolocation) return toast(t('locDenied'));
    $('#placeTag').textContent = t('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc(p.coords.latitude, p.coords.longitude, { label: fmt('gpsOk', { lat: num(p.coords.latitude, 4), lon: num(p.coords.longitude, 4), m: num(p.coords.accuracy) }) }),
      () => {
        $('#placeTag').textContent = t('locDenied');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
  // Photo: shown as a preview; its EXIF GPS (if the phone saved one) fills the location.
  $('#photoIn').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    const gps = exifGPS(buf);
    AD.photo = await shrink(f);
    $('#pimg').src = AD.photo;
    $('#preview').hidden = false;
    if (gps) {
      $('#gpsTag').textContent = `GPS ${num(gps.lat, 4)}, ${num(gps.lon, 4)}`;
      setLoc(gps.lat, gps.lon, { label: t('gpsFromPhoto') });
    } else {
      $('#gpsTag').textContent = t('noPhotoGps');
      if (AD.lat == null && !AD.place) $('#gpsPick').click();
    }
  });
  function shrink(file, max = 1280) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  // Minimal EXIF GPS reader (JPEG APP1), from the design prototype.
  function exifGPS(buf) {
    try {
      const v = new DataView(buf);
      if (v.getUint16(0) !== 0xffd8) return null;
      let o = 2;
      while (o < v.byteLength) {
        const m = v.getUint16(o);
        const len = v.getUint16(o + 2);
        if (m === 0xffe1 && v.getUint32(o + 4) === 0x45786966) {
          const tiff = o + 10;
          const le = v.getUint16(tiff) === 0x4949;
          const u16 = (p) => v.getUint16(p, le);
          const u32 = (p) => v.getUint32(p, le);
          const ifd0 = tiff + u32(tiff + 4);
          let gpsOff = null;
          for (let i = 0; i < u16(ifd0); i++) {
            const e = ifd0 + 2 + i * 12;
            if (u16(e) === 0x8825) gpsOff = tiff + u32(e + 8);
          }
          if (!gpsOff) return null;
          const g = {};
          for (let i = 0; i < u16(gpsOff); i++) {
            const e = gpsOff + 2 + i * 12;
            const tag = u16(e);
            if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(v.getUint8(e + 8));
            if (tag === 2 || tag === 4) {
              const p = tiff + u32(e + 8);
              const r = (k) => u32(p + k * 8) / u32(p + k * 8 + 4);
              g[tag] = r(0) + r(1) / 60 + r(2) / 3600;
            }
          }
          if (g[2] == null || g[4] == null) return null;
          return { lat: g[2] * (g[1] === 'S' ? -1 : 1), lon: g[4] * (g[3] === 'W' ? -1 : 1) };
        }
        o += 2 + len;
      }
    } catch {}
    return null;
  }

  const AN_STEPS = ['anSat', 'anSam', 'anSoil', 'anWx', 'anCal'];
  function anProgress(n, failed) {
    $('#anlist').innerHTML = AN_STEPS.map((k, i) => `<div class="anrow ${i === n && failed ? 'fail' : ''}"><span class="st">${i < n ? I.check : i === n && !failed ? '<span class="spin"></span>' : i === n ? I.warn : '<span class="dotx"></span>'}</span><span class="k">${esc(t(k))}</span></div>`).join('');
  }
  $('#findBtn').addEventListener('click', async () => {
    stepTo(2);
    $('#anvis').innerHTML = AD.photo ? `<img src="${AD.photo}" alt="">` : `<div class="orbitbig"><div class="earthb"></div><div class="satb">${I.sat}</div></div>`;
    anProgress(0);
    const body = { kind: 'empty', lang, photoDataUrl: AD.photo };
    if (AD.place) body.place = AD.place;
    else Object.assign(body, { lat: AD.lat, lon: AD.lon });
    let st = 0;
    const tick = setInterval(() => anProgress(Math.min(1, ++st)), 2500);
    try {
      const r = await postJson('/api/lands', body);
      clearInterval(tick);
      if (!r.ok) throw new Error(r.error);
      AD.land = r.land;
      anProgress(2);
      $('#anvis').innerHTML = `<div class="anmap"><img src="${imgUrl(r.land.tileUrl)}" alt=""><div class="mono">${esc(r.fields ? fmt('fieldsFound', { n: num(r.fields), ac: num(r.land.acres, 2) }) : t('noFieldFound'))}</div></div>`;
      if (!r.fields) {
        anProgress(1, true);
        $('#anlist').insertAdjacentHTML('beforeend', `<p class="sub">${esc(t('heroNoFieldS'))}</p><button class="btn" id="anUseAnyway">${esc(t('useAnyway'))}</button>`);
        $('#anUseAnyway').addEventListener('click', finishAdd);
        return;
      }
      const p = await api(`/api/lands/${r.land.id}/plan`);
      anProgress(5);
      AD.plan = p.ok ? p.plan : null;
      setTimeout(showResults, 500);
    } catch (err) {
      clearInterval(tick);
      anProgress(st, true);
      toast(`${t('error')}: ${err.message}`);
    }
  });
  function showResults() {
    stepTo(3);
    const p = AD.plan;
    const w = p?.weather;
    $('#prof').innerHTML = [
      [I.eye, t('fieldSize'), AD.land?.acres ? `${num(AD.land.acres, 2)} ${t('acShort')}` : '—'],
      [I.soil, t('soilType'), p?.soil ? `${t(`soil_${p.soil.texture}`)} · pH ${num(p.soil.ph, 1)}` : t('soilUnknown')],
      [I.drop, t('topsoilMoist'), w ? `${num((w.soilMoisture ?? 0) * 100)}% · ${t(`moist_${w.soilMoistureLevel}`)}` : '—'],
      [I.rain, t('rain10'), w ? `${num(w.rainNext10Mm)} ${t('mm')}` : '—'],
    ]
      .map(([ic, k, v], i) => `<div class="pt" style="animation-delay:${i * 70}ms"><span class="ptic">${ic}</span><div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div></div>`)
      .join('');
    const crops = p?.crops || [];
    $('#crops').innerHTML = crops.length
      ? crops.map((c, i) => `<button class="crop ${i === 0 ? 'top' : ''}" data-crop="${c.key}" style="animation-delay:${i * 90}ms"><span class="cic">${I.sprout}</span><div><h4>${esc(cropName(c.key))}${i === 0 ? `<span class="pill ok">${esc(t('bestNow'))}</span>` : ''}</h4><div class="who">${esc(c.status === 'soon' ? fmt('startsIn', { n: num(c.daysUntil) }) : fmt('sowBy', { date: fd(c.windowEnd), n: num(c.daysLeft) }))}</div><div class="who">${esc(fmt('harvestIn', { a: num(c.growDays?.min), b: num(c.growDays?.max) }))} · ${esc(t(`water_${c.water}`))}</div></div><div class="go"><span class="profit">${esc(money(c.sampleProfitBdtPerAcre || 0, '৳'))}</span><span class="who">${esc(t('perAcreSample'))}</span><span class="btn">${esc(t('grow'))}</span></div></button>`).join('')
      : `<div class="emptybox">${esc(p?.aez ? t('noCropsText') : t('noFaoHere'))}</div>`;
    $('#crops')
      .querySelectorAll('[data-crop]')
      .forEach((b) =>
        b.addEventListener('click', () => {
          AD.crop = crops.find((c) => c.key === b.dataset.crop);
          showPlan();
        })
      );
  }
  $('#noCrop').addEventListener('click', finishAdd);
  function showPlan() {
    stepTo(4);
    const c = AD.crop;
    const today = AD.plan?.today || new Date().toISOString().slice(0, 10);
    $('#planH').textContent = fmt('seasonOf', { crop: cropName(c.key) });
    const steps = seasonSteps(c, today);
    $('#money3').innerHTML = [[t('sowWindow'), `${fd(c.windowStart)} – ${fd(c.windowEnd)}`], [t('harvestL'), fmt('harvestIn', { a: num(c.growDays?.min), b: num(c.growDays?.max) })], [t('perAcreSample'), money(c.sampleProfitBdtPerAcre || 0, '৳')]].map(([k, v]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');
    $('#tl').innerHTML = steps.map((s, i) => `<div class="tli" style="animation-delay:${i * 110}ms"><span class="ic">${I[s.icon]}</span><div><b>${esc(t(`step_${s.id}`))}</b><div class="d">${esc(fd(s.date))}</div></div><span class="a">${s.date === steps[0].date && i === 0 ? esc(t('next')) : ''}</span></div>`).join('');
  }
  $('#startBtn').addEventListener('click', async () => {
    if (AD.land && AD.crop) await api(`/api/lands/${AD.land.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crop: AD.crop.key }) }).catch(() => null);
    finishAdd();
  });
  async function finishAdd() {
    $('#addSheet').hidden = true;
    await loadLands();
    if (AD.land) await openLand(AD.land.id);
    show('home');
  }

  // ================= start =================
  async function boot() {
    applyLang();
    icons();
    try {
      await loadLands();
    } catch {
      return;
    }
    show('home');
    const want = store.get('ks_land');
    const pick = S.lands.find((l) => l.id === want) || S.lands[0];
    if (pick) await openLand(pick.id).catch((e) => toast(e.message));
    else renderAll();
    loadSide();
  }
  boot();
})();
