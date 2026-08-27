import { describe, expect, it } from "vitest";
import { totalDisplay, tagVariant, allTotals, bestTotal, statusDisplay } from "../selectors";
import { Card, Player, Turn } from "../../types";

const banker: Player = { id: "bank", firstName: "Bank", lastName: "", type: "admin", presence: "online" };
const p1: Player = { id: "p1", firstName: "P1", lastName: "", type: "player", presence: "online" };
const p2: Player = { id: "p2", firstName: "P2", lastName: "", type: "player", presence: "online" };

function makeTurn(player: Player, overrides: Partial<Turn> = {}): Turn {
  return { player, state: "pending", cards: [{ name: "9", attributes: { values: [9] } }], bet: 5, ...overrides };
}

describe("totalDisplay -- a standing player's total must not leak before resolution", () => {
  it("hides a standing (not yet resolved) player's total from other viewers", () => {
    const turn = makeTurn(p1, { state: "standby" });
    const info = totalDisplay(turn, p2.id); // p2 viewing p1
    expect(info.value).toBe("hidden");
  });

  it("still shows the owner their own total the moment they stand", () => {
    const turn = makeTurn(p1, { state: "standby" });
    const info = totalDisplay(turn, p1.id); // p1 viewing themselves
    expect(info.value).toBe("9");
  });

  it("reveals the total to everyone once the round actually resolves the turn to won", () => {
    const turn = makeTurn(p1, { state: "won" });
    const info = totalDisplay(turn, p2.id);
    expect(info.value).toBe("9");
  });

  it("reveals the total to everyone once the round actually resolves the turn to lost", () => {
    const turn = makeTurn(p1, { state: "lost", cards: [{ name: "10", attributes: { values: [10] } }, { name: "9", attributes: { values: [9] } }, { name: "9", attributes: { values: [9] } }] });
    const info = totalDisplay(turn, p2.id);
    expect(info.value).toBe("28"); // a genuine bust total, still shown once lost
  });

  it("still hides a merely-pending (never stood) player's total from other viewers", () => {
    const turn = makeTurn(p1, { state: "pending" });
    const info = totalDisplay(turn, p2.id);
    expect(info.value).toBe("hidden");
  });

  it("does not affect the banker's own hole-card reveal timing", () => {
    // Banker's own turn resolves to "standby" at round end (see round.ts's
    // calculateEndState) -- forceBankerReveal (driven by roundState ===
    // "terminate" in Seat.tsx) is what reveals it then, not the removed
    // isPublicStandby path this fix touched.
    const turn = makeTurn(banker, { state: "standby", cards: [{ name: "9", attributes: { values: [9] } }, { name: "7", attributes: { values: [7] } }] });
    const hiddenInfo = totalDisplay(turn, p1.id, "playing", { forceBankerReveal: false });
    expect(hiddenInfo.value).toBe("hidden");
    const revealedInfo = totalDisplay(turn, p1.id, "terminate", { forceBankerReveal: true });
    expect(revealedInfo.value).toBe("16");
  });

  it("shows the banker's real busted total even when their round net happens to land on exactly $0", () => {
    // calculateEndState (round.ts) repurposes the admin turn's `bet` field to
    // hold the round's net balance once resolved -- 0 there means "broke
    // even" (one seat's win offset another's loss), not "never wagered."
    // Before the isBanker guard, this net-zero bet was misread as blatt
    // phase and the total got recomputed from cards.slice(1), dropping the
    // hole card entirely.
    const turn = makeTurn(banker, {
      state: "lost",
      bet: 0,
      busted: true,
      cards: [
        { name: "10", attributes: { values: [10] } },
        { name: "9", attributes: { values: [9] } },
        { name: "9", attributes: { values: [9] } },
      ],
    });
    const info = totalDisplay(turn, p1.id, "terminate", { forceBankerReveal: true });
    expect(info.value).toBe("28");
  });
});

// This is the client-side mirror of backend/src/turn.ts's calcSums. The rule
// lives in two places, so these expectations are deliberately the same ones
// the backend's own simulate.ts asserts -- if the two ever drift, the total a
// player SEES stops matching the total they're settled on.
describe("allTotals/bestTotal -- the 12 re-reads itself at every point in the round", () => {
  const c = (name: string, values: number[]): Card => ({ name, attributes: { values } });
  const C12 = c("12", [12, 9, 10]);
  const C10 = c("10", [10]);
  const C2 = c("2", [2]);
  const C9 = c("9", [9]);

  it("reads a lone 12 as its highest value", () => {
    expect(bestTotal([C12]).total).toBe(12);
  });

  it("drops the same 12 to a 10 rather than busting the hand at 22", () => {
    expect(allTotals([C12, C10]).sort((a, b) => a - b)).toContain(20);
    expect(bestTotal([C12, C10]).total).toBe(20);
  });

  it("drops that 12 again to a 9 when a third card makes 21 reachable", () => {
    expect(bestTotal([C12, C10, C2]).total).toBe(21);
  });

  it("only reports a bust when every reading is over 21, and shows the smallest", () => {
    const busted = bestTotal([C12, C12, C12]);
    expect(busted.total).toBeUndefined();
    expect(busted.bustedTotal).toBe(27); // 9+9+9, the kindest reading available
  });

  it("stays bounded rather than tripling per 12, so a long hand can't hang the tab", () => {
    const totals = allTotals(Array.from({ length: 20 }, () => C12));
    expect(totals.length).toBeLessThanOrEqual(22);
    expect(new Set(totals).size).toBe(totals.length);
  });

  it("shows the owner the re-read total, not a fixed-value one", () => {
    const owner: Player = { id: "me", firstName: "Me", lastName: "", type: "player", presence: "online" };
    const turn: Turn = { player: owner, state: "pending", cards: [C12, C9], bet: 5 };
    expect(totalDisplay(turn, owner.id).value).toBe("21");
  });
});

describe("tagVariant -- the banker's own status pill must match a player's", () => {
  // Dealer.tsx used to compute this inline with only "turn"/"stand"/"muted",
  // silently dropping WON/FUTCHED! to a dull grey "muted" pill for the
  // banker's own bust or win. Both seats now share this one mapping.
  it("shows the same red 'bust' variant for FUTCHED! as for a plain LOST", () => {
    expect(tagVariant("FUTCHED!", false)).toBe("bust");
    expect(tagVariant("LOST", false)).toBe("bust");
  });

  it("shows the green 'won' variant for WON", () => {
    expect(tagVariant("WON", false)).toBe("won");
  });

  it("prioritizes the active-turn variant over the label", () => {
    expect(tagVariant("FUTCHED!", true)).toBe("turn");
  });

  it("falls back to muted for anything else", () => {
    expect(tagVariant("PUSH", false)).toBe("muted");
    expect(tagVariant("Waiting...", false)).toBe("muted");
  });
});

// A banker plays ONE hand against the whole table, so "did the bank win?" has
// no single answer -- an 18 beats a 17 and loses to a 20 in the same round.
// The server's turn.state can't say, because it doubles as the banker's MONEY
// result: a banker who beat three players but paid out one big wager settles
// to "lost", which a player holding 17 read as "the bank lost to my 17".
describe("statusDisplay -- the banker's outcome against a whole table", () => {
  const settled = (over: Partial<Turn>): Turn =>
    makeTurn(banker, { state: "standby", beat: 0, lostTo: 0, ...over });

  it("does not call it a loss when the bank beat some players and lost to others", () => {
    // The exact shape of the reported bug: state "lost" (down on money),
    // hand of 18, but it still beat two of the three players.
    const turn = settled({ state: "lost", beat: 2, lostTo: 1 });
    expect(statusDisplay(turn).label).toBe("BEAT 2 · LOST 1");
    expect(tagVariant(statusDisplay(turn).label, false)).toBe("stand"); // neither green nor red
  });

  it("reads as a clean win when the bank beat everyone", () => {
    expect(statusDisplay(settled({ beat: 3, lostTo: 0 })).label).toBe("BEAT 3");
    expect(tagVariant("BEAT 3", false)).toBe("won");
  });

  it("reads as a clean loss when every wagering player beat it", () => {
    expect(statusDisplay(settled({ state: "lost", beat: 0, lostTo: 2 })).label).toBe("LOST TO 2");
    expect(tagVariant("LOST TO 2", false)).toBe("bust");
  });

  it("says FUTCHED only when the bank's own hand actually went over", () => {
    // Busted beats every other reading, however the money landed.
    const busted = settled({ state: "lost", busted: true, beat: 0, lostTo: 3 });
    expect(statusDisplay(busted).label).toBe("FUTCHED!");
    // ...and a bank that merely finished DOWN on money is not a futch.
    const brokeEven = settled({ state: "lost", busted: false, beat: 1, lostTo: 2 });
    expect(statusDisplay(brokeEven).label).not.toBe("FUTCHED!");
  });

  it("says nothing about wagers nobody made", () => {
    expect(statusDisplay(settled({ beat: 0, lostTo: 0 })).label).toBe("NO WAGERS");
  });

  it("leaves a live round alone -- beat/lostTo only exist after settlement", () => {
    // Mid-round the banker is still just waiting their turn.
    expect(statusDisplay(makeTurn(banker, { state: "pending" })).label).toBe("Waiting...");
    expect(statusDisplay(makeTurn(banker, { state: "standby" })).label).toBe("STANDING");
  });

  it("never applies any of this to a regular player", () => {
    // A player carrying these fields somehow must still read as a plain loss.
    const turn = makeTurn(p1, { state: "lost", beat: 5, lostTo: 0 });
    expect(statusDisplay(turn).label).toBe("LOST");
  });
});

describe("statusDisplay -- the bank hitting exactly 21 outright", () => {
  it("gets its own live tag, not the plain WON a showdown win gets", () => {
    const turn = makeTurn(banker, {
      state: "won",
      cards: [{ name: "9", attributes: { values: [9] } }, { name: "12", attributes: { values: [12, 9, 10] } }],
    });
    expect(statusDisplay(turn).label).toBe("BANK 21!");
    expect(tagVariant("BANK 21!", false)).toBe("natural");
  });

  it("does not apply to a player's own natural 21 -- banker-only tag", () => {
    const turn = makeTurn(p1, {
      state: "won",
      cards: [{ name: "9", attributes: { values: [9] } }, { name: "12", attributes: { values: [12, 9, 10] } }],
    });
    expect(statusDisplay(turn).label).toBe("WON");
  });

  it("does not fire for a showdown win that only reaches 21 by coincidence of a settled beat/lostTo tally", () => {
    // Once beat/lostTo exist, bankerOutcome already owns this turn -- the
    // BANK 21! check must never see it.
    const turn = makeTurn(banker, {
      state: "won",
      beat: 3,
      lostTo: 0,
      cards: [{ name: "9", attributes: { values: [9] } }, { name: "12", attributes: { values: [12, 9, 10] } }],
    });
    expect(statusDisplay(turn).label).toBe("BEAT 3");
  });

  it("catches a second banker hand within the same round (a BANK! auto-redeal) the same way", () => {
    // settleBankOutcome (store.ts) can deal the banker a fresh single-card
    // hand mid-round after a BANK! wager settles ("the two frames"). This
    // check reads off the turn's own live cards/state, not a once-per-round
    // flag, so it doesn't matter what the FIRST hand did -- a natural 21 on
    // the SECOND, redealt hand is caught exactly the same way.
    const firstHandBusted = makeTurn(banker, {
      state: "lost",
      busted: true,
      cards: [{ name: "10", attributes: { values: [10] } }, { name: "9", attributes: { values: [9] } }, { name: "5", attributes: { values: [5] } }],
    });
    expect(statusDisplay(firstHandBusted).label).toBe("FUTCHED!");

    const redealtSecondHand = makeTurn(banker, {
      state: "won",
      cards: [{ name: "9", attributes: { values: [9] } }, { name: "12", attributes: { values: [12, 9, 10] } }],
    });
    expect(statusDisplay(redealtSecondHand).label).toBe("BANK 21!");
  });
});
