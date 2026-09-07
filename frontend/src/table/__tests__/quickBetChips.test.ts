import { describe, expect, it } from "vitest";
import { quickBetChips, defaultBet } from "../PlayerDock";

// The chips were a hardcoded [5, 10, 25] and the opening bet a hardcoded 5.
// Those are 5/10/25% of the $100 table they were picked on, and the practice
// lobby alone offers $20 through $1,000.
describe("quick-bet chips", () => {
  // The whole point of the fractions: the table everyone actually plays is
  // unchanged, so this is not a behaviour change for the common case.
  it("gives the original 5 / 10 / 25 on a $100 table", () => {
    expect(quickBetChips(100)).toEqual([5, 10, 25]);
    expect(defaultBet(100)).toBe(5);
  });

  it("scales up so a big table's presets are worth tapping", () => {
    expect(quickBetChips(500)).toEqual([25, 50, 125]);
    expect(quickBetChips(1000)).toEqual([50, 100, 250]);
  });

  it("scales down so a small table's presets are not a third of the stack", () => {
    expect(quickBetChips(20)).toEqual([1, 2, 5]);
  });

  // Rounding can land two fractions on the same figure. Three buttons reading
  // the same amount is worse than two reading different ones.
  it("never offers the same amount twice", () => {
    for (const buyIn of [10, 12, 15, 20, 25, 40, 60, 100, 250, 500, 1000]) {
      const chips = quickBetChips(buyIn);
      expect(new Set(chips).size).toBe(chips.length);
      expect([...chips].sort((a, b) => a - b)).toEqual(chips);
    }
  });

  it("never offers a chip below $1, whatever the table", () => {
    for (const buyIn of [0, 1, 5, 10]) {
      expect(Math.min(...quickBetChips(buyIn))).toBeGreaterThanOrEqual(1);
    }
  });

  // A room persisted before buyIn existed, or a malformed one, must not
  // produce a dock with no chips on it.
  it("falls back to the $100 table on a missing or nonsense buy-in", () => {
    expect(quickBetChips(0)).toEqual([5, 10, 25]);
    expect(quickBetChips(-50)).toEqual([5, 10, 25]);
  });
});
