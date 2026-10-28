// Khet Sathi v0.17.0: install on the phone. Android and Chrome offer their own install prompt, which the card
// opens; on iPhone there is no prompt, so the card shows the Share, then "Add to Home Screen" steps. The card
// shows once per phone (after sign-in, on Home), never on a computer and never when already installed.
(() => {
  'use strict';
  const K = window.KS;
  if (!K) return;
  const { $, t, store } = K;
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => null));
  let deferred = null;
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const phone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  const iphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const seen = () => store.get('ks_install_seen') === '1';
  function maybeShow() {
    if (seen() || installed() || !phone() || document.body.dataset.auth !== 'in' || K.S.tab !== 'home') return;
    if (!deferred && !iphone()) return;
    $('#installT').textContent = t(iphone() && !deferred ? 'instIos' : 'instT');
    $('#installGo').hidden = !deferred;
    $('#installCard').hidden = false;
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    maybeShow();
  });
  window.addEventListener('appinstalled', () => {
    store.set('ks_install_seen', '1');
    $('#installCard').hidden = true;
  });
  $('#installLater').addEventListener('click', () => {
    store.set('ks_install_seen', '1');
    $('#installCard').hidden = true;
  });
  $('#installGo').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    store.set('ks_install_seen', '1');
    $('#installCard').hidden = true;
  });
  // After sign-in the app settles on a tab; check a little later.
  setTimeout(maybeShow, 6000);
  window.KSInstall = { maybeShow };
})();
