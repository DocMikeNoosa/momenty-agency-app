// Offline support: the whole app is cached so it opens without a connection.
const VERSION = 'momenty-v1.0.0';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/auth.js', 'js/ui.js', 'js/model.js', 'js/router.js', 'js/components.js', 'js/letters.js', 'js/version.js',
  'js/views/today.js', 'js/views/projects.js', 'js/views/contacts.js', 'js/views/files.js', 'js/views/assistant.js', 'js/views/settings.js',
  'assets/icons/logo-white.png', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/apple-touch-icon.png', 'assets/icons/favicon-64.png',
  'assets/fonts/inter-latin-400-normal.woff2', 'assets/fonts/inter-latin-ext-400-normal.woff2',
  'assets/fonts/inter-latin-500-normal.woff2', 'assets/fonts/inter-latin-ext-500-normal.woff2',
  'assets/fonts/inter-latin-600-normal.woff2', 'assets/fonts/inter-latin-ext-600-normal.woff2',
  'assets/fonts/inter-latin-700-normal.woff2', 'assets/fonts/inter-latin-ext-700-normal.woff2',
  'assets/fonts/michroma-latin-400-normal.woff2', 'assets/fonts/michroma-latin-ext-400-normal.woff2',
  'assets/fonts/cormorant-garamond-latin-500-normal.woff2', 'assets/fonts/cormorant-garamond-latin-ext-500-normal.woff2',
  'assets/fonts/cormorant-garamond-latin-500-italic.woff2', 'assets/fonts/cormorant-garamond-latin-ext-500-italic.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// Cache first: the app opens instantly even with weak signal. New versions arrive by bumping VERSION
// (the app then shows "Odśwież").
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
