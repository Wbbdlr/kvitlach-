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
// sharpness the way a small raster asset would. Checked, not guessed: the
// card art (the biggest raster asset on the felt) ships at 946x1438, and the
// tallest a card ever renders at nominal (unscaled) stage size is the
// viewer's own 92px hand -- so even at this cap, a card is only ever drawn
// at 92*3/1438 =~ 19% of its source resolution, nowhere near visible
// softening. The old 1.6 cap was set well below that budget on an untested
// guess ("3x on an 8K display") rather than this number, and produced real,
// reported pillarboxing on an ordinary wide monitor (2560px wide needs 2.0
// to fill edge to edge). 3.0 exactly fills a 3840px (4K) window and leaves
// the same comfortable margin -- still a real ceiling for the hypothetical
// display few of these dimensions actually reach, just recalibrated to what
// the assets can actually take instead of a number nobody checked.
const MAX_SCALE = 3.0;

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
//
// dockHeight is the tray's MEASURED height, when it's known. The constants
// above describe the dock mid-turn; it grows in other states, and the tallest
// one found in play -- "Round complete / Waiting for the banker to start the
// next round" -- wraps to two lines and reaches 79px, overlapping the bottom
// seat by 11px on a landscape phone. Measuring beats enumerating every state
// and hoping, and it can't feed back: the tray sits outside the scaled stage
// (see .k-fit) and its width follows the viewport, not vf, so its height
// doesn't move when the answer here changes.
export function computeFit(
  availWidth: number,
  availHeight: number,
  isCompact: boolean,
  dockHeight = 0
): StageFit {
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
  const nominalDock = isCompact ? COMPACT_DOCK_HEIGHT_PX : DOCK_HEIGHT_PX;
  const dockBand = (Math.max(nominalDock, dockHeight) + DOCK_GUTTER_PX) / scale;
  const playTop = TOP_CHROME_PX / scale;

  // Whatever vertical room is left between the two bands decides how flat the
  // table gets. Quantized to 2dp so a drag-resize doesn't mint a new seat-arc
  // table (see layout.ts) on every animation frame.
  const rawVf = (availHeight / scale - dockBand - playTop) / STAGE_HEIGHT;
  const vf = Math.round(Math.min(Math.max(rawVf, MIN_VF), 1) * 100) / 100;

  // On a portrait phone (width binds the scale long before height runs out)
  // vf ceilings at 1 with room to spare -- the play area plus both bands
  // can total well under availHeight. That leftover used to just vanish:
  // stageHeight capped at the smaller "content" sum, and .k-fit's centering
  // turned the difference into matching dead bars above and below the
  // WHOLE stage, dock included (it's bottom-anchored to the felt's own
  // edge -- see .k-controls -- so it rode down with it, floating with a
  // gap under it that mirrored the one above the logo). Folded back in
  // here instead of left as dead space -- but not split evenly: an even
  // split (tried first, checked live on a 360x800 profile) pushed the play
  // area ~180px further from the top chrome, which reads as the table
  // adrift in a big green void rather than anchored near the branding the
  // way it sits on every other viewport. Most of the room goes to the dock
  // band instead -- more felt showing below the last seat, which is inert
  // (nothing is anchored to that edge) rather than a gap that visibly
  // pushes something around -- and only a modest share widens the top
  // gutter, enough that it doesn't feel clipped without the table drifting
  // far from where it sits everywhere else. Neither share touches vf or
  // the dock's own reserved height, so the seat arc and the dock's layout
  // are exactly as collision-tested either way; only how much room the two
  // bands either side of them get grows.
  const contentHeight = playTop + STAGE_HEIGHT * vf + dockBand;
  const room = Math.max(0, availHeight / scale - contentHeight);
  const grownPlayTop = playTop + room * 0.2;
  const grownDockBand = dockBand + room * 0.8;

  // Cap at the viewport so an over-tall stage can't push the dock off-screen;
  // otherwise the felt is exactly the play area plus both (now possibly
  // grown) bands.
  const stageHeight = Math.min(availHeight / scale, grownPlayTop + STAGE_HEIGHT * vf + grownDockBand);

  return { scale, stageHeight, vf, playTop: grownPlayTop };
}

export function useStageScale() {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Attach to the controls tray so its real height feeds the bottom band.
  const dockRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<StageFit>({ scale: 1, stageHeight: STAGE_HEIGHT, vf: 1, playTop: 0 });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const apply = () => {
      const isCompact = typeof window.matchMedia === "function" && window.matchMedia(COMPACT_MEDIA_QUERY).matches;
      const next = computeFit(
        wrap.clientWidth,
        wrap.clientHeight,
        isCompact,
        dockRef.current?.getBoundingClientRect().height ?? 0
      );
      setFit((prev) =>
        prev.scale === next.scale &&
        prev.stageHeight === next.stageHeight &&
        prev.vf === next.vf &&
        prev.playTop === next.playTop
          ? prev
          : next
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
    // The tray changes height when the dock swaps states mid-round, not just
    // when the window resizes, so it needs watching in its own right.
    if (dockRef.current) ro?.observe(dockRef.current);
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

  return { wrapRef, dockRef, ...fit };
}
