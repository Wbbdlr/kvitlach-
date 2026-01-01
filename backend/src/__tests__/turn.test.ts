import { describe, expect, it } from "vitest";
import { calcState, getCombinations, getSums } from "../turn";
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
    expect(getCombinations([1, 2], [10, 20])).toEqual([11, 21, 12, 22]);
    expect(getSums([{ name: "12", attributes: { values: [12, 9, 10] } } as Card])).toEqual([12, 9, 10]);
  });
});
