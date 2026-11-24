// Deliberately minimal: it caches nothing and answers nothing itself.
// Having a worker makes the app installable, which is what lets it appear in the phone's share sheet.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
