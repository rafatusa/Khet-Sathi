// Khet Saathi farmer app (v0.7.0): language, home, add land (photo + GPS),
// satellite plot with SAM 3.1 outline (zoomed scan), re-scan, ask Saathi by voice or tap, spoken replies.
(() => {
  const $ = (id) => document.getElementById(id);
  const I18N = window.KS_I18N;

  // ---------- storage helpers (private windows may block storage) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  let lang = store.get('ks_lang');
  let passcode = store.get('ks_passcode') || '';
  let health = null;
  let lands = [];
  let current = null; // land on screen
  let captureKind = 'empty';
  let place = null; // demo place key, or null for GPS
  let gps = null; // { lat, lon }
  let photoDataUrl = null;
  let lastSam = null; // SAM summary from the latest scan, shown on the no-field notice

  const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  const digits = { bn: '০১২৩৪৫৬৭৮৯', hi: '०१२३४५६७८९' };
  const num = (n, dp = 1) => {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const s = Number(n).toFixed(dp).replace(/\.0+$/, '');
    const d = digits[lang];
    return d ? s.replace(/[0-9]/g, (c) => d[c]) : s;
  };
  // Small Bengal plots need 2 decimals (0.12 acres would otherwise read 0.1).
  const acresText = (a) => num(a, a != null && Number(a) < 1 ? 2 : 1);

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'x-app-passcode': passcode, ...(opts.headers || {}) } });
    const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (res.status === 401) {
      show('s-pass');
      throw new Error('Passcode required');
    }
    return json;
  }
  const postJson = (path, body, method = 'POST') =>
    api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const imgUrl = (u) => (u ? `${u}${u.includes('?') ? '&' : '?'}k=${encodeURIComponent(passcode)}` : '');

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (el.hidden = true), 4000);
  }

  // ---------- screens + language ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== id));
    $('micBar').hidden = !['s-home', 's-land', 's-plan', 's-cal', 's-shed'].includes(id);
    window.scrollTo(0, 0);
  }
  function applyLang() {
    document.documentElement.lang = lang || 'bn';
    document.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
    $('langSwitch').textContent = { bn: 'বাংলা', hi: 'हिंदी', en: 'English' }[lang] || 'বাংলা';
    if (health?.demoPlaces) {
      document.querySelectorAll('[data-place]').forEach((b) => {
        if (b.dataset.place !== 'gps') b.textContent = health.demoPlaces[b.dataset.place]?.[lang] || b.dataset.place;
      });
    }
  }

  document.querySelectorAll('.lang-btn').forEach((b) =>
    b.addEventListener('click', () => {
      lang = b.dataset.lang;
      store.set('ks_lang', lang);
      applyLang();
      goHome();
    })
  );
  $('langSwitch').addEventListener('click', () => show('s-lang'));
  $('passGo').addEventListener('click', () => {
    passcode = $('passInput').value.trim();
    store.set('ks_passcode', passcode);
    start();
  });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', goHome));
  document.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', goHome));

  // ---------- home ----------
  async function goHome() {
    show('s-home');
    $('homeAnswer').hidden = true;
    loadAlerts();
    loadKit();
    const list = $('landList');
    try {
      const r = await api('/api/lands');
      lands = r.ok ? r.lands : [];
    } catch {
      return;
    }
    list.replaceChildren();
    if (!lands.length) {
      const p = document.createElement('div');
      p.className = 'empty-note';
      p.textContent = t('noLands');
      list.append(p);
      return;
    }
    for (const land of lands) {
      const b = document.createElement('button');
      b.className = 'land-item';
      const img = document.createElement('img');
      img.alt = '';
      img.src = imgUrl(`/api/lands/${land.id}/image/tile?v=${encodeURIComponent(String(land.ground_m ?? ''))}`);
      const main = document.createElement('div');
      main.className = 'li-main';
      const title = document.createElement('span');
      title.className = 'li-title';
      title.textContent = land.kind === 'empty' ? t('emptyLand') : t('standingCrop');
      const sub = document.createElement('span');
      sub.className = 'muted small';
      sub.textContent = new Date(land.created_at).toLocaleDateString(lang === 'en' ? 'en-IN' : `${lang}-IN`);
      main.append(title, sub);
      const acres = document.createElement('span');
      acres.className = 'li-acres';
      acres.textContent = land.acres ? `${acresText(land.acres)} ${t('acres')}` : '';
      b.append(img, main, acres);
      b.addEventListener('click', () => openLand(land.id));
      list.append(b);
    }
  }
  $('goEmpty').addEventListener('click', () => openCapture('empty'));
  $('goCrop').addEventListener('click', () => openCapture('crop'));

  // ---------- capture ----------
  function setPlace(p) {
    place = p;
    document.querySelectorAll('[data-place]').forEach((b) => b.classList.toggle('on', b.dataset.place === (p || 'gps')));
  }
  function setLoc(state, text) {
    $('locDot').className = `dot ${state}`;
    $('locText').textContent = text;
  }
  function inSouthAsia(lat, lon) {
    return lat >= 5 && lat <= 37 && lon >= 60 && lon <= 98;
  }
  function locate() {
    gps = null;
    setLoc('wait', t('locating'));
    if (!navigator.geolocation) {
      setPlace(defaultPlace());
      return setLoc('warn', t('locDenied'));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        if (!inSouthAsia(lat, lon)) {
          setPlace(defaultPlace());
          return setLoc('warn', t('locFar'));
        }
        gps = { lat, lon };
        setPlace(null);
        setLoc('ok', `${t('locOk')} · ${num(lat, 4)}, ${num(lon, 4)}`);
      },
      () => {
        setPlace(defaultPlace());
        setLoc('warn', t('locDenied'));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }
  // Empty land defaults to the Bogura demo plot (full soil, weather and sowing data).
  const defaultPlace = () => (captureKind === 'empty' ? 'bogura' : 'bolpur');
  function openCapture(kind) {
    captureKind = kind;
    photoDataUrl = null;
    $('photoPreview').hidden = true;
    $('photoInput').value = '';
    $('photoBtnLabel').textContent = t('takePhoto');
    $('captureTitle').textContent = kind === 'empty' ? t('captureEmpty') : t('captureCrop');
    show('s-capture');
    locate();
  }
  document.querySelectorAll('[data-place]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.place === 'gps') {
        if (gps) setPlace(null);
        else locate();
      } else {
        setPlace(b.dataset.place);
        setLoc('ok', `${t('demoPlace')} · ${b.textContent}`);
      }
    })
  );
  $('photoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      photoDataUrl = await shrinkImage(file, 1280);
      $('photoPreview').src = photoDataUrl;
      $('photoPreview').hidden = false;
      $('photoBtnLabel').textContent = t('retake');
    } catch {
      toast(t('error'));
    }
  });
  function shrinkImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- analyse (thinking screen) ----------
  function runSteps() {
    const items = [...document.querySelectorAll('#steps li')];
    items.forEach((li) => li.classList.remove('active', 'done'));
    let i = 0;
    items[0].classList.add('active');
    const timer = setInterval(() => {
      if (i < items.length - 1) {
        items[i].classList.replace('active', 'done');
        i += 1;
        items[i].classList.add('active');
      }
    }, 2600);
    return () => {
      clearInterval(timer);
      items.forEach((li) => {
        li.classList.remove('active');
        li.classList.add('done');
      });
    };
  }
  $('analyseBtn').addEventListener('click', async () => {
    if (!gps && !place) setPlace(defaultPlace());
    const body = { kind: captureKind, lang, photoDataUrl };
    if (place) body.place = place;
    else Object.assign(body, gps);
    await scanAndShow(() => postJson('/api/lands', body), 's-capture');
  });

  // Shows the thinking screen while the server scans, then the land screen.
  async function scanAndShow(request, backTo) {
    show('s-think');
    const finish = runSteps();
    try {
      const r = await request();
      finish();
      if (!r.ok) throw new Error(r.error);
      lastSam = { landId: r.land.id, ...(r.sam || {}) };
      setTimeout(() => renderLand(r.land), 500);
    } catch (err) {
      finish();
      toast(`${t('error')}: ${err.message}`);
      if (backTo === 'land') {
        if (current) renderLand(current);
        else goHome();
      } else show(backTo);
    }
  }

  // ---------- land ----------
  async function openLand(id) {
    try {
      const r = await api(`/api/lands/${id}`);
      if (!r.ok) throw new Error(r.error);
      renderLand(r.land);
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    }
  }
  function renderLand(land) {
    current = land;
    show('s-land');
    $('landAnswer').hidden = true;
    $('landTitle').textContent = land.kind === 'empty' ? t('emptyLand') : t('standingCrop');
    $('mapImg').src = imgUrl(land.tileUrl);
    $('mapImg').alt = t('yourLand');
    if (land.photoUrl) {
      $('mapPhoto').src = imgUrl(land.photoUrl);
      $('mapPhoto').hidden = false;
    } else {
      $('mapPhoto').hidden = true;
    }
    $('demoBadge').hidden = land.location_source !== 'demo';
    $('demoBadge').textContent = `${t('demoBadge')} · ${health?.demoPlaces?.[land.place]?.[lang] || ''}`;
    drawFields();
    const objs = land.objects || [];
    const ground = Number(land.ground_m);
    $('statFields').textContent = num(objs.length, 0);
    $('mapHint').textContent = objs.length > 1 ? t('tapToChange') : '';
    $('scaleBadge').hidden = !(ground > 0);
    $('scaleBadge').textContent = t('viewMeters').replace('{m}', num(ground, 0));

    // No outline: a town spot (scanned close up, nothing found) or an old land (wide view only).
    const noField = objs.length === 0;
    const nothingHere = noField && ground > 0 && ground < 600;
    $('landNotice').hidden = !noField;
    $('landStats').hidden = noField;
    $('seePlanBtn').hidden = noField || land.kind !== 'empty';
    $('askTitle').hidden = noField;
    $('askChips').hidden = noField;
    if (noField) {
      $('noticeTitle').textContent = nothingHere ? t('noFarmTitle') : t('rescanTitle');
      $('noticeText').textContent = nothingHere ? t('noFarmText') : t('rescanText');
      $('demoBtn').hidden = !nothingHere;
      $('rescanBtn').className = nothingHere ? 'btn wide' : 'btn yellow wide';
      $('rescanIcoSearch').style.display = nothingHere ? 'none' : '';
      $('rescanIcoRetry').style.display = nothingHere ? '' : 'none';
      $('rescanLabel').textContent = nothingHere ? t('tryAgain') : t('rescanBtn');
      $('samLine').textContent = samLine(land);
    }

    const chips = $('askChips');
    chips.replaceChildren();
    const qs = land.kind === 'empty' ? [t('suggestEmpty'), t('suggestGeneral')] : [t('suggestCrop'), t('suggestGeneral')];
    for (const q of qs) {
      const b = document.createElement('button');
      b.className = 'pill';
      b.textContent = q;
      b.addEventListener('click', () => ask(q, $('landAnswer')));
      chips.append(b);
    }
  }
  // Small technical line for judges: what SAM looked at and what came back.
  function samLine(land) {
    const s = lastSam && lastSam.landId === land.id ? lastSam : null;
    const ground = Number(land.ground_m) || 0;
    const prompt = s?.prompt || (ground && ground < 600 ? 'field' : 'farm field');
    let line = `SAM 3.1 · "${prompt}" · 0 fields at ${Math.round(ground)} m view`;
    if (s?.error) line += ` · ${s.error}`;
    return line;
  }
  $('rescanBtn').addEventListener('click', () => {
    if (!current) return;
    const id = current.id;
    scanAndShow(() => postJson(`/api/lands/${id}/rescan`, {}), 'land');
  });
  $('demoBtn').addEventListener('click', () => {
    const kind = current?.kind || 'empty';
    scanAndShow(() => postJson('/api/lands', { kind, lang, place: 'bolpur' }), 'land');
  });

  function drawFields() {
    const land = current;
    const svg = $('mapSvg');
    const W = land.image_px || 1024;
    svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
    svg.replaceChildren();
    const ns = 'http://www.w3.org/2000/svg';
    const sel = String(land.selected_object ?? '');
    for (const o of land.objects || []) {
      if (!o.mask?.svgPath) continue;
      const b = o.mask.bounds;
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', o.mask.svgPath);
      p.setAttribute('fill-rule', 'evenodd');
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      p.setAttribute('stroke-width', String(o.id) === sel ? '4' : '1.5');
      p.setAttribute('class', String(o.id) === sel ? 'field sel' : 'field');
      p.setAttribute(
        'transform',
        `translate(${b.left} ${b.top}) scale(${(b.right - b.left) / o.mask.width} ${(b.bottom - b.top) / o.mask.height})`
      );
      p.addEventListener('click', () => chooseField(o.id));
      svg.append(p);
    }
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', W / 2);
    dot.setAttribute('cy', W / 2);
    dot.setAttribute('r', 12);
    dot.setAttribute('class', 'gps');
    svg.append(dot);
    // Selected field drawn last so its outline sits on top.
    const selEl = svg.querySelector('.field.sel');
    if (selEl) svg.insertBefore(selEl, dot);
    $('acresBadge').textContent = land.acres ? `${acresText(land.acres)} ${t('acres')}` : t('yourLand');
    $('statAcres').textContent = acresText(land.acres);
  }
  async function chooseField(id) {
    if (String(id) === String(current.selected_object)) return;
    try {
      const r = await postJson(`/api/lands/${current.id}`, { selected: id }, 'PATCH');
      if (!r.ok) throw new Error(r.error);
      current = r.land;
      drawFields();
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    }
  }
  // ---------- what to grow (Scenario 1) ----------
  const locale = () => ({ bn: 'bn-BD', hi: 'hi-IN', en: 'en-IN' }[lang] || 'bn-BD');
  const fmt = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const dayDate = (iso) => new Date(`${iso}T12:00:00Z`);
  const longDate = (iso) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dayDate(iso));
  const weekday = (iso, style = 'long') => new Intl.DateTimeFormat(locale(), { weekday: style, timeZone: 'UTC' }).format(dayDate(iso));
  const money = (n) => `৳ ${num(n, 0).replace(/\B(?=([0-9০-৯०-९]{3})+(?![0-9০-৯०-९]))/g, ',')}`;
  let plan = null;

  $('seePlanBtn').addEventListener('click', () => openPlan());
  $('planBack').addEventListener('click', () => (current ? renderLand(current) : goHome()));

  async function openPlan() {
    if (!current) return;
    show('s-plan');
    plan = null;
    $('planImg').src = imgUrl(current.tileUrl);
    $('planPlotTitle').textContent = `${acresText(current.acres)} ${t('acres')}${current.place ? ` · ${health?.demoPlaces?.[current.place]?.[lang] || ''}` : ''}`;
    $('planChips').replaceChildren();
    $('planWx').hidden = true;
    $('planNotice').hidden = true;
    $('planHead').hidden = true;
    $('planZoneNote').hidden = true;
    $('planCrops').replaceChildren();
    $('planAnswer').hidden = true;
    $('planLoading').hidden = false;
    try {
      const r = await api(`/api/lands/${current.id}/plan`);
      if (!r.ok) throw new Error(r.error);
      plan = r.plan;
      renderPlan(plan);
    } catch (err) {
      showPlanNotice(t('error'), err.message);
    } finally {
      $('planLoading').hidden = true;
    }
  }

  function showPlanNotice(title, text) {
    $('planNoticeTitle').textContent = title;
    $('planNoticeText').textContent = text;
    $('planNotice').hidden = false;
  }

  function chip(text) {
    const c = document.createElement('span');
    c.className = 'soil-chip';
    c.textContent = text;
    return c;
  }

  function renderPlan(p) {
    const chips = $('planChips');
    if (p.soil) {
      chips.append(chip(t(`soil_${p.soil.texture}`)));
      if (Number.isFinite(p.soil.ph)) chips.append(chip(`pH ${num(p.soil.ph)}`));
    } else chips.append(chip(t('soilUnknown')));
    if (p.weather?.soilMoistureLevel) chips.append(chip(t(`moist_${p.weather.soilMoistureLevel}`)));

    // Weather card: rain warning with the best days to sow, and the next 5 days.
    if (p.weather) {
      $('planWx').hidden = false;
      if (p.rain) {
        $('wxTitle').textContent = fmt('rainTitle', { day: weekday(p.rain.rainDate) });
        const b = p.rain.sowBefore && weekday(p.rain.sowBefore);
        const a = p.rain.sowAfter && weekday(p.rain.sowAfter);
        $('wxText').textContent = b && a ? fmt('rainBeforeAfter', { before: b, after: a }) : a ? fmt('rainAfterOnly', { after: a }) : b ? fmt('rainBeforeOnly', { before: b }) : '';
      } else {
        $('wxTitle').textContent = t('noRainTitle');
        $('wxText').textContent = t('noRainText');
      }
      const days = $('wxDays');
      days.replaceChildren();
      for (const d of p.weather.days.slice(0, 5)) {
        const el = document.createElement('div');
        el.className = `wx-day${(d.rainChance ?? 0) >= 60 || (d.rainMm ?? 0) >= 10 ? ' rain' : ''}`;
        el.innerHTML = `${esc(weekday(d.date, 'short'))}<strong>${esc(num(d.rainChance ?? 0, 0))}%</strong>`;
        days.append(el);
      }
    } else {
      chips.append(chip(t('weatherUnknown')));
    }

    if (!p.aez) return showPlanNotice(t('noCalendarTitle'), t('noCalendarText'));
    if (!p.crops.length) return showPlanNotice(t('noCropsTitle'), t('noCropsText'));
    $('planHead').textContent = fmt('cropsFor', { n: num(p.crops.length, 0) });
    $('planHead').hidden = false;
    $('planZoneNote').textContent = t('zoneAssumed');
    $('planZoneNote').hidden = !p.aezAssumed;
    for (const c of p.crops) $('planCrops').append(cropCard(c));
  }

  function cropTag(c) {
    if (c.status === 'closing') return c.daysLeft === 0 ? t('closingToday') : fmt('closing', { n: num(c.daysLeft, 0) });
    if (c.status === 'open') return fmt('openTag', { n: num(c.daysLeft, 0) });
    return fmt('soonTag', { n: num(c.daysUntil, 0) });
  }
  function cropWhy(c) {
    const when = c.status === 'soon' ? fmt('whyStarts', { date: longDate(c.windowStart) }) : fmt('whySowBy', { date: longDate(c.windowEnd) });
    return `${when} ${t('soilFit')} ${t(`water_${c.water}`)}`;
  }
  function cropDays(c) {
    if (!c.growDays) return '—';
    return c.growDays.min === c.growDays.max ? num(c.growDays.min, 0) : `${num(c.growDays.min, 0)}-${num(c.growDays.max, 0)}`;
  }

  function cropCard(c) {
    const name = t(`crop_${c.key}`);
    const el = document.createElement('div');
    el.className = `crop st-${c.status}`; // st- prefix: .soon is already the Home tile badge
    el.innerHTML = `
      <div class="crop-top"><div class="crop-name">${esc(name)}</div><span class="tag st-${c.status}">${esc(cropTag(c))}</span></div>
      <div class="nums">
        <div class="num"><strong>${esc(cropDays(c))}</strong><span class="muted small">${esc(t('daysToHarvest'))}</span></div>
        <div class="num"><strong>${esc(money(c.sampleProfitBdtPerAcre))}</strong><span class="muted small">${esc(t('profitPerAcre'))}</span><span class="sample">${esc(t('sample'))}</span></div>
      </div>
      <div class="why">${esc(cropWhy(c))}</div>
      <div class="crop-btns">
        <button class="btn${c === plan.crops[0] ? ' primary' : ''}" data-pick>${esc(t('pick'))}</button>
        <button class="btn sq" data-say aria-label="${esc(t('listen'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg></button>
      </div>`;
    el.querySelector('[data-pick]').addEventListener('click', () => ask(fmt('pickAsk', { crop: name }), $('planAnswer')));
    el.querySelector('[data-say]').addEventListener('click', () => speak(`${name}. ${cropTag(c)}. ${cropDays(c)} ${t('daysToHarvest')}. ${cropWhy(c)}`));
    return el;
  }

  $('planListen').addEventListener('click', () => {
    if (!plan) return;
    const parts = [$('wxTitle').textContent, $('wxText').textContent];
    for (const c of plan.crops) parts.push(`${t(`crop_${c.key}`)}, ${cropTag(c)}.`);
    speak(parts.filter(Boolean).join(' '));
  });

  // ---------- alerts feed + simulated village sensor kit (Home) ----------
  const ALERT_ICONS = {
    weather: '<path d="M7 15a4 4 0 1 1 .9-7.9A5 5 0 0 1 17.5 9 3.5 3.5 0 0 1 17 16H7z"/><path d="M9 19l-1 2M13 19l-1 2"/>',
    sensor: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    shed: '<path d="M3 11l9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/>',
  };
  const ago = (iso) => {
    const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  };
  const landLabel = (place) => (place ? t(`land_${place}`) : t('landYour'));
  function alertText(a) {
    let v = {};
    try { v = JSON.parse(a.body || '{}'); } catch {}
    const vars = {
      land: landLabel(v.place),
      chance: num(v.chance ?? 0, 0),
      mm: num(v.mm ?? 0, 0),
      humidity: num(v.humidity ?? 0, 0),
      value: num(v.value ?? 0, a.title === 'soil_dry' ? 0 : 1),
      days: num(v.days ?? 0, 0),
      crop: v.crop ? t(`crop_${v.crop}`) : '',
      date: v.date ? longDate(v.date) : '',
    };
    return { title: fmt(`a_${a.title}`, vars), body: fmt(`b_${a.title}`, vars) };
  }

  async function loadAlerts() {
    let r;
    try {
      r = await api('/api/alerts');
    } catch {
      return;
    }
    const list = r.ok ? r.alerts || [] : [];
    $('alertsBox').hidden = !list.length;
    $('alertsCount').textContent = list.length ? fmt('alertsNew', { n: num(list.length, 0) }) : '';
    const box = $('alertList');
    box.replaceChildren();
    for (const a of list) {
      const { title, body } = alertText(a);
      const kind = a.source === 'weather' ? 'weather' : a.area === 'shed' || a.source === 'camera' ? 'shed' : a.source || 'sensor';
      const el = document.createElement('div');
      el.className = `alert sev-${a.severity}`;
      el.innerHTML = `
        <div class="a-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${ALERT_ICONS[kind] || ALERT_ICONS.sensor}</svg></div>
        <div class="a-main">
          <div class="a-title">${esc(title)}</div>
          <div class="a-body">${esc(body)}</div>
          <div class="a-meta">${esc(t(`src_${a.source}`))}${a.source === 'sensor' ? ` <span class="sample">${esc(t('simulated'))}</span>` : ''} · ${esc(ago(a.created_at))}</div>
        </div>
        <div class="a-btns">
          <button data-say aria-label="${esc(t('listen'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg></button>
          <button data-read aria-label="${esc(t('gotIt'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg></button>
        </div>`;
      el.querySelector('[data-say]').addEventListener('click', () => speak(`${title}. ${body}`));
      el.querySelector('[data-read]').addEventListener('click', async () => {
        el.remove();
        const left = box.children.length;
        $('alertsCount').textContent = left ? fmt('alertsNew', { n: num(left, 0) }) : '';
        $('alertsBox').hidden = !left;
        try { await postJson(`/api/alerts/${a.id}/read`, {}); } catch {}
      });
      box.append(el);
    }
  }

  async function loadKit() {
    let r;
    try {
      r = await api('/api/sensors');
    } catch {
      return;
    }
    const f = r.ok ? r.field : null;
    $('kitCard').hidden = !f;
    if (!f) return;
    const grid = $('kitGrid');
    grid.replaceChildren();
    const units = { soil_moisture: '%', soil_temp: '°', air_temp: '°', humidity: '%' };
    let newest = null;
    for (const m of ['soil_moisture', 'soil_temp', 'air_temp', 'humidity']) {
      if (!f[m]) continue;
      if (!newest || f[m].at > newest) newest = f[m].at;
      const c = document.createElement('div');
      c.className = `kit-cell${m === 'soil_moisture' && f[m].value < 18 ? ' warn' : ''}`;
      c.innerHTML = `<strong>${esc(num(f[m].value, 0))}${units[m]}</strong><span class="muted small">${esc(t(`m_${m}`))}</span>`;
      grid.append(c);
    }
    $('kitWhen').textContent = newest ? fmt('kitWhen', { ago: ago(newest) }) : '';
  }

  // ---------- crop calendar ----------
  let cal = null;
  $('goCalendar').addEventListener('click', () => openCalendar());

  // Position of a month/day on a January-to-December bar, in percent.
  const yearPos = (m, d) => (((m - 1) * 30.44 + (d - 1)) / 365.25) * 100;
  function barSegs(win, cls) {
    const a = yearPos(win[0], win[1]);
    const b = yearPos(win[2], win[3]);
    const seg = (left, width) => `<div class="cal-seg ${cls}" style="left:${left.toFixed(2)}%;width:${Math.max(width, 0.8).toFixed(2)}%"></div>`;
    return b >= a ? seg(a, b - a) : seg(a, 100 - a) + seg(0, b); // windows across the new year wrap
  }
  const monthDay = (m, d) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, d)));
  const span = (w) => `${monthDay(w[0], w[1])} - ${monthDay(w[2], w[3])}`;
  function calTag(r) {
    if (r.status === 'closing') return r.daysLeft === 0 ? t('closingToday') : fmt('closing', { n: num(r.daysLeft, 0) });
    if (r.status === 'open') return fmt('openTag', { n: num(r.daysLeft, 0) });
    if (r.status === 'soon') return fmt('soonTag', { n: num(r.daysUntil, 0) });
    return fmt('laterTag', { n: num(r.daysUntil, 0) });
  }

  async function openCalendar() {
    show('s-cal');
    $('calAnswer').hidden = true;
    $('calNotice').hidden = true;
    $('calList').replaceChildren();
    $('calMonths').innerHTML = Array.from({ length: 12 }, (_, i) =>
      `<span>${esc(new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 15))))}</span>`).join('');
    $('calLoading').hidden = false;
    try {
      const landId = current?.id || '';
      const r = await api(`/api/calendar${landId ? `?landId=${encodeURIComponent(landId)}` : ''}`);
      if (!r.ok) throw new Error(r.error);
      cal = r;
      renderCalendar(r);
    } catch (err) {
      $('calNoticeTitle').textContent = t('error');
      $('calNoticeText').textContent = err.message;
      $('calNotice').hidden = false;
    } finally {
      $('calLoading').hidden = true;
    }
  }

  function renderCalendar(r) {
    $('calZoneName').textContent = r.place ? t(`place_${r.place}`) : t('landYour');
    if (!r.aez) {
      $('calZone').textContent = '';
      $('calNoticeTitle').textContent = t('noCalendarTitle');
      $('calNoticeText').textContent = t('noCalendarText');
      $('calNotice').hidden = false;
      return;
    }
    const zoneNo = (r.aez.match(/^(\d+)\./) || [])[1] || '';
    const zoneName = zoneNo === '4' ? t('aez_name') : r.aez.replace(/^\d+\.\s*/, '');
    $('calZone').textContent = `${fmt('zoneLabel', { zone: zoneName, n: num(zoneNo || 0, 0) })}${r.aezAssumed ? ` · ${t('zoneAssumedShort')}` : ''}`;
    const today = r.today.split('-').map(Number);
    const todayPos = yearPos(today[1], today[2]);
    const groups = {
      now: r.rows.filter((x) => x.status === 'closing' || x.status === 'open'),
      soon: r.rows.filter((x) => x.status === 'soon'),
      later: r.rows.filter((x) => x.status === 'later'),
    };
    const list = $('calList');
    const head = (text) => {
      const h = document.createElement('h2');
      h.className = 'cal-head';
      h.textContent = text;
      list.append(h);
    };
    const row = (x) => {
      const name = t(`crop_${x.key}`);
      const b = document.createElement('button');
      b.className = 'cal-row';
      b.innerHTML = `
        <span class="cal-row-top"><span class="cal-name">${esc(name)}</span><span class="tag st-${x.status}">${esc(calTag(x))}</span></span>
        <span class="cal-bar" aria-hidden="true">${barSegs(x.sow, 'sow')}${barSegs(x.harvest, 'harvest')}<span class="cal-today" style="left:${todayPos.toFixed(2)}%"></span></span>
        <span class="cal-sub">${esc(fmt('calSub', { sow: span(x.sow), harvest: span(x.harvest) }))}</span>`;
      b.addEventListener('click', () => ask(fmt('calAsk', { crop: name }), $('calAnswer')));
      return b;
    };
    if (groups.now.length) {
      head(fmt('calNow', { n: num(groups.now.length, 0) }));
      const shown = groups.now.slice(0, 5);
      shown.forEach((x) => list.append(row(x)));
      if (groups.now.length > shown.length) {
        const more = document.createElement('button');
        more.className = 'btn cal-more';
        more.textContent = fmt('calMore', { n: num(groups.now.length - shown.length, 0) });
        more.addEventListener('click', () => {
          const rest = groups.now.slice(shown.length).map(row);
          more.replaceWith(...rest);
        });
        list.append(more);
      }
    }
    if (groups.soon.length) {
      head(t('calSoon'));
      groups.soon.forEach((x) => list.append(row(x)));
    }
    if (groups.later.length) {
      head(t('calLater'));
      groups.later.slice(0, 4).forEach((x) => list.append(row(x)));
    }
  }

  $('calListen').addEventListener('click', () => {
    if (!cal?.rows?.length) return;
    const now = cal.rows.filter((x) => x.status === 'closing' || x.status === 'open').slice(0, 5);
    speak(`${t('calSayNow')} ${now.map((x) => `${t(`crop_${x.key}`)}, ${calTag(x)}`).join('. ')}.`);
  });

  // ---------- poultry shed ----------
  // Video comes from the farmer's phone. Frames are pulled here in the browser (no video tools
  // on the server); SAM counts birds per frame; Muse Spark 1.2 watches the clip with its sound.
  // Shed sensors, egg counter and the vet are SIMULATED. No disease or medicine is ever named.
  let shed = { vet: null, vetSummary: '', still: 0, resting: false, soundBad: false };
  $('goShed').addEventListener('click', () => openShed());

  function shedProgress(text) {
    $('shedProgress').textContent = text || '';
    $('shedProgress').hidden = !text;
  }

  async function openShed() {
    show('s-shed');
    $('shedAnswer').hidden = true;
    await loadShed();
  }

  async function loadShed() {
    let r;
    try {
      r = await api('/api/poultry');
    } catch {
      return;
    }
    if (!r.ok) return;
    shed.vet = r.vet;
    const s = r.shed;
    $('shedKit').hidden = !s;
    $('eggCard').hidden = !s?.eggs_today;
    if (!s) return;
    const grid = $('shedKitGrid');
    grid.replaceChildren();
    const fmtV = { shed_temp: (v) => `${num(v, 0)}°`, shed_humidity: (v) => `${num(v, 0)}%`, ammonia_ppm: (v) => num(v, 0), light: (v) => (v ? t('lightOn') : t('lightOff')), water_pct: (v) => `${num(v, 0)}%`, feed_pct: (v) => `${num(v, 0)}%` };
    const warn = { shed_temp: (v) => v > 32 || v < 16, shed_humidity: (v) => v > 80 || v < 40, ammonia_ppm: (v) => v > 25, water_pct: (v) => v < 20, feed_pct: (v) => v < 20 };
    for (const m of Object.keys(fmtV)) {
      if (!s[m]) continue;
      const c = document.createElement('div');
      c.className = `kit-cell${warn[m]?.(s[m].value) ? ' warn' : ''}`;
      c.innerHTML = `<strong>${esc(fmtV[m](s[m].value))}</strong><span class="muted small">${esc(t(`s_${m}`))}</span>`;
      grid.append(c);
    }
    if (s.eggs_today) {
      const n = s.eggs_today.value;
      const target = r.eggTarget || 300;
      $('eggFill').style.width = `${Math.min(100, (n / target) * 100)}%`;
      $('eggText').textContent = fmt('eggText', { n: num(n, 0), target: num(target, 0) });
    }
  }

  // Up to 8 frames, spread over the clip, as JPEG data URLs no wider than 1024 px.
  function extractFrames(file, count = 8, maxW = 1024) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = URL.createObjectURL(file);
      const frames = [];
      let size = null;
      v.onerror = () => reject(new Error('video'));
      v.onloadedmetadata = async () => {
        const dur = v.duration;
        if (!Number.isFinite(dur) || dur <= 0) return reject(new Error('video'));
        const scale = Math.min(1, maxW / v.videoWidth);
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        size = { width: c.width, height: c.height, seconds: dur };
        const n = Math.max(2, Math.min(count, Math.floor(dur)));
        for (let i = 0; i < n; i++) {
          await new Promise((ok) => {
            v.onseeked = ok;
            v.currentTime = Math.min(dur - 0.05, (dur * (i + 0.5)) / n);
          });
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          frames.push(c.toDataURL('image/jpeg', 0.85));
        }
        URL.revokeObjectURL(v.src);
        resolve({ frames, ...size });
      };
    });
  }

  function drawShed(frame, size, result) {
    $('shedFrame').src = frame;
    $('shedFrame').hidden = false;
    $('shedEmpty').hidden = true;
    const svg = $('shedSvg');
    svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    svg.replaceChildren();
    const ns = 'http://www.w3.org/2000/svg';
    for (const b of result.still || []) {
      const c = document.createElementNS(ns, 'ellipse');
      c.setAttribute('cx', (b.left + b.right) / 2);
      c.setAttribute('cy', (b.top + b.bottom) / 2);
      c.setAttribute('rx', Math.max(14, (b.right - b.left) / 2 + 6));
      c.setAttribute('ry', Math.max(14, (b.bottom - b.top) / 2 + 6));
      c.setAttribute('class', 'still');
      svg.append(c);
    }
    svg.removeAttribute('hidden'); // SVG elements have no .hidden property
    $('shedBadge').textContent = fmt('videoBadge', { n: num(Math.round(size.seconds), 0) });
    $('shedBadge').hidden = false;
    $('shedSam').hidden = false;
  }

  function showAction() {
    const still = shed.still > 0 && !shed.resting;
    $('shedAction').hidden = !(still || shed.soundBad);
    if (!still && !shed.soundBad) return;
    $('shedActionTitle').textContent = still ? fmt('stillTitle', { n: num(shed.still, 0) }) : t('soundBadTitle');
    $('shedActionText').textContent = shed.vetLine || t('b_birds_still');
    $('shedVetName').innerHTML = shed.vet ? `${esc(shed.vet.name)} <span class="sample">${esc(t('simulated'))}</span>` : '';
  }

  $('shedVideoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) return toast(t('videoTooBig'));
    $('shedAction').hidden = true;
    $('shedSound').hidden = true;
    $('shedNote').hidden = true;
    try {
      shedProgress(t('stepFrames'));
      const v = await extractFrames(file);
      shedProgress(t('stepCount'));
      const r = await postJson('/api/poultry/count', { frames: v.frames, width: v.width });
      if (!r.ok) throw new Error(r.error);
      shed.still = r.still.length;
      shed.resting = r.resting;
      $('shedStats').hidden = false;
      $('shedCount').textContent = num(r.count, 0);
      $('shedStill').textContent = num(r.resting ? 0 : r.still.length, 0);
      $('shedStillBox').classList.toggle('warn', !r.resting && r.still.length > 0);
      drawShed(v.frames[v.frames.length - 1], v, r.resting ? { still: [] } : r);
      if (r.resting) {
        $('shedNote').textContent = t('restingNight');
        $('shedNote').hidden = false;
      }
      showAction();
      shedProgress(t('stepWatch'));
      const w = await api(`/api/poultry/video?lang=${lang}`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: file });
      if (w.ok) applyObservation(w);
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    } finally {
      shedProgress('');
      loadShed();
    }
  });

  function applyObservation(w) {
    const o = w.observation || {};
    shed.vetLine = w.vetLine;
    if (!o.ok) return;
    shed.soundBad = o.unusualSound;
    shed.vetSummary = o.vetSummary || '';
    const box = $('shedSound');
    box.hidden = false;
    box.classList.toggle('warn', o.unusualSound || !o.heardAudio);
    $('shedSoundTitle').textContent = !o.heardAudio ? t('soundMissing') : o.unusualSound ? t('soundBadTitle') : t('soundOkTitle');
    $('shedSoundText').textContent = o.heardAudio && !o.unusualSound ? t('soundOkText') : '';
    if (o.note) {
      $('shedNote').textContent = [$('shedNote').hidden ? '' : $('shedNote').textContent, o.note].filter(Boolean).join(' ');
      $('shedNote').hidden = false;
    }
    showAction();
  }

  // Tap: record 15 seconds of shed sound, then Spark 1.2 listens.
  let shedRec = null;
  $('shedSoundBtn').addEventListener('click', async () => {
    if (shedRec) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      shedRec = new MediaRecorder(stream);
      shedRec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      let left = 15;
      $('shedSoundLabel').textContent = fmt('recording', { n: num(left, 0) });
      const timer = setInterval(() => {
        left -= 1;
        $('shedSoundLabel').textContent = fmt('recording', { n: num(left, 0) });
        if (left <= 0) shedRec.stop();
      }, 1000);
      shedRec.onstop = async () => {
        clearInterval(timer);
        stream.getTracks().forEach((tr) => tr.stop());
        shedRec = null;
        $('shedSoundLabel').textContent = t('listenShed');
        shedProgress(t('stepSound'));
        try {
          const wav = await toWav(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }));
          const r = await api(`/api/poultry/sound?lang=${lang}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
          if (!r.ok) throw new Error(r.error);
          applyObservation(r);
        } catch (err) {
          toast(`${t('error')}: ${err.message}`);
        } finally {
          shedProgress('');
        }
      };
      shedRec.start();
    } catch (err) {
      shedRec = null;
      toast(`Mic: ${err.message}`);
    }
  });

  // Vet sheet: simulated contact, no real call.
  function openVet() {
    $('vetSheetName').textContent = shed.vet?.name || t('vet');
    $('vetSheetPlace').textContent = shed.vet?.village || '';
    $('vetSheetSummary').textContent = shed.vetSummary || '';
    $('vetSheet').hidden = false;
    $('vetSheetClose').focus();
  }
  $('shedVetBtn').addEventListener('click', openVet);
  $('vetSheetClose').addEventListener('click', () => ($('vetSheet').hidden = true));
  $('vetSheet').addEventListener('click', (e) => {
    if (e.target === $('vetSheet')) $('vetSheet').hidden = true;
  });
  $('vetSheetSay').addEventListener('click', () => speak(shed.vetSummary || $('shedActionText').textContent));
  $('shedSayBtn').addEventListener('click', () => speak(`${$('shedActionTitle').textContent}. ${$('shedActionText').textContent}`));
  $('shedListen').addEventListener('click', () => {
    const parts = [];
    if (!$('shedStats').hidden) parts.push(`${$('shedCount').textContent} ${t('birdsCounted')}`);
    if (!$('shedAction').hidden) parts.push($('shedActionTitle').textContent, $('shedActionText').textContent);
    if (!$('shedSound').hidden) parts.push($('shedSoundTitle').textContent);
    if (!$('eggCard').hidden) parts.push(`${t('eggsToday')}: ${$('eggText').textContent}`);
    if (parts.length) speak(parts.join('. '));
  });

  // ---------- delete a land ----------
  function openDeleteSheet() {
    if (!current) return;
    $('deleteThumb').src = imgUrl(current.tileUrl);
    $('deleteSheet').hidden = false;
    $('deleteNo').focus(); // the safe choice has focus
  }
  function closeDeleteSheet() {
    $('deleteSheet').hidden = true;
    $('deleteBtn').focus();
  }
  $('deleteBtn').addEventListener('click', openDeleteSheet);
  $('deleteNo').addEventListener('click', closeDeleteSheet);
  $('deleteSheet').addEventListener('click', (e) => {
    if (e.target === $('deleteSheet')) closeDeleteSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('deleteSheet').hidden) closeDeleteSheet();
    if (e.key === 'Escape' && !$('vetSheet').hidden) $('vetSheet').hidden = true;
  });
  $('deleteYes').addEventListener('click', async () => {
    if (!current) return;
    const btn = $('deleteYes');
    btn.disabled = true;
    try {
      const r = await api(`/api/lands/${current.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(r.error);
      $('deleteSheet').hidden = true;
      current = null;
      toast(t('deleted'));
      goHome();
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  $('landListen').addEventListener('click', () => {
    if (!current) return;
    const kind = current.kind === 'empty' ? t('emptyLand') : t('standingCrop');
    speak(`${t('yourLand')}: ${kind}, ${acresText(current.acres)} ${t('acres')}.`);
  });

  // ---------- ask Saathi ----------
  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  async function ask(text, box) {
    box.hidden = false;
    box.className = 'answer thinking';
    box.innerHTML = `<div class="a-text">“${esc(text)}”<br>${esc(t('thinkingShort'))}</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      const landId = current?.id || lands[0]?.id || null;
      const r = await postJson('/api/ask', { text, landId });
      if (!r.ok) throw new Error(r.error);
      const tools = (r.trace || []).filter((s) => s.type === 'tool').map((s) => s.name);
      box.className = 'answer';
      box.innerHTML =
        `<div class="a-text">${esc(r.answer)}</div>` +
        (tools.length ? `<div class="a-steps">${tools.map((n) => `<span class="a-step">✓ ${esc(n.replace(/_/g, ' '))}</span>`).join('')}</div>` : '') +
        (tools.includes('draft_order') ? `<div class="a-note">${esc(t('draftNote'))}</div>` : '') +
        `<button class="btn" data-replay>${esc(t('playAgain'))}</button>`;
      box.querySelector('[data-replay]').addEventListener('click', () => speak(r.answer, box));
      speak(r.answer, box);
    } catch (err) {
      box.className = 'answer';
      box.innerHTML = `<div class="a-text">${esc(t('error'))}: ${esc(err.message)}</div>`;
    }
  }

  // ---------- speech out ----------
  let player = null;
  const audioCache = new Map();
  async function speak(text, box) {
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
      if (box) {
        box.classList.add('speaking');
        player.onended = () => box.classList.remove('speaking');
      }
      await player.play();
    } catch (err) {
      if (box) box.classList.remove('speaking');
      if (err.name !== 'NotAllowedError') toast(`${t('listen')}: ${err.message}`);
    }
  }

  // ---------- speech in (hold to talk) ----------
  let recorder = null;
  let chunks = [];
  async function startRec() {
    if (recorder) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        recorder = null;
        $('mic').classList.remove('on');
        $('mic').classList.add('busy');
        $('micLabel').textContent = t('thinkingShort');
        try {
          await handleSpeech(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }));
        } finally {
          $('mic').classList.remove('busy');
          $('micLabel').textContent = t('holdToTalk');
        }
      };
      recorder.start();
      $('mic').classList.add('on');
      $('micLabel').textContent = t('listening');
    } catch (err) {
      toast(`Mic: ${err.message}`);
    }
  }
  function stopRec() {
    if (recorder && recorder.state === 'recording') recorder.stop();
  }
  $('mic').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startRec();
  });
  $('mic').addEventListener('pointerup', stopRec);
  $('mic').addEventListener('pointerleave', stopRec);
  $('mic').addEventListener('contextmenu', (e) => e.preventDefault());

  async function handleSpeech(blob) {
    let wav;
    try {
      wav = await toWav(blob);
    } catch {
      return toast(t('error'));
    }
    const r = await api('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
    if (!r.ok || !r.text) return toast(r.error || t('tryAgain'));
    const box = !$('s-shed').hidden ? $('shedAnswer') : !$('s-cal').hidden ? $('calAnswer') : !$('s-plan').hidden ? $('planAnswer') : $('s-land').hidden ? $('homeAnswer') : $('landAnswer');
    await ask(r.text, box);
  }

  // Any browser recording -> mono 16-bit 16 kHz WAV for Muse Voice Transcribe.
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
    str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, mono[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ---------- start ----------
  async function start() {
    try {
      health = await fetch('/api/health').then((r) => r.json());
    } catch {
      health = null;
    }
    if (!lang) {
      lang = 'bn';
      applyLang();
      return show('s-lang');
    }
    applyLang();
    if (health?.passcodeRequired && !passcode) {
      $('passInput').value = '';
      return show('s-pass');
    }
    goHome();
  }
  start();
})();
