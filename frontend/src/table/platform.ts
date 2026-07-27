// iOS Safari never implements the Fullscreen API for ordinary elements (see
// fullscreen.ts), so the only path to a chrome-free table on an iPhone is
// installing as a home-screen web app -- these two checks tell TableRoot
// whether to nudge a visitor toward that, instead of showing them a
// fullscreen button that can never work.
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ reports its platform as "MacIntel", identical to a real Mac --
  // maxTouchPoints is what actually distinguishes the two.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true);
}
