import { describe, expect, it } from "vitest";
import { decideBotAction, decideBotBet, decideBotEleveroon } from "../bot";
import { Card } from "../types";

const card = (values: number[]): Card => ({ name: values.join("/"), attributes: { values } });

describe("decideBotBet", () => {
  // One id per temperament. Checked by hand against the hash (bot-1 -> timid,
  // bot-3 -> steady, bot-5 -> bold) and then asserted below, because picking
  // ids by eye is exactly how this list would rot into three copies of one
  // bucket and turn every "they differ" test into a coin flip. Real bots get
  // uuids (store.ts), which spread evenly across the three -- measured at
  // 3020/3023/2957 over 9,000.
  const ids = ["bot-1", "bot-3", "bot-5"];

  const meanBet = (id: string, wallet = 1000, rounds = 400) => {
    let sum = 0;
    for (let i = 0; i < rounds; i += 1) sum += decideBotBet(wallet, 100000, id);
    return sum / rounds;
  };

  it("never bets more than the wallet or the available bank window", () => {
    // This is the invariant the whole function exists under: a bot must never
    // be able to trigger insufficient_funds or bank_limit. It outranks the
    // temperament -- a bold bot wanting 20% of $100 in a $2 window bets $2.
    for (const id of ids) {
      for (let i = 0; i < 50; i += 1) {
        expect(decideBotBet(3, 100, id)).toBeLessThanOrEqual(3);
        expect(decideBotBet(100, 2, id)).toBeLessThanOrEqual(2);
        expect(decideBotBet(100, 100, id)).toBeLessThanOrEqual(100);
      }
    }
  });

  it("always bets at least $1 when there's room to", () => {
    for (const id of ids) {
      for (let i = 0; i < 50; i += 1) {
        expect(decideBotBet(100, 100, id)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("bets 0 (plays it as a blatt) when the wallet or bank window is empty", () => {
    expect(decideBotBet(0, 100)).toBe(0);
    expect(decideBotBet(100, 0)).toBe(0);
  });

  it("bets whole chips only", () => {
    for (const id of ids) {
      for (let i = 0; i < 50; i += 1) {
        expect(decideBotBet(137, 500, id) % 1).toBe(0);
      }
    }
  });

  it("gives different bots different betting ranges", () => {
    // The actual bug: every bot drew $1-5 from one distribution, so a table of
    // five read as one timid player copied five times. Compares MEANS over many
    // rounds rather than single draws -- the ranges overlap by design (a bold
    // bot's quiet hand and a timid bot's loud one should be able to collide),
    // and asserting on one sample each would be a flaky test of nothing.
    const means = ids.map((id) => meanBet(id));
    // All three buckets are actually represented: sorted, each is clear of the
    // next by more than sampling noise. Without this the suite would still pass
    // with two of the three temperaments unreachable.
    const sorted = [...means].sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeGreaterThan(15);
    expect(sorted[2] - sorted[1]).toBeGreaterThan(30);
  });

  it("is the SAME bot every time -- temperament rides the id, not the round", () => {
    // A bot whose personality was redrawn each hand would vary the numbers and
    // still not populate the table: the point is that seat 3 is recognisably
    // the reckless one, hand after hand and across a server restart.
    for (const id of ids) {
      expect(Math.abs(meanBet(id) - meanBet(id))).toBeLessThan(15);
    }
  });

  it("scales with the wallet instead of sitting under a flat ceiling", () => {
    // The old rule capped every bet at $5 regardless of stack, so a bot with
    // $2,000 bet the same as one with $20 and the table never felt any
    // different as the game went on.
    expect(meanBet("bot-3", 2000, 300)).toBeGreaterThan(meanBet("bot-3", 100, 300) * 5);
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
