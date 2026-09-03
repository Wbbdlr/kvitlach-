import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The portrait gate hides the ENTIRE table (.k-fit) behind a full-screen
// "turn your phone sideways" cover, because a portrait phone does not render
// the table so much as a squashed caricature of it -- ~0.30 stage scale at
// 390x844, seat nameplates under 4px.
//
// That raises the stakes on one predicate. It used to be written twice, once
// in index.css and once in TableRoot.tsx, with a comment in each admitting
// nothing enforced the match. When the consequence of the two disagreeing was
// "the nudge banner shows in the wrong place", that was untidy. Now that one
// of them hides the whole game, a disagreement is a blank screen: CSS hiding
// .k-fit at a width where JS declines to render the cover leaves a player
// looking at nothing at all, with no button on it.
//
// So there is exactly one copy, it lives in TableRoot.tsx, and this asserts
// it. A render test cannot: jsdom has no orientation, and the failure only
// exists in the gap between two files.

const ROOT = resolve(__dirname, "../..");
const CSS = readFileSync(resolve(ROOT, "index.css"), "utf8");
const TABLE_ROOT = readFileSync(resolve(ROOT, "table/TableRoot.tsx"), "utf8");

const QUERY = "(orientation: portrait) and (max-width: 540px)";

describe("the portrait gate's breakpoint", () => {
  it("is written exactly once, in TableRoot.tsx", () => {
    const inTsx = TABLE_ROOT.split(QUERY).length - 1;
    expect(inTsx).toBe(1);
  });

  it("is not duplicated in index.css for anything that hides the table", () => {
    // index.css may still carry portrait rules of its own (the chrome-top wrap
    // fix, for one) -- what it must not carry is a second copy of THIS gate's
    // query, or any rule that hides .k-fit on its own authority.
    const gateRules = CSS.split("\n").filter(
      (line) => line.includes(".k-fit") && line.includes("is-portrait-blocked")
    );
    expect(gateRules.length).toBe(1);
    expect(CSS).not.toContain(`@media ${QUERY}`.replace("@media ", "@media "));
    // The cover itself must have no media query gating it either -- it is
    // rendered conditionally or not at all.
    const gateBlock = CSS.slice(CSS.indexOf(".k-rotate-gate {"));
    expect(gateBlock.slice(0, gateBlock.indexOf("}"))).not.toContain("@media");
  });

  it("keeps the escape hatch for a phone with rotation lock on", () => {
    // Plenty of people play with rotation lock on, and for them "turn your
    // phone" is advice they cannot take. Without a way through, the gate is a
    // dead end with their money on the table. This is the one control that
    // must never be quietly dropped as "clutter".
    expect(TABLE_ROOT).toContain("k-rotate-anyway");
    expect(TABLE_ROOT).toContain("setPortraitOverride(true)");
    expect(CSS).toContain(".k-rotate-anyway");
  });

  it("hides the table rather than unmounting it", () => {
    // A player mid-hand who tips their phone must come back to the same round,
    // not a rejoin -- so the gate is a class on .k-fit, never a `return` that
    // drops the tree and the socket with it.
    expect(TABLE_ROOT).toContain('clsx("k-fit", portraitBlocked && "is-portrait-blocked")');
  });
});
