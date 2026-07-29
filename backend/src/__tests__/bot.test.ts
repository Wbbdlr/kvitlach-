import { describe, expect, it } from "vitest";
import { decideBotAction, decideBotBet } from "../bot";
import { Card } from "../types";

const card = (values: number[]): Card => ({ name: values.join("/"), attributes: { values } });

describe("decideBotBet", () => {
  it("never bets more than the wallet, the available bank window, or 5", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(decideBotBet(3, 100)).toBeLessThanOrEqual(3);
      expect(decideBotBet(100, 2)).toBeLessThanOrEqual(2);
      expect(decideBotBet(100, 100)).toBeLessThanOrEqual(5);
    }
  });

  it("always bets at least $1 when there's room to", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(decideBotBet(100, 100)).toBeGreaterThanOrEqual(1);
    }
  });

  it("bets 0 (plays it as a blatt) when the wallet or bank window is empty", () => {
    expect(decideBotBet(0, 100)).toBe(0);
    expect(decideBotBet(100, 0)).toBe(0);
  });
});

describe("decideBotAction", () => {
  it("hits below 17", () => {
    expect(decideBotAction([card([10]), card([6])])).toBe("hit"); // 16
  });

  it("stands at 17 or above", () => {
    expect(decideBotAction([card([10]), card([7])])).toBe("stand"); // 17
    expect(decideBotAction([card([10]), card([10])])).toBe("stand"); // 20
  });

  it("stands rather than hit again once already busted (nothing left to improve)", () => {
    expect(decideBotAction([card([10]), card([9]), card([9])])).toBe("stand"); // 28, busted
  });
});
