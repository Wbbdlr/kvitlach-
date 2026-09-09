import { RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  SEAT_HEIGHT,
  bottomSeatCenterY,
  seatPositions,
  seatScale,
} from "./layout";

// PREDICATE 3 OF 3. Owns exactly one question: "is the RENDERED TABLE cramped
// enough to need compact chrome and dock styling?" Not "is this a phone"
// (that's isHandheld(), immersive.ts) and not "is this viewport too small to
// render the table in portrait" (that's the rotate gate's own 540px bound).
// See docs/mobile-ui.md Part 4 -- reusing one of these for another's question
// is a bug, and has been twice.
//
// Note the comma: this is an OR across BOTH axes, and the height arm is the
// one that matters most, because a landscape phone is wide (854) but short
// (384). Bug #9 in the ledger was a width-only test used for exactly this
// question, which is why it missed every landscape phone it was written for.
//
// Matches index.css's compact PlayerDock breakpoint exactly -- the dock is
// shorter there, so it needs a smaller band reserved for it below.
// Exported for compactQuery.test.ts, which checks that every compact block in
// index.css is written with this exact string. Unlike the portrait gate -- one
// predicate, hiding the whole table, so its CSS rule could be deleted outright
// -- this one legitimately styles many rules and has to live in both files.
// Six blocks carry it today; the risk is not that one of them is wrong on
// purpose but that a future seventh is typed from memory as 521 or 400, and
// then a phone gets the compact JS layout with desktop CSS or the reverse.
// See docs/mobile-ui.md Part 4.
export const COMPACT_MEDIA_QUERY = "(max-width: 520px), (max-height: 440px)";
const DOCK_HEIGHT_PX = 66;
const COMPACT_DOCK_HEIGHT_PX = 54;
// Breathing room between the dock tray and the lowest seat above it. Trimmed
// from 16 (still clears every measured dock state -- see the tallest-state
// regression test below -- just with less pure margin, in service of a
// bigger play area on a flattened landscape phone, where this reservation
// directly trades off against vf rather than becoming unused felt).
const DOCK_GUTTER_PX = 10;
// The resize grip's range. The floor is a taste call (shrinking is what was
// actually asked for); the ceiling is now only ever an upper bound on
// StageFit.maxDockScale, which is what a viewport tight enough will lower.
export const DOCK_SCALE_MIN = 0.7;
export const DOCK_SCALE_MAX = 1.25;
// .k-chrome-top's row (buttons + its 8px inset) plus a gutter. The felt used
// to letterbox, which kept the dealer well clear of this row by accident;
// now that the stage reaches the viewport's top edge, the play area has to
// clear it deliberately or the felt switcher lands on the dealer's plate.
const TOP_CHROME_PX = 44;
// The dealer's own seat overhangs ABOVE its center (Dealer.tsx: `top: play-
// top + 160px*vf`, then translate(-50%,-50%)) the same way the viewer's own
// seat overhangs below its center (see VIEWER_SEAT_OVERHANG_PX below) -- and
// this constant's own comment predicted exactly this failure ("or the felt
// switcher lands on the dealer's plate") without actually budgeting for it:
// TOP_CHROME_PX alone only clears the dealer's CENTER, not the plate sitting
// above it. Confirmed live on an 11-player table at 812x375 (2026-08-11,
// following up the still-open landscape-clipping item): the dealer's plate
// (real y 37.8-61.9) sat 10px inside .k-chrome-top's own real span (8-48),
// under it in z-index (10 vs chrome-top's 40) so the buttons visibly painted
// over the bank badge.
//
// NOT half of SEAT_HEIGHT the way VIEWER_SEAT_OVERHANG_PX is -- that fix
// lives in dockBand, a term with no other job, but this one has to live in
// playTop (the dealer's seat is anchored off playTop directly, unlike the
// viewer's, which is anchored off vf alone), and playTop feeds the viewer's
// own position too (cy = CY*vf + playTop). At the exact viewport/dock-state
// this was found on, vf was already pinned at MIN_VF -- no self-correcting
// slack left -- so growing playTop here costs the viewer's dock margin
// (established above) real px 1-for-1, not just a diluted share of it. A
// measured 10px gap plus a buffer, not a full extra half-seat, is what the
// dealer actually needs; the full amount would have bought the dealer far
// more than the ~10px it was short by, at the viewer's direct expense
// (confirmed: SEAT_HEIGHT/2 flipped the dock-clearance regression test
// negative on the same profile that started this).
//
// NOW 33, and the arithmetic is worth keeping because it has bitten twice.
// Step 2 deleted the dealer's "Total: N" + status row (~39 stage px including
// .k-seat's gap) from this column. The seat is centred, so losing 39 off its
// height raises its bottom edge by 19.5 AND lowers its top edge by 19.5 -- so
// the clearance this constant reserves shrinks by the same 19.5, not by 39.
// 52 - 19.5 ~= 33. Lowering it moves the whole play area UP, which is the safe
// direction for the dock-clearance test below; the bank header row above the
// plate is still budgeted, it is just no longer paying for a status row too.
//
// The history below is the warning that produced this arithmetic:
// grown from 40 to 52 when the bank's readout moved onto the banker's own seat
// (Dealer.tsx renders BankPanel as .k-seat's first child). That adds ~24px to
// the box -- ~18px for the pill plus .k-seat's own 6px gap -- but only HALF of
// that lands above the anchor: the seat is centred with translate(-50%, -50%),
// so a box that grows by 24 raises its own top edge by 12 and lowers its bottom
// by 12. +12 here, not +24.
//
// Checked, not reasoned: +24 was tried first and the dock-clearance regression
// test below went 0.91px negative on the Galaxy S21 landscape profile, which is
// this constant's own comment above coming true -- once vf is pinned at MIN_VF
// there is no self-correcting slack, and every px added here comes straight out
// of the viewer's dock margin.
// Step 2 of the refactor hands this back and more -- folding the dealer's status
// row into its plate removes ~39px from the same column.
const DEALER_SEAT_OVERHANG_PX = 33;

// How far the viewer's own seat -- always bottom-centre, layout.ts's
// bottomSeatCenterY -- extends below its own CENTER once translate(-50%,
// -50%) is applied. layout.ts's ellipse (CY/RY) places that CENTER inside
// the play area, shrinking with vf like everything else on the arc, but the
// seat's own rendered box (name plate + hand + total + status tag) is a
// fixed size that does NOT shrink with vf -- so at a flattened vf the
// content pokes further past its own center, relative to the shrinking play
// area, than layout.ts's RY comment ("198 clears the dock outright")
// accounted for; that number was only ever checked at vf=1. Reused from
// layout.ts's own SEAT_HEIGHT (already the single source of truth for "how
// tall the viewer's own 92px-card seat renders") rather than a second
// measured constant.
//
// Folded into the DOCK band below, not added as its own term elsewhere:
// once the viewport is tight enough that this reservation pulls vf down at
// all, the felt is already capped to fill the viewport exactly (see
// stageHeight below), which pins the dock's own real screen position
// independent of vf entirely -- from that point a HIGHER vf only pushes the
// viewer's own seat further down toward that fixed point, so reserving room
// that lowers vf is what actually buys clearance, not a floor that raises it
// (see MIN_VF's own comment).
const VIEWER_SEAT_OVERHANG_PX = SEAT_HEIGHT / 2;

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
// this bottoming out around a 1280x304 surface is roughly a 4.2:1 table.
//
// Lowered from 0.5 (2026-08-10, alongside VIEWER_SEAT_OVERHANG_PX above):
// forcing vf UP to a floor doesn't help dock/seat clearance the way it
// sounds like it should. Once the viewport is tight enough that the floor
// actually engages, the felt is already capped to fill the viewport exactly
// (see stageHeight below), which pins the dock's own real position
// independent of vf -- from there a HIGHER vf only pushes the viewer's own
// seat further down toward that fixed point. A user report of the dock
// covering their own hand's total traced to exactly this: at a live
// landscape phone size with the dock in a taller-than-nominal state, the
// old 0.5 floor was forcing vf just high enough to erase the ~5px of
// clearance the seat had left, without the seat-overhang reservation above
// to compensate. 0.4 was checked against stage.test.ts's two realistic
// landscape profiles with the dock in its tallest measured state (79px, see
// the "reserves the tray's real height" regression test below): both clear
// the dock band by 40+ real px at this floor, comfortably past the ~0px
// (and briefly negative) margin the old floor left once the seat's own
// overhang is accounted for.
//
// Seats colliding with EACH OTHER (not the dock) is a separate concern,
// already covered by seatScale()'s own independently-tested 0.36 floor in
// layout.ts -- that's what stops the oval from reading as unreadable, not
// this constant, so lowering it doesn't reopen that failure mode.
const MIN_VF = 0.4;

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
  /**
   * Whether the table is rendering at COMPACT_MEDIA_QUERY -- a landscape
   * phone, essentially.
   *
   * Surfaced out of the fit rather than recomputed by each consumer so there
   * is exactly one definition of "compact" shared by the CSS breakpoint, the
   * dock band above, the dealer's flanking status row and the bank pill's
   * placement. Those last two are two halves of one layout: the pill only has
   * a centre corridor to sit in BECAUSE the dealer's status row has left it,
   * so a consumer that disagreed about compactness would put the pill exactly
   * where the row still is.
   */
  compact: boolean;
  /**
   * The largest resize factor the control bar can take before its top edge
   * reaches the viewer's own cards (draggablePanel.ts's `bounds.max`).
   *
   * A number, not a constant, because the room available for it is not one:
   * on a landscape phone `vf` is already pinned at MIN_VF and the felt fills
   * the viewport, so nothing left in computeFit can absorb a taller bar --
   * the bar simply grows up over the bottom seat. The flat 1.25 that used to
   * be hardcoded was set without checking it against that, and on the
   * profiles this table supports it lands within a few pixels of the seat (at
   * the dock's tallest state, past it). Reported from an Android phone as
   * "the control bar begins too high up on the screen, overlapping my cards a
   * bit. not sure why, it should start off lower on the screen" -- "not sure
   * why" being the point: the size is remembered in localStorage from
   * whenever it was set, and nothing on screen says so.
   */
  maxDockScale: number;
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
  dockHeight = 0,
  seatCount = 0,
  // What the phone itself takes off the bottom of the viewport -- Android's
  // gesture bar, an iPhone's home indicator. `.k-bottom-band` sits at
  // `max(10px, env(safe-area-inset-bottom))`, so on a device with an inset
  // the whole bar is pushed further UP the screen than the flat
  // DOCK_GUTTER_PX below ever accounted for. Read from a live probe rather
  // than assumed (see readBottomInset) because env() has no JS API and the
  // value differs per device, per orientation, and between a browser tab and
  // a standalone/fullscreen session on the SAME device.
  bottomInsetPx = 0,
  // The bar's UNSCALED height, when it differs from dockHeight above.
  //
  // dockHeight is what the bar measures ON SCREEN, transform included, which
  // is the number the reservation needs. maxDockScale needs the other one:
  // it is a factor applied to the bar's layout height, so dividing the room
  // available by an already-scaled height answers "how much bigger again
  // than it currently is", not "how big may it be" -- and feeding that back
  // through a clamp settles on sqrt(room/height) rather than room/height.
  // Defaults to dockHeight, which is exactly right whenever the bar has not
  // been resized and the two are the same number.
  dockLayoutHeightPx = dockHeight
): StageFit {
  if (availWidth <= 0 || availHeight <= 0) {
    return { scale: 1, stageHeight: STAGE_HEIGHT, vf: 1, playTop: 0, compact: isCompact, maxDockScale: 1 };
  }

  // Width binds first, always: the stage is a fixed 1280 design px wide, so
  // this is what makes the felt reach both side edges with no pillarboxing.
  const scale = Math.min(availWidth / STAGE_WIDTH, MAX_SCALE);

  // How much smaller than nominal every PLAYER seat is actually rendering,
  // once seatScale() has packed `seatCount` of them onto the arc (see
  // layout.ts) -- NOT the dealer's own seat, which TableRoot.tsx's own
  // dealDeltaFor comment notes is never shrunk ("no scale in Dealer.tsx's
  // own transform"). VIEWER_SEAT_OVERHANG_PX below was sized off the
  // UNSHRUNK seat box (seatScale=1, i.e. a small table); reserving that full
  // amount regardless of how crowded the table actually is meant a full
  // 11-player practice table -- seatScale near its 0.36 floor there --
  // reserved room sized for seats more than twice as tall as the ones
  // actually on screen (live-measured 2026-08-11: seatScale 0.449, the
  // viewer's own seat box rendering at 132px real against the ~300px the
  // reservation assumed). That's most of what a "the table can be so much
  // bigger" report traced to. Evaluated at vf=1 rather than whatever vf THIS
  // call is about to solve for -- computeFit can't know that yet, it's what
  // PRODUCES vf -- and spreadFactor already keeps seatScale roughly flat
  // across the vf range that produces, so vf=1 is a stable, close-enough
  // stand-in. seatCount defaults to 0 (no round dealt yet, so no real seat
  // count to shrink by) and reads as "don't shrink the reservation" --
  // the same safe-default shape as dockHeight's own 0 default.
  const crowding = seatCount > 1 ? seatScale(seatPositions(seatCount, 1, 0)) : 1;

  // Both chrome rows sit at true viewport size (they never scale -- see
  // .k-fit), so converting their real pixel heights back into stage px is
  // what lets the play area between them be sized in the same units as
  // everything else.
  const nominalDock = isCompact ? COMPACT_DOCK_HEIGHT_PX : DOCK_HEIGHT_PX;
  // VIEWER_SEAT_OVERHANG_PX is already stage-design px (see its own
  // comment), unlike the rest of this sum, which starts as real px and
  // needs the /scale conversion -- added after, not inside, the division.
  // Scaled by `crowding` for the reason above.
  const bottomGutter = Math.max(DOCK_GUTTER_PX, bottomInsetPx);
  const dockBand = (Math.max(nominalDock, dockHeight) + bottomGutter) / scale + VIEWER_SEAT_OVERHANG_PX * crowding;
  // Same split as dockBand above: TOP_CHROME_PX is real px (needs /scale),
  // DEALER_SEAT_OVERHANG_PX is already stage-design px (added after). NOT
  // scaled by `crowding` -- the dealer's own seat never shrinks, so its
  // overhang doesn't either, regardless of how many players are seated.
  const playTop = TOP_CHROME_PX / scale + DEALER_SEAT_OVERHANG_PX;

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

  // How much of the screen the bar may actually occupy, in real px, derived
  // the same way __tests__/stage.test.ts's own clearance check derives it --
  // from the rendered geometry (TableRoot's JSX: the felt centred in .k-fit,
  // the band bottom-anchored off what is left) rather than from computeFit's
  // internal accounting, which is exactly what cannot see this: with vf
  // pinned at MIN_VF and the felt filling the viewport, dockBand above has
  // nothing left to give and the bar's extra height comes straight out of
  // the bottom seat.
  const feltRealY = (availHeight - stageHeight * scale) / 2;
  const seatRealBottom =
    feltRealY + scale * (bottomSeatCenterY(vf, grownPlayTop) + VIEWER_SEAT_OVERHANG_PX * crowding);
  const barRoom = availHeight - feltRealY - bottomGutter - seatRealBottom;
  // dockHeight is the bar's height as measured ON SCREEN, so the ratio is
  // the factor it could still grow by. Clamped to the range the resize grip
  // offers: never below its own floor (a bar too small to press is not an
  // improvement on one that overlaps), never above the ceiling the design
  // already chose.
  const maxDockScale =
    dockLayoutHeightPx > 0
      ? Math.min(DOCK_SCALE_MAX, Math.max(DOCK_SCALE_MIN, barRoom / dockLayoutHeightPx))
      : DOCK_SCALE_MAX;

  return { scale, stageHeight, vf, playTop: grownPlayTop, compact: isCompact, maxDockScale };
}

// seatCount: how many (non-dealer) seats are on the arc right now --
// TableRoot passes playerTurns.length, the same count that drives its own
// seatScale(seatPositions(...)) call, so computeFit's crowding correction
// (see its own comment) matches what's actually rendered. Not part of the
// ref-driven measurement loop below (it can't be -- it's not a DOM size),
// so it lives in the effect's own dependency array instead: a seat joining
// or leaving mid-session re-runs apply() with the new count, same as a
// resize would.
// dockBarRef: the control bar's own box -- `.k-dock-row`, the element that
// carries the resize transform, NOT the `.k-controls` tray dockRef sits on.
//
// Both are needed and they measure different things. The scale is a CSS
// transform with `transform-origin: bottom center`, and a descendant's
// transform never changes an ancestor's border box -- so dockRef keeps
// reporting the bar's UNSCALED layout height while the bar on screen is up to
// 25% taller, growing UPWARDS because the band is bottom-anchored. The
// reservation was made against the smaller number and the bar quietly grew
// into the viewer's own cards.
//
// A ResizeObserver cannot catch it either: it reports layout size and ignores
// transforms outright. So the visual height is read straight off the row's
// rect, and the layout effect below is what re-reads it -- a resize drag
// re-renders on every frame, and setFit's own equality guard is what keeps
// that from looping.
// env(safe-area-inset-bottom) has no JS API, so it is read the only way it
// can be: hand it to a throwaway element and measure what comes back. Zero on
// every desktop browser and on any device without an inset, which is why the
// flat DOCK_GUTTER_PX was never caught being wrong -- it is only wrong on a
// phone, which is where the bar's clearance is tightest to begin with.
function readBottomInset(): number {
  if (typeof document === "undefined" || !document.body) return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? height : 0;
}

// How far two fits may differ and still count as the same one.
//
// This is a crash fix, not a taste for round numbers. `apply` runs in a
// useLayoutEffect with NO dependency array -- deliberately, because the dock's
// on-screen height changes with a transform nothing observes -- so every
// setFit that returns a NEW object schedules a render that measures again. The
// comment on that effect calls the arrangement "self-limiting", and it is,
// but only while the measurement is stable.
//
// It is not stable to the last decimal. getBoundingClientRect() returns
// FRACTIONAL pixels, and the row it measures carries the resize transform this
// very fit sets, so a hair of difference in the measured bar height produces a
// hair of difference in `scale`, which re-renders, which measures again. Two
// values a fraction apart, alternating, is a render loop -- React gives up at
// roughly fifty nested updates and throws #185, "Maximum update depth
// exceeded", which is the error a player got mid-round at a real table on
// 2026-09-09 (bundle index-DEskz4en.js, frame $k/i, i.e. this callback).
//
// Comparing with a tolerance ends it: the first of the two values is kept and
// the second is treated as no change, so the chain stops after one step. The
// thresholds are far below anything a person can see -- half a pixel of
// layout, and 0.05% of a scale factor -- while every real change (a rotation,
// a resize drag, the URL bar collapsing) is orders of magnitude larger.
const SAME_PX = 0.5;
const SAME_RATIO = 0.0005;
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) < tolerance;

/** True when two fits are the same one as far as the screen is concerned. */
export function fitsMatch(prev: StageFit, next: StageFit): boolean {
  return (
    near(prev.scale, next.scale, SAME_RATIO) &&
    near(prev.stageHeight, next.stageHeight, SAME_PX) &&
    near(prev.vf, next.vf, SAME_RATIO) &&
    near(prev.playTop, next.playTop, SAME_PX) &&
    prev.compact === next.compact &&
    near(prev.maxDockScale, next.maxDockScale, SAME_RATIO)
  );
}

export function useStageScale(seatCount = 0, dockBarRef?: RefObject<HTMLElement>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Attach to the controls tray so its real height feeds the bottom band.
  const dockRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<StageFit>({
    scale: 1,
    stageHeight: STAGE_HEIGHT,
    vf: 1,
    playTop: 0,
    compact: false,
    maxDockScale: DOCK_SCALE_MAX,
  });

  const apply = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const isCompact = typeof window.matchMedia === "function" && window.matchMedia(COMPACT_MEDIA_QUERY).matches;
    // The row's rect when there is one (it includes the resize transform);
    // the tray's otherwise, which is the same number at scale 1 and the only
    // one available before the row has mounted.
    // Two heights, and the difference is the whole point of having both refs:
    // the ROW carries the resize transform, so its rect is what the bar
    // really occupies; `.k-controls` is its untransformed ancestor, so its
    // rect is the bar's layout height. The reservation wants the first, the
    // resize ceiling wants the second.
    const layoutHeight = dockRef.current?.getBoundingClientRect().height ?? 0;
    const barHeight = dockBarRef?.current?.getBoundingClientRect().height ?? layoutHeight;
    const next = computeFit(
      wrap.clientWidth,
      wrap.clientHeight,
      isCompact,
      barHeight,
      seatCount,
      readBottomInset(),
      layoutHeight || barHeight
    );
    // maxDockScale is compared like every other field, and has to be: it is
    // the only one that can move on its own (a taller bar changes what the
    // bar is allowed to grow to without moving vf, which is pinned at its
    // floor on exactly the viewports where this matters), and a fit held back
    // here never reaches draggablePanel's bounds.
    setFit((prev) => (fitsMatch(prev, next) ? prev : next));
  }, [seatCount, dockBarRef]);

  // Every render, not only on the events below: the bar's on-screen height
  // changes with a transform nothing observes (see the note above the hook),
  // and a resize drag is a re-render. Cheap and self-limiting -- setFit above
  // returns the previous object unless something actually moved.
  useLayoutEffect(apply);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

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
  }, [apply]);

  return { wrapRef, dockRef, ...fit };
}
