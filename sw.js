/* FORMA — service worker: приложение открывается без интернета.
   Файлы приложения: сначала сеть (чтобы обновления приходили сразу), без сети — из кэша.
   Библиотеки и шрифты с CDN: из кэша. Запросы к базе (Supabase) не кэшируются. */
const CACHE = 'forma-v24';
const CORE = ['./', 'index.html', 'privacy.html', 'manifest.webmanifest', 'css/app.css', 'js/data.js', 'js/core.js', 'js/charts.js', 'js/pages-a.js', 'js/pages-b.js', 'js/pages-c.js', 'js/steps.js', 'js/discipline.js', 'js/account.js', 'js/main.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'data/foods-off.json'];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  } else if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
  }
});
