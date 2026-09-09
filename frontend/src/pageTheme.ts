// Light or dark for the LOBBY AND INFO PAGES. Never the table.
//
// The mechanism lives in tailwind.config.cjs -- every colour those pages use
// is a CSS variable, and dark mode redefines the variables under a selector
// that excludes the table. This file only decides which of the three states is
// in force and writes it onto <html>.
//
// THREE states, not two, and the third is the important one:
//
//   "system"  no attribute. Follows the device, and keeps following it -- a
//             phone that goes dark at sunset takes this page with it. This is
//             what everybody has until they touch the control.
//   "light"   explicit. Beats a dark device.
//   "dark"    explicit. Beats a light device.
//
// A two-state toggle would have to pick a side at first paint and would
// silently stop tracking the device the moment anyone touched it. Storing
// "system" as a real value is what keeps the default honest.

export type PageTheme = "system" | "light" | "dark";

const STORAGE_KEY = "kvitlach.pageTheme";
const ATTRIBUTE = "data-page-theme";

/** Fires when the choice changes, so a mounted control can re-read it. */
export const PAGE_THEME_EVENT = "kvitlach:page-theme";

function isTheme(value: unknown): value is PageTheme {
  return value === "system" || value === "light" || value === "dark";
}

/** The stored choice, or "system" for anyone who has never chosen. */
export function loadPageTheme(): PageTheme {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(saved) ? saved : "system";
  } catch {
    // Private mode, or storage disabled. Following the device is the right
    // answer for somebody whose preference cannot be remembered anyway.
    return "system";
  }
}

/** True when the given choice resolves to dark right now. */
export function resolvesDark(theme: PageTheme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * Writes the choice onto <html>.
 *
 * "system" REMOVES the attribute rather than stamping a resolved value: the
 * CSS already has a prefers-color-scheme branch, so the absence of the
 * attribute is what lets the page keep tracking the device without any
 * listener of ours running at all.
 */
export function applyPageTheme(theme: PageTheme): void {
  try {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute(ATTRIBUTE);
    else root.setAttribute(ATTRIBUTE, theme);
    // Tells the browser which scrollbars and form-control chrome to draw. The
    // page can be dark while the device is light, and without this the
    // scrollbar stays light against it.
    root.style.colorScheme = theme === "system" ? "" : theme;
  } catch {
    /* no document (tests, SSR) */
  }
}

/** Stores and applies a choice, and announces it. */
export function setPageTheme(theme: PageTheme): void {
  try {
    if (theme === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* not remembered, but still applied for this page */
  }
  applyPageTheme(theme);
  try {
    window.dispatchEvent(new Event(PAGE_THEME_EVENT));
  } catch {
    /* no window */
  }
}

/**
 * What the control does: flip to the opposite of what is on screen NOW.
 *
 * Deliberately not a three-way cycle through "system". A control that lands on
 * a state whose meaning is "whatever the phone says" leaves somebody pressing
 * it and seeing nothing change, because the phone already said that. Going
 * back to following the device is a rare thing to want and does not need to be
 * on the fastest path; clearing site data does it, and so does the API above.
 */
export function togglePageTheme(): PageTheme {
  const next: PageTheme = resolvesDark(loadPageTheme()) ? "light" : "dark";
  setPageTheme(next);
  return next;
}

/** Called once at boot, before React paints, to avoid a flash of the wrong one. */
export function initPageTheme(): void {
  applyPageTheme(loadPageTheme());
}
