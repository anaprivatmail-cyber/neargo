// version: 2025-11-09-2

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Passthrough (network)
// Basic fetch passthrough
// Vedno uporabi network-first za JS/CSS/HTML, da dobimo najnovejse verzije
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const isHTML = req.destination === 'document' || url.pathname.endsWith('.html');
  const isAsset = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  if (isHTML || isAsset) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => fetch(req))
    );
    return;
  }
  // za ostalo ne spreminjamo
});

// In-app early notification: receive message and show system notification
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'EARLY_NOTIFY_PUSH' && data.offer) {
    const o = data.offer;
    const title = o.name || 'Nova ponudba';
    const body = 'Ekskluziven zgodnji dostop (' + (o.subcategory||'') + ')';
    try { self.registration.showNotification(title, { body, tag: 'early-'+o.id, data:{ offerId:o.id }, icon:'/assets/icons/bell.png' }); } catch {}
  }
});

self.addEventListener('notificationclick', (event) => {
  const offerId = event.notification?.data?.offerId;
  event.notification.close();
  if (offerId) {
    const url = '/offer.html?id=' + encodeURIComponent(offerId);
    event.waitUntil(
      clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
        for (const c of list){ if (c.url.includes('/offer.html')) { c.focus(); c.postMessage({ type:'FOCUS_OFFER', offerId }); return; } }
        if (clients.openWindow) return clients.openWindow(url);
      })
    );
  }
});
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Passthrough (network)
// duplikat iz starega bloka odstranimo
