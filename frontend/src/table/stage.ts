import { useEffect, useRef, useState } from "react";
import { STAGE_HEIGHT, STAGE_WIDTH } from "./layout";

// Matches index.css's compact PlayerDock breakpoint exactly -- below this,
// the dock is a fixed-height overlay pinned to the viewport's bottom edge
// (see .k-dock's "lives outside the scaled stage" comment), not real layout
// space .k-fit's height accounts for. On a long hand the viewer's own seat
// (always bottom-center, see layout.ts's viewerSlotIndex) can grow tall
// enough to reach into that space if the felt is allowed to scale as if the
// dock weren't there. Reserving it here, and top-aligning to make the
// reservation land specifically at the bottom (see .k-fit's matching
// align-items rule), guarantees real clearance instead of hoping a centered
// layout's margins happen to be enough.
const COMPACT_MEDIA_QUERY = "(max-width: 520px), (max-height: 440px)";
const DOCK_RESERVED_HEIGHT_PX = 76;

// The non-compact dock is shorter (~66px) but .k-fit stays centered rather
// than top-aligned outside the compact breakpoint, so only half of whatever
// gets reserved here actually lands in the bottom margin -- the other half
// is spent growing the (already-fine) top margin instead. Reserving double
// the real dock height is what makes the bottom half of that split alone
// enough to clear it. Without this, any viewport landing at native 1x scale
// with height roughly 760-890px (1366x768 laptops chief among them -- the
// single most common laptop resolution) rendered the felt at its full
// unshrunk 760px design height, and the dock overlapped its bottom edge by
// tens of pixels, covering part of the viewer's own seat.
const DESKTOP_DOCK_RESERVED_HEIGHT_PX = 90;

// Scale-to-fit for the fixed 1280x760 stage, ported from the mockup's
// fitStage(). The stage keeps its design pixel size and is uniformly
// transform-scaled to fit the wrapper, so the whole composition letterboxes
// and centers at any viewport instead of reflowing. Capped at 1 so it never
// upscales past the design size on a large desktop monitor.
export function useStageScale() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const fit = () => {
      const isCompact = typeof window.matchMedia === "function" && window.matchMedia(COMPACT_MEDIA_QUERY).matches;
      const availableHeight = isCompact
        ? wrap.clientHeight - DOCK_RESERVED_HEIGHT_PX
        : wrap.clientHeight - DESKTOP_DOCK_RESERVED_HEIGHT_PX * 2;
      const next = Math.min(wrap.clientWidth / STAGE_WIDTH, availableHeight / STAGE_HEIGHT, 1);
      setScale(next > 0 ? next : 1);
    };

    fit();

    // Deliberately belt-and-braces: on mobile the interesting resizes
    // (URL bar collapsing, rotating, entering fullscreen) don't all reliably
    // fire the same event, so every available signal is wired up and they
    // simply converge on the same idempotent fit().
    // ResizeObserver is an enhancement, not a requirement (the listeners
    // below cover rotation and window resizes), so tolerate its absence --
    // jsdom under test has no implementation of it.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : undefined;
    ro?.observe(wrap);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    document.addEventListener("fullscreenchange", fit);
    // Orientation change needs a tick before the new dimensions settle.
    const onOrientation = () => setTimeout(fit, 60);
    window.addEventListener("orientationchange", onOrientation);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
      document.removeEventListener("fullscreenchange", fit);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, []);

  return { wrapRef, scale };
}
