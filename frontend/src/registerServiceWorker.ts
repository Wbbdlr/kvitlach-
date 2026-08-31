import { APP_VERSION } from "./version";

// Registers public/sw.js, which is what makes the site installable to a phone
// home screen (see the note in index.html: on iOS an installed web app is the
// only way to get a chrome-free full-screen table).
//
// Dev is deliberately excluded. A worker registered from `npm run dev` outlives
// the dev server on the same origin and then serves cached bundles into later
// sessions, which is a genuinely confusing way to lose an afternoon.
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`/sw.js?v=${APP_VERSION}`, {
        // The version query only changes the URL on a release; `updateViaCache:
        // "none"` is what guarantees the worker script itself is revalidated
        // against the network every time, since nginx sets no Cache-Control on
        // it and a heuristically cached sw.js can pin players to an old worker.
        updateViaCache: "none",
      })
      .catch((err) => {
        // Installability is a nicety; never let it break the app that loaded.
        console.warn("Service worker registration failed", err);
      });
  });
}
