// Service worker: shows push notifications and opens the receiver when one is tapped.
// It doesn't cache or intercept anything else.
self.addEventListener('push', (e) => {
  const d = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(d.title || 'Squelch', {
    body: d.body,
    tag: d.tag, // a newer notification about the same story replaces the older one
    renotify: Boolean(d.tag),
    icon: '/icon-192.png',
    data: { url: d.url || '/', n: d.n },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const open = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).find((c) => new URL(c.url).origin === self.location.origin);
    if (open) {
      try { return await (await open.navigate(url))?.focus(); } catch { /* not controlled by this worker: open a new one */ }
    }
    return self.clients.openWindow(url);
  })());
});
