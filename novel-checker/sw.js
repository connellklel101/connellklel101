// Lets the site open and work offline after the first visit.
const CACHE = 'novel-checker-v2';
const FILES = [
  './', 'index.html', 'css/styles.css', 'js/app.js', 'js/importers.js', 'js/storage.js', 'js/languagetool.js', 'js/annotate.js', 'js/docx-export.js',
  'engine/analyzer.js', 'engine/worker.js', 'vendor/nspell.js', 'vendor/mammoth.browser.min.js', 'vendor/jszip.min.js',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'dict/en-US.aff', 'dict/en-US.dic', 'dict/en-GB.aff', 'dict/en-GB.dic',
  'samples/salt-and-lantern.txt', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so updates arrive; fall back to the cache when offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
