import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPageTheme, loadPageTheme, resolvesDark, setPageTheme, togglePageTheme } from "../pageTheme";

// Light or dark for the lobby and info pages. The state that matters is the
// THIRD one: "system" is the absence of a stored choice AND the absence of the
// attribute, which is what lets the CSS keep tracking the device. Storing a
// resolved value instead would silently freeze somebody's page at whatever
// their phone happened to be the first time they loaded it.

const setSystemDark = (dark: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-page-theme");
  document.documentElement.style.colorScheme = "";
  setSystemDark(false);
});

afterEach(() => {
  // Braces, not a concise arrow: unstubAllGlobals RETURNS VitestUtils, and an
  // afterEach hook is typed to void -- vitest runs it happily either way, so
  // this only ever fails at `tsc`. The backend suite shipped exactly this and
  // broke an image build at step 6 of 16.
  vi.unstubAllGlobals();
});

describe("the default", () => {
  it("is system, for anyone who has never chosen", () => {
    expect(loadPageTheme()).toBe("system");
  });

  it("follows a dark device", () => {
    setSystemDark(true);
    expect(resolvesDark("system")).toBe(true);
  });

  it("follows a light device", () => {
    expect(resolvesDark("system")).toBe(false);
  });

  it("leaves the attribute OFF, which is what keeps it tracking", () => {
    applyPageTheme("system");
    expect(document.documentElement.hasAttribute("data-page-theme")).toBe(false);
  });
});

describe("an explicit choice", () => {
  it("beats a dark device", () => {
    setSystemDark(true);
    setPageTheme("light");
    expect(document.documentElement.getAttribute("data-page-theme")).toBe("light");
    expect(resolvesDark("light")).toBe(false);
  });

  it("beats a light device", () => {
    setPageTheme("dark");
    expect(document.documentElement.getAttribute("data-page-theme")).toBe("dark");
  });

  it("is remembered", () => {
    setPageTheme("dark");
    expect(loadPageTheme()).toBe("dark");
  });

  it("tells the browser which scrollbars to draw", () => {
    // Without this the page can be dark while its scrollbars and native
    // controls stay light, which looks like a half-finished theme.
    setPageTheme("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});

describe("the toggle", () => {
  it("flips away from what is on screen, not from what is stored", () => {
    // The distinction matters on a dark DEVICE with no stored choice: the
    // screen is dark, so the first press has to produce light. Toggling from
    // the stored value ("system") would have to guess, and guessing wrong
    // means the first press appears to do nothing.
    setSystemDark(true);
    expect(loadPageTheme()).toBe("system");
    expect(togglePageTheme()).toBe("light");
  });

  it("flips back and forth from there", () => {
    setPageTheme("light");
    expect(togglePageTheme()).toBe("dark");
    expect(togglePageTheme()).toBe("light");
  });
});

describe("when storage is unavailable", () => {
  it("still applies, and falls back to following the device", () => {
    const boom = () => {
      throw new Error("denied");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    expect(loadPageTheme()).toBe("system");
    expect(() => setPageTheme("dark")).not.toThrow();
    expect(document.documentElement.getAttribute("data-page-theme")).toBe("dark");
    vi.restoreAllMocks();
  });
});
