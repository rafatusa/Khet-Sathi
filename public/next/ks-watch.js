// v0.22.0: "Sathi on watch" on Home. Shows what Sathi saw, thought and did by herself for the place on screen,
// what she is waiting for, and the farm's setting for how much she does on her own. The work itself runs on
// the server (lib/watch.js); this file only shows it and sends the farmer's taps.
(() => {
  const K = window.KS;
  if (!K) return;
  const { $, t, fmt, esc, num, S, api, postJson, toast } = K;
  const W = { mode: 'ask', missions: [], key: '', busy: false };
  const L = () => K.lang();
  const placeKey = () => (S.mode === 'field' && S.cur ? `field|${S.cur.id}` : S.mode === 'shed' ? `shed|${S.shed?.id || ''}` : '');
  const hhmm = (iso) => {
    try {
      return new Intl.DateTimeFormat(L() === 'en' ? 'en-GB' : L() === 'hi' ? 'hi-IN' : 'bn-BD', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    } catch {
      return String(iso).slice(11, 16);
    }
  };
  // v0.26.1: Bangla digits in her Bangla lines (the model writes 0-9).
  // v0.27.1: older lines may hold an ISO date ("2026-10-30 04:53") or "37.1C"; both read plainly now.
  const MON = { bn: ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'], hi: ['जन', 'फ़र', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुल', 'अग', 'सित', 'अक्टू', 'नव', 'दिस'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
  const tidy = (x) => String(x).replace(/\b\d{4}-(\d\d)-(\d\d)(?:[ T](\d\d:\d\d))?/g, (_, mo, d, hm) => `${Number(d)} ${(MON[L()] || MON.en)[Number(mo) - 1] || mo}${hm ? ` ${hm}` : ''}`).replace(/(\d)\s?C\b/g, '$1°C');
  const textOf = (s) => (s.text ? (L() === 'bn' && s.text.bn ? K.digits(tidy(s.text.bn)) : tidy(s.text[L()] || s.text.en || '')) : '');
  const KIND = { saw: ['S', 'wtSaw'], thought: ['T', 'wtThought'], did: ['D', 'wtDid'], wait: ['?', 'wtWait'] };

  function stepLine(s) {
    if (s.key === 'wtSawAlert' && s.alert) return K.alertText(s.alert).title;
    const vars = { ...(s.vars || {}) };
    if (s.key === 'wtDidLater' && vars.at) vars.at = hhmm(vars.at);
    if (vars.action) vars.action = t(`wtAct_${vars.action}`);
    if (vars.what) vars.what = t(`wtTool_${vars.what}`);
    if (vars.stage) vars.stage = t(`wtStage_${vars.stage}`);
    for (const k of ['temp', 'humidity', 'birds', 'still', 'max', 'min', 'rain', 'hours']) if (typeof vars[k] === 'number') vars[k] = num(vars[k]);
    const head = s.key ? fmt(s.key, vars) : '';
    const body = textOf(s);
    if (s.key === 'wtDidTold') return `${head}: ${body}`;
    return [head, body].filter(Boolean).join(' · ');
  }
  function stepHtml(s) {
    const [mark, label] = KIND[s.kind] || ['·', 'wtDid'];
    const sim = s.simulated ? ` <span class="src-tag sim">${esc(t('wtSim'))}</span>` : '';
    return `<li class="wl-${esc(s.kind)}"><span class="wk" aria-hidden="true">${mark}</span><span class="sr-only">${esc(t(label))}: </span><span class="wt">${esc(stepLine(s))}${sim}</span><span class="wm">${esc(hhmm(s.at))}</span></li>`;
  }
  function eyes() {
    const cam = (window.KSFieldCam?.count?.() || 0) > 0; // v0.23.0: the field camera, when the field has looks
    const list = S.mode === 'shed' ? [['wtEyeCam', true], ['wtEyeKit', false], ['wtEyeWx', false]] : [...(cam ? [['fcH', true]] : []), ['wtEyeSat', false], ['wtEyeWx', false]];
    return list.map(([k, live]) => `<span class="eye"><span class="wdot${live ? ' live' : ''}" aria-hidden="true"></span>${esc(t(k))}</span>`).join('');
  }
  function askHtml(m) {
    const w = [...(m.steps || [])].reverse().find((s) => s.kind === 'wait' && s.status === 'open');
    if (!w) return '';
    return `<div class="wask" role="group" aria-label="${esc(t('wtWait'))}"><b>${esc(textOf(w))}</b><div class="btns"><button class="btn${w.action === 'call_vet' ? ' turm' : ''}" type="button" data-wdecide="yes" data-wid="${esc(m.id)}">${esc(t(`wtAct_${w.action}`))}</button><button class="btn ghost" type="button" data-wdecide="no" data-wid="${esc(m.id)}">${esc(t('wtNotNow'))}</button></div></div>`;
  }
  function render() {
    const card = $('#watchCard');
    if (!card) return;
    const on = (S.mode === 'field' && S.cur) || S.mode === 'shed';
    card.hidden = !on;
    if (!on) return;
    const [latest, ...older] = W.missions;
    const steps = latest?.steps || [];
    const last = steps[steps.length - 1];
    card.innerHTML = `
      <div class="wc-top">
        <div class="wc-h"><h2>${esc(t('wtH'))}</h2><p>${esc(last ? fmt('wtLast', { time: hhmm(last.at) }) : t('wtSub'))}</p></div>
        <div class="eyes">${eyes()}</div>
        <div class="wseg" role="radiogroup" aria-label="${esc(t('wtModeL'))}">${['tell', 'ask', 'rules'].map((m) => `<button type="button" role="radio" aria-checked="${W.mode === m}" data-wmode="${m}">${esc(t(`wtMode_${m}`))}</button>`).join('')}</div>
      </div>
      ${latest ? askHtml(latest) : ''}
      ${latest ? `<div class="wc-log"><div class="wc-lab"><span>${esc(K.alertText({ title: latest.trigger, body: JSON.stringify(steps[0]?.alert ? JSON.parse(steps[0].alert.body || '{}') : {}) }).title)}</span><span class="wstat">${esc(t(`wtStatus_${latest.status}`))}</span>${latest.model ? `<span class="src-tag">${esc(latest.model)}</span>` : ''}</div>${steps.length > 5 ? `<details class="wall"><summary>${esc(fmt('wtAll', { n: num(steps.length) }))}</summary><ol class="wlog">${steps.slice(0, -5).map(stepHtml).join('')}</ol></details>` : ''}<ol class="wlog">${steps.slice(-5).map(stepHtml).join('')}</ol></div>` : `<p class="muted small wnone">${esc(t('wtNone'))}</p>`}
      ${older.length ? `<details class="wold"><summary>${esc(t('wtEarlier'))} (${num(older.length)})</summary>${older.map((m) => `<div class="wc-lab"><span>${esc(K.alertText({ title: m.trigger, body: m.steps?.[0]?.alert?.body || '{}' }).title)}</span><span class="wstat">${esc(t(`wtStatus_${m.status}`))}</span></div><ol class="wlog">${(m.steps || []).slice(-6).map(stepHtml).join('')}</ol>`).join('')}</details>` : ''}
      ${S.view === 'demo' && S.admin && S.mode === 'shed' ? `<button class="btn ghost" type="button" id="wWake">${esc(W.busy ? t('wtWaking') : t('wtWake'))}</button>` : ''}`;
  }
  async function load(force = false) {
    const key = placeKey();
    if (!key) return render();
    if (!force && key === W.key && Date.now() - (W.at || 0) < 20000) return render();
    W.key = key;
    W.at = Date.now();
    const [kind, id] = key.split('|');
    const r = await api(`/api/watch?kind=${kind}${id ? `&id=${encodeURIComponent(id)}` : ''}`).catch(() => null);
    if (placeKey() !== key) return;
    if (r?.ok) {
      W.mode = r.mode;
      W.missions = r.missions || [];
    }
    render();
  }

  $('#watchCard')?.addEventListener('click', async (e) => {
    const mode = e.target.closest('[data-wmode]');
    if (mode) {
      const want = mode.dataset.wmode;
      const r = await postJson('/api/watch/mode', { mode: want }).catch((err) => ({ ok: false, error: err.message }));
      if (r.ok) W.mode = r.mode;
      else if (r.error) toast(r.error);
      return render();
    }
    const d = e.target.closest('[data-wdecide]');
    if (d) {
      d.disabled = true;
      const choice = d.dataset.wdecide;
      const r = await postJson(`/api/watch/${d.dataset.wid}/decide`, { choice }).catch((err) => ({ ok: false, error: err.message }));
      if (!r.ok) {
        d.disabled = false;
        return toast(`${t('error')}: ${r.error}`);
      }
      W.missions = W.missions.map((m) => (m.id === r.mission.id ? r.mission : m));
      render();
      // What Sathi asked for opens with the farmer's tap: the vet call, or the summary for the office.
      if (r.open === 'call_vet') window.KSShed?.openVet();
      // v0.24.0: ripening: the harvest steps (when the harvest is near, booking and selling) on Home.
      if (r.open === 'plan_harvest') {
        K.show('home');
        setTimeout(() => $('#dashCrop')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      }
      if (r.open === 'send_office_summary') {
        const cam = S.mode === 'field' ? await window.KSFieldCam?.latestForProblem().catch(() => null) : null;
        if (cam) window.KSProblem?.openWith(cam);
        else window.KSProblem?.open();
      }
      return;
    }
    if (e.target.closest('#wWake') && !W.busy) {
      W.busy = true;
      render();
      const r = await postJson('/api/watch/wake', {}).catch((err) => ({ ok: false, error: err.message }));
      W.busy = false;
      if (!r.ok) toast(`${t('error')}: ${r.error}`);
      await load(true);
    }
  });
  // While Home is on screen, look for Sathi's new steps every 30 seconds.
  setInterval(() => {
    if (S.tab === 'home' && !document.hidden && placeKey()) load(true);
  }, 30000);
  document.querySelectorAll('.lang [data-lang]').forEach((b) => b.addEventListener('click', () => setTimeout(render, 0)));

  window.KSWatch = { load, render };
})();
