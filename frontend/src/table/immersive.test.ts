import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { enterImmersive, exitImmersive, isHandheld } from "./immersive";

// enterImmersive() is fire-and-forget by design -- every call inside it is
// refused by some real browser and none of the refusals surface. That makes it
// exactly the kind of code that can quietly stop doing anything at all, or
// start doing it to people it should leave alone. These pin the gating.

const requestFullscreen = vi.fn(() => Promise.resolve());
const exitFullscreen = vi.fn(() => Promise.resolve());
const lock = vi.fn(() => Promise.resolve());
const unlock = vi.fn();

function setPlatform(opts: {
  coarse: boolean;
  shortEdge: number;
  standalone?: boolean;
  fullscreenApi?: boolean;
  inFullscreen?: boolean;
}) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("pointer: coarse")
      ? opts.coarse
      : q.includes("display-mode: standalone")
        ? Boolean(opts.standalone)
        : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(window, "screen", {
    configurable: true,
    value: {
      width: opts.shortEdge,
      height: opts.shortEdge * 2,
      orientation: { lock, unlock },
    },
  });
  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    value: opts.fullscreenApi !== false,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: opts.inFullscreen ? document.documentElement : null,
  });
  document.documentElement.requestFullscreen =
    opts.fullscreenApi === false ? (undefined as never) : requestFullscreen;
  document.exitFullscreen = exitFullscreen;
}

beforeEach(() => {
  requestFullscreen.mockClear();
  exitFullscreen.mockClear();
  lock.mockClear();
  unlock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isHandheld", () => {
  // A touchscreen laptop matches (pointer: coarse) too. Size is what actually
  // means "phone", and it is the short edge because the device may already be
  // held landscape.
  it("is false for a coarse pointer on a big screen", () => {
    setPlatform({ coarse: true, shortEdge: 1200 });
    expect(isHandheld()).toBe(false);
  });

  it("is false for a small window with a fine pointer", () => {
    setPlatform({ coarse: false, shortEdge: 390 });
    expect(isHandheld()).toBe(false);
  });

  it("is true for a coarse pointer on a phone-sized screen", () => {
    setPlatform({ coarse: true, shortEdge: 390 });
    expect(isHandheld()).toBe(true);
  });
});

describe("enterImmersive", () => {
  it("does nothing at all on a desktop", () => {
    setPlatform({ coarse: false, shortEdge: 1440 });
    enterImmersive();
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
  });

  it("goes fullscreen and then locks landscape on a phone", async () => {
    setPlatform({ coarse: true, shortEdge: 390 });
    enterImmersive();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    // Chained, not parallel: Chrome rejects the lock unless a fullscreen
    // element already exists, so it must wait for the promise.
    expect(lock).not.toHaveBeenCalled();
    // Also still not called right as the fullscreen promise resolves -- see
    // LOCK_DELAY_MS's comment in immersive.ts (a stuck Android "exit full
    // screen" banner, suspected to be triggered by firing the orientation
    // lock in the same tick fullscreen entry resolves).
    await Promise.resolve();
    expect(lock).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(lock).toHaveBeenCalledWith("landscape");
  });

  it("locks without asking for fullscreen in an installed app", () => {
    setPlatform({ coarse: true, shortEdge: 390, standalone: true });
    enterImmersive();
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalledWith("landscape");
  });

  // iOS Safari implements fullscreen for <video> only. The rotate hint is the
  // fallback there; what must not happen is a throw that takes the tap with it
  // and stops the player joining at all.
  it("is a silent no-op where the fullscreen API is absent", () => {
    setPlatform({ coarse: true, shortEdge: 390, fullscreenApi: false });
    expect(() => enterImmersive()).not.toThrow();
    expect(lock).not.toHaveBeenCalled();
  });
});

describe("exitImmersive", () => {
  it("releases the lock and leaves fullscreen", () => {
    setPlatform({ coarse: true, shortEdge: 390, inFullscreen: true });
    exitImmersive();
    expect(unlock).toHaveBeenCalled();
    expect(exitFullscreen).toHaveBeenCalled();
  });

  it("does not call exitFullscreen when not in fullscreen", () => {
    setPlatform({ coarse: true, shortEdge: 390, inFullscreen: false });
    exitImmersive();
    expect(exitFullscreen).not.toHaveBeenCalled();
  });
});
