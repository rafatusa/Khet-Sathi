// v0.21.0: the app made easy for browser agents (Meta's Muse, Groq bots, any other) and screen readers.
// Nothing here changes what the farmer sees. Every popup is a named dialog that says when it opens and closes,
// Escape closes it, every button gets a fixed data-action name that does not change with the language, and
// waiting messages are status messages an agent can wait on. The steps for agents are at /for-agents.
(() => {
  const K = window.KS;
  if (!K) return;
  const { t } = K;
  const say = (msg) => {
    const el = document.getElementById('agentSay');
    if (!el) return;
    el.textContent = '';
    setTimeout(() => (el.textContent = msg), 30);
  };
  const shown = (el) => el && !el.hidden && el.offsetParent !== null;

  // ---------- popups (the .sheet elements) as dialogs ----------
  const titleOf = (s) => {
    const h = [...s.querySelectorAll('h2,h3,#callName')].find((e) => shown(e) && e.textContent.trim());
    // A popup whose title is filled in when it opens has a fallback name (data-name, a text key).
    return h ? h.textContent.trim() : s.dataset.name ? t(s.dataset.name) : '';
  };
  const closeOf = (s) => s.querySelector('.shtop .iconbtn') || s.querySelector('[id$="Close"]') || s.querySelector('#callEnd');
  function label(s) {
    const name = titleOf(s);
    if (name) s.setAttribute('aria-label', name);
    const c = closeOf(s);
    if (c && c.id !== 'callEnd') c.setAttribute('aria-label', name ? `${t('agClose')}: ${name}` : t('agClose'));
  }
  let lastFocus = null;
  function changed(s) {
    const open = !s.hidden;
    if ((s.dataset.state === 'open') === open) return;
    s.dataset.state = open ? 'open' : 'closed';
    label(s);
    say(`${t(open ? 'agOpened' : 'agClosed')}: ${s.getAttribute('aria-label') || ''}`);
    if (open) {
      lastFocus = document.activeElement;
      setTimeout(() => {
        if (!s.hidden && !s.contains(document.activeElement)) s.focus({ preventScroll: true });
      }, 40);
    } else if (lastFocus && document.contains(lastFocus) && shown(lastFocus)) {
      lastFocus.focus({ preventScroll: true });
    }
  }
  function prepSheet(s) {
    if (s.dataset.agent) return;
    s.dataset.agent = '1';
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-modal', 'true');
    s.tabIndex = -1;
    s.dataset.state = s.hidden ? 'closed' : 'open';
    label(s);
    new MutationObserver(() => changed(s)).observe(s, { attributes: true, attributeFilter: ['hidden'] });
    // Steps inside a popup change its heading (the crop problem's four steps): keep the name current.
    let pending = 0;
    new MutationObserver(() => {
      if (s.hidden || pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        label(s);
      });
    }).observe(s, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.sheet')].filter((s) => !s.hidden);
    const top = open[open.length - 1];
    const c = top && closeOf(top);
    if (c && !c.disabled && c.id !== 'callEnd') {
      e.preventDefault();
      c.click();
    }
  });

  // ---------- fixed action names ----------
  // data-action never changes with the language: the button's id, else its first data-* setting ("book:tractor"),
  // else its text key. /for-agents lists the main ones.
  function actionOf(b) {
    if (b.id) return b.id;
    for (const a of b.attributes) {
      if (!a.name.startsWith('data-') || ['data-action', 'data-t', 'data-tl', 'data-tp', 'data-icon', 'data-agent', 'data-state'].includes(a.name)) continue;
      const k = a.name.slice(5);
      return a.value ? `${k}:${a.value}` : k;
    }
    const tk = b.dataset.t || b.querySelector('[data-t]')?.dataset.t;
    if (tk) return tk;
    return b.tagName === 'A' && b.getAttribute('href') ? `link:${b.getAttribute('href')}` : null;
  }
  // Waiting messages ("Measuring…", "Finding…") become status messages.
  function prepBusy(el) {
    if (el.getAttribute('role')) return;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
  }
  function sweep(root = document) {
    root.querySelectorAll?.('.sheet').forEach(prepSheet);
    root.querySelectorAll?.('button:not([data-action]),[role="button"]:not([data-action]),a[href]:not([data-action])').forEach((b) => {
      const a = actionOf(b);
      if (a) b.dataset.action = a;
    });
    root.querySelectorAll?.('.maploading,.loading,.skel').forEach(prepBusy);
    // A very short button inside a popup ("OK") also says which popup it belongs to.
    root.querySelectorAll?.('.sheet button').forEach((b) => {
      if (b.closest('.stepper,.shtop,.lang') || b.getAttribute('aria-label') && !b.dataset.agentShort) return;
      const txt = b.textContent.trim();
      const dlg = b.closest('.sheet')?.getAttribute('aria-label');
      if (txt && txt.length <= 3 && dlg) {
        b.setAttribute('aria-label', `${txt}: ${dlg}`);
        b.dataset.agentShort = '1';
      }
    });
    // −/+ steppers are named after the setting they change: "Less: Sell when the price is at least".
    root.querySelectorAll?.('.stepper button').forEach((b) => {
      const box = b.closest('.ruleopt') || b.closest('.stepper')?.parentElement;
      const what = box?.querySelector('label span, :scope > span, .stepper > span')?.textContent.trim();
      const word = t(b.textContent.trim() === '+' ? 'agMore' : 'agLess');
      const want = what ? `${word}: ${what}` : word;
      if (b.getAttribute('aria-label') !== want && (b.dataset.agentName || !b.getAttribute('aria-label'))) {
        b.setAttribute('aria-label', want);
        b.dataset.agentName = '1';
      }
    });
  }
  let queued = 0;
  new MutationObserver(() => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      sweep();
    });
  }).observe(document.body, { subtree: true, childList: true });
  sweep();

  // ---------- the brand name in the header acts like the logo link ----------
  document.querySelectorAll('.brand[role="link"]').forEach((b) =>
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        b.click();
      }
    })
  );

  // Labels follow the language: relabel open popups when the language buttons are pressed.
  document.querySelectorAll('.lang [data-lang]').forEach((b) =>
    b.addEventListener('click', () => setTimeout(() => document.querySelectorAll('.sheet').forEach(label), 60))
  );
})();
