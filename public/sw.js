// Khet Sathi service worker (v0.17.0): makes the app installable and lets the app frame open without internet.
// Always the network first, so a new release is never hidden behind an old copy; the saved copy is used only
// when the phone is offline. Server answers (/api/...) are never saved: farm data always comes live.
const CACHE = 'ks-shell-v0.24.1';
const SHELL = ['/', '/home', '/next/ks.css', '/next/ks-real.css', '/next/landing.css', '/i18n.js', '/next/ks-icons.js', '/next/ks-text.js', '/next/ks.js', '/next/ks-shed.js', '/next/ks-harvest.js', '/next/ks-admin.js', '/next/ks-yard.js', '/next/ks-problem.js', '/next/ks-install.js', '/next/ks-report.js', '/next/ks-tour.js', '/next/ks-fieldcam.js', '/next/ks-watch.js', '/next/ks-guide.js', '/next/ks-agent.js', '/icons/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => null));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (SHELL.includes(url.pathname) || req.mode === 'navigate')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/home' : req, copy)).catch(() => null);
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/home') : Response.error())))
  );
});
