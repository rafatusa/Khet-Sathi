// v0.21.0: the Guide. How the app works, in Bangla, Hindi and English, for farmers, judges and AI agents.
// Steps name the real buttons through their text keys ({pbTake} becomes the button's own words in the app
// language), so the Guide never drifts from what is on screen. The same steps for agents are at /for-agents.
(() => {
  const K = window.KS;
  if (!K) return;
  const { $, t, esc, S } = K;
  const fill = (s, bold) => esc(s).replace(/\{([a-zA-Z0-9]+)\}/g, (_, k) => (bold ? `<b>${esc(t(k))}</b>` : esc(t(k))));
  const CARDS = [1, 2, 3, 4, 5, 6];
  const STEPS = [1, 2, 3, 4, 5, 6, 7];

  function render() {
    const el = $('#guideBody');
    if (!el) return;
    const open = new Set([...el.querySelectorAll('details[open]')].map((d) => d.dataset.step));
    if (!open.size && !el.dataset.done) open.add('1');
    el.dataset.done = '1';
    el.innerHTML = `
      <div class="gd-hero">
        <div><h1>${esc(t('gdH'))}</h1><p>${esc(t('gdLead'))}</p></div>
        <div class="btns"><button class="btn" type="button" id="gdTour">${esc(t('tourMenu'))}</button><button class="btn ghost" type="button" id="gdAsk">${esc(t('askL'))}</button></div>
      </div>
      <h2 class="gd-sec">${esc(t('gdWhatH'))}</h2>
      <div class="gd-grid">${CARDS.map((i) => `<div class="gd-card"><h3>${esc(t(`gdC${i}H`))}</h3><p>${esc(t(`gdC${i}T`))}</p><span class="m">${fill(t(`gdC${i}M`), false)}</span></div>`).join('')}</div>
      <h2 class="gd-sec">${esc(t('gdStepsH'))}</h2>
      <div class="gd-steps">${STEPS.map((i) => `<details data-step="${i}"${open.has(String(i)) ? ' open' : ''}><summary>${esc(t(`gdS${i}H`))}</summary><ol>${t(`gdS${i}`).split('|').map((s) => `<li>${fill(s.trim(), true)}</li>`).join('')}</ol></details>`).join('')}</div>
      <h2 class="gd-sec">${esc(t('gdRealH'))}</h2>
      <div class="gd-two">
        <div class="gd-card gd-real"><h3>${esc(t('gdReal'))}</h3><p>${esc(t('gdRealT'))}</p></div>
        <div class="gd-card gd-demo"><h3>${esc(t('gdDemo'))}</h3><p>${esc(t('gdDemoT'))}</p></div>
      </div>
      <p class="gd-note">${esc(t('gdNever'))}</p>
      <p class="gd-note">${esc(t('gdAgents'))} <a href="/for-agents" target="_blank" rel="noopener">/for-agents</a></p>`;
    $('#gdTour').addEventListener('click', () => window.KSTour?.start());
    $('#gdAsk').addEventListener('click', () => K.show('saathi'));
  }

  $('#guideBtn')?.addEventListener('click', () => K.show('guide'));
  $('#meGuide')?.addEventListener('click', () => {
    $('#meMenu').hidden = true;
    K.show('guide');
  });
  // The Guide follows the language buttons.
  document.querySelectorAll('.lang [data-lang]').forEach((b) => b.addEventListener('click', () => setTimeout(() => S.tab === 'guide' && render(), 0)));

  window.KSGuide = { render };
})();
