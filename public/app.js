// Khet Saathi v0.1.0 - browser side of the model check.
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
    ['tile', 'Satellite image for plot', 'Esri World Imagery'],
    ['sam', 'Field outlines from satellite', 'sam-3.1'],
    ['vision', 'Scene description from image', 'spark'],
    ['agent', 'Agent loop with tool calls', 'spark'],
    ['voice', 'Speech → text', 'muse-voice-transcribe-1.0'],
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
    setModel('vision', h.models.spark);
    setModel('agent', h.models.spark);
    setModel('voice', h.models.voice);
    mark('server', h.keyConfigured ? 'PASS' : 'FAIL', h.keyConfigured ? `v${h.version}` : 'MODEL_API_KEY missing in Railway Variables');
    return h.keyConfigured;
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
    const detail = `"${r.prompt}": ${r.count} object(s)${r.diagnostics?.length ? ` · ${r.diagnostics.length} warning(s)` : ''}${r.count === 0 ? ' - try "field", "crop field" or a wider view' : ''}`;
    mark('sam', ok ? 'PASS' : 'FAIL', detail, r.ms);
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
  async function runAgent() {
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
    const passed = Boolean(r.answer) && tools.length > 0;
    const drafted = tools.includes('draft_order');
    mark('agent', passed ? 'PASS' : 'FAIL', `${tools.length} tool call(s): ${[...new Set(tools)].join(', ') || 'none'} · ${r.steps} step(s)${passed && !drafted ? ' · no draft order this run' : ''}`, r.ms);
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
  $('runAgent').addEventListener('click', busy($('runAgent'), runAgent));
  $('runAll').addEventListener(
    'click',
    busy($('runAll'), async () => {
      if (!(await checkServer())) return;
      await checkModels();
      await loadTile();
      await Promise.all([runSegment(), runVision(), runAgent()]);
      const v = $(`row-voice`).children[2].textContent;
      if (v === 'NOT RUN') mark('voice', 'NOT RUN', 'Hold the mic button and speak to test');
    })
  );
  checkServer();
})();
