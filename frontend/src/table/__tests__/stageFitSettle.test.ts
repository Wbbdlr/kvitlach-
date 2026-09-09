import { describe, expect, it } from "vitest";
import { fitsMatch } from "../stage";
import type { StageFit } from "../stage";

// The guard that stops the stage measuring itself into a render loop.
//
// useStageScale's apply() runs in a useLayoutEffect with no dependency array,
// so every fit it treats as NEW schedules a render that measures again. The
// measurement is not stable to the last decimal -- getBoundingClientRect
// returns fractional pixels, and the row it measures carries the very
// transform this fit sets -- so an exact === comparison let two values a
// fraction apart alternate forever. React aborts that at ~50 nested updates
// with #185, which a player hit mid-round at a real table on 2026-09-09.

const base: StageFit = {
  scale: 0.734375,
  stageHeight: 760,
  vf: 0.92,
  playTop: 118.5,
  compact: false,
  maxDockScale: 1.15,
};

const with_ = (over: Partial<StageFit>): StageFit => ({ ...base, ...over });

describe("two fits are the same one when", () => {
  it("they are identical", () => {
    expect(fitsMatch(base, { ...base })).toBe(true);
  });

  it("the scale differs by less than a twentieth of a percent", () => {
    // The actual shape of the crash: a sub-pixel bar height moves the computed
    // scale by a hair, every render, forever.
    expect(fitsMatch(base, with_({ scale: base.scale + 0.0001 }))).toBe(true);
  });

  it("a measured height differs by a fraction of a pixel", () => {
    expect(fitsMatch(base, with_({ playTop: base.playTop + 0.25 }))).toBe(true);
    expect(fitsMatch(base, with_({ stageHeight: base.stageHeight + 0.4 }))).toBe(true);
  });
});

describe("two fits are different when", () => {
  it("the scale moves enough to see", () => {
    // A resize drag or a rotation moves it far more than this.
    expect(fitsMatch(base, with_({ scale: base.scale + 0.01 }))).toBe(false);
  });

  it("the layout moves a whole pixel", () => {
    expect(fitsMatch(base, with_({ playTop: base.playTop + 1 }))).toBe(false);
    expect(fitsMatch(base, with_({ stageHeight: base.stageHeight + 1 }))).toBe(false);
  });

  it("the viewport crosses the compact breakpoint", () => {
    // A boolean, compared exactly -- there is no such thing as nearly compact.
    expect(fitsMatch(base, with_({ compact: true }))).toBe(false);
  });

  it("maxDockScale moves, which nothing else would catch", () => {
    // It is the one field that can move on its own: a taller bar changes what
    // the bar may grow to without moving vf. A fit held back here never
    // reaches draggablePanel's bounds.
    expect(fitsMatch(base, with_({ maxDockScale: base.maxDockScale + 0.05 }))).toBe(false);
  });

  it("vf moves, which is the whole vertical fit", () => {
    expect(fitsMatch(base, with_({ vf: base.vf + 0.01 }))).toBe(false);
  });
});
