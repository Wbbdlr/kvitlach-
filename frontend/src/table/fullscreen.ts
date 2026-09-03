import { useEffect, useState } from "react";

// The Fullscreen API can only ever be invoked from a real user gesture (a
// tap/click handler) -- there is no way to auto-enter fullscreen on
// orientationchange in any current browser, so this exposes a manual toggle
// rather than trying (and failing) to do it automatically on rotate.
//
// iOS Safari does not implement the Fullscreen API for arbitrary elements at
// all (only <video>), so `supported` is false there and callers should hide
// the control entirely rather than show a button that can't work.
export function useFullscreen() {
  const supported =
    typeof document !== "undefined" && Boolean(document.documentElement.requestFullscreen) && document.fullscreenEnabled !== false;

  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== "undefined" && Boolean(document.fullscreenElement)
  );

  useEffect(() => {
    if (!supported) return;
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [supported]);

  const toggleFullscreen = async () => {
    if (!supported) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
        // Landscape lock is opportunistic -- unsupported on many browsers and
        // only meaningful once actually in fullscreen, so failures here are
        // expected and silently ignored rather than surfaced as an error.
        // Delayed the same way and for the same reason as immersive.ts's
        // LOCK_DELAY_MS: firing it in the same tick fullscreen entry resolves
        // is suspected to leave Android Chrome's own "exit full screen"
        // banner stuck on screen instead of clearing itself.
        setTimeout(() => {
          const orientation = screen.orientation as unknown as { lock?: (o: string) => Promise<void> };
          orientation?.lock?.("landscape").catch(() => {});
        }, 120);
      }
    } catch {
      /* user gesture requirement not met, or the browser denied it -- nothing to do */
    }
  };

  return { supported, isFullscreen, toggleFullscreen };
}
