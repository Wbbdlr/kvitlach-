// Minimal service worker. Its ONLY job is to make the site installable: Chrome
// and Edge refuse to fire `beforeinstallprompt` for a site with no service
// worker that has a fetch handler.
//
// It deliberately caches NOTHING. Kvitlach is a real-time game whose entire
// state arrives over a WebSocket, so there is no offline experience worth
// building, and a caching worker here would be actively harmful: deploys are
// manual and testers identify their build from the footer version badge, so a
// worker serving yesterday's bundle would have people reporting bugs against
// a build they are not running. The fetch handler below returns without
// calling respondWith(), which lets every request fall through to the network
// exactly as if no worker existed.
//
// If this ever needs removing: an installed worker survives deleting this
// file. Ship a version that calls self.registration.unregister() first, let it
// reach everyone, and only then delete it.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  /* pass through to the network -- see above, this must stay a no-op */
});
