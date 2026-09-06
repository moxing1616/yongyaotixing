// Health data and authenticated API responses are deliberately never cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Fall back to a private generic message. */ }
  event.waitUntil(self.registration.showNotification(data.title || '服药提醒智能体', {
    body: data.body || '你有一条新的提醒，请打开应用查看。',
    icon: '/icon-192.png', badge: '/icon-192.png',
    tag: data.tag || 'medication-reminder',
    data: { url: '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(item => new URL(item.url).origin === self.location.origin);
    if (client) return client.focus();
    return self.clients.openWindow('/');
  }));
});
