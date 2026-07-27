import { useEffect, useRef } from "react";

// Cast rather than rely on lib.dom's WakeLock types -- support varies enough
// by TS/browser version (same reasoning as fullscreen.ts's screen.orientation
// cast) that a minimal inline shape is more robust than the ambient type.
type WakeLockSentinelLike = { release: () => Promise<void> };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

// Keeps the phone's screen from dimming/locking during active play -- the
// #1 mobile complaint with a felt table you glance at rather than tap
// constantly. Unsupported browsers (iOS Safari < 16.4, most desktop) just
// no-op; this is a nicety, never something to surface an error over.
//
// The OS releases the lock automatically whenever the tab is backgrounded
// (app switch, phone's own screen lock), so it must be re-acquired on
// visibilitychange rather than assumed to still be held once the tab
// returns to the foreground.
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const nav = typeof navigator === "undefined" ? undefined : (navigator as NavigatorWithWakeLock);
    if (!active || !nav?.wakeLock) return;

    let cancelled = false;
    const acquire = async () => {
      try {
        const sentinel = await nav.wakeLock!.request("screen");
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        /* denied (e.g. low battery mode) or requires a foreground/visible
           document at the moment of the call -- not worth surfacing */
      }
    };
    acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) acquire();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
    };
  }, [active]);
}
