// Khet Sathi v0.14.0: the admin Settings tab. Model checks, every farm (view one read only), usage today
// against the daily limits, and the demo places. Only admins see the tab; the server refuses its routes
// for anyone else.
(() => {
  'use strict';
  const K = window.KS;
  if (!K) return;
  const { S, $, t, fmt, num, esc, toast, api, postJson, emptyBox } = K;
  const A = { checks: null, overview: null, busy: false };
  const ago = (iso) => {
    if (!iso) return t('adNever');
    const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(K.loc(), { numeric: 'auto' });
    if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  };
  const secs = (ms) => (ms == null ? '—' : `${num(ms / 1000, 1)} s`);

  async function loadChecks(force = false) {
    A.busy = true;
    $('#adRun').disabled = true;
    $('#adChecks').innerHTML = K.skelBox();
    const r = await api(`/api/admin/checks${force ? '?run=1' : ''}`).catch((e) => ({ ok: false, error: e.message }));
    A.busy = false;
    $('#adRun').disabled = false;
    A.checks = r.ok ? r : { error: r.error };
    renderChecks();
  }
  function renderChecks() {
    const c = A.checks;
    if (!c) return;
    if (c.error) return ($('#adChecks').innerHTML = emptyBox(`${t('error')}: ${c.error}`));
    $('#adChecksAt').textContent = fmt('adChecksAt', { t: ago(new Date(c.at).toISOString()) });
    $('#adChecks').innerHTML = `<table class="adt"><tbody>${c.rows
      .map((r) => `<tr><td>${esc(r.label)}</td><td><span class="st ${r.status}">${esc(t(`st_${r.status}`))}</span>${r.status === 'off' ? '' : `<div class="muted small">${esc(r.note || '')}</div>`}</td><td class="mono">${esc(secs(r.ms))}</td></tr>`)
      .join('')}</tbody></table>`;
  }

  async function loadOverview() {
    $('#adFarms').innerHTML = K.skelBox();
    const r = await api('/api/admin/overview').catch((e) => ({ ok: false, error: e.message }));
    A.overview = r.ok ? r : { error: r.error };
    renderOverview();
  }
  function renderOverview() {
    const o = A.overview;
    if (!o) return;
    if (o.error) return ($('#adFarms').innerHTML = emptyBox(`${t('error')}: ${o.error}`));
    $('#adFarmsN').textContent = fmt('adFarmsN', { n: num(o.farms.length), d: num(o.signedInToday) });
    $('#adFarms').innerHTML =
      (o.usersError ? `<p class="muted small">${esc(o.usersError)}</p>` : '') +
      `<table class="adt"><thead><tr><th>Email</th><th>${esc(t('fieldsH'))}</th><th>${esc(t('nMoney'))}</th><th></th><th></th></tr></thead><tbody>${o.farms
        .map(
          (f) =>
            `<tr><td>${esc(f.email)}${f.admin ? ` <span class="pill warn">${esc(t('adYou'))}</span>` : ''}</td><td>${esc(fmt('adPlaces', { l: num(f.lands), s: num(f.sheds) }))}</td><td>${esc(num(f.deals))}</td><td class="muted small">${esc(ago(f.lastActive))}</td><td>${f.admin ? '' : `<button class="btn ghost small-btn" type="button" data-viewfarm="${esc(f.id)}" data-email="${esc(f.email)}">${esc(t('adViewFarm'))}</button>`}</td></tr>`
        )
        .join('')}</tbody></table>`;
    const u = o.usage;
    $('#adUsage').innerHTML =
      `<table class="adt"><tbody>${['scan', 'check', 'ask', 'shops', 'demoCall']
        .map((k) => {
          const n = u.total[k] || 0;
          const top = u.top[k];
          const frac = top ? Math.min(1, top.n / u.limits[k]) : 0;
          return `<tr><td>${esc(t(`u_${k}`))}</td><td class="mono">${esc(num(n))}</td><td style="width:42%"><div class="adbar" title="${esc(top ? `${top.n}/${u.limits[k]}` : '')}"><i style="width:${Math.round(frac * 100)}%"></i></div></td></tr>`;
        })
        .join('')}</tbody></table>` +
      (() => {
        const best = Object.entries(u.top).sort((a, b) => b[1].n - a[1].n)[0];
        return best ? `<p class="muted small">${esc(fmt('adTop', { n: num(best[1].n), what: t(`u_${best[0]}`), email: best[1].email || '' }))}</p>` : '';
      })();
    $('#adDemoList').innerHTML = o.demoPlaces.length
      ? `<table class="adt"><tbody>${o.demoPlaces
          .map((l) => `<tr><td>${esc(K.landTitle(l))}</td><td><span class="pill warn">${esc(t('demoTag'))}</span></td><td>${esc(l.crop ? K.cropName(l.crop) : t('emptyQ'))}</td><td><button class="btn ghost small-btn" type="button" data-demoback="${esc(l.id)}">${esc(t('adBackToMine'))}</button></td></tr>`)
          .join('')}</tbody></table>`
      : emptyBox(t('adNoDemo'));
    $('#adMakeDemo').disabled = !S.cur || S.view || S.cur.location_source === 'demo';
  }

  $('#settings').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'adRun') return loadChecks(true);
    if (b.id === 'adOpenDemo') return K.enterView('demo');
    if (b.dataset.viewfarm) return K.enterView({ id: b.dataset.viewfarm, email: b.dataset.email });
    if (b.id === 'adMakeDemo') {
      if (!S.cur) return;
      if (!window.confirm(fmt('adMakeConfirm', { land: K.landTitle(S.cur) }))) return;
      const r = await postJson(`/api/admin/demo/${S.cur.id}`, { toDemo: true }).catch((err) => ({ ok: false, error: err.message }));
      if (!r.ok) return toast(`${t('error')}: ${r.error}`);
      await K.loadLands();
      S.cur = S.lands[0] || null;
      return loadOverview();
    }
    if (b.dataset.demoback) {
      const r = await postJson(`/api/admin/demo/${b.dataset.demoback}`, { toDemo: false }).catch((err) => ({ ok: false, error: err.message }));
      if (!r.ok) return toast(`${t('error')}: ${r.error}`);
      await K.loadLands();
      return loadOverview();
    }
  });

  function render() {
    if (!S.admin) return;
    if (!A.checks && !A.busy) loadChecks(false);
    else renderChecks();
    loadOverview();
  }
  window.KSAdmin = { render };
})();
