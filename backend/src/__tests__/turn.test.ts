import { describe, expect, it } from "vitest";
import { calcState, calcSums, getSums } from "../turn";
import { Card } from "../types";

const rosierCard: Card = { name: "2", attributes: { values: [2], type: "rosier" } };

describe("turn logic", () => {
  it("wins on 21", () => {
    const cards: Card[] = [
      { name: "10", attributes: { values: [10] } },
      { name: "11", attributes: { values: [11], type: "rosier" } },
    ];
    expect(calcState(cards)).toBe("won");
  });

  it("wins on rosier pair", () => {
    const cards: Card[] = [rosierCard, { ...rosierCard, name: "11" }];
    expect(calcState(cards)).toBe("won");
  });

  it("loses when all sums exceed 21", () => {
    const cards: Card[] = [
      { name: "12", attributes: { values: [12, 9, 10] } },
      { name: "12", attributes: { values: [12, 9, 10] } },
      { name: "10", attributes: { values: [10] } },
    ];
    expect(calcState(cards)).toBe("lost");
  });

  it("combines sums correctly", () => {
    // Order isn't part of the contract -- only which totals are reachable.
    expect([...calcSums([[1, 2], [10, 20]])].sort((a, b) => a - b)).toEqual([11, 12, 21, 22]);
    expect(getSums([{ name: "12", attributes: { values: [12, 9, 10] } } as Card])).toEqual([12, 9, 10]);
  });

  it("keeps every reading of a hand of 12s within reach instead of locking one in", () => {
    const c12: Card = { name: "12", attributes: { values: [12, 9, 10] } };
    // 12+12 can be read as 21 (12+9 or 9+12), 18, 19, 20 -- all still on the table.
    const sums = getSums([c12, c12]);
    [18, 19, 20, 21].forEach((total) => expect(sums).toContain(total));
  });

  it("collapses duplicate and busted readings so a hand of 12s can't grow exponentially", () => {
    const c12: Card = { name: "12", attributes: { values: [12, 9, 10] } };
    // Un-pruned this is 3^20 combinations. Bounded, it can only ever hold the
    // sums 1..21 plus one busted representative.
    const sums = getSums(Array.from({ length: 20 }, () => c12));
    expect(sums.length).toBeLessThanOrEqual(22);
    expect(new Set(sums).size).toBe(sums.length); // no duplicates
    // 20 twelves is a bust however you read it -- lowest possible is 20x9=180.
    expect(sums.every((s) => s > 21)).toBe(true);
    expect(calcState(Array.from({ length: 20 }, () => c12))).toBe("lost");
  });

  it("reports the smallest busted total when every reading is over 21", () => {
    const cards: Card[] = [
      { name: "10", attributes: { values: [10] } },
      { name: "10", attributes: { values: [10] } },
      { name: "12", attributes: { values: [12, 9, 10] } },
    ];
    // 20 + (9|10|12) -> 29, 30, 32. Only the smallest is kept, which is what a
    // busted hand shows the player.
    expect(getSums(cards)).toEqual([29]);
  });

  it("treats a hand with nothing readable as an empty total rather than throwing", () => {
    // calcSums used to reduce with no seed value, so an all-ignored (or empty)
    // hand threw out of the middle of the game engine.
    expect(getSums([])).toEqual([0]);
    expect(calcState([])).toBe("pending");
  });
});
