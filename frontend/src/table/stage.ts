import { useEffect, useRef, useState } from "react";
import { STAGE_HEIGHT, STAGE_WIDTH } from "./layout";

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
      const next = Math.min(wrap.clientWidth / STAGE_WIDTH, wrap.clientHeight / STAGE_HEIGHT, 1);
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
