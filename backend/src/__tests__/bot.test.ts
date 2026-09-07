import { describe, expect, it } from "vitest";
import { decideBotAction, decideBotBet, decideBotEleveroon } from "../bot";
import { Card } from "../types";

const card = (values: number[]): Card => ({ name: values.join("/"), attributes: { values } });

describe("decideBotBet", () => {
  // One id per temperament, asserted below rather than trusted -- picking ids
  // by eye is exactly how this list rots into several copies of one bucket
  // and turns every "they differ" test into a coin flip. Real bots get uuids
  // (store.ts), which spread evenly across the bands.
  //
  // There were three temperaments and there are now five: three bands for a
  // table of up to ten bots meant most seats had a twin, which is the same
  // "one player copied five times" complaint the temperaments were added for,
  // just less severe.
  // Computed against the hash, not guessed: bot-3/bot-7/bot-1/bot-5/bot-2 land
  // in bands 0..4 respectively. Real bots get uuids (store.ts), which spread
  // evenly -- measured at 10034/9864/9971/10172/9959 over 50,000.
  const ids = ["bot-3", "bot-7", "bot-1", "bot-5", "bot-2"];

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
    const sorted = ids.map((id) => meanBet(id)).sort((a, b) => a - b);
    // Every band is actually represented and none of these ids collide:
    // sorted, each mean is clear of the next by more than sampling noise.
    // Without this the suite would still pass with bands unreachable.
    //
    // Written as "every consecutive gap" rather than two hand-tuned numbers,
    // which is what the previous version had and what broke the moment the
    // bands went from three to five: the gaps narrow as bands are added, and
    // a threshold picked for three says nothing about five.
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(8);
    }
    // And the spread as a whole is still wide: the boldest bot bets several
    // times what the timid one does, which is the point of the feature.
    expect(sorted[sorted.length - 1]).toBeGreaterThan(sorted[0] * 2.5);
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

// Bet sizing is a percentage of the WALLET, and a wallet only ever shrinks --
// so an hour into a session every bot has drifted down to pushing $1 and the
// table goes inert. Measured on the $100 default before the floor: five bots
// down to $15 each all bet $1-$3.
describe("bot bet sizing over a losing night", () => {
  const ids = ["bot-3", "bot-7", "bot-1", "bot-5", "bot-2"];
  const samples = (wallet: number, id: string, buyIn = 100) =>
    Array.from({ length: 400 }, () => decideBotBet(wallet, 100000, id, buyIn));

  it("keeps a short stack betting like it is still at the table", () => {
    // A bot down to $15 of a $100 buy-in. Without the floor every one of
    // these collapsed to $1-$3.
    const top = Math.max(...ids.flatMap((id) => samples(15, id)));
    expect(top).toBeGreaterThanOrEqual(5);
  });

  // The floor lifts a fallen wallet; it must never invent money.
  it("never stakes more than the stack, however small", () => {
    for (const wallet of [1, 2, 3, 5, 8, 12, 15]) {
      for (const id of ids) {
        for (const bet of samples(wallet, id)) {
          expect(bet).toBeLessThanOrEqual(wallet);
          expect(bet).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  // The opposite failure, which this file already warns about: a bot that can
  // lose a third of its stack a hand is broke in three and spends the rest of
  // the night playing $0 blatts -- which looks exactly like the inert table
  // the floor exists to prevent.
  it("caps a short stack's wager at 40% of what it actually holds", () => {
    for (const wallet of [5, 8, 12, 15, 30]) {
      const top = Math.max(...ids.flatMap((id) => samples(wallet, id)));
      expect(top).toBeLessThanOrEqual(Math.max(1, Math.ceil(wallet * 0.4)));
    }
  });

  it("leaves a healthy stack entirely to its temperament", () => {
    const top = Math.max(...ids.flatMap((id) => samples(100, id)));
    expect(top).toBeLessThanOrEqual(20);
    expect(top).toBeGreaterThan(12);
  });

  // The variety is meant to be BETWEEN bots, and three bands for a table of
  // up to ten meant most seats had a twin.
  it("gives a table of five bots more than three distinct betting bands", () => {
    const bands = new Set(ids.map((id) => {
      const s = samples(100, id);
      return `${Math.min(...s)}-${Math.max(...s)}`;
    }));
    expect(bands.size).toBeGreaterThanOrEqual(4);
  });

  it("still works with no buy-in passed at all", () => {
    for (const bet of samples(100, "bot-1", 0)) {
      expect(bet).toBeGreaterThanOrEqual(1);
      expect(bet).toBeLessThanOrEqual(100);
    }
  });
});
