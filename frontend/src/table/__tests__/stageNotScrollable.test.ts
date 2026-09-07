import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

// The whole table view lives inside `.k-fit`, and the felt's LAYOUT box is
// the full unscaled stage -- 1280x575 on a landscape phone. The scale
// transform that fits it to the viewport does not change layout, so the
// content overflows `.k-fit` by ~96px vertically.
//
// With `overflow: hidden` that leftover is hidden and still SCROLLABLE. No
// scrollbar renders and no drag reaches it, but a single focus() on any
// descendant is enough for the browser to scroll it into view -- and nothing
// ever scrolls it back. Reproduced at 854x384 by starting a round:
// `.k-fit.scrollTop` went 0 -> 96 and stayed there, which puts the top row of
// cards off the screen, the control bar in the middle of the felt, and a
// black band under everything. Reported from an Android phone as "the control
// bar begins too high up on the screen, overlapping my cards a bit".
//
// `overflow: clip` is not a scroll container, so there is nothing to scroll.
// Asserted in the CSS text because no jsdom test can see it: jsdom has no
// layout, so it has no overflow and no scrollTop to get wrong.
describe(".k-fit clips, it does not scroll", () => {
  const block = CSS.slice(CSS.indexOf("\n.k-fit {"), CSS.indexOf("}", CSS.indexOf("\n.k-fit {")));

  it("declares overflow: clip", () => {
    expect(block).toMatch(/overflow:\s*clip/);
  });

  it("keeps overflow: hidden BEFORE it, as the fallback for browsers without clip", () => {
    const hidden = block.indexOf("overflow: hidden");
    const clip = block.indexOf("overflow: clip");
    expect(hidden).toBeGreaterThan(-1);
    expect(clip).toBeGreaterThan(hidden);
  });
});
