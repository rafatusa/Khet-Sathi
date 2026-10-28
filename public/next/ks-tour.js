// v0.19.0: a 5-stop tour of the demo farm for a first-time visitor (a judge opening the link cold):
// Sathi by voice, the field from space, the shed camera, the home yard, the weekly report.
// Shows once per browser when the demo farm opens; the account menu starts it again. Skip any time (Esc).
(() => {
  'use strict';
  const K = window.KS;
  if (!K) return;
  const { S, $, t, fmt, esc, num } = K;
  const DONE = 'ks_tour_done';
  const seen = () => {
    try {
      return localStorage.getItem(DONE) === '1';
    } catch {
      return true;
    }
  };
  const markSeen = () => {
    try {
      localStorage.setItem(DONE, '1');
    } catch {}
  };
  const field = () => S.lands.find((l) => (l.objects || []).length) || S.lands[0] || null;
  async function toField() {
    const f = field();
    if (!f) return false;
    if (S.mode !== 'field' || S.cur?.id !== f.id) await K.openLand(f.id);
    K.show('home');
    return true;
  }
  const STOPS = [
    { key: 'tour1', go: toField, el: () => $('#tabs [data-tab="saathi"]'), fixed: true },
    { key: 'tour2', go: toField, el: () => $('#kpis')?.closest('.card') },
    {
      key: 'tour3',
      go: async () => {
        if (!S.sheds[0]) return false;
        K.openShed(S.sheds[0].id);
        K.show('shed');
        return true;
      },
      el: () => $('#camTag')?.closest('.panel, .card'),
    },
    {
      key: 'tour4',
      go: async () => {
        if (!S.yards?.[0] || !window.KSYard) return false;
        await window.KSYard.open(S.yards[0].id);
        K.show('home');
        return true;
      },
      el: () => $('#ydPic')?.closest('.card'),
    },
    { key: 'tour5', go: toField, el: () => $('#home [data-report]') },
  ];

  let ui = null;
  let at = 0;
  let stops = [];
  const visible = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const waitFor = async (fn, ms = 8000) => {
    const t0 = Date.now();
    for (;;) {
      const el = fn();
      if (visible(el)) return el;
      if (Date.now() - t0 > ms) return null;
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  function place() {
    if (!ui?.target) return;
    const r = ui.target.getBoundingClientRect();
    Object.assign(ui.hole.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    const phone = innerWidth < 1000;
    const tip = ui.tip;
    if (phone) {
      Object.assign(tip.style, { left: '16px', right: '16px', top: 'auto', bottom: '92px' });
      // A target in the bottom bar: the card sits just above the bar.
      if (r.top > innerHeight - 120) tip.style.bottom = `${innerHeight - r.top + 14}px`;
    } else {
      const h = tip.offsetHeight || 190;
      const w = tip.offsetWidth || 360;
      const midTop = Math.max(12, Math.min(innerHeight - h - 12, r.top + r.height / 2 - h / 2));
      let left;
      let top;
      if (r.bottom + 14 + h < innerHeight) [left, top] = [r.left, r.bottom + 14];
      else if (r.top - h - 14 > 0) [left, top] = [r.left, r.top - h - 14];
      // A tall target (the shed camera): the card goes beside it, never over it.
      else if (r.right + 14 + w < innerWidth) [left, top] = [r.right + 14, midTop];
      else if (r.left - 14 - w > 0) [left, top] = [r.left - 14 - w, midTop];
      else [left, top] = [r.left, Math.max(12, innerHeight - h - 12)];
      Object.assign(tip.style, { left: `${Math.max(16, Math.min(left, innerWidth - w - 16))}px`, right: 'auto', top: `${top}px`, bottom: 'auto' });
    }
  }

  async function showStop(i) {
    at = i;
    const s = stops[i];
    ui.tip.setAttribute('aria-busy', 'true');
    ui.tip.classList.add('busy');
    ui.target = null;
    const ok = await s.go().catch(() => false);
    if (!ui) return;
    const el = ok === false ? null : await waitFor(s.el);
    if (!ui) return;
    if (!el) return i + 1 < stops.length ? showStop(i + 1) : close();
    if (!s.fixed) {
      el.scrollIntoView({ block: innerWidth < 1000 ? 'start' : 'center' });
      if (innerWidth < 1000) scrollBy(0, -90);
    }
    ui.target = el;
    ui.tip.innerHTML = `<div class="tour-n">${esc(fmt('tourOf', { i: num(i + 1), n: num(stops.length) }))}</div><h4 id="tourH">${esc(t(`${s.key}H`))}</h4><p>${esc(t(`${s.key}T`))}</p><div class="tour-row"><button type="button" data-tour="skip">${esc(t('tourSkip'))}</button><div class="tour-dots" aria-hidden="true">${stops.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div><button type="button" class="go" data-tour="next">${esc(t(i + 1 < stops.length ? 'tourNext' : 'tourDone'))}</button></div>`;
    ui.tip.removeAttribute('aria-busy');
    ui.tip.classList.remove('busy');
    requestAnimationFrame(place);
    setTimeout(place, 350);
    ui.tip.querySelector('[data-tour="next"]').focus({ preventScroll: true });
  }

  function close() {
    if (!ui) return;
    markSeen();
    ui.dim.remove();
    ui.tip.remove();
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey);
    ui = null;
    goBack().catch(() => null);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  async function start() {
    if (ui) return;
    if (S.view !== 'demo') await K.enterView('demo');
    stops = STOPS;
    const dim = document.createElement('div');
    dim.className = 'tour-dim';
    dim.innerHTML = '<div class="tour-hole"></div>';
    const tip = document.createElement('div');
    tip.className = 'tour-tip';
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-modal', 'true');
    tip.setAttribute('aria-labelledby', 'tourH');
    document.body.append(dim, tip);
    ui = { dim, tip, hole: dim.firstChild, target: null };
    tip.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      if (b.dataset.tour === 'skip') return close();
      if (at + 1 < stops.length) showStop(at + 1);
      else close();
    });
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    document.addEventListener('keydown', onKey);
    showStop(0);
  }

  // First visit to the demo farm: start by itself once its places have loaded. v0.19.1: a visitor who picked
  // one demo place (target) is brought back to it when the tour ends.
  let returnTo = null;
  function maybeStart(target = null) {
    if (seen() || ui || S.view !== 'demo' || !(S.lands.length || S.sheds.length || S.yards?.length)) return;
    returnTo = target;
    setTimeout(() => S.view === 'demo' && !seen() && start(), 900);
  }
  async function goBack() {
    const r = returnTo;
    returnTo = null;
    if (!r || S.view !== 'demo') return;
    if (r.kind === 'shed' && S.sheds.some((x) => x.id === r.id)) K.openShed(r.id);
    else if (r.kind === 'yard' && S.yards?.some((x) => x.id === r.id)) await window.KSYard?.open(r.id);
    else if (r.kind === 'field' && S.lands.some((x) => x.id === r.id)) await K.openLand(r.id);
    else return;
    K.show('home');
  }

  window.KSTour = { start, maybeStart, close, isOpen: () => Boolean(ui) };
  $('#meTour')?.addEventListener('click', () => {
    $('#meMenu').hidden = true;
    start();
  });
})();
