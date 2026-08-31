// Service worker for the installed (home-screen) app.
//
// Deliberately NOT an offline-play cache. Every hand of Kvitlach is decided by
// the server over the WebSocket (see backend/src/store.ts) -- there is no
// client-authoritative mode to fall back on, practice rooms included. So this
// worker exists to (a) satisfy the installability criteria, (b) make repeat
// launches of the installed app instant, and (c) show a real page instead of
// the browser's dinosaur when a player's phone drops off the network
// mid-table. It never pretends a table is playable offline.
//
// Bump CACHE_VERSION whenever the caching rules below change. Hashed /assets/
// filenames make stale code impossible, so a bump is only needed for the
// worker's own logic or the precached shell -- not for every deploy.
const CACHE_VERSION = "kvitlach-v1";
const OFFLINE_URL = "/offline.html";

// The bare minimum to render something useful with no network.
const PRECACHE = [OFFLINE_URL, "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Vite emits content-hashed filenames here, so a hit can never be stale.
const isImmutableAsset = (url) => url.pathname.startsWith("/assets/");

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match(OFFLINE_URL);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    cache.put(request, response.clone());
  }
  return response;
}

// Serve the cached copy immediately, refresh it in the background. Used for
// fonts/images/sounds, which are unhashed in public/ and change rarely.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch the WS host or anything else

  if (request.mode === "navigate") {
    // Network-first: a player opening a room link must get the live app, and
    // index.html is unhashed, so a cache-first shell would pin them to an old
    // build until the cache turned over.
    event.respondWith(networkFirst(request));
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
