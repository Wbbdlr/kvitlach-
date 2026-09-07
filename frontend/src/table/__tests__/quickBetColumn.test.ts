import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Reported, after the first (row) version shipped: "the chip pop up is
// still huge and not popping up in a small neat column." A three-across
// ROW was tried first and rendered correctly, just not as what was asked
// for -- column layout, sized to the widest single chip rather than to all
// three side by side, is the actual ask. See .k-quickbets-panel's own
// comment in index.css for why a WRAPPING row (tried before the row) is not
// the same thing as flex-direction: column, even though both end up one
// item per line.
//
// jsdom does not lay flex out at all, so there is nothing to render here --
// same reasoning as chromeReactCentering.test.ts and cssOverrideOrder.test.ts's
// own source-assertion tests. What's pinned is that the rule actually asks
// for a column, not a row.
const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

describe(".k-quickbets-panel lays its chips out as a column", () => {
  it("sets flex-direction: column", () => {
    const match = CSS.match(/\.k-quickbets-panel \{([^}]*)\}/);
    expect(match, ".k-quickbets-panel rule not found -- did it move or get renamed?").toBeTruthy();
    expect(match![1]).toContain("flex-direction: column");
  });
});
