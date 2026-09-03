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
// Confirmed live: the button sat at the exact viewport centre with no dock
// present, and at the right edge with the fix in place.
//
// jsdom does not implement :has() layout effects (it doesn't lay out at
// all), so there's nothing to render here -- same reasoning as
// cssOverrideOrder.test.ts and snapshot.test.ts's own source-assertion
// tests. What's pinned is that the selector exists and targets exactly the
// "no dock" case, not every state.
const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

describe(".k-controls stops centering when the reaction button is alone", () => {
  it("has a :has() override keyed on .k-chrome-react being the row's only child", () => {
    expect(CSS).toMatch(/\.k-controls:has\(\.k-dock-row > \.k-chrome-react:only-child\)\s*\{/);
  });

  it("the override switches away from centering", () => {
    const match = CSS.match(/\.k-controls:has\(\.k-dock-row > \.k-chrome-react:only-child\)\s*\{([^}]*)\}/);
    expect(match, "the :has() override rule itself wasn't found").toBeTruthy();
    expect(match![1]).toContain("justify-content: flex-end");
  });

  it("does not touch the base .k-controls rule -- every state WITH a dock still centers", () => {
    const base = CSS.match(/^\.k-controls \{([^}]*)\}/m);
    expect(base, "no top-level .k-controls rule found -- did it move or get renamed?").toBeTruthy();
    expect(base![1]).toContain("justify-content: center");
  });
});
