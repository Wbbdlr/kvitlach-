import { useCallback, useSyncExternalStore } from "react";

// Install-to-home-screen plumbing.
//
// `beforeinstallprompt` fires once, early, and often BEFORE React has mounted.
// Miss it and there is no way to ask for it again -- the browser will not
// re-fire it for the rest of the page's life. So the listener is registered at
// module scope, on import, and the event is parked here for whatever component
// eventually wants it. That is also why this is a module-level store rather
// than component state.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | undefined;
const subscribers = new Set<() => void>();

function emit() {
  for (const fn of subscribers) fn();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Without preventDefault() Chrome shows its own mini-infobar, which on a
    // phone covers the bottom of the lobby -- including the Join button.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = undefined;
    emit();
  });
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Registers the no-op service worker that makes the site installable at all.
 * See public/sw.js -- it caches nothing, deliberately.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Registration competes with the first render and with the WS connect for
  // the same main thread; nothing here is needed in the first seconds of a
  // visit, so it waits for load.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* http origins, private modes and locked-down browsers all refuse this;
         the only casualty is the install prompt, so there is nothing to say */
    });
  });
}

export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(
    subscribe,
    () => deferredPrompt !== undefined,
    () => false
  );

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    const event = deferredPrompt;
    if (!event) return "unavailable";
    // One shot per event: the browser will not accept a second prompt() call
    // on the same event, so it is cleared before awaiting the choice rather
    // than after, in case the user double-taps.
    deferredPrompt = undefined;
    emit();
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      return outcome;
    } catch {
      return "unavailable";
    }
  }, []);

  return { canInstall, promptInstall };
}
