// Khet Saathi v0.5.0 - browser side of the model check.
(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- passcode ----------
  let passcode = '';
  try { passcode = localStorage.getItem('ks_passcode') || ''; } catch {}
  $('passcode').value = passcode;
  $('passcode').addEventListener('change', (e) => {
    passcode = e.target.value;
    try { localStorage.setItem('ks_passcode', passcode); } catch {}
  });
  const headers = (extra = {}) => ({ 'x-app-passcode': passcode, ...extra });

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: headers(opts.headers) });
    const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (res.status === 401) json.error = 'Passcode required - enter it top right';
    return json;
  }

  // ---------- verification table ----------
  const CHECKS = [
    ['server', 'Server + API key configured', '—'],
    ['models', 'Team can access required models', 'GET /v1/models'],
    ['db', 'Database + photo storage', 'supabase'],
    ['tile', 'Satellite image for plot', 'Esri World Imagery'],
    ['sam', 'Field outlines from satellite', 'sam-3.1'],
    ['zoom', 'Field outlines, zoomed 225 m (farmer app scan)', 'sam-3.1'],
    ['soil', 'Soil at this point', 'ISRIC SoilGrids'],
    ['weather', '10-day weather + soil moisture', 'Open-Meteo'],
    ['calendar', 'Sowing windows + top 3 crops', 'FAO Crop Calendar'],
    ['sensors', 'Village sensor kit (simulated)', 'simulator'],
    ['alerts', 'Alerts engine', 'rules'],
    ['vision', 'Scene description from image', 'spark'],
    ['agent', 'Agent plan with tool calls', 'spark'],
    ['voice', 'Speech → text', 'muse-voice-transcribe-1.0'],
    ['speak', 'Reply → speech', 'gemini tts'],
  ];
  const vt = $('vt');
  for (const [key, label, model] of CHECKS) {
    const tr = document.createElement('tr');
    tr.id = `row-${key}`;
    tr.innerHTML = `<td>${label}</td><td><code>${model}</code></td><td><span class="pill">NOT RUN</span></td><td class="t">—</td><td class="detail">—</td>`;
    vt.appendChild(tr);
  }
  function mark(key, status, detail = '', ms = null) {
    const tr = $(`row-${key}`);
    if (!tr) return;
    tr.children[2].innerHTML = `<span class="pill ${status}">${status}</span>`;
    tr.children[3].textContent = ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`;
    tr.children[4].textContent = detail || '—';
  }
  function setModel(key, id) {
    const tr = $(`row-${key}`);
    if (tr) tr.children[1].innerHTML = `<code>${id}</code>`;
  }

  // ---------- 1. server + models ----------
  async function checkServer() {
    mark('server', 'RUNNING');
    const h = await fetch('/api/health').then((r) => r.json()).catch(() => null);
    if (!h) return mark('server', 'FAIL', 'Server not reachable');
    $('ver').textContent = `v${h.version}`;
    $('passcode').hidden = !h.passcodeRequired;
    setModel('sam', h.models.sam);
    setModel('zoom', h.models.sam);
    setModel('vision', h.models.spark);
    setModel('agent', h.models.spark);
    setModel('voice', h.models.voice);
    setModel('speak', h.models.tts);
    if (!h.ttsConfigured) mark('speak', 'FAIL', 'GEMINI_API_KEY missing in Railway Variables');
    mark('server', h.keyConfigured ? 'PASS' : 'FAIL', h.keyConfigured ? `v${h.version}` : 'MODEL_API_KEY missing in Railway Variables');
    return h.keyConfigured;
  }
  async function checkDb() {
    mark('db', 'RUNNING');
    const r = await api('/api/db');
    if (!r.ok) return mark('db', 'FAIL', r.error, r.ms);
    if (r.mode === 'memory') return mark('db', 'FAIL', 'Supabase not configured: running in memory, data is lost on restart', r.ms);
    const ok = r.landsTable && r.bucket && r.contacts > 0;
    mark('db', ok ? 'PASS' : 'FAIL', `lands table ${r.landsTable ? '✓' : '✗'} · photo bucket ${r.bucket ? '✓' : '✗'} · ${r.contacts ?? 0} contacts`, r.ms);
  }
  async function checkModels() {
    mark('models', 'RUNNING');
    const r = await api('/api/models');
    if (!r.ok) return mark('models', 'FAIL', r.error, r.ms);
    const missing = r.needed.filter((n) => !n.accessible).map((n) => n.id);
    mark('models', missing.length ? 'FAIL' : 'PASS', missing.length ? `Not accessible: ${missing.join(', ')}` : r.needed.map((n) => n.id).join(', '), r.ms);
  }

  // ---------- 2. plot image ----------
  let imageDataUrl = null;
  let imageSize = { w: 1024, h: 1024 };
  function showImage(dataUrl, w, h, attribution = '') {
    imageDataUrl = dataUrl;
    imageSize = { w, h };
    $('plotImg').src = dataUrl;
    $('plotImg').hidden = false;
    $('stageEmpty').hidden = true;
    $('overlay').innerHTML = '';
    $('overlay').hidden = true;
    $('attrib').textContent = attribution;
  }
  async function loadTile() {
    mark('tile', 'RUNNING');
    const q = new URLSearchParams({ lat: $('lat').value, lon: $('lon').value, half: $('half').value });
    const r = await api(`/api/tile?${q}`);
    if (!r.ok) return mark('tile', 'FAIL', r.error, r.ms);
    showImage(r.dataUrl, r.width, r.height, r.attribution);
    mark('tile', 'PASS', `${r.width}×${r.height}px, ${r.groundMeters} m across`, r.ms);
  }
  $('photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await shrinkImage(file, 1280);
    const img = new Image();
    img.onload = () => showImage(dataUrl, img.naturalWidth, img.naturalHeight, 'Uploaded photo');
    img.src = dataUrl;
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
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- 3. SAM 3.1 ----------
  const COLORS = ['#5fa152', '#e3b23c', '#4aa3df', '#e07a5f', '#b07bd6', '#3fbfa0', '#f2cc8f', '#81b29a'];
  function drawSegments(objects) {
    const svg = $('overlay');
    svg.setAttribute('viewBox', `0 0 ${imageSize.w} ${imageSize.h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.innerHTML = '';
    objects.forEach((o, i) => {
      const color = COLORS[i % COLORS.length];
      const ns = 'http://www.w3.org/2000/svg';
      if (o.mask?.svgPath) {
        const b = o.mask.bounds;
        const sx = (b.right - b.left) / o.mask.width;
        const sy = (b.bottom - b.top) / o.mask.height;
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', o.mask.svgPath);
        p.setAttribute('class', 'mask');
        p.setAttribute('fill', color);
        p.setAttribute('stroke', color);
        p.setAttribute('fill-rule', 'evenodd');
        p.setAttribute('transform', `translate(${b.left} ${b.top}) scale(${sx} ${sy})`);
        p.setAttribute('vector-effect', 'non-scaling-stroke');
        p.style.animationDelay = `${i * 80}ms`;
        svg.appendChild(p);
      } else {
        const r = document.createElementNS(ns, 'rect');
        r.setAttribute('class', 'box');
        r.setAttribute('x', o.box.left);
        r.setAttribute('y', o.box.top);
        r.setAttribute('width', o.box.right - o.box.left);
        r.setAttribute('height', o.box.bottom - o.box.top);
        svg.appendChild(r);
      }
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('class', 'label');
      t.setAttribute('x', (o.box.left + o.box.right) / 2);
      t.setAttribute('y', (o.box.top + o.box.bottom) / 2);
      t.setAttribute('text-anchor', 'middle');
      t.textContent = `${i + 1}${o.confidence != null ? ` · ${Math.round(o.confidence * 100)}%` : ''}`;
      svg.appendChild(t);
    });
    svg.hidden = false;
  }
  async function runSegment() {
    if (!imageDataUrl) await loadTile();
    if (!imageDataUrl) return mark('sam', 'FAIL', 'No image loaded');
    mark('sam', 'RUNNING');
    const r = await api('/api/segment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl, prompt: $('concept').value }),
    });
    if (!r.ok) return mark('sam', 'FAIL', r.error, r.ms);
    drawSegments(r.objects);
    const ok = r.outcome?.status === 'completed';
    const detail = `"${r.prompt}": ${r.count} object(s)${r.diagnostics?.length ? ` · ${r.diagnostics.length} warning(s)` : ''}${r.count === 0 ? ' · try "field" or the zoomed scan' : ''}`;
    // 0 objects is not a pass: SAM answered but found no fields (v0.3.0 hid this as PASS).
    mark('sam', !ok ? 'FAIL' : r.count === 0 ? 'WARN' : 'PASS', detail, r.ms);
  }

  // Soil, weather and crop calendar for the point in the Lat/Lon boxes.
  async function runPlanCheck() {
    ['soil', 'weather', 'calendar'].forEach((k) => mark(k, 'RUNNING'));
    const q = new URLSearchParams({ lat: $('lat').value, lon: $('lon').value });
    const r = await api(`/api/plan?${q}`);
    if (!r.ok) return ['soil', 'weather', 'calendar'].forEach((k) => mark(k, 'FAIL', r.error, r.ms));
    const p = r.plan;
    const s = p.soil;
    mark('soil', s ? (p.soilError ? 'WARN' : 'PASS') : 'FAIL',
      s ? `${s.texture.replace(/_/g, ' ')} · clay ${s.clay}% sand ${s.sand}% silt ${s.silt}% · pH ${s.ph} · ${s.source}${p.soilError ? ` · live lookup failed: ${p.soilError}` : ''}` : p.soilError || 'no soil data', r.ms);
    const w = p.weather;
    mark('weather', w ? 'PASS' : 'FAIL',
      w ? `rain next 10 days ${w.rainNext10Mm} mm · soil moisture ${w.soilMoisture} (${w.soilMoistureLevel})${p.rain ? ` · rain ${p.rain.chance}% on ${p.rain.rainDate}` : ' · no heavy rain in 3 days'}` : p.weatherError || 'no forecast', r.ms);
    if (!p.aez) return mark('calendar', 'WARN', 'No FAO sowing calendar for this area (FAO covers Bangladesh, not India)', r.ms);
    const crops = p.crops.map((c) => `${c.faoName} (${c.status}${c.daysLeft != null ? `, ${c.daysLeft} d left` : `, in ${c.daysUntil} d`})`).join(', ');
    mark('calendar', p.crops.length ? (p.calendarError ? 'WARN' : 'PASS') : 'WARN',
      `${p.aez}${p.aezAssumed ? ' (assumed)' : ''} · ${crops || 'nothing to sow now'} · ${p.calendarSource}`, r.ms);
  }

  // Simulated sensor kit + alerts engine.
  function markEngine(r, what) {
    if (!r.ok) return ['sensors', 'alerts'].forEach((k) => mark(k, 'FAIL', r.error, r.ms));
    const s = r.summary || {};
    mark('sensors', s.readings ? 'PASS' : 'WARN', `${what} · ${s.lands ?? 0} field kit(s) + shed · ${s.readings ?? 0} readings saved${s.errors?.length ? ` · ${s.errors.join('; ')}` : ''}`, r.ms);
    mark('alerts', 'PASS', s.alerts?.length ? `new: ${s.alerts.join(', ')}` : 'no new alerts (rules quiet, or already raised in the last 12 h)', r.ms);
  }
  async function simTick() {
    ['sensors', 'alerts'].forEach((k) => mark(k, 'RUNNING'));
    markEngine(await api('/api/sensors/tick', { method: 'POST' }), 'tick');
  }
  async function force(target, metric, value) {
    ['sensors', 'alerts'].forEach((k) => mark(k, 'RUNNING'));
    const r = await api('/api/sensors/force', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, metric, value }) });
    markEngine(r, `forced ${metric} = ${value}`);
  }

  // The same scan the farmer app runs: centre 225 m enlarged, "field", then the wide view.
  async function runZoomScan() {
    mark('zoom', 'RUNNING');
    const q = new URLSearchParams({ lat: $('lat').value, lon: $('lon').value });
    const r = await api(`/api/scan?${q}`);
    if (!r.ok) return mark('zoom', 'FAIL', r.error, r.ms);
    const s = r.sam || {};
    showImage(r.image, r.imagePx, r.imagePx, `Farmer app scan · ${s.view === 'zoom' ? 'zoomed' : 'wide'} ${Math.round(s.groundMeters)} m view`);
    drawSegments(r.objects || []);
    const centre = (r.objects || []).some((o) => o.containsPoint);
    const tries = (s.passes || []).map((p) => `${p.view} "${p.prompt}" ${p.error ? 'error' : `${p.kept}/${p.found}`}`).join(', ');
    const detail = `"${s.prompt}": ${s.fields} object(s) · ${centre ? 'centre covered' : 'centre not covered'}${r.acres != null ? ` · ${r.acres} acres` : ''} · ${tries}${s.error ? ` · ${s.error}` : ''}`;
    mark('zoom', s.error ? 'FAIL' : !s.fields ? 'WARN' : 'PASS', detail, r.ms);
  }

  // ---------- 4. Spark vision ----------
  async function runVision() {
    if (!imageDataUrl) await loadTile();
    if (!imageDataUrl) return mark('vision', 'FAIL', 'No image loaded');
    mark('vision', 'RUNNING');
    $('visionOut').textContent = '…';
    const r = await api('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl }),
    });
    $('visionOut').textContent = r.ok ? r.text : '';
    mark('vision', r.ok && r.text ? 'PASS' : 'FAIL', r.ok ? `${r.text.length} chars` : r.error, r.ms);
  }

  // ---------- 5. agent ----------
  const SAMPLES = {
    hi: 'मेरे पास 2 एकड़ ज़मीन है। इस रबी सीज़न में क्या बोऊँ? बीज और खाद का ऑर्डर तैयार कर दो।',
    bn: 'আমার ২ একর জমি আছে। এই রবি মৌসুমে কী চাষ করব? বীজ আর সারের অর্ডার তৈরি করে দাও।',
    en: 'I have 2 acres. What should I plant this Rabi season? Please prepare a seed and fertilizer order.',
  };
  $('agentText').value = SAMPLES.hi;
  document.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => ($('agentText').value = SAMPLES[c.dataset.lang]))
  );
  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  async function runAgent({ speakReply = true } = {}) {
    mark('agent', 'RUNNING');
    $('trace').innerHTML = '<li>Thinking…</li>';
    const r = await api('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: $('agentText').value, lat: $('lat').value, lon: $('lon').value }),
    });
    if (!r.ok) {
      $('trace').innerHTML = `<li>${esc(r.error)}</li>`;
      return mark('agent', 'FAIL', r.error, r.ms);
    }
    $('trace').innerHTML = r.trace
      .map((t) =>
        t.type === 'tool'
          ? `<li class="tool"><span class="tname">Step ${t.step} · ${esc(t.name)}</span><details><summary>args + result</summary><pre>${esc(JSON.stringify(t.args, null, 1))}\n→ ${esc(JSON.stringify(t.output, null, 1))}</pre></details></li>`
          : `<li class="answer">${esc(t.text)}</li>`
      )
      .join('');
    const tools = r.trace.filter((t) => t.type === 'tool').map((t) => t.name);
    const drafted = tools.includes('draft_order');
    const toolDetail = tools.length
      ? `${tools.length} tool call(s): ${[...new Set(tools)].join(', ')} · ${r.steps} step(s)${drafted ? '' : ' · no draft order this run'}`
      : 'Answered directly, no tools needed';
    // The check row is about planning: it passes only on a run that used tools and produced an answer.
    if (tools.length) mark('agent', r.answer ? 'PASS' : 'FAIL', toolDetail, r.ms);
    else {
      $('trace').insertAdjacentHTML('afterbegin', `<li class="muted">${toolDetail}</li>`);
      mark('agent', 'NOT RUN', 'Answered directly - ask what to grow or buy to test planning', r.ms);
    }
    if (r.answer && speakReply) await speak(r.answer);
    return r.answer;
  }

  // ---------- 7. spoken reply ----------
  let player = null;
  async function speak(text) {
    mark('speak', 'RUNNING');
    const r = await api('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) return mark('speak', 'FAIL', r.error, r.ms);
    mark('speak', 'PASS', `${r.chars} chars → ${r.seconds} s audio`, r.ms);
    if (player) player.pause();
    player = new Audio(r.audioDataUrl);
    const answerEl = document.querySelector('#trace li.answer');
    if (answerEl) {
      answerEl.classList.add('speaking');
      player.onended = () => answerEl.classList.remove('speaking');
      if (!answerEl.querySelector('.replay')) {
        const b = document.createElement('button');
        b.className = 'replay';
        b.textContent = '▶ Play again';
        b.onclick = () => { player.currentTime = 0; player.play(); answerEl.classList.add('speaking'); };
        answerEl.appendChild(b);
      }
    }
    try { await player.play(); } catch (e) { mark('speak', 'PASS', `${r.chars} chars - press ▶ Play again (browser blocked autoplay)`, r.ms); }
  }

  // ---------- 6. voice ----------
  let recorder = null;
  let chunks = [];
  let recStart = 0;
  let timer = null;
  async function startRec() {
    if (recorder) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder = null;
        clearInterval(timer);
        $('rec').classList.remove('on');
        $('recLabel').textContent = 'Hold to talk';
        await sendAudio(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }));
      };
      recorder.start();
      recStart = Date.now();
      $('rec').classList.add('on');
      $('recLabel').textContent = 'Listening… release to send';
      timer = setInterval(() => ($('recTime').textContent = `${((Date.now() - recStart) / 1000).toFixed(0)} s`), 250);
    } catch (e) {
      mark('voice', 'FAIL', `Microphone: ${e.message}`);
    }
  }
  function stopRec() {
    if (recorder && recorder.state === 'recording') recorder.stop();
  }
  $('rec').addEventListener('pointerdown', startRec);
  $('rec').addEventListener('pointerup', stopRec);
  $('rec').addEventListener('pointerleave', stopRec);
  $('audioFile').addEventListener('change', (e) => e.target.files[0] && sendAudio(e.target.files[0]));

  // Any browser audio -> mono 16-bit 16 kHz WAV, the format Muse Voice Transcribe accepts.
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
    return { wav: new Blob([buf], { type: 'audio/wav' }), seconds: audio.duration };
  }
  async function sendAudio(blob) {
    mark('voice', 'RUNNING');
    $('transcript').textContent = '…';
    let wav, seconds;
    try {
      ({ wav, seconds } = await toWav(blob));
    } catch (e) {
      $('transcript').textContent = '';
      return mark('voice', 'FAIL', `Could not read audio: ${e.message}`);
    }
    const r = await api('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
    if (!r.ok) {
      $('transcript').textContent = '';
      return mark('voice', 'FAIL', r.error, r.ms);
    }
    $('transcript').textContent = r.text || JSON.stringify(r.raw, null, 1);
    $('useTranscript').hidden = !r.text;
    mark('voice', r.text ? 'PASS' : 'FAIL', r.text ? `${seconds.toFixed(1)} s audio → ${r.text.length} chars` : 'No text found - see raw response', r.ms);
    if (r.text && $('autoReply').checked) {
      $('agentText').value = r.text;
      $('runAgent').disabled = true;
      try { await runAgent(); } finally { $('runAgent').disabled = false; }
    }
  }
  $('useTranscript').addEventListener('click', () => {
    $('agentText').value = $('transcript').textContent;
    $('agentText').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ---------- wiring ----------
  function busy(btn, fn) {
    return async () => {
      btn.disabled = true;
      try { await fn(); } finally { btn.disabled = false; }
    };
  }
  $('loadTile').addEventListener('click', busy($('loadTile'), loadTile));
  $('segment').addEventListener('click', busy($('segment'), runSegment));
  $('describe').addEventListener('click', busy($('describe'), runVision));
  $('zoomScan').addEventListener('click', busy($('zoomScan'), runZoomScan));
  $('planCheck').addEventListener('click', busy($('planCheck'), runPlanCheck));
  $('simTick').addEventListener('click', busy($('simTick'), simTick));
  $('forceDry').addEventListener('click', busy($('forceDry'), () => force('field', 'soil_moisture', 12)));
  $('forceHot').addEventListener('click', busy($('forceHot'), () => force('shed', 'shed_temp', 35)));
  $('runAgent').addEventListener('click', busy($('runAgent'), () => runAgent()));
  $('runAll').addEventListener(
    'click',
    busy($('runAll'), async () => {
      if (!(await checkServer())) return;
      await checkModels();
      await checkDb();
      await loadTile();
      const samples = { hi: SAMPLES.hi, bn: SAMPLES.bn, en: SAMPLES.en };
      if (!Object.values(samples).includes($('agentText').value)) $('agentText').value = SAMPLES.hi;
      await Promise.all([runSegment(), runVision(), runAgent()]);
      await runZoomScan();
      await runPlanCheck();
      await simTick();
      const v = $(`row-voice`).children[2].textContent;
      if (v === 'NOT RUN') mark('voice', 'NOT RUN', 'Hold the mic button and speak to test');
    })
  );
  checkServer();
})();
