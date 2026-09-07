import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Reported: "the reset button for the main control bar is still clipped by
// the border of the control panel." .k-dock-grip / .k-dock-reset
// (DockGrips.tsx) are position: absolute children of .k-dock and hang off
// its corners on purpose, poking outside the border the same way
// .k-viewer-hud-reset pokes outside the readout. An element with a
// non-visible overflow-x also forces its own overflow-y to auto (CSS has no
// way to scroll one axis and stay visible on the other), so the compact
// breakpoint's "last resort" horizontal scroll -- there is genuinely no
// honest way to fit six controls in one row below ~600px -- must never land
// on .k-dock itself. .k-dock-content is the inner wrapper introduced to
// carry it instead; see index.css's own comment on .k-dock for the fuller
// account.
//
// jsdom does not lay out @media queries or :has() at all, so there is
// nothing to render here -- same reasoning as chromeReactCentering.test.ts.
// What's pinned is that no rule anywhere in the file gives .k-dock a
// non-visible overflow of either axis, and that the scroll fallback that
// used to be there targets .k-dock-content now.
const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

function dockRuleBodies(): string[] {
  // ".k-dock {" as an exact, standalone selector -- not a prefix match, so
  // ".k-dock-content {", ".k-dock-row {" etc. are excluded on their own,
  // and ".k-dock .k-toggle {" (a descendant selector) is excluded because
  // ".k-dock" there is followed by " .k-toggle", not " {".
  const re = /(?:^|\s)\.k-dock \{([^}]*)\}/gm;
  return [...CSS.matchAll(re)].map((m) => m[1]);
}

describe(".k-dock never clips -- DockGrips hangs off its corners on purpose", () => {
  it("no .k-dock rule sets a non-visible overflow on either axis", () => {
    const bodies = dockRuleBodies();
    expect(bodies.length, "no '.k-dock {' rule found at all -- did it move or get renamed?").toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toMatch(/overflow(-x|-y)?\s*:\s*(hidden|auto|scroll|clip)/);
    }
  });

  it("the compact breakpoint's horizontal-scroll fallback targets .k-dock-content, not .k-dock", () => {
    expect(CSS).toMatch(/\.k-dock-row > \.k-dock > \.k-dock-content \{[^}]*overflow-x:\s*auto/);
  });
});
