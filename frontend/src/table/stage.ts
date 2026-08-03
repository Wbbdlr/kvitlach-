import { useEffect, useRef, useState } from "react";
import { STAGE_HEIGHT, STAGE_WIDTH } from "./layout";

// Matches index.css's compact PlayerDock breakpoint exactly -- the dock is
// shorter there, so it needs a smaller band reserved for it below.
const COMPACT_MEDIA_QUERY = "(max-width: 520px), (max-height: 440px)";
const DOCK_HEIGHT_PX = 66;
const COMPACT_DOCK_HEIGHT_PX = 60;
// Breathing room between the dock tray and the lowest seat above it.
const DOCK_GUTTER_PX = 16;
// .k-chrome-top's row (buttons + its 8px inset) plus a gutter. The felt used
// to letterbox, which kept the dealer well clear of this row by accident;
// now that the stage reaches the viewport's top edge, the play area has to
// clear it deliberately or the felt switcher lands on the dealer's plate.
const TOP_CHROME_PX = 44;

// Growing past the 1280x760 design size is fine -- every in-stage visual is a
// font glyph, an SVG, or a high-resolution source image, so it doesn't cost
// sharpness the way a small raster asset would. Stopping short of a full
// uncap avoids betting on source-image resolution holding up at, say, 3x on
// an 8K display nobody has tested this against.
const MAX_SCALE = 1.6;

// How flat the table may get. The play area's height is STAGE_HEIGHT * vf, so
// 0.5 bottoms out around a 1280x380 surface -- roughly a 3.4:1 table. Below
// this the oval stops reading as a table and the seat ellipse gets flat
// enough that neighbours start colliding (seatScale then shrinks everyone,
// which would undo the legibility this whole mechanism exists to buy).
const MIN_VF = 0.5;

export interface StageFit {
  /** Uniform scale applied to the whole stage. */
  scale: number;
  /** Rendered height of the felt surface, in stage px. */
  stageHeight: number;
  /**
   * Vertical factor (MIN_VF..1) applied to the play area -- the oval, the
   * seat ellipse, the dealer, and the bank panel. Consumed in CSS as --vf.
   */
  vf: number;
  /** Stage px between the felt's top edge and the play area, clearing the
   *  top chrome row. Consumed in CSS as --play-top. */
  playTop: number;
}

// Exported for tests -- this is the whole no-wasted-space contract, and it's
// pure, so it's far cheaper to pin here than through a rendered component.
export function computeFit(availWidth: number, availHeight: number, isCompact: boolean): StageFit {
  if (availWidth <= 0 || availHeight <= 0) {
    return { scale: 1, stageHeight: STAGE_HEIGHT, vf: 1, playTop: 0 };
  }

  // Width binds first, always: the stage is a fixed 1280 design px wide, so
  // this is what makes the felt reach both side edges with no pillarboxing.
  const scale = Math.min(availWidth / STAGE_WIDTH, MAX_SCALE);

  // Both chrome rows sit at true viewport size (they never scale -- see
  // .k-fit), so converting their real pixel heights back into stage px is
  // what lets the play area between them be sized in the same units as
  // everything else.
  const dockBand = ((isCompact ? COMPACT_DOCK_HEIGHT_PX : DOCK_HEIGHT_PX) + DOCK_GUTTER_PX) / scale;
  const playTop = TOP_CHROME_PX / scale;

  // Whatever vertical room is left between the two bands decides how flat the
  // table gets. Quantized to 2dp so a drag-resize doesn't mint a new seat-arc
  // table (see layout.ts) on every animation frame.
  const rawVf = (availHeight / scale - dockBand - playTop) / STAGE_HEIGHT;
  const vf = Math.round(Math.min(Math.max(rawVf, MIN_VF), 1) * 100) / 100;

  // Cap at the viewport so an over-tall stage can't push the dock off-screen;
  // otherwise the felt is exactly the play area plus both bands.
  const stageHeight = Math.min(availHeight / scale, playTop + STAGE_HEIGHT * vf + dockBand);

  return { scale, stageHeight, vf, playTop };
}

export function useStageScale() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<StageFit>({ scale: 1, stageHeight: STAGE_HEIGHT, vf: 1 });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const apply = () => {
      const isCompact = typeof window.matchMedia === "function" && window.matchMedia(COMPACT_MEDIA_QUERY).matches;
      const next = computeFit(wrap.clientWidth, wrap.clientHeight, isCompact);
      setFit((prev) =>
        prev.scale === next.scale && prev.stageHeight === next.stageHeight && prev.vf === next.vf ? prev : next
      );
    };

    apply();

    // Deliberately belt-and-braces: on mobile the interesting resizes
    // (URL bar collapsing, rotating, entering fullscreen) don't all reliably
    // fire the same event, so every available signal is wired up and they
    // simply converge on the same idempotent apply().
    // ResizeObserver is an enhancement, not a requirement (the listeners
    // below cover rotation and window resizes), so tolerate its absence --
    // jsdom under test has no implementation of it.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : undefined;
    ro?.observe(wrap);
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("scroll", apply);
    document.addEventListener("fullscreenchange", apply);
    // Orientation change needs a tick before the new dimensions settle.
    const onOrientation = () => setTimeout(apply, 60);
    window.addEventListener("orientationchange", onOrientation);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("scroll", apply);
      document.removeEventListener("fullscreenchange", apply);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, []);

  return { wrapRef, ...fit };
}
