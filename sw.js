/**
 * Service worker: permite jugar sin conexión tras la primera visita y acelera las cargas.
 * Estrategia: precarga del núcleo + "stale-while-revalidate" para el resto de recursos propios.
 * Cambiar VERSION al publicar fuerza la renovación de la caché.
 */
const VERSION = 'rcfs-v6';
const CORE = ['./', './index.html', './manifest.webmanifest', './styles/main.css', './styles/menus.css', './styles/hud.css', './styles/controls.css',
  './vendor/three/three.module.js', './vendor/three/three.core.js', './src/main.js', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fuentes externas: red normal
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
