// Khet Saathi v0.11.0: poultry (Home, Shed camera wall, vet, egg sale) and buying for a field.
// Real tests never fake anything: a farmer's own land shows only real shops, and "call" means
// "Saathi will call and update you" with a coming-soon note. The demo lands and the demo shed keep
// their scripted demo calls, always tagged "Demo". No disease or medicine is ever named.
(() => {
  'use strict';
  const K = window.KS;
  if (!K) return;
  const { S, $, $$, I, t, fmt, num, esc, money, toast, api, postJson, imgUrl, emptyBox } = K;
  const L = () => K.lang();
  const isDemoShed = () => Boolean(S.shed?.demo || S.shed?.builtIn);
  const isDemoLand = () => S.cur?.location_source === 'demo';
  const rupees = (n) => money(Number(n) || 0, '₹');

  const P = { poultry: null, clips: { clips: [], todayId: null, max: 5 }, eggs: [], sel: null, pending: null, market: null, pick: new Set(['seed', 'fert', 'plough']), shop: null, feedIdx: 0, showResult: false };
  const last = { count: null, obs: null, birds: null, still: 0, resting: false, soundBad: false, vetLine: '' };
  const myClips = () => P.clips.clips.filter((c) => (isDemoShed() ? !c.shedId : c.shedId === S.shed?.id));
  const ago = (iso) => {
    const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(K.loc(), { numeric: 'auto' });
    if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  };
  const comingSoon = (title, text) => {
    $('#soonT').textContent = title;
    $('#soonS').textContent = text;
    $('#soonSheet').hidden = false;
  };

  // ================= data =================
  async function load() {
    const [p, c, e, s] = await Promise.all([api('/api/poultry').catch(() => null), api('/api/clips').catch(() => null), api('/api/shed/eggs').catch(() => null), api('/api/sell').catch(() => null)]);
    if (p?.ok) P.poultry = p;
    if (c?.ok) P.clips = c;
    if (e?.ok) P.eggs = e.days || [];
    if (s?.ok) S.sale = s;
    if (P.sel && !myClips().some((x) => x.id === P.sel)) P.sel = null;
    if (!P.sel) P.sel = (myClips().find((x) => x.id === P.clips.todayId) || myClips()[0])?.id || null;
    const sel = myClips().find((x) => x.id === P.sel);
    if (sel) fromSaved(sel);
    if (S.mode === 'shed') {
      if (S.tab === 'home') renderHome();
      else render(S.tab);
    }
  }

  // ================= kit tiles =================
  const KIT = [
    ['shed_temp', 's_shed_temp', (v) => `${num(v, 1)}°`, (v) => v > 32 || v < 16],
    ['shed_humidity', 's_shed_humidity', (v) => `${num(v)}%`, (v) => v > 80 || v < 40],
    ['ammonia_ppm', 's_ammonia_ppm', (v) => num(v), (v) => v > 25],
    ['water_pct', 's_water_pct', (v) => `${num(v)}%`, (v) => v < 20],
    ['feed_pct', 's_feed_pct', (v) => `${num(v)}%`, (v) => v < 20],
    ['eggs_today', 'eggsToday', (v) => num(v), () => false],
  ];
  function kitHtml() {
    const sh = P.poultry?.shed || S.sensors?.shed;
    if (!sh) return emptyBox(t('shedWaiting'));
    return KIT.filter(([m]) => sh[m])
      .map(([m, k, f, bad]) => `<div class="tile ${bad(sh[m].value) ? 'warn' : ''}"><div class="k">${esc(t(k))}</div><div class="v">${esc(f(sh[m].value))}</div></div>`)
      .join('');
  }
  function feedLine() {
    const sh = P.poultry?.shed;
    if (!sh) return '';
    const parts = [];
    // Only what needs doing; the tiles already show the numbers.
    if (sh.water_pct?.value < 20) parts.push(fmt('waterLow', { v: num(sh.water_pct.value) }));
    if (sh.feed_pct?.value < 20) parts.push(fmt('feedLow', { v: num(sh.feed_pct.value) }));
    return parts.join(' · ');
  }

  // ================= poultry home =================
  function hero() {
    const sale = S.sale;
    if (sale && sale.trays >= 1 && (sale.due || S.alerts.some((a) => a.title === 'sell_due' || a.title === 'sell_offers'))) {
      const r = sale.rule || {};
      const rule = [r.min_count ? fmt('ruleWhen', { n: num(r.min_count) }) : '', r.every_days ? fmt('ruleEveryN', { n: num(r.every_days) }) : '', r.ask_first !== false ? t('ruleAskShort') : '', r.floor_price ? fmt('ruleFloorShort', { p: rupees(r.floor_price) }) : ''].filter(Boolean).join(' · ');
      return { big: fmt('traysReady', { n: num(sale.trays) }), sub: rule, cta: t('seeOffers'), icon: 'rupee', go: () => startSale() };
    }
    if (last.still > 0 && !last.resting) return { big: fmt('stillTitle', { n: num(last.still) }), sub: last.vetLine || t('b_birds_still'), cta: t('callVet'), icon: 'warn', go: openVet };
    return { big: K.shedLine(S.shed), sub: feedLine() || t('shedNormal'), cta: t('checkShed'), icon: 'camera', go: () => K.show('shed') };
  }

  function eggChart(days) {
    const have = days.filter((d) => d.eggs != null);
    if (!have.length) return emptyBox(t('eggsNoHistory'));
    const W = 320;
    const H = 150;
    const B = 22;
    const T = 16;
    const mx = Math.max(10, ...have.map((d) => d.eggs));
    const bw = (W - 20) / days.length;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${days
      .map((d, i) => {
        const v = d.eggs ?? 0;
        const h = ((H - B - T) * v) / mx;
        const x = 10 + i * bw + bw * 0.15;
        const today = i === days.length - 1;
        return `<rect class="bar" style="animation-delay:${i * 60}ms" x="${x}" y="${H - B - h}" width="${bw * 0.7}" height="${h}" rx="5" fill="${today ? 'var(--turmeric)' : 'var(--leaf)'}" opacity="${d.eggs == null ? 0.2 : 0.9}"/>${d.eggs != null ? `<text x="${x + bw * 0.35}" y="${H - B - h - 4}" text-anchor="middle">${num(v)}</text>` : ''}<text x="${x + bw * 0.35}" y="${H - 6}" text-anchor="middle">${esc(today ? t('today') : K.fd(d.date, { weekday: 'short' }))}</text>`;
      })
      .join('')}</svg>`;
  }

  function renderHome() {
    $('#shKit').innerHTML = kitHtml();
    $('#shFeed').textContent = feedLine();
    $('#shEggs').innerHTML = eggChart(P.eggs);
    const cl = myClips();
    $('#shThumbs').innerHTML = cl.length
      ? cl.slice(0, 4).map((c) => `<button class="thumb" type="button" data-clip="${c.id}"><img src="${imgUrl(`/api/clips/${c.id}/frame/${Math.max(0, c.frames - 1)}`)}" alt=""><span>${esc(c.name)}</span></button>`).join('')
      : emptyBox(t('noClipsYet'));
    const r = cl.find((c) => c.id === P.sel)?.result;
    $('#shLast').textContent = r?.count ? fmt('lastCheckLine', { n: num(r.count.count), s: num(r.count.resting ? 0 : r.count.still.length), when: ago(r.checkedAt) }) : '';
    const deals = (S.deals || []).filter((d) => d.status === 'confirmed' && (d.items || [])[0]?.item === 'eggs').slice(0, 4);
    $('#shSales').innerHTML =
      (deals.length
        ? deals.map((d) => `<div class="entry">${I.rupee}<div class="t"><b>${esc(fmt('traysN', { n: num(d.items[0].trays) }))}</b><div class="who">${esc(d.items[0].shop || '')} · ${esc(new Date(d.created_at).toLocaleDateString(K.loc(), { day: 'numeric', month: 'short' }))}</div></div><span class="a in-c">+${esc(rupees(d.total_inr))}</span></div>`).join('')
        : `<div class="muted small">${esc(t('noSalesYet'))}</div>`) + (S.sale ? `<div class="muted small">${esc(fmt('eggStockText', { n: num(S.sale.stock), trays: num(S.sale.trays) }))}</div>` : '');
  }
  document.addEventListener('click', (e) => {
    const th = e.target.closest('[data-clip]');
    if (th) {
      P.sel = th.dataset.clip;
      K.show('shed');
      return;
    }
    if (e.target.closest('[data-go]')) K.show(e.target.closest('[data-go]').dataset.go);
    if (e.target.closest('[data-vet]')) openVet();
    if (e.target.closest('[data-sell]')) startSale();
    if (e.target.closest('[data-rule]')) openRule();
    if (e.target.closest('[data-pickvideo]')) $('#videoIn').click();
  });

  // ================= shed tab: camera wall =================
  // Demo shed: its saved clips play one after another, muted and looping, as camera feeds ("Demo feed").
  // A real shed shows only the farmer's own phone clips. Live CCTV is coming soon.
  let clockT;
  function ensureCam() {
    if ($('#shVideo')) return;
    const v = document.createElement('video');
    v.id = 'shVideo';
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('playsinline', '');
    v.addEventListener('ended', nextFeed);
    $('#shedView').prepend(v);
    const ov = document.createElement('div');
    ov.className = 'camov';
    ov.innerHTML = `<span class="camname" id="camName"></span><span class="camclock mono" id="camClock"></span>`;
    $('#shedView').append(ov);
    const cctv = document.createElement('button');
    cctv.className = 'chip';
    cctv.type = 'button';
    cctv.id = 'cctvBtn';
    cctv.innerHTML = `${I.camera}<span>${esc(t('connectCctv'))}</span>`;
    cctv.addEventListener('click', () => comingSoon(t('cctvH'), t('cctvT')));
    $('#shed .panel .lab').after(cctv);
  }
  function nextFeed() {
    const cl = myClips().filter((c) => c.hasVideo);
    if (!cl.length || P.pending || P.showResult) return;
    const i = (cl.findIndex((c) => c.id === P.sel) + 1) % cl.length;
    P.sel = cl[i].id;
    renderShedTab();
  }
  function camClock() {
    clearInterval(clockT);
    const tick = () => {
      const el = $('#camClock');
      if (!el) return;
      el.textContent = K.digits(new Date().toLocaleTimeString(K.loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    tick();
    clockT = setInterval(tick, 1000);
  }
  function drawRings(size, still) {
    const svg = $('#shSvg');
    svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    svg.innerHTML = (still || [])
      .map((b) => `<ellipse class="still" cx="${(b.left + b.right) / 2}" cy="${(b.top + b.bottom) / 2}" rx="${Math.max(14, (b.right - b.left) / 2 + 6)}" ry="${Math.max(14, (b.bottom - b.top) / 2 + 6)}"/>`)
      .join('');
    svg.toggleAttribute('hidden', !(still || []).length);
  }
  function renderShedTab() {
    ensureCam();
    camClock();
    const cl = myClips();
    const c = cl.find((x) => x.id === P.sel);
    const v = $('#shVideo');
    $('#camTag').textContent = isDemoShed() ? t('demoFeed') : t('yourClips');
    $('#camTag').className = `src-tag ${isDemoShed() ? 'sim' : ''}`;
    $('#clipRow').innerHTML =
      cl.map((x, i) => `<button class="clipb ${x.id === P.sel ? 'on' : ''}" type="button" data-sel="${x.id}"><b>${esc(fmt('camN', { n: num(i + 1) }))}</b><span>${esc(x.name)}</span>${x.id === P.sel ? `<span class="del" data-del="${x.id}" role="button" aria-label="${esc(t('clipDelete'))}">×</span>` : ''}</button>`).join('') ||
      `<span class="muted small">${esc(t('noClipsYet'))}</span>`;
    if (P.pending) {
      v.hidden = true;
      $('#shFrame').src = P.pending.v.frames.at(-1);
      $('#shFrame').hidden = false;
      $('#shEmpty').hidden = true;
      $('#camName').textContent = t('newVideo');
      return;
    }
    if (!c) {
      v.hidden = true;
      v.removeAttribute('src');
      $('#shFrame').hidden = true;
      $('#shSvg').setAttribute('hidden', '');
      $('#shEmpty').hidden = false;
      $('#camName').textContent = '';
      showResult(null);
      return;
    }
    $('#shEmpty').hidden = true;
    $('#camName').textContent = `${fmt('camN', { n: num(cl.indexOf(c) + 1) })} · ${c.name}${isDemoShed() ? ` · ${t('demoFeed')}` : ''}`;
    const r = c.result;
    const still = r?.count && !r.count.resting ? r.count.still : [];
    if (c.hasVideo && !P.showResult) {
      $('#shFrame').hidden = true;
      $('#shSvg').setAttribute('hidden', '');
      const src = imgUrl(`/api/clips/${c.id}/video`);
      if (v.dataset.src !== src) {
        v.dataset.src = src;
        v.src = src;
        v.loop = myClips().filter((x) => x.hasVideo).length < 2;
        v.play().catch(() => null);
      }
      v.hidden = false;
    } else {
      v.hidden = true;
      v.pause?.();
      $('#shFrame').src = imgUrl(`/api/clips/${c.id}/frame/${Math.max(0, c.frames - 1)}`);
      $('#shFrame').hidden = false;
      drawRings({ width: c.width, height: c.height }, still);
    }
    $('#clipInfo').textContent = r?.checkedAt ? fmt('lastChecked', { when: ago(r.checkedAt) }) : t('notChecked');
    showResult(r);
  }
  $('#clipRow').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      // Two taps to delete (no browser dialogs): the first one arms it.
      if (P.armed !== del.dataset.del) {
        P.armed = del.dataset.del;
        return toast(t('tapAgainDelete'));
      }
      P.armed = null;
      const r = await api(`/api/clips/${del.dataset.del}`, { method: 'DELETE' }).catch(() => null);
      if (!r?.ok) return toast(`${t('error')}: ${r?.error || ''}`);
      toast(t('clipDeleted'));
      P.sel = null;
      return load();
    }
    const b = e.target.closest('[data-sel]');
    if (!b) return;
    P.pending = null;
    $('#saveBox').hidden = true;
    P.showResult = false;
    P.sel = b.dataset.sel;
    const c = myClips().find((x) => x.id === P.sel);
    if (c) fromSaved(c);
    renderShedTab();
  });

  function fromSaved(c) {
    const r = c?.result;
    last.count = r?.count ? { still: r.count.resting ? [] : r.count.still, resting: r.count.resting } : null;
    last.birds = r?.count?.count || null;
    last.still = r?.count && !r.count.resting ? r.count.still.length : 0;
    last.resting = Boolean(r?.count?.resting);
    last.obs = r?.observation?.ok ? r.observation : null;
    last.soundBad = Boolean(r?.observation?.unusualSound);
  }
  function showResult(r) {
    $('#shCount').textContent = r?.count ? num(r.count.count) : '—';
    $('#shStill').textContent = r?.count ? num(r.count.resting ? 0 : r.count.still.length) : '—';
    $('#shStillBox').classList.toggle('warn', Boolean(r?.count && !r.count.resting && r.count.still.length));
    const notes = [];
    if (r?.count?.resting) notes.push(t('restingNight'));
    if (r?.observation?.note) notes.push(r.observation.note);
    $('#shNote').textContent = notes.join(' ');
    $('#shNote').hidden = !notes.length;
    const o = r?.observation;
    $('#shSound').hidden = !o?.ok;
    if (o?.ok) {
      $('#shSoundT').textContent = !o.heardAudio ? t('soundMissing') : o.unusualSound ? t('soundBadTitle') : t('soundOkTitle');
      $('#shSound').className = `action ${o.unusualSound || !o.heardAudio ? '' : 'ok'}`;
    }
    const stillN = r?.count && !r.count.resting ? r.count.still.length : 0;
    $('#shAction').hidden = !(stillN || o?.unusualSound);
    $('#shActionT').textContent = stillN ? fmt('stillTitle', { n: num(stillN) }) : t('soundBadTitle');
    $('#shActionS').textContent = t('b_birds_still').split(' · ').pop();
  }
  function busy(text) {
    $('#shBusy').hidden = !text;
    $('#shBusyT').textContent = text || '';
  }

  $('#recheckBtn').addEventListener('click', async () => {
    if (!P.sel) return toast(t('noClipsYet'));
    $('#recheckBtn').disabled = true;
    busy(t('stepWatch'));
    try {
      const r = await postJson(`/api/clips/${P.sel}/check?lang=${L()}`, {});
      if (!r.ok) throw new Error(r.error);
      P.clips.clips = P.clips.clips.map((c) => (c.id === r.clip.id ? r.clip : c));
      last.vetLine = r.vetLine || '';
      fromSaved(r.clip);
      P.showResult = true; // show the checked frame with rings around chickens that did not move
      renderShedTab();
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    } finally {
      $('#recheckBtn').disabled = false;
      busy('');
    }
  });

  // A new phone video: frames are pulled here in the browser, then the farmer saves it or checks it once.
  function extractFrames(file, count = 8, maxW = 1024) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = URL.createObjectURL(file);
      const frames = [];
      v.onerror = () => reject(new Error('video'));
      v.onloadedmetadata = async () => {
        const dur = v.duration;
        if (!Number.isFinite(dur) || dur <= 0) return reject(new Error('video'));
        const scale = Math.min(1, maxW / v.videoWidth);
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
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
        resolve({ frames, width: c.width, height: c.height, seconds: dur });
      };
    });
  }
  $('#videoIn').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return toast(t('videoTooBig'));
    if (S.tab !== 'shed') K.show('shed');
    busy(t('stepFrames'));
    try {
      const v = await extractFrames(file);
      P.pending = { file, v };
      $('#clipName').value = fmt('defaultClipName', { n: num(myClips().length + 1) });
      $('#clipSaveBtn').disabled = myClips().length >= (P.clips.max || 5);
      if ($('#clipSaveBtn').disabled) toast(t('clipsFull'));
      $('#saveBox').hidden = false;
      renderShedTab();
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    } finally {
      busy('');
    }
  });
  $('#clipSaveBtn').addEventListener('click', async () => {
    if (!P.pending) return;
    const { file, v } = P.pending;
    $('#saveBox').hidden = true;
    busy(t('saving'));
    try {
      const name = $('#clipName').value.trim() || fmt('defaultClipName', { n: num(myClips().length + 1) });
      const c = await postJson('/api/clips', { name, seconds: v.seconds, width: v.width, height: v.height, frames: v.frames, shedId: isDemoShed() ? null : S.shed?.id });
      if (!c.ok) throw new Error(c.error);
      const up = await api(`/api/clips/${c.clip.id}/video`, { method: 'PUT', headers: { 'Content-Type': file.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4' }, body: file });
      if (!up.ok) throw new Error(up.error);
      P.pending = null;
      P.sel = c.clip.id;
      busy(t('stepWatch'));
      const r = await postJson(`/api/clips/${c.clip.id}/check?lang=${L()}`, {});
      if (!r.ok) throw new Error(r.error);
      P.showResult = true;
      await load();
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
      P.pending = null;
      await load();
    } finally {
      busy('');
    }
  });
  $('#clipOnceBtn').addEventListener('click', async () => {
    if (!P.pending) return;
    const { file, v } = P.pending;
    $('#saveBox').hidden = true;
    busy(t('stepCount'));
    try {
      const r = await postJson('/api/poultry/count', { frames: v.frames, width: v.width });
      if (!r.ok) throw new Error(r.error);
      last.count = { still: r.resting ? [] : r.still, resting: r.resting };
      last.birds = r.count || null;
      last.still = r.resting ? 0 : r.still.length;
      last.resting = r.resting;
      const res = { count: { count: r.count, still: r.still, resting: r.resting } };
      showResult(res);
      drawRings(v, r.resting ? [] : r.still);
      busy(t('stepWatch'));
      const w = await api(`/api/poultry/video?lang=${L()}`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: file });
      if (w.ok && w.observation?.ok) {
        last.obs = w.observation;
        last.soundBad = Boolean(w.observation.unusualSound);
        last.vetLine = w.vetLine || '';
        showResult({ ...res, observation: w.observation });
      }
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    } finally {
      busy('');
    }
  });

  // Listen to the shed for 15 seconds (Muse Spark hears unusual sounds; never names a disease).
  let rec = null;
  $('#soundBtn').addEventListener('click', async () => {
    if (rec) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const parts = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      let left = 15;
      busy(fmt('recording', { n: num(left) }));
      const timer = setInterval(() => {
        left -= 1;
        busy(fmt('recording', { n: num(left) }));
        if (left <= 0) rec.stop();
      }, 1000);
      rec.onstop = async () => {
        clearInterval(timer);
        stream.getTracks().forEach((x) => x.stop());
        rec = null;
        busy(t('stepSound'));
        try {
          const wav = await K.toWav(new Blob(parts, { type: parts[0]?.type || 'audio/webm' }));
          const r = await api(`/api/poultry/sound?lang=${L()}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
          if (!r.ok) throw new Error(r.error);
          if (r.observation?.ok) {
            last.obs = r.observation;
            last.soundBad = Boolean(r.observation.unusualSound);
            showResult({ count: last.count ? { count: last.birds, still: last.count.still, resting: last.resting } : null, observation: r.observation });
          }
        } catch (err) {
          toast(`${t('error')}: ${err.message}`);
        } finally {
          busy('');
        }
      };
      rec.start();
    } catch (err) {
      rec = null;
      toast(`Mic: ${err.message}`);
    }
  });

  // ================= demo call player (vet, egg shops, field shops) =================
  const call = { id: 0, start: 0, timer: null, audio: new Map(), replay: null };
  const audioFor = (turn) => {
    const key = `${turn.who}|${turn.text}`;
    if (!call.audio.has(key)) call.audio.set(key, postJson('/api/speak', { text: turn.text, voice: turn.who === 'vet' ? 'vet' : turn.who === 'shop' ? 'shop' : undefined }).then((r) => (r.ok ? r.audioDataUrl : null)).catch(() => null));
    return call.audio.get(key);
  };
  const mmss = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${num(Math.floor(s / 60))}:${num(s % 60).padStart(2, num(0))}`;
  };
  function callState(live) {
    $('#callState').className = `callstate ${live ? 'live' : ''}`;
    $('#callState').textContent = fmt(live ? 'callLiveT' : 'callEndedT', { t: mmss(Date.now() - call.start) });
  }
  // legs: [{ name, av, info, turns: [{who, text, src}] }]; resolves when every leg has played or the farmer ends it.
  async function playCalls(legs, { summary = null, next = null } = {}) {
    const id = ++call.id;
    call.after = next;
    call.replay = () => playCalls(legs, { summary, next });
    $('#callSheet').hidden = false;
    $('#callSaid').hidden = true;
    $('#callEnd').hidden = false;
    $('#callReplay').hidden = true;
    $('#callNext').hidden = true;
    $('#callProg').innerHTML = legs.length > 1 ? legs.map(() => '<span></span>').join('') : '';
    legs.flatMap((l) => l.turns).forEach(audioFor);
    for (let i = 0; i < legs.length && id === call.id; i++) {
      const leg = legs[i];
      [...$('#callProg').children].forEach((el, k) => (el.className = k < i ? 'done' : k === i ? 'now' : ''));
      $('#callName').textContent = leg.name;
      $('#callAv').textContent = leg.av || '';
      $('#callInfo').textContent = leg.info || '';
      $('#callLines').innerHTML = '';
      $('#callState').className = 'callstate live';
      $('#callState').textContent = t('callConnecting');
      await audioFor(leg.turns[0]);
      call.start = Date.now();
      clearInterval(call.timer);
      call.timer = setInterval(() => callState(true), 1000);
      for (const turn of leg.turns) {
        if (id !== call.id) return;
        const el = document.createElement('div');
        el.className = `cl ${turn.who === 'saathi' ? 'me' : 'them'} now`;
        el.innerHTML = `<div class="b">${esc(turn.text)}${turn.src ? `<span class="src">${esc(turn.src)}</span>` : ''}</div>`;
        $('#callLines').append(el);
        el.scrollIntoView({ block: 'nearest' });
        await K.playUrl(await audioFor(turn));
        el.classList.remove('now');
      }
    }
    if (id !== call.id) return;
    endCall(summary, next);
  }
  function endCall(summary, next) {
    call.id++;
    K.stopAudio();
    clearInterval(call.timer);
    callState(false);
    $('#callEnd').hidden = true;
    $('#callReplay').hidden = false;
    if (summary?.items?.length) {
      $('#callSaidH').textContent = summary.title || '';
      $('#callSaidList').innerHTML = summary.items.map((s) => `<li>${esc(s)}</li>`).join('');
      $('#callSaid').hidden = false;
    }
    if (next) {
      $('#callNext').textContent = next.label;
      $('#callNext').hidden = false;
      $('#callNext').onclick = () => {
        $('#callSheet').hidden = true;
        next.go();
      };
    } else {
      $('#callNext').textContent = t('close');
      $('#callNext').hidden = false;
      $('#callNext').onclick = () => ($('#callSheet').hidden = true);
    }
  }
  $('#callEnd').addEventListener('click', () => endCall(null, call.after || null));
  // The call sheet always has a way out, even mid-call.
  $('#callSheet').addEventListener('keydown', (e) => e.key === 'Escape' && endCall(null, null));
  $('#callReplay').addEventListener('click', () => call.replay && call.replay());

  // ================= vet: signs, two questions, the farmer's yes, then the call =================
  const vet = { signs: new Set(), auto: new Set(), since: null, deaths: null };
  const SIGNS = ['still', 'off_feed', 'crowding', 'twisted_neck', 'wet_litter', 'breathing', 'swollen_face', 'weak', 'drink_less', 'droppings', 'fewer_eggs'];
  function vetStep(n) {
    [1, 2, 3].forEach((i) => ($(`#v${i}`).hidden = i !== n));
    $('#vetTitle').textContent = n === 1 ? t(vet.auto.size ? 'signsTitleAuto' : 'signsTitle') : n === 2 ? t('moreTitle') : vetName();
  }
  const vetName = () => (isDemoShed() ? P.poultry?.vet?.names?.[L()] || P.poultry?.vet?.name || t('vet') : t('yourVet'));
  async function openVet() {
    vet.since = null;
    vet.deaths = null;
    vet.auto = new Set();
    const r = await postJson('/api/vet/signs', { count: last.count, observation: last.obs }).catch(() => null);
    if (r?.ok) vet.auto = new Set(r.signs);
    vet.signs = new Set(vet.auto);
    renderSigns();
    renderSince();
    $('#dVal').textContent = '—';
    $('#vetSignsNote').hidden = !vet.auto.size;
    vetStep(1);
    $('#vetSheet').hidden = false;
  }
  function renderSigns() {
    const n = last.count?.still?.length || 0;
    $('#vetSigns').innerHTML = SIGNS.map((c) => `<button type="button" class="chip" data-sign="${c}" aria-pressed="${vet.signs.has(c)}">${esc(c === 'still' ? (n ? fmt('sign_still', { n: num(n) }) : t('sign_still0')) : t(`sign_${c}`))}${vet.auto.has(c) ? ` <span class="src">${esc(t('fromVideo'))}</span>` : ''}</button>`).join('');
  }
  $('#vetSigns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sign]');
    if (!b) return;
    const c = b.dataset.sign;
    vet.signs.has(c) ? vet.signs.delete(c) : vet.signs.add(c);
    b.setAttribute('aria-pressed', String(vet.signs.has(c)));
  });
  function renderSince() {
    $('#vetSince').innerHTML = ['today', 'days', 'week'].map((c) => `<button type="button" class="chip" data-since="${c}" aria-pressed="${vet.since === c}">${esc(t(`since_${c}`))}</button>`).join('');
  }
  $('#vetSince').addEventListener('click', (e) => {
    const b = e.target.closest('[data-since]');
    if (!b) return;
    vet.since = b.dataset.since;
    renderSince();
  });
  const setDeaths = (n) => {
    vet.deaths = Math.max(0, Math.min(9999, n));
    $('#dVal').textContent = num(vet.deaths);
  };
  $('#dMinus').addEventListener('click', () => setDeaths((vet.deaths ?? 1) - 1));
  $('#dPlus').addEventListener('click', () => setDeaths((vet.deaths ?? 0) + 1));
  $('#vetNext1').addEventListener('click', () => vetStep(2));
  const callBody = () => ({ lang: L(), signs: [...vet.signs], still: last.count?.still?.length || null, since: vet.since, deaths: vet.deaths, birds: last.birds || S.shed?.chickens || null });
  $('#vetNext2').addEventListener('click', async () => {
    const r = await postJson('/api/vet/message', callBody()).catch(() => null);
    if (!r?.ok) return toast(t('error'));
    $('#vetMsg').textContent = r.message;
    $('#vetPlace').textContent = isDemoShed() ? `${P.poultry?.vet?.villages?.[L()] || ''} · ${t('demoTag')}` : '';
    $('#vetConsent').checked = false;
    $('#vetCall').disabled = true;
    vetStep(3);
  });
  $('#vetConsent').addEventListener('change', (e) => ($('#vetCall').disabled = !e.target.checked));
  $('#vetCall').addEventListener('click', async () => {
    $('#vetSheet').hidden = true;
    if (!isDemoShed()) return comingSoon(t('vetSoonH'), t('vetSoonT'));
    const r = await postJson('/api/vet/call', { ...callBody(), consent: true }).catch(() => null);
    if (!r?.ok) return toast(`${t('error')}: ${r?.error || ''}`);
    const name = r.vet?.names?.[L()] || vetName();
    playCalls([{ name, av: t('vetInitial'), turns: (r.turns || []).map((x) => ({ ...x, src: x.src ? t(x.src === 'sam' ? 'srcSam' : 'srcSensor') : '' })) }], { summary: { title: t('vetSaid'), items: r.summary || [] } });
  });
  $('#vetClose').addEventListener('click', () => ($('#vetSheet').hidden = true));

  // ================= egg sale (demo shed: scripted calls with Muse Spark shopkeepers) =================
  const sale = { run: null, pick: null, rule: null };
  const shopName = (s) => s?.names?.[L()] || s?.name || '';
  async function startSale() {
    if (!isDemoShed()) return comingSoon(t('sellSoonH'), t('sellSoonT'));
    const info = await api('/api/sell').catch(() => null);
    if (info?.ok) S.sale = info;
    if ((S.sale?.trays ?? 0) < 1) return toast(t('noTrays'));
    const open = S.sale?.rule?.last_run;
    if (open?.status === 'open') {
      sale.run = open;
      return showOffers();
    }
    $('#callSheet').hidden = false;
    $('#callName').textContent = t('callingShops');
    $('#callLines').innerHTML = '';
    $('#callState').textContent = t('callConnecting');
    const r = await postJson('/api/sell/run', { lang: L() }).catch(() => null);
    if (!r?.ok) {
      $('#callSheet').hidden = true;
      return toast(`${t('error')}: ${r?.error || ''}`);
    }
    sale.run = r.run;
    playSale();
  }
  function playSale() {
    const run = sale.run;
    const legs = run.shops.map((s, i) => ({
      name: shopName(s),
      av: t('shopInitial'),
      info: fmt('sellCallInfo', { i: num(i + 1), n: num(run.shops.length), trays: num(run.trays), floor: rupees(run.floor) }),
      turns: s.turns.map((x) => ({ who: x.who === 'shop' ? 'shop' : 'saathi', text: x.text, src: x.who === 'shop' && x.by === 'spark' ? fmt('shopBySpark', { model: s.by || 'Muse Spark' }) : '' })),
    }));
    playCalls(legs, { next: { label: t('offersTitle'), go: showOffers } });
  }
  function showOffers() {
    const run = sale.run;
    const ranked = (run.ranked || run.shops.map((s) => s.contact_id)).map((id) => run.shops.find((s) => s.contact_id === id)).filter(Boolean);
    sale.ranked = ranked;
    sale.pick = ranked.find((s) => s.price)?.contact_id || null;
    $('#offers').innerHTML = ranked
      .map((s, i) => `<button type="button" class="offer" role="radio" data-shop="${s.contact_id}" ${s.price ? '' : 'disabled'}><div><b>${esc(shopName(s))}</b>${s.price && i === 0 ? ` <span class="pill ok">${esc(t('bestTag'))}</span>` : ''}<div class="muted small">${esc(s.price ? fmt('pickupAt', { when: s.pickup }) : fmt('lastOffer', { p: rupees(s.best) }))}</div></div>${s.price ? `<b>${esc(fmt('perTray', { p: rupees(s.price) }))}</b>` : `<span class="pill bad">${esc(t('priceLow'))}</span>`}</button>`)
      .join('');
    renderPick();
    $('#offerConfirm').hidden = !sale.pick;
    if (!sale.pick) $('#offerTotal').textContent = t('noDeal');
    $('#offerSheet').hidden = false;
  }
  function renderPick() {
    $$('#offers .offer').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.shop === sale.pick)));
    const s = sale.run.shops.find((x) => x.contact_id === sale.pick);
    if (s) $('#offerTotal').innerHTML = `<span>${esc(fmt('totalLine', { trays: num(sale.run.trays), p: rupees(s.price) }))}</span><b>${esc(rupees(s.price * sale.run.trays))}</b>`;
  }
  $('#offers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shop]');
    if (!b || b.disabled) return;
    sale.pick = b.dataset.shop;
    renderPick();
  });
  $('#offerConfirm').addEventListener('click', async () => {
    if (!sale.pick) return;
    $('#offerConfirm').disabled = true;
    try {
      const r = await postJson('/api/sell/confirm', { runId: sale.run.id, contactId: sale.pick });
      if (!r.ok) throw new Error(r.error);
      const s = sale.run.shops.find((x) => x.contact_id === sale.pick);
      const msg = fmt('dealDone', { shop: shopName(s), total: rupees(r.total) });
      toast(msg);
      K.speak(msg);
      $('#offerSheet').hidden = true;
      await K.loadSide();
      load();
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    } finally {
      $('#offerConfirm').disabled = false;
    }
  });
  $('#offerReplay').addEventListener('click', () => {
    $('#offerSheet').hidden = true;
    playSale();
  });
  $('#offerSkip').addEventListener('click', () => {
    if (sale.run) postJson('/api/sell/skip', { runId: sale.run.id }).catch(() => null);
    $('#offerSheet').hidden = true;
  });
  $('#offerClose').addEventListener('click', () => ($('#offerSheet').hidden = true));

  // ---- the farmer's sell rule ----
  async function openRule() {
    const info = await api('/api/sell').catch(() => null);
    if (!info?.ok) return toast(t('error'));
    S.sale = info;
    const r = info.rule || {};
    sale.rule = { min: r.min_count || 300, minOn: Boolean(r.min_count), days: r.every_days || 3, daysOn: Boolean(r.every_days), floor: Number(r.floor_price) || 175, ask: r.ask_first !== false, shops: new Set(r.shop_ids?.length ? r.shop_ids : info.shops.map((s) => s.id)) };
    // A real shed has no shops yet: only the demo shed lists the demo egg shops.
    $('#rShops').innerHTML = isDemoShed()
      ? info.shops.map((s) => `<label><input type="checkbox" data-rshop="${s.id}" ${sale.rule.shops.has(s.id) ? 'checked' : ''}><span>${esc(shopName(s))} <small>· ${esc(s.villages?.[L()] || s.village || '')} · ${esc(t('demoTag'))}</small></span></label>`).join('')
      : `<div class="muted small">${esc(t('noShopsYetShed'))}</div>`;
    const prices = info.shops.map((s) => s.details?.last_price_inr_per_tray).filter(Boolean);
    $('#rFloorHint').textContent = isDemoShed() && prices.length ? fmt('ruleFloorHint', { lo: rupees(Math.min(...prices)), hi: rupees(Math.max(...prices)) }) : '';
    $('#rAsk').checked = sale.rule.ask;
    renderRule();
    $('#ruleSheet').hidden = false;
  }
  function renderRule() {
    const r = sale.rule;
    $('#rCount').textContent = fmt('eggsN', { n: num(r.min) });
    $('#rCountTrays').textContent = fmt('traysEq', { n: num(r.min / 30) });
    $('#rDays').textContent = fmt('daysN', { n: num(r.days) });
    $('#rFloor').textContent = rupees(r.floor);
    $('#rCountOn').checked = r.minOn;
    $('#rDaysOn').checked = r.daysOn;
  }
  $('#ruleSheet').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rs]');
    if (b) {
      const [k, d] = b.dataset.rs.split(':');
      const lim = { min: [30, 3000], days: [1, 30], floor: [5, 5000] }[k];
      sale.rule[k] = Math.max(lim[0], Math.min(lim[1], sale.rule[k] + Number(d)));
      renderRule();
    }
    const c = e.target.closest('[data-rshop]');
    if (c) c.checked ? sale.rule.shops.add(c.dataset.rshop) : sale.rule.shops.delete(c.dataset.rshop);
  });
  $('#rCountOn').addEventListener('change', (e) => (sale.rule.minOn = e.target.checked));
  $('#rDaysOn').addEventListener('change', (e) => (sale.rule.daysOn = e.target.checked));
  $('#rAsk').addEventListener('change', (e) => (sale.rule.ask = e.target.checked));
  $('#rSave').addEventListener('click', async () => {
    const r = sale.rule;
    if (!r.minOn && !r.daysOn) return toast(t('ruleNeedOne'));
    if (isDemoShed() && !r.shops.size) return toast(t('ruleNeedShop'));
    const res = await postJson('/api/sell/rule', { min_count: r.minOn ? r.min : null, every_days: r.daysOn ? r.days : null, floor_price: r.floor, ask_first: r.ask, shop_ids: [...r.shops] }).catch(() => null);
    if (!res?.ok) return toast(`${t('error')}: ${res?.error || ''}`);
    toast(t('ruleSaved'));
    $('#ruleSheet').hidden = true;
    load();
  });
  $('#ruleClose').addEventListener('click', () => ($('#ruleSheet').hidden = true));

  // ================= market =================
  function renderShedMarket() {
    const s = S.sale;
    $('#mkStock').innerHTML = s ? `<b>${esc(fmt('traysN', { n: num(s.trays) }))}</b><span>${esc(fmt('eggStockText', { n: num(s.stock), trays: num(s.trays) }))}</span>` : emptyBox(t('shedWaiting'));
    const r = s?.rule || {};
    $('#mkRule').textContent = s ? [r.min_count ? fmt('ruleWhen', { n: num(r.min_count) }) : '', r.every_days ? fmt('ruleEveryN', { n: num(r.every_days) }) : '', r.floor_price ? fmt('ruleFloorShort', { p: rupees(r.floor_price) }) : '', r.ask_first !== false ? t('ruleAskShort') : ''].filter(Boolean).join(' · ') : '';
    const deals = (S.deals || []).filter((d) => d.status === 'confirmed' && (d.items || [])[0]?.item === 'eggs');
    $('#mkDeals').innerHTML = deals.length
      ? deals.slice(0, 8).map((d) => `<div class="entry">${I.rupee}<div class="t"><b>${esc(fmt('traysN', { n: num(d.items[0].trays) }))} · ${esc(d.items[0].shop || '')}</b><div class="who">${esc(new Date(d.created_at).toLocaleDateString(K.loc(), { day: 'numeric', month: 'short' }))} · ${esc(t('simulated'))}</div></div><span class="a in-c">+${esc(rupees(d.total_inr))}</span></div>`).join('')
      : `<div class="muted small">${esc(t('noSalesYet'))}</div>`;
  }

  // Buying for a field: quantities from the field size; shops near the field.
  // Demo lands: sample prices and a scripted demo call. Real lands: no prices, real shops only, no fake call.
  async function loadMarket() {
    if (!S.cur) return;
    const id = S.cur.id;
    $('#mkNeeds').innerHTML = emptyBox(t('loadingPlan'));
    $('#mkCall').hidden = true;
    $('#mkTotal').textContent = '';
    $('#mkShops').innerHTML = emptyBox(t('findingShops'));
    const r = await api(`/api/lands/${id}/market`).catch(() => null);
    if (S.cur?.id !== id) return;
    P.market = r?.ok ? { ...r, landId: id } : { error: r?.error || 'error', landId: id };
    P.shop = (P.market.shops || [])[0] || (P.market.demoShop ? { ...P.market.demoShop, name: P.market.demoShop.name[L()] } : null);
    renderFieldMarket();
  }
  const unitText = (l) => (l.unit === 'bag50' ? t('bags50') : l.unit === 'acre' ? t('acShort') : l.unit === 'kg' ? t('kgShort') : t('cuttings'));
  function renderFieldMarket() {
    const m = P.market;
    if (!m) return;
    if (m.error) return ($('#mkNeeds').innerHTML = emptyBox(`${t('error')}: ${m.error}`));
    const demo = m.demoLand;
    const sym = m.currency?.symbol || '';
    $('#mkCropH').textContent = m.crop ? fmt('buyFor', { crop: K.cropName(m.crop) }) : t('buyH');
    $$('#mkField .src-tag.sim').forEach((x) => (x.hidden = !demo));
    if (m.blocked) {
      $('#mkNeeds').innerHTML = emptyBox(t('resiH'));
      $('#mkTotal').textContent = '';
      $('#mkCall').hidden = true;
    } else if (!m.crop) {
      $('#mkNeeds').innerHTML = emptyBox(t('pickCropFirst'));
      $('#mkTotal').textContent = '';
      $('#mkCall').hidden = true;
    } else {
      $('#mkCall').hidden = false;
      $('#mkNeeds').innerHTML = m.needs
        .map((l) => `<label class="need"><input type="checkbox" data-need="${l.id}" ${P.pick.has(l.id) ? 'checked' : ''}><span class="nm"><b>${esc(t(`buy_${l.id}`))}</b><small>${esc(`${l.id === 'seed' ? `${K.cropName(l.crop)} · ` : ''}${num(l.qty, l.qty < 10 ? 1 : 0)} ${unitText(l)} · ${t('approx')}`)}</small></span>${demo ? `<b class="pr">${esc(money(l.price, sym))}</b>` : ''}</label>`)
        .join('');
      const tot = m.needs.filter((l) => P.pick.has(l.id)).reduce((a, l) => a + l.price, 0);
      $('#mkTotal').innerHTML = demo ? `<span>${esc(t('sampleTotal'))}</span><b>${esc(money(tot, sym))}</b>` : `<span class="muted small">${esc(t('noLivePrices'))}</span>`;
      $('#mkCall').querySelector('[data-t]').textContent = t(demo ? 'callAndBook' : 'askSaathiCall');
    }
    $('#mkShopSrc').textContent = m.shops?.length ? m.shopSource || '' : demo ? t('demoTag') : '';
    const shops = m.shops?.length ? m.shops : demo && m.demoShop ? [{ ...m.demoShop, name: m.demoShop.name[L()] }] : [];
    $('#mkShops').innerHTML = shops.length
      ? shops.map((s, i) => `<button type="button" class="shopb ${P.shop?.id === s.id ? 'on' : ''}" data-shopi="${i}"><span>${I.pin}</span><span class="nm"><b>${esc(s.name)}</b><small>${esc([s.km != null ? fmt('kmAway', { km: num(s.km, 1) }) : '', s.address || '', s.real ? s.source : t('demoTag')].filter(Boolean).join(' · '))}</small></span></button>`).join('')
      : `<div class="emptybox">${esc(m.shopError ? t('shopSearchDown') : t('noShopsNear'))}</div>`;
    $('#mkShops').dataset.list = JSON.stringify(shops);
    $('#mkCall').disabled = !shops.length && !demo;
  }
  $('#mkNeeds').addEventListener('change', (e) => {
    const c = e.target.closest('[data-need]');
    if (!c) return;
    c.checked ? P.pick.add(c.dataset.need) : P.pick.delete(c.dataset.need);
    renderFieldMarket();
  });
  $('#mkShops').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shopi]');
    if (!b) return;
    P.shop = JSON.parse($('#mkShops').dataset.list || '[]')[+b.dataset.shopi] || null;
    renderFieldMarket();
  });
  $('#mkCall').addEventListener('click', async () => {
    const m = P.market;
    if (!m || !P.pick.size) return toast(t('pickSomething'));
    if (!m.demoLand) {
      // Real land: no call is made and nothing is faked.
      return comingSoon(P.shop ? fmt('willCall', { shop: P.shop.name }) : t('callSoonH'), t('callSoonT'));
    }
    $('#mkCall').disabled = true;
    try {
      const r = await postJson(`/api/lands/${S.cur.id}/order`, { lines: [...P.pick], shop: P.shop, crop: m.crop, cropName: K.cropName(m.crop), lang: L(), place: m.place || K.placeLine(S.plan?.place) });
      if (!r.ok) throw new Error(r.error);
      if (r.comingSoon) return comingSoon(r.shop ? fmt('willCall', { shop: r.shop.name }) : t('callSoonH'), t('callSoonT'));
      const sym = r.currency?.symbol || '';
      const legs = r.calls.map((c) => ({ name: c.to, av: t('shopInitial'), turns: c.turns }));
      await K.loadSide();
      playCalls(legs, { summary: { title: t('bookedH'), items: r.calls.map((c) => `${c.to}: ${money(c.total, sym)} · ${c.when}`) } });
    } catch (err) {
      toast(`${t('error')}: ${err.message}`);
    } finally {
      $('#mkCall').disabled = false;
    }
  });

  // ================= add a shed =================
  const SH = { lat: null, lon: null };
  function openAddShed() {
    SH.lat = null;
    SH.lon = null;
    $('#shedNameIn').value = '';
    $('#shedCountIn').value = '';
    $('#shedGpsTag').textContent = '';
    $('#shedSheet').hidden = false;
    $('#shedNameIn').focus();
  }
  $('#shedGps').addEventListener('click', () => {
    if (!navigator.geolocation) return toast(t('locDenied'));
    $('#shedGpsTag').textContent = t('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        SH.lat = p.coords.latitude;
        SH.lon = p.coords.longitude;
        $('#shedGpsTag').textContent = `${num(SH.lat, 4)}, ${num(SH.lon, 4)}`;
      },
      () => ($('#shedGpsTag').textContent = t('locDenied')),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
  $('#shedSave').addEventListener('click', async () => {
    const name = $('#shedNameIn').value.trim();
    if (!name) return toast(t('shedNameNeed'));
    const r = await postJson('/api/sheds', { name, chickens: Number($('#shedCountIn').value) || null, lat: SH.lat, lon: SH.lon, lang: L() }).catch(() => null);
    if (!r?.ok) return toast(`${t('error')}: ${r?.error || ''}`);
    $('#shedSheet').hidden = true;
    await K.loadSheds();
    K.openShed(r.shed.id);
  });
  $('#shedClose').addEventListener('click', () => ($('#shedSheet').hidden = true));

  // "Coming soon" sheet (calls, email, CCTV): a plain promise, never a fake result.
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="sheet" id="soonSheet" hidden><div class="wrap sh narrowsh"><div class="shtop"><button class="iconbtn" id="soonClose" aria-label="close">×</button></div><div class="soonbox"><span class="soonic">${I.chat}</span><h2 id="soonT"></h2><p id="soonS"></p><span class="pill warn">${esc(t('comingSoon'))}</span></div><button class="cta wide" type="button" id="soonOk"><span>${esc(t('gotIt'))}</span></button></div></div>`
  );
  $('#soonClose').addEventListener('click', () => ($('#soonSheet').hidden = true));
  $('#soonOk').addEventListener('click', () => ($('#soonSheet').hidden = true));

  function render(tab) {
    if (tab === 'shed') {
      $('#shKit2').innerHTML = kitHtml();
      renderShedTab();
    }
    if (tab === 'market') {
      if (S.mode === 'shed') renderShedMarket();
      else if (!P.market || P.market.landId !== S.cur?.id) loadMarket();
      else renderFieldMarket();
    }
  }

  window.KSShed = { load, render, renderHome, hero, openAddShed, openVet };
})();
