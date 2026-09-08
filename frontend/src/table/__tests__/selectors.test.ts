import { describe, expect, it } from "vitest";
import { totalDisplay, tagVariant, allTotals, bestTotal, statusDisplay, fullName, winningCardIndices, futchedCardIndices, REACTION_EMOJIS, REACTION_EMOJI_LABELS } from "../selectors";
import { Card, Player, Turn } from "../../types";

const banker: Player = { id: "bank", firstName: "Bank", lastName: "", type: "admin", presence: "online" };
const p1: Player = { id: "p1", firstName: "P1", lastName: "", type: "player", presence: "online" };
const p2: Player = { id: "p2", firstName: "P2", lastName: "", type: "player", presence: "online" };

function makeTurn(player: Player, overrides: Partial<Turn> = {}): Turn {
  return { player, state: "pending", cards: [{ name: "9", attributes: { values: [9] } }], bet: 5, ...overrides };
}

const TEN: Card = { name: "10", attributes: { values: [10] } };
const NINE: Card = { name: "9", attributes: { values: [9] } };
const SIX: Card = { name: "6", attributes: { values: [6] } };
const ELEV_IGNORED: Card = { name: "11", attributes: { values: [11], eleveroonIgnored: true } };

// A concealed total says "hidden". Reported live: it was saying "0" instead,
// which is not concealment -- it is a specific, false number, and the table
// read it as a real hand worth nothing.
//
// The cause is one line: bestTotal([]) returns { total: 0 } (selectors.ts),
// so "nothing visible" and "a hand totalling zero" were indistinguishable to
// every caller that sliced the hole card off and asked for the remainder.
// The "--" fallback that was meant to catch this could never run.
//
// The wider point, and why these are grouped: the app had TWO vocabularies
// for the same idea. The banker's branch said "hidden" and the player's said
// "0" (intending "--"). One concealed total should look like every other one.
// Two cousins really are both called Rivka S at this table, so the server
// tags the second one and fullName is the single place that tag becomes
// text -- the felt plates, the roster, the settlement table and the export
// sheet all read their name through here.
describe("a name shared by more than one player", () => {
  const player = (over: Record<string, unknown> = {}) =>
    ({ id: "p", firstName: "Rivka", lastName: "S", type: "player", presence: "online", ...over }) as any;

  it("leaves the first one exactly as it was", () => {
    expect(fullName(player())).toBe("Rivka S");
    expect(fullName(player({ nameTag: 1 }))).toBe("Rivka S");
  });

  it("marks the second and third so the banker can tell who they paid", () => {
    expect(fullName(player({ nameTag: 2 }))).toBe("Rivka S (2)");
    expect(fullName(player({ nameTag: 3 }))).toBe("Rivka S (3)");
  });

  it("still handles a player with no last name", () => {
    expect(fullName(player({ lastName: "", nameTag: 2 }))).toBe("Rivka (2)");
  });
});

describe("totalDisplay -- concealment says so, and never says 0", () => {
  it("says hidden for a blatt player holding only their face-down card", () => {
    // Dealt one card, no wager yet: cards[0] is face-down to the table (the
    // server's isCardHidden agrees), so there is nothing to total.
    const turn = makeTurn(p1, { bet: 0, cards: [NINE] });
    expect(totalDisplay(turn, p2.id).value).toBe("hidden");
  });

  it("says hidden for the banker holding only their hole card", () => {
    const turn = makeTurn(banker, { cards: [NINE] });
    expect(totalDisplay(turn, p2.id).value).toBe("hidden");
  });

  it("says hidden when the only visible card is one Eleveroon ignored", () => {
    // The same bug one layer down: the card is present, so a length check
    // passes, but bestTotal drops it and lands back on 0. The banker always
    // has Eleveroon active, so this is their ordinary case, not an exotic one.
    const turn = makeTurn(banker, { cards: [NINE, ELEV_IGNORED] });
    expect(totalDisplay(turn, p2.id).value).toBe("hidden");
  });

  it("still totals the blatt cards that ARE public", () => {
    const turn = makeTurn(p1, { bet: 0, cards: [NINE, TEN] });
    // Card 0 stays down; the blatt draw after it is public to the whole table.
    expect(totalDisplay(turn, p2.id).value).toBe("10");
  });

  it("shows a blatt hand's real total once the round resolves it", () => {
    // The other half of #9, and the part that was visible for a whole round:
    // a blatt settles as "won" (calculateEndState treats no wager as a push),
    // and the blatt branch had no reveal guard -- so it went on slicing the
    // hole card off a hand the server had already sent face-up, and reported
    // "0" through showdown and into round complete.
    const turn = makeTurn(p1, { bet: 0, state: "won", cards: [SIX] });
    expect(totalDisplay(turn, p2.id).value).toBe("6");
  });

  it("shows a blatt hand's real total once it busts", () => {
    const turn = makeTurn(p1, { bet: 0, state: "lost", cards: [TEN, TEN, SIX] });
    expect(totalDisplay(turn, p2.id).value).toBe("26");
  });

  it("never renders a bare 0 to a viewer who is being kept out", () => {
    // The invariant, stated once: whatever the hand, a total withheld from a
    // viewer reads as withheld.
    const hands: Card[][] = [[NINE], [ELEV_IGNORED], [NINE, ELEV_IGNORED]];
    for (const cards of hands) {
      for (const turn of [makeTurn(p1, { bet: 0, cards }), makeTurn(banker, { cards })]) {
        expect(totalDisplay(turn, p2.id).value).not.toBe("0");
      }
    }
  });

  it("still shows the owner their own hand, hole card included", () => {
    const turn = makeTurn(p1, { bet: 0, cards: [NINE] });
    expect(totalDisplay(turn, p1.id).value).toBe("9");
  });
});

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
    expect(tagVariant("WON!", false)).toBe("won");
  });

  it("prioritizes the active-turn variant over the label", () => {
    expect(tagVariant("FUTCHED!", true)).toBe("turn");
  });

  it("falls back to muted for anything else", () => {
    expect(tagVariant("PUSH", false)).toBe("muted");
    expect(tagVariant("Waiting...", false)).toBe("wait");
    expect(tagVariant("Up next", false)).toBe("next");
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
    expect(statusDisplay(turn).label).toBe("WON!");
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

  it("still fires on a banker turn carrying bet: 0 -- the bank never wagers", () => {
    // Every other case in this block inherits makeTurn's bet: 5 default, which
    // no real banker turn ever has: the bank places no wager, so its `bet` is
    // 0 for the whole live window and only becomes anything else when
    // calculateEndState overwrites it with the round's net. That made this
    // check unreachable behind isPushTurn (bet === 0 + state "won" reads as a
    // returned wager) and the tag rendered "PUSH" -- caught only because the
    // fixtures here were richer than the real thing.
    const turn = makeTurn(banker, {
      state: "won",
      bet: 0,
      cards: [{ name: "9", attributes: { values: [9] } }, { name: "12", attributes: { values: [12, 9, 10] } }],
    });
    expect(statusDisplay(turn).label).toBe("BANK 21!");
  });

  it("still calls a real player blatt win a PUSH -- bet: 0 keeps its meaning there", () => {
    const turn = makeTurn(p1, {
      state: "won",
      bet: 0,
      cards: [{ name: "9", attributes: { values: [9] } }, { name: "12", attributes: { values: [12, 9, 10] } }],
    });
    expect(statusDisplay(turn).label).toBe("PUSH");
  });
});

describe("REACTION_EMOJI_LABELS", () => {
  // ReactionLayer.tsx's emoji buttons have no other accessible name -- a
  // screen reader falls back to the glyph's raw Unicode/CLDR reading, which
  // isn't always right for what it's standing in for at this table. Every
  // entry in REACTION_EMOJIS needs a matching label, or one of those buttons
  // silently goes back to being announced by codepoint.
  it("has exactly one label per reaction emoji, nothing missing and nothing stale", () => {
    for (const emoji of REACTION_EMOJIS) {
      expect(REACTION_EMOJI_LABELS[emoji], `missing a label for ${emoji}`).toBeTruthy();
    }
    expect(Object.keys(REACTION_EMOJI_LABELS).length).toBe(REACTION_EMOJIS.length);
  });
});

// The glow says "these cards are the win". It is only honest if it fires on
// the hands that actually won on their own cards, and stays off the ones that
// merely came out ahead of the banker.
describe("winningCardIndices", () => {
  const TWO: Card = { name: "2", attributes: { values: [2], type: "rosier" } };
  const ELEVEN: Card = { name: "11", attributes: { values: [11], type: "rosier" } };
  const FIVE: Card = { name: "5", attributes: { values: [5] } };
  const TWELVE: Card = { name: "12", attributes: { values: [12, 9, 10] } };

  it("lights the whole hand on an outright 21", () => {
    const turn = makeTurn(p1, { state: "won", cards: [TEN, SIX, FIVE] });
    expect([...winningCardIndices(turn)]).toEqual([0, 1, 2]);
  });

  it("reads 21 through the 12's flexible value, like everything else does", () => {
    // 12 counted as 9, plus 6, plus 6 -- the 12 is 12/9/10 and re-reads at
    // every evaluation (docs/GAME_RULES.md). A hand that only reaches 21 on
    // its lower reading is still a 21.
    const turn = makeTurn(p1, { state: "won", cards: [TWELVE, SIX, SIX] });
    expect([...winningCardIndices(turn)]).toEqual([0, 1, 2]);
  });

  it("lights only the two framed cards on a rosier pair", () => {
    const turn = makeTurn(p1, { state: "won", cards: [TWO, ELEVEN] });
    expect([...winningCardIndices(turn)]).toEqual([0, 1]);
  });

  it("stays dark on a showdown win -- those cards did nothing special", () => {
    // 16 against a banker who came in lower. calculateEndState resolves this
    // to "won" exactly like a 21, which is the whole reason this needs its
    // own answer rather than reading turn.state.
    const turn = makeTurn(p1, { state: "won", cards: [TEN, SIX] });
    expect([...winningCardIndices(turn)]).toEqual([]);
  });

  it("stays dark on a hand still being played", () => {
    const turn = makeTurn(p1, { state: "pending", cards: [TEN, SIX, FIVE] });
    expect([...winningCardIndices(turn)]).toEqual([]);
  });

  it("skips an Eleveroon-ignored card sitting in a winning hand", () => {
    // The card is on the felt and contributes nothing -- 10 + 6 + 5 is the
    // 21, and the rejected 11 is not part of it.
    const turn = makeTurn(p1, { state: "won", cards: [TEN, SIX, ELEV_IGNORED, FIVE] });
    expect([...winningCardIndices(turn)]).toEqual([0, 1, 3]);
  });

  it("covers the banker's own 21, which is the loudest one at the table", () => {
    const turn = makeTurn(banker, { state: "won", cards: [TEN, SIX, FIVE] });
    expect([...winningCardIndices(turn)]).toEqual([0, 1, 2]);
  });
});

// The futch treatment is the mirror of the win glow, and it has the same one
// way to be wrong: firing on hands that merely LOST. `state === "lost"` is not
// the question -- a player who stood on 16 against an 18 lost nothing to the
// count, and the banker's "lost" also fires when they only end down on money.
describe("futchedCardIndices", () => {
  const FIVE: Card = { name: "5", attributes: { values: [5] } };

  it("marks every card of a hand that went over 21", () => {
    const turn = makeTurn(p1, { state: "lost", cards: [TEN, NINE, SIX] });
    expect([...futchedCardIndices(turn)]).toEqual([0, 1, 2]);
  });

  it("stays clear of a showdown loss -- nothing about those cards busted", () => {
    const turn = makeTurn(p1, { state: "lost", cards: [TEN, SIX] });
    expect([...futchedCardIndices(turn)]).toEqual([]);
  });

  it("stays clear of a banker who only ended the round down on money", () => {
    // calculateEndState sets state "lost" for a losing NIGHT and reports the
    // count separately in `busted` -- which is exactly why that field exists.
    const turn = makeTurn(banker, { state: "lost", busted: false, cards: [TEN, SIX], bet: -40 });
    expect([...futchedCardIndices(turn)]).toEqual([]);
  });

  it("trusts the server's own busted flag over the cards when it has one", () => {
    const turn = makeTurn(banker, { state: "lost", busted: true, cards: [TEN, NINE, SIX] });
    expect([...futchedCardIndices(turn)]).toEqual([0, 1, 2]);
  });

  it("leaves a blatt that overshot alone -- that is a push, and says so", () => {
    // No wager anywhere on it, so round.ts resolves it at $0 and the pill
    // reads PUSH. Cards dressed as a futch under a PUSH pill would have the
    // felt saying two things about one hand.
    const turn = makeTurn(p1, { state: "won", bet: 0, settledBet: 0, cards: [TEN, NINE, SIX] });
    expect([...futchedCardIndices(turn)]).toEqual([]);
  });

  it("skips an Eleveroon-ignored card, same as the win side", () => {
    const turn = makeTurn(p1, { state: "lost", cards: [TEN, ELEV_IGNORED, NINE, FIVE] });
    expect([...futchedCardIndices(turn)]).toEqual([0, 2, 3]);
  });

  it("never marks a hand that is still being played", () => {
    const turn = makeTurn(p1, { state: "pending", cards: [TEN, SIX] });
    expect([...futchedCardIndices(turn)]).toEqual([]);
  });
});

// Both card treatments read turn.cards, and what a client HOLDS is whatever
// the server chose to send it: ws-server's redactTurn replaces a card the
// viewer may not see with { name: "0", values: [] }, which allTotals scores
// as 0. They are safe today only because concealment and these two agree on
// one thing -- isCardHidden opens a hand outright once its state is "won" or
// "lost", which is exactly when these fire, so a marked hand is never a
// partly-hidden one.
//
// That is an assumption across two files with nothing else asserting it. If
// concealment ever kept a card back on a resolved hand, a redacted card
// scoring 0 would quietly drag totals DOWN -- so a futched hand would stop
// being marked (harmless) and, worse, a hand that never made 21 could be read
// as one. This pins the direction.
describe("the card treatments against a redacted hand", () => {
  const REDACTED: Card = { name: "0", attributes: { values: [] } };

  it("scores a redacted card as nothing rather than guessing at it", () => {
    expect(bestTotal([TEN, REDACTED]).total).toBe(10);
  });

  it("never invents a 21 out of hidden cards", () => {
    // 10 + something-hidden must not read as a win, whatever the hidden card
    // would have been.
    const turn = makeTurn(p1, { state: "won", cards: [TEN, REDACTED] });
    expect([...winningCardIndices(turn)]).toEqual([]);
  });

  it("does not mark a futch it cannot actually see", () => {
    const turn = makeTurn(p1, { state: "lost", cards: [TEN, REDACTED] });
    expect([...futchedCardIndices(turn)]).toEqual([]);
  });
});
