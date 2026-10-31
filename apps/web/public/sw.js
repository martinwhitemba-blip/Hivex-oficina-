// La interfaz se puede abrir sin red. API, fotos y socket no se guardan.
// HTML y JS se piden primero a la red para que un despliegue nuevo no se quede en un bundle viejo.
const CACHE = 'hivex-oficina-v5';
self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads') || url.pathname.startsWith('/socket.io')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { credentials: 'include' });
        const type = res.headers.get('content-type') || '';
        if (res.ok && type.includes('text/html')) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./', copy)).catch(() => {});
          return res;
        }
        const cached = await caches.match('./') || await caches.match('./index.html');
        return cached || res;
      } catch {
        return (await caches.match('./')) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
  const fresh = fetch(e.request, { credentials: 'include' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(e.request, copy)).catch(() => {});
    }
    return res;
  });
  e.respondWith(fresh.catch(() => caches.match(e.request).then((hit) => hit || Response.error())));
});
