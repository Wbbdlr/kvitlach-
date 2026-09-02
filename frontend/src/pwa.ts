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

// ---------------------------------------------------------------------------
// "Ask once, then leave it alone for a while."
//
// Both install nudges (the lobby banner in InstallPrompt.tsx and the in-table
// iOS hint in TableRoot.tsx) used to write a flat "1" on dismissal, which
// silenced them FOREVER. One "not now" on the day someone first opened the
// site meant they were never offered it again -- including the people who
// tapped it to get the banner out of the way mid-join and would happily have
// installed it a week later. Browsers themselves work the way the nudge should
// have: Chrome re-offers a dismissed install on a later visit rather than
// treating one decline as permanent.
//
// So a dismissal is a snooze with a backoff, not a tombstone. Each "not now"
// pushes the next ask further out, and after the fourth the answer is taken as
// final -- somebody who has declined four times over two months has answered.

const SNOOZE_DAYS = [7, 30, 90];
const DAY_MS = 24 * 60 * 60 * 1000;

interface NudgeState {
  at: number; // when it was last dismissed
  n: number; // how many times
}

function read(key: string): NudgeState | undefined {
  if (typeof window === "undefined" || !window.localStorage) return { at: Date.now(), n: 99 };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // Private mode and "block site data" both throw. Showing the nudge is the
    // safe failure: it is dismissible, it just will not stay dismissed.
    return undefined;
  }
  if (!raw) return undefined;
  // "1" is what every build before this wrote. Migrated as a dismissal that
  // happened NOW rather than one that happened at the epoch: the alternative
  // re-asks every existing player the moment they load this build, which is
  // the nagging this whole change exists to avoid.
  if (raw === "1") {
    const migrated = { at: Date.now(), n: 1 };
    write(key, migrated);
    return migrated;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<NudgeState>;
    if (typeof parsed?.at !== "number" || typeof parsed?.n !== "number") return undefined;
    return { at: parsed.at, n: parsed.n };
  } catch {
    return undefined;
  }
}

function write(key: string, state: NudgeState): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* ignore -- reappears next visit, not worth failing over */
  }
}

/** Whether an install nudge stored under `key` is allowed to show right now. */
export function installNudgeDue(key: string, now = Date.now()): boolean {
  const state = read(key);
  if (!state) return true;
  if (state.n > SNOOZE_DAYS.length) return false; // asked and answered
  const wait = SNOOZE_DAYS[Math.min(state.n, SNOOZE_DAYS.length) - 1] ?? SNOOZE_DAYS[0];
  return now - state.at >= wait * DAY_MS;
}

/** Records a "not now": silences the nudge for a while, longer each time. */
export function snoozeInstallNudge(key: string, now = Date.now()): void {
  const previous = read(key)?.n ?? 0;
  write(key, { at: now, n: previous + 1 });
}

/** Records an outcome there is no coming back from -- they installed it. */
export function silenceInstallNudge(key: string): void {
  write(key, { at: Date.now(), n: SNOOZE_DAYS.length + 1 });
}
