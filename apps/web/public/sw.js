// Service worker for time-keeper PWA.
// Handles incoming push events, routes notification clicks back into the app,
// and stages POST /share-receive payloads (PWA share_target) for the SPA.

const SHARE_DB = 'time-keeper-share';
const SHARE_STORE = 'pending';

self.addEventListener('install', (event) => {
  // Activate immediately so the app's first load is push-capable.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function openShareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SHARE_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function stagePendingShare(payload) {
  const db = await openShareDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    tx.objectStore(SHARE_STORE).put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-receive') return;

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData();
        const id = `share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const payload = {
          id,
          title: formData.get('title') || '',
          text: formData.get('text') || '',
          url: formData.get('url') || '',
          stagedAt: new Date().toISOString(),
        };
        await stagePendingShare(payload);
        return Response.redirect(`/share-receive?id=${encodeURIComponent(id)}`, 303);
      } catch (err) {
        return new Response(`Share staging failed: ${err.message}`, { status: 500 });
      }
    })()
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'Time-keeper', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Time-keeper';
  const options = {
    body: data.body || '',
    data: {
      url: data.url || '/today',
      notificationId: data.notificationId,
      kind: data.kind,
    },
    badge: '/favicon.svg',
    icon: '/favicon.svg',
    tag: data.notificationId, // collapses repeats with same id
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/today';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an existing tab if one is open
      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(url);
            } catch {
              // ignore
            }
          }
          return;
        }
      }
      // Otherwise open a new tab
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })()
  );
});
