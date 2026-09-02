import { describe, expect, it } from "vitest";
import { decideBotAction, decideBotBet, decideBotEleveroon } from "../bot";
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

describe("decideBotEleveroon", () => {
  it("claims it on a hand readable as exactly 11", () => {
    // The reported case: a bot sitting on 11 drew an 11 and futched, every
    // time, because nothing ever opted in on its behalf.
    expect(decideBotEleveroon([card([3]), card([8])])).toBe(true);
    expect(decideBotEleveroon([card([11])])).toBe(true);
  });

  it("claims it when 11 is reachable but is not the best reading of the hand", () => {
    // The 12 is worth 12, 9 or 10 and is re-read at every evaluation, so
    // 12+2 is readable as 11 even though winningNumber() would say 14.
    // Asking winningNumber here instead of getSums would decline protection
    // on precisely the hands the rule exists for.
    expect(decideBotEleveroon([card([12, 9, 10]), card([2])])).toBe(true);
  });

  it("does not claim it on a hand that is not at 11", () => {
    expect(decideBotEleveroon([card([10]), card([6])])).toBe(false); // 16
    expect(decideBotEleveroon([card([5])])).toBe(false);
  });

  it("does not claim it on a busted hand", () => {
    // Nothing achievable left, so there is no reading of 11 to protect.
    expect(decideBotEleveroon([card([10]), card([9]), card([9])])).toBe(false);
  });
});
