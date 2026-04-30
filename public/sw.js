const CACHE_NAME = 'smartscan-v1';
const STATIC_ASSETS = ['/', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return; // never cache API
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Push notifications
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  const title = data.title || 'R.E.A.L. SmartScan';
  const options = {
    body: data.body || 'Price alert!',
    icon: '/favicon.png',
    badge: '/favicon.png',
    data: { url: data.url || '/' },
    actions: [
      { action: 'view', title: 'View Deal' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'view' || !e.action) {
    const url = e.notification.data?.url || '/';
    e.waitUntil(clients.openWindow(url));
  }
});
