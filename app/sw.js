/* SAMURAI companion service worker: the app shell (html, css, js, fonts, vendor, icons) is cached so the phone page opens
   instantly and keeps working on a flaky Wi-Fi; every request to a sidecar port (anything not on this origin) goes to the
   network untouched. Registered only by the companion page (?companion=1). */
const SHELL = 'samurai-shell-v1';
const PRECACHE = ['jarvis-interface.html', 'css/hud.css', 'js/hud-core.js', 'js/hud-voice.js', 'js/hud-brain.js', 'js/hud-widgets.js', 'js/hud.js', 'js/hud-fx.js', 'js/hud-3d.js',
  'fonts/fonts.css', 'vendor/three/three.module.js', 'vendor/three/three.core.js', 'companion.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.allSettled(PRECACHE.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;          // sidecars (other ports) and POSTs: network only
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const fetched = fetch(e.request).then(r => { if (r.ok) caches.open(SHELL).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || fetched;                                                                   // cache first, refreshed in the background
  }));
});
