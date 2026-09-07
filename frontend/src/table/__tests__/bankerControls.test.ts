import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
const DEALER = readFileSync(resolve(__dirname, "../Dealer.tsx"), "utf8");

// The banker acts every single round, and their mis-taps are the expensive
// ones -- yet Hit and Stand were measured at 22x27 and 32x27 on a 854x384
// phone, roughly a quarter the area of the player's own buttons and the
// smallest controls anywhere in the app.
//
// That is not a missing min-height. These buttons sit ON the scaled stage
// (TableRoot sets --stage-scale, which is ~0.5 on a phone), so a 44px rule
// written here renders at 22 physical px, while the player's dock lives in
// the unscaled HUD and gets its 44 for free. Any fix that does not divide by
// the scale is measuring the wrong pixels -- which is exactly how a control
// floor the codebase states in its own comments was missed for months.

describe("the banker's mid-hand controls", () => {
  it("gives Hit and Stand their own class rather than sharing the felt's sm buttons", () => {
    expect(DEALER).toContain("k-bank-act");
  });

  it("sizes them against the screen, not against the stage", () => {
    const rule = CSS.slice(CSS.indexOf(".k-bank-act .k-btn"));
    expect(rule.slice(0, 400)).toContain("var(--stage-scale");
  });

  it("asks for at least 44 screen-px of height", () => {
    const rule = CSS.slice(CSS.indexOf(".k-bank-act .k-btn"), CSS.indexOf(".k-bank-act .k-btn") + 400);
    // 44 is the floor the codebase states in its own comments and had never
    // enforced anywhere (docs/mobile-ui.md's checklist, ChromeMenu.tsx:32).
    expect(rule).toMatch(/min-height:[^;]*44px[^;]*var\(--stage-scale/);
  });

  it("keeps a sane size when the stage is scaled UP past 1 on a desktop", () => {
    const rule = CSS.slice(CSS.indexOf(".k-bank-act .k-btn"), CSS.indexOf(".k-bank-act .k-btn") + 400);
    // Dividing alone shrinks these below the felt's other controls wherever
    // --stage-scale > 1, which it genuinely is on a wide desktop.
    expect(rule).toContain("max(");
  });
});
