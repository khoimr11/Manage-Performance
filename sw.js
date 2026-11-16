// LF Command Center service worker: makes the site installable in Chrome ("Cài app") and opens offline.
// Network first for everything (so updates and data are always fresh); the cached copy is only used offline.
// Data files, the GitHub API and other dashboards are never cached here.
const CACHE = 'b2c-v4';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'assets/styles.css?v=3', 'assets/cc.css?v=4', 'assets/config.js?v=3', 'assets/store.js?v=2', 'assets/playbook.js?v=1', 'assets/engine.js?v=4', 'assets/demo.js?v=1', 'assets/sheet.js?v=1', 'assets/collab.js?v=1', 'assets/app.js?v=4', 'assets/logo.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/favicon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url), scope = new URL(self.registration.scope);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith(scope.pathname) || u.pathname.includes('/data/')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
