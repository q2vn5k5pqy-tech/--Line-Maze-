const CACHE_NAME = 'wire-dungeon-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './data/rules.json',
  './data/player.json',
  './data/floors.json',
  './data/entities.json',
  './data/enemies.json',
  './data/items.json',
  './data/weapons.json',
  './data/facilities.json',
  './data/i18n/ja.json',
  './data/i18n/en.json',
  './data/maps/f1.json',
  './data/maps/f2.json',
  './data/maps/f3.json',
  './data/maps/f4.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME) ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try{
      const res = await fetch(req);
      // only cache GET same-origin
      if (req.method === 'GET' && new URL(req.url).origin === location.origin) {
        cache.put(req, res.clone());
      }
      return res;
    }catch(e){
      // offline fallback: try index
      const fallback = await cache.match('./index.html');
      return fallback || new Response('Offline', { status: 200, headers: { 'Content-Type': 'text/plain' }});
    }
  })());
});
