import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMPACT_MEDIA_QUERY } from "../stage";

const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

// stage.ts decides in JS whether the table is "compact" (which controls what
// TableRoot renders); index.css decides in CSS how a compact table is styled.
// The two must agree on where the line is, and the string is written in both.
//
// Unlike the portrait gate -- one predicate, hiding the whole table, so its
// CSS rule could simply be deleted -- this one legitimately styles many rules
// and has to exist in both files. So it is pinned rather than eliminated:
// docs/mobile-ui.md Part 4 has described this test as existing for months
// while it did not.
//
// The failure it prevents is not subtle in effect and is completely silent in
// review: a phone that matches one file's idea of compact and not the other's
// gets the compact JS layout with desktop CSS, or the reverse.

describe("the compact breakpoint", () => {
  it("is written the same way in index.css as in stage.ts", () => {
    expect(CSS).toContain(`@media ${COMPACT_MEDIA_QUERY}`);
  });

  it("has no near-miss variants anywhere in index.css", () => {
    // Any @media block mentioning one of these two dimensions must be the
    // agreed query verbatim, or one of the deliberate exceptions below. This
    // is what catches a seventh block typed from memory as 521px or 400px.
    // Every OTHER breakpoint in the file, listed with what it is for. The
    // point is not that these four are wrong -- they are all deliberate and
    // all answer a different question -- it is that a fifth appearing without
    // a line here is almost certainly the compact query typed from memory.
    const exceptions = [
      // Part 4's own predicates. Different questions, different numbers,
      // documented where they are declared.
      "(orientation: portrait) and (max-width: 540px)",
      "(max-height: 440px) and (min-width: 541px)",
      // The two halves of compact, used alone and on purpose. Width only:
      // the appearance panel cannot anchor to its chip on a narrow screen and
      // pins to the viewport instead (540 here, matching the portrait gate's
      // width rather than compact's 520 -- it is a "is this screen narrow"
      // question, not a "is this the compact layout" one). Height only: on a
      // landscape phone the chrome is 61px of 384 and the panel would hang
      // down the felt, so it tightens.
      "(max-width: 540px)",
      "(max-height: 440px)",
      // Ordinary responsive tiers, nowhere near the phone breakpoints.
      "(max-width: 767px)",
      "(max-width: 1279px)",
    ];
    const blocks = [...CSS.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1].trim());
    const suspicious = blocks.filter(
      (q) =>
        (q.includes("max-width") || q.includes("max-height")) &&
        q !== COMPACT_MEDIA_QUERY &&
        !exceptions.includes(q)
    );
    expect(suspicious).toEqual([]);
  });

  it("is used by more than one block, which is why it needs pinning at all", () => {
    const uses = CSS.split(`@media ${COMPACT_MEDIA_QUERY}`).length - 1;
    expect(uses).toBeGreaterThan(1);
  });
});
