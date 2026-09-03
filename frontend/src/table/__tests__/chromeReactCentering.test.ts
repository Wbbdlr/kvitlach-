import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Reported: "while the control bar is away (awaiting turn) the emoji
// reaction picker overlaps with the player's card."
//
// .k-controls centers .k-dock-stack under the viewer's own seat -- right
// when there's a dock in it (a bet field, a "Table ready" panel) worth
// centering as a group. It stops being right the instant .k-dock-row holds
// nothing but the reaction button: centering one 36px icon under your own
// seat puts it, and the picker it opens, directly on top of your own cards.
//
// First fix moved to .k-controls itself (justify-content: flex-end there)
// -- confirmed live it centered the button correctly, and ALSO confirmed
// live a second bug: .k-controls has exactly one flex child (the stack),
// so re-aligning it moved the stack's own box, taking .k-viewer-hud with
// it (position: absolute, left: 0 of THAT box) -- reported as the readout
// "reverting to a space off screen" the moment it wasn't the viewer's turn.
// Fixed for real by targeting .k-dock-stack instead: width: 100% keeps the
// stack's box exactly where .k-controls always put it (so the readout's
// left: 0 still means the viewport's own left edge), and only the ROW's
// alignment inside that now-full-width stack needs to change, which costs
// the readout nothing -- it was never part of that flex flow to begin
// with. Confirmed live both ways: the button at the viewport's right edge,
// the readout still at its normal left-edge position, in the same frame.
//
// jsdom does not implement :has() layout effects (it doesn't lay out at
// all), so there's nothing to render here -- same reasoning as
// cssOverrideOrder.test.ts and snapshot.test.ts's own source-assertion
// tests. What's pinned is that the selector exists, targets exactly the
// "no dock" case, and lands on .k-dock-stack rather than .k-controls.
const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

const SELECTOR = /\.k-controls:has\(\.k-dock-row > \.k-chrome-react:only-child\) \.k-dock-stack \{([^}]*)\}/;

describe(".k-controls stops centering when the reaction button is alone", () => {
  it("has a :has() override keyed on .k-chrome-react being the row's only child, scoped to .k-dock-stack", () => {
    expect(CSS).toMatch(SELECTOR);
  });

  it("the override widens the stack and pushes the row to the end, without touching .k-controls", () => {
    const match = CSS.match(SELECTOR);
    expect(match, "the :has() override rule itself wasn't found").toBeTruthy();
    expect(match![1]).toContain("width: 100%");
    expect(match![1]).toContain("justify-content: flex-end");
  });

  it("does not touch the base .k-controls rule -- every state WITH a dock still centers", () => {
    const base = CSS.match(/^\.k-controls \{([^}]*)\}/m);
    expect(base, "no top-level .k-controls rule found -- did it move or get renamed?").toBeTruthy();
    expect(base![1]).toContain("justify-content: center");
  });

  it("does not re-target .k-controls itself for the no-dock override (the readout regression)", () => {
    // The exact shape of the first, wrong fix -- :has() applied directly to
    // .k-controls with no descendant selector after it. Fails if this ever
    // comes back, whatever the specific declarations inside it are.
    expect(CSS).not.toMatch(/\.k-controls:has\(\.k-dock-row > \.k-chrome-react:only-child\)\s*\{/);
  });
});
