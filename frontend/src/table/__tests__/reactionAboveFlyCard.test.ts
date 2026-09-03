import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Reported: reaction emoji getting covered by dealt cards. Both bubbles now
// portal straight to document.body (Seat.tsx/Dealer.tsx), the same place
// .table-fly-card is appended (animations.ts's flyCard) -- so this is a
// direct, un-nested z-index comparison for the first time. Pinned as a
// RELATIONSHIP (reaction > fly-card), not two hardcoded numbers: either one
// changing later is fine as long as the ordering that fixes the bug survives
// it. A hardcoded pair would pass right up until the day someone bumps one
// number without checking the other, which is exactly how the original bug
// had no test catching it for however long .k-seat's cap existed.
// Comments stripped before searching -- this file's own comments explain
// PAST z-index values by name ("was 45, meaningless outside .k-seat's own
// stacking context (position + z-index: 10, ...")), and a naive
// first-match regex finds those numbers in the prose before it ever reaches
// the real declaration below them. Caught by this test against itself: it
// first reported .k-reaction at 10, which is .k-seat's number, quoted in
// exactly that comment.
const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** selector is a plain class name, e.g. "k-reaction" (no leading dot). */
function zIndexOf(selector: string): number {
  const re = new RegExp(`^\\.${selector} \\{([^}]*)\\}`, "m");
  const match = CSS.match(re);
  if (!match) throw new Error(`no top-level '.${selector} {' rule found -- did it move or get renamed?`);
  const zMatch = match[1].match(/z-index:\s*(\d+)/);
  if (!zMatch) throw new Error(`'.${selector}' has no z-index of its own`);
  return Number(zMatch[1]);
}

describe("reaction bubbles render above dealt-card animations", () => {
  it(".k-reaction's z-index clears .table-fly-card's", () => {
    const reaction = zIndexOf("k-reaction");
    const flyCard = zIndexOf("table-fly-card");
    expect(reaction).toBeGreaterThan(flyCard);
  });
});
