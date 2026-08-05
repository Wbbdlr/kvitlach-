import { describe, expect, it } from "vitest";
import { buildShoe } from "../round.js";

// Regression: buildShoe(deckCount) used to build each deck's own fair
// Fisher-Yates shuffle (deck.ts) and just concatenate them -- correct per
// individual deck, but the ASSEMBLED shoe was never itself shuffled, so
// every deck-aligned 24-card window was guaranteed exactly 2-of-each-rank,
// unlike a genuinely mixed multi-deck shoe (a real shoe's rank composition
// varies window to window). recommendedDeckCount() puts almost any table
// above 1 player onto a multi-deck shoe, so this wasn't a rare edge case.
// A real Kvitlach deck is 24 cards -- 2 copies of each rank 1-12 (deck.ts).
describe("buildShoe -- multi-deck shoe is shuffled as one unit, not deck-by-deck", () => {
  it("does not leave the first 24 cards as a rigid, always-perfectly-balanced block", () => {
    const rankCounts = (cards: ReturnType<typeof buildShoe>) => {
      const counts: Record<string, number> = {};
      cards.forEach((c) => {
        counts[c.name] = (counts[c.name] ?? 0) + 1;
      });
      return counts;
    };
    const isPerfectlyBalanced = (counts: Record<string, number>) =>
      Object.keys(counts).length === 12 && Object.values(counts).every((n) => n === 2);

    // Under the old bug this was true on EVERY trial (probability 1) --
    // deck 1's own shuffle always fully occupied the first 24-card window.
    // Under a real full-shoe shuffle it should be true only on a tiny
    // fraction of trials, so a handful of trials is enough to reliably
    // find a counter-example without flaking.
    let sawUnbalancedWindow = false;
    for (let trial = 0; trial < 30 && !sawUnbalancedWindow; trial += 1) {
      const shoe = buildShoe(2);
      const firstWindow = rankCounts(shoe.slice(0, 24));
      if (!isPerfectlyBalanced(firstWindow)) sawUnbalancedWindow = true;
    }
    expect(sawUnbalancedWindow).toBe(true);
  });

  it("still preserves the full shoe's overall composition -- 4 of each rank for a 2-deck shoe", () => {
    const shoe = buildShoe(2);
    expect(shoe).toHaveLength(48);
    const counts: Record<string, number> = {};
    shoe.forEach((c) => {
      counts[c.name] = (counts[c.name] ?? 0) + 1;
    });
    expect(Object.keys(counts)).toHaveLength(12);
    Object.values(counts).forEach((n) => expect(n).toBe(4));
  });
});
