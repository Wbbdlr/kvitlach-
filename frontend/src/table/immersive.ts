import { isStandaloneDisplay } from "./platform";

// Turning a phone landscape and going fullscreen when someone enters a table.
//
// Testers kept landing on the felt in portrait, seeing a squeezed table, and
// not working out on their own that they were meant to rotate. The .k-rotate-hint
// banner tells them, but a banner someone has to read and act on is a step
// most people skip.
//
// fullscreen.ts's comment says there is no way to enter fullscreen
// automatically, and that is true of the case it was written for -- you cannot
// do it from an `orientationchange` handler, because that is not a user
// gesture. Entering a table IS one: it is a tap on Join / Create / Play. So
// these run from those handlers rather than from an effect, and everything
// here has to stay callable synchronously inside a click.
//
// Deliberately best-effort throughout. Every one of these calls is refused by
// some real browser, and a refusal is not an error worth showing anybody --
// the rotate hint is still there underneath as the fallback it always was.

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

function orientationApi(): LockableOrientation | undefined {
  if (typeof screen === "undefined") return undefined;
  return screen.orientation as LockableOrientation | undefined;
}

// Only phones. Rotating a desktop browser is meaningless, and yanking someone
// on a laptop into fullscreen because they clicked Join would be obnoxious.
//
// Pointer coarseness alone is not enough -- touchscreen laptops and TVs match
// it too. The size bound is what actually means "phone", and it is measured on
// the SHORT edge because the device may already be held landscape, in which
// case screen.width is the long one.
export function isHandheld(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  if (!window.matchMedia("(pointer: coarse)").matches) return false;
  const w = window.screen?.width ?? 0;
  const h = window.screen?.height ?? 0;
  const shortEdge = Math.min(w, h);
  return shortEdge > 0 && shortEdge <= 820;
}

/**
 * Take the table fullscreen and lock it landscape. MUST be called
 * synchronously from a user gesture -- the promise can settle later, but the
 * `requestFullscreen()` call itself has to happen inside the handler or the
 * browser refuses it.
 */
export function enterImmersive(): void {
  if (typeof document === "undefined" || !isHandheld()) return;

  const lockLandscape = () => {
    void orientationApi()?.lock?.("landscape").catch(() => {});
  };

  // An installed web app has no browser chrome to escape, and its orientation
  // can be locked without a fullscreen element -- asking for fullscreen there
  // buys nothing and on some engines throws.
  if (isStandaloneDisplay()) {
    lockLandscape();
    return;
  }

  const el = document.documentElement;
  // iOS Safari implements the Fullscreen API for <video> only, so this is the
  // branch every iPhone takes. Those visitors keep the rotate hint and the
  // add-to-home-screen nudge; there is nothing else available to them.
  if (!el.requestFullscreen || document.fullscreenEnabled === false) return;

  if (document.fullscreenElement) {
    lockLandscape();
    return;
  }
  // The lock is chained onto the fullscreen promise rather than fired
  // alongside it: Chrome rejects orientation.lock() outright unless a
  // fullscreen element already exists.
  el.requestFullscreen().then(lockLandscape).catch(() => {});
}

/**
 * Undo it on the way out. Leaving someone locked landscape and fullscreen
 * after they have left the table -- back on the lobby, which is a portrait
 * page -- is worse than never having locked them at all.
 */
export function exitImmersive(): void {
  if (typeof document === "undefined") return;
  orientationApi()?.unlock?.();
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
  }
}
