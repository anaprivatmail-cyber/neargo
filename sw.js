// version: 2025-11-09-2

const VERSION = '2025-11-09-2';

// Always take control ASAP
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Clear any old runtime caches (we don't use caching currently)
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      await self.clients.claim();
      // Broadcast current version to clients so they can decide to reload
      try {
        const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
        for (const c of all) c.postMessage({ type: 'SW_VERSION', version: VERSION });
      } catch {}
    })()
  );
});

// Network passthrough – rely on HTTP caching headers
self.addEventListener('fetch', () => { /* no-op */ });

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
