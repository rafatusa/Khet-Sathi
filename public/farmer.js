// Khet Saathi farmer app (v0.3.2): language, home, add land (photo + GPS),
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
    $('micBar').hidden = !(id === 's-home' || id === 's-land');
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
      setPlace('bolpur');
      return setLoc('warn', t('locDenied'));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        if (!inSouthAsia(lat, lon)) {
          setPlace('bolpur');
          return setLoc('warn', t('locFar'));
        }
        gps = { lat, lon };
        setPlace(null);
        setLoc('ok', `${t('locOk')} · ${num(lat, 4)}, ${num(lon, 4)}`);
      },
      () => {
        setPlace('bolpur');
        setLoc('warn', t('locDenied'));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }
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
    if (!gps && !place) setPlace('bolpur');
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
    const box = $('s-land').hidden ? $('homeAnswer') : $('landAnswer');
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
