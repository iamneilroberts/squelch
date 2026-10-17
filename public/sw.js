// Service worker: shows push notifications and opens the receiver when one is tapped.
// It doesn't cache or intercept anything else.
self.addEventListener('install', () => self.skipWaiting()); // an open Home Screen app never closes, so don't wait for it to

self.addEventListener('push', (e) => {
  const d = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(d.title || 'Squelch', {
    body: d.body,
    tag: d.tag, // a newer notification about the same story replaces the older one
    renotify: Boolean(d.tag),
    icon: '/icon-192.png',
    data: { url: d.url || '/', n: d.n },
    // Without opening (Android, desktop; Chrome shows two at most). iPhone shows no action buttons: tapping opens the
    // story, whose card has Pause and More / Fewer.
    actions: d.n ? [{ action: 'snooze', title: 'Snooze 1 h' }, { action: 'fewer', title: 'Fewer like this' }] : [],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'snooze') {
    e.waitUntil(self.registration.pushManager.getSubscription().then((sub) => fetch('/api/notify/snooze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub?.endpoint, for: '1h' }),
    })));
    return;
  }
  if (e.action === 'more' || e.action === 'fewer') {
    e.waitUntil(self.registration.pushManager.getSubscription().then((sub) => fetch('/api/notify/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: e.notification.data?.n, endpoint: sub?.endpoint, feedback: e.action === 'more' ? 1 : -1 }),
    })));
    return;
  }
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((c) => new URL(c.url).origin === self.location.origin);
    // A Studio notification (the manual) never takes over the receiver page, which may be playing audio: it uses a manual window already open, or a new one.
    if (new URL(url).pathname === '/manual.html') {
      const manual = all.find((c) => new URL(c.url).pathname === '/manual.html');
      return manual ? manual.navigate(url).then((c) => (c || manual).focus(), () => self.clients.openWindow(url)) : self.clients.openWindow(url);
    }
    const open = all[0];
    // iPhone brings a running Home Screen app forward without loading the new URL, so the open page is
    // told which story to show instead (app.js listens for this).
    if (open && url.startsWith(self.location.origin)) { // another site (a GitHub issue) opens in its own window
      open.postMessage({ open: url });
      return open.focus().catch(() => {});
    }
    return self.clients.openWindow(url);
  })());
});
