// Cachea la interfaz para poder abrirla sin red. Nunca guarda API, fotos ni el socket.
const CACHE = 'hivex-oficina-v3';
self.addEventListener('install', (e) => {
  const paths = ['./', './index.html', './manifest.webmanifest'];
  e.waitUntil(caches.open(CACHE).then((cache) => Promise.all(paths.map((path) =>
    fetch(new Request(path, { credentials: 'include' })).then((res) => (res.ok ? cache.put(path, res) : undefined)),
  ))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads') || url.pathname.startsWith('/socket.io')) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request, { credentials: 'include' }).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
