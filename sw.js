'use strict';
// Service worker Benteng Fajar: menyimpan berkas game yang pernah dimuat, supaya permainan lawan AI tetap bisa dibuka
// tanpa internet (dan supaya game bisa dipasang sebagai aplikasi).
//   - Daring: selalu mengambil dari jaringan (server menjawab 304 bila berkas belum berubah) dan memperbarui simpanan.
//   - Luring: memakai simpanan terakhir.
// WebSocket multiplayer dan /healthz tidak lewat sini.
const CACHE = 'benteng-fajar-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/healthz' || url.pathname === '/ws') return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) {
        // simpan hanya bila isinya berubah (ETag berbeda), supaya tiap pembukaan tidak menulis ulang seluruh aset
        const old = await cache.match(req);
        if (!old || old.headers.get('ETag') !== res.headers.get('ETag')) await cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match(new URL('./', self.location).href) : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
