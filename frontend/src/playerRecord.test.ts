import { describe, expect, it } from "vitest";
import { readLifetimeRecord, tableStandings, turnNet, EMPTY_RECORD } from "./playerRecord";
import { CompletedRoundSummary } from "./state";
import { Card, Player, Turn } from "./types";

const card = (n: number): Card => ({ name: String(n), attributes: { values: [n] } });
const P = (id: string, name: string, type: Player["type"] = "player"): Player => ({
  id,
  firstName: name,
  lastName: "",
  type,
  presence: "online",
});

const turn = (player: Player, state: Turn["state"], bet: number, extra: Partial<Turn> = {}): Turn => ({
  player,
  state,
  cards: [card(9), card(8)],
  bet,
  ...extra,
});

const round = (n: number, at: number, turns: Turn[]): CompletedRoundSummary => ({
  roundId: `r${n}`,
  roundNumber: n,
  turns,
  balances: [],
  completedAt: at,
});

// A stand-in for localStorage that behaves like the real one where it matters:
// Object.keys enumerates the stored keys.
function store(entries: Record<string, string>): Storage {
  const map = { ...entries } as Record<string, string>;
  return Object.assign(map, {
    getItem: (k: string) => (k in map ? map[k] : null),
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  }) as unknown as Storage;
}

const me = P("me", "Shaya");
const other = P("p2", "Rivky");
const bank = P("bk", "The Gabbai", "admin");

describe("turnNet", () => {
  it("pays a win and charges a loss at the settled stake", () => {
    expect(turnNet(turn(me, "won", 10))).toBe(10);
    expect(turnNet(turn(me, "lost", 10))).toBe(-10);
  });

  it("reads the banker's own bet as the round's signed net, not a wager", () => {
    // calculateEndState overwrites the admin turn's `bet` with the round net.
    // Re-deriving it from won/lost would be wrong in both directions: the bank
    // does not win or lose a wager, it settles several, and a "lost" round can
    // still be net positive.
    expect(turnNet(turn(bank, "lost", -14))).toBe(-14);
    expect(turnNet(turn(bank, "won", 22))).toBe(22);
  });

  it("is worth nothing on a blatt", () => {
    expect(turnNet(turn(me, "won", 0, { settledBet: 0 }))).toBe(0);
  });
});

describe("readLifetimeRecord", () => {
  it("is empty when this device has never played", () => {
    expect(readLifetimeRecord(store({}))).toEqual(EMPTY_RECORD);
  });

  it("folds every night on this device into one record", () => {
    const s = store({
      "kvitlach.session.AAA": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.AAA": JSON.stringify([
        round(2, 200, [turn(me, "lost", 5), turn(bank, "won", 5)]),
        round(1, 100, [turn(me, "won", 10), turn(bank, "lost", -10)]),
      ]),
      "kvitlach.session.BBB": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.BBB": JSON.stringify([round(1, 300, [turn(me, "won", 7)])]),
    });
    const r = readLifetimeRecord(s);
    expect(r.nights).toBe(2);
    expect(r.rounds).toBe(3);
    expect(r.wins).toBe(2);
    expect(r.losses).toBe(1);
    expect(r.net).toBe(12);
    expect(r.best).toBe(10);
    expect(r.worst).toBe(-5);
  });

  it("attributes only THIS device's own player, never the whole table", () => {
    // The session is what says who this device was. Without it the only way to
    // pick a player is to guess, and a guess quietly credits someone else's
    // night to this player -- silently, and forever after.
    const s = store({
      "kvitlach.session.AAA": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.AAA": JSON.stringify([round(1, 100, [turn(me, "won", 10), turn(other, "won", 50)])]),
    });
    expect(readLifetimeRecord(s).net).toBe(10);
  });

  it("skips a room whose session is missing rather than guessing", () => {
    const s = store({
      "kvitlach.history.AAA": JSON.stringify([round(1, 100, [turn(me, "won", 10)])]),
    });
    expect(readLifetimeRecord(s)).toEqual(EMPTY_RECORD);
  });

  it("counts a night only if this player actually took a hand in it", () => {
    // Joining and watching is not a night played.
    const s = store({
      "kvitlach.session.AAA": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.AAA": JSON.stringify([round(1, 100, [turn(other, "won", 10)])]),
    });
    expect(readLifetimeRecord(s).nights).toBe(0);
  });

  it("counts the longest streak in the order the rounds were played", () => {
    // state.ts PREPENDS to the stored history, so the array is newest-first.
    // Counting a streak in stored order reads the night backwards, which gives
    // a different and wrong answer the moment a night is not symmetric.
    const s = store({
      "kvitlach.session.AAA": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.AAA": JSON.stringify([
        round(4, 400, [turn(me, "lost", 5)]),
        round(3, 300, [turn(me, "won", 5)]),
        round(2, 200, [turn(me, "won", 5)]),
        round(1, 100, [turn(me, "won", 5)]),
      ]),
    });
    expect(readLifetimeRecord(s).longestWinStreak).toBe(3);
  });

  it("does not count a blatt toward a win streak", () => {
    // A blatt resolves with state "won" -- the player took the round without a
    // wager -- and isPushTurn is the only thing that tells it from a real win.
    // Checking state alone gave 18 rounds, 1 win and a longest streak of 8 on
    // live data, because a table of blatts read as an unbroken run.
    const blatt = (n: number, at: number) => round(n, at, [turn(me, "won", 0, { settledBet: 0 })]);
    const s = store({
      "kvitlach.session.AAA": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.AAA": JSON.stringify([blatt(3, 300), blatt(2, 200), blatt(1, 100)]),
    });
    const r = readLifetimeRecord(s);
    expect(r.wins).toBe(0);
    expect(r.longestWinStreak).toBe(0);
  });

  it("lets a push sit inside a streak without breaking it", () => {
    const s = store({
      "kvitlach.session.AAA": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.AAA": JSON.stringify([
        round(3, 300, [turn(me, "won", 5)]),
        round(2, 200, [turn(me, "won", 0, { settledBet: 0 })]),
        round(1, 100, [turn(me, "won", 5)]),
      ]),
    });
    expect(readLifetimeRecord(s).longestWinStreak).toBe(2);
  });

  it("does not run a streak across two different nights", () => {
    const s = store({
      "kvitlach.session.AAA": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.AAA": JSON.stringify([round(1, 100, [turn(me, "won", 5)])]),
      "kvitlach.session.BBB": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.BBB": JSON.stringify([round(1, 200, [turn(me, "won", 5)])]),
    });
    expect(readLifetimeRecord(s).longestWinStreak).toBe(1);
  });

  it("survives corrupt storage rather than taking the dialog down with it", () => {
    const s = store({
      "kvitlach.session.AAA": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.AAA": "{not json",
    });
    expect(readLifetimeRecord(s)).toEqual(EMPTY_RECORD);
  });

  it("counts a blatt as a round played, not as a loss", () => {
    const s = store({
      "kvitlach.session.AAA": JSON.stringify({ playerId: "me" }),
      "kvitlach.history.AAA": JSON.stringify([round(1, 100, [turn(me, "won", 0, { settledBet: 0 })])]),
    });
    const r = readLifetimeRecord(s);
    expect(r.rounds).toBe(1);
    expect(r.blatts).toBe(1);
    expect(r.losses).toBe(0);
    expect(r.net).toBe(0);
  });
});

describe("tableStandings", () => {
  const rounds = [
    round(1, 100, [turn(me, "won", 10), turn(other, "lost", 4), turn(bank, "lost", -6)]),
    round(2, 200, [turn(me, "lost", 3), turn(other, "won", 8), turn(bank, "lost", -5)]),
  ];

  it("totals every player at the table", () => {
    const rows = tableStandings(rounds);
    const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));
    expect(byId.me.net).toBe(7);
    expect(byId.p2.net).toBe(4);
    expect(byId.bk.net).toBe(-11);
    expect(byId.me.rounds).toBe(2);
  });

  it("puts the bank first, then the biggest winner down", () => {
    // The bank is the counterparty every other row is measured against, so it
    // is not just another row in the ranking.
    expect(tableStandings(rounds).map((r) => r.playerId)).toEqual(["bk", "me", "p2"]);
  });

  it("adds up to zero across the table", () => {
    // Every chip won came from somewhere. If this ever fails, one of the two
    // net rules above has drifted from calculateEndState.
    const total = tableStandings(rounds).reduce((sum, r) => sum + r.net, 0);
    expect(total).toBe(0);
  });
});


// A settlement table that ignores half the money that moved.
//
// Found by playing, 2026-09-06: the banker adjusted Sara +$50 and "Tonight so
// far" went on reporting her at -$10. The drawer's own comment promises these
// rows balance to zero across the table; after one correction they do not, and
// the export reads the same source, so the number the banker pays out from at
// the end of the night is short by exactly the correction.
//
// The fix keeps play and non-play money in separate columns rather than
// merging them into one `net`. Merging would be worse than the bug: "Sara is
// +$40" cannot be checked against anything, whereas "she is -$10 on the cards
// and the banker gave her $50" is two numbers a table full of relatives can
// argue with, which is the actual job.
describe("standings with banker adjustments", () => {
  const round = {
    roundId: "R1",
    roundNumber: 1,
    completedAt: 1,
    balances: [],
    turns: [
      { player: { id: "bank", firstName: "Zeide", type: "admin" }, state: "won", bet: 10 },
      { player: { id: "p2", firstName: "Sara", type: "player" }, state: "lost", bet: 10 },
    ],
  } as any;

  const entry = (over: Record<string, unknown> = {}) =>
    ({
      id: "l1",
      kind: "adjust",
      playerId: "p2",
      playerName: "Sara",
      actorId: "bank",
      actorName: "Zeide",
      amount: 50,
      at: 1,
      ...over,
    }) as any;

  // Found bug-hunting 11.6, in 11.5's own ledger work. The ledger records
  // five kinds and `adjustments` folded in all of them -- but they are not
  // the same kind of fact.
  //
  //   adjust / buy-in / bank-topup  chips ENTERING or MOVING between people.
  //                                 These change what is owed at the end.
  //   kick / leave                  a record of the stack that walked away
  //                                 WITH its owner. Nothing is owed over it.
  //
  // Folding a departure in double-counts it: Sara buys in at 100, loses 10 on
  // the cards, leaves holding 90. She is down 10. Counting the -90 as an
  // adjustment reports her at -100 -- and the whole point of splitting these
  // columns was a settlement number a table can check.
  it("does not count a departing stack as money still to settle", () => {
    const [, sara] = tableStandings([round], [entry({ kind: "leave", amount: -90 })]);
    expect(sara.net).toBe(-10);
    expect(sara.adjustments).toBe(0);
    expect(sara.settle).toBe(-10);
  });

  it("does not count a kicked stack either", () => {
    const [, sara] = tableStandings([round], [entry({ kind: "kick", amount: -90 })]);
    expect(sara.settle).toBe(-10);
  });

  it("still counts a buy-in, which is real money changing hands", () => {
    const [, sara] = tableStandings([round], [entry({ kind: "buy-in", amount: 50 })]);
    expect(sara.adjustments).toBe(50);
    expect(sara.settle).toBe(40);
  });

  it("gives a departing player no phantom row when they never played", () => {
    // A ledger-only row exists so somebody owed money is never omitted. A
    // player who only ever left owes and is owed nothing, so a row reading
    // "0" for them is noise on the banker's settlement list.
    const rows = tableStandings([round], [entry({ playerId: "gone", playerName: "Gone", kind: "leave", amount: -50 })]);
    expect(rows.find((r) => r.playerId === "gone")).toBeUndefined();
  });

  it("leaves play net alone and reports adjustments beside it", () => {
    const [, sara] = tableStandings([round], [entry()]);
    expect(sara.net).toBe(-10);
    expect(sara.adjustments).toBe(50);
    expect(sara.settle).toBe(40);
  });

  it("reports zero adjustments rather than undefined when nothing was adjusted", () => {
    const [, sara] = tableStandings([round]);
    expect(sara.adjustments).toBe(0);
    expect(sara.settle).toBe(-10);
  });

  it("sums several movements for one player", () => {
    const [, sara] = tableStandings([round], [entry(), entry({ id: "l2", amount: -20 })]);
    expect(sara.adjustments).toBe(30);
  });

  // This test used to assert 35 -- buy-in + kick + leave summed together --
  // which encoded the double-count above rather than catching it. Departures
  // record what happened to a stack; only the kinds that change what is OWED
  // belong in a settlement column.
  it("counts the kinds that move money, and only those", () => {
    const [, sara] = tableStandings([round], [
      entry({ id: "b", kind: "buy-in", amount: 100 }),
      entry({ id: "k", kind: "kick", amount: -40 }),
      entry({ id: "v", kind: "leave", amount: -25 }),
      entry({ id: "a", kind: "adjust", amount: -15 }),
    ]);
    expect(sara.adjustments).toBe(85);
  });

  // Somebody the banker handed chips to before they ever played a hand has no
  // turn in any round, so the rounds alone cannot produce a row for them --
  // and a settlement table that silently omits a player who is owed money is
  // the same failure as one that reports the wrong number.
  it("gives a row to a player who only ever appears in the ledger", () => {
    const rows = tableStandings([round], [entry({ id: "l9", playerId: "p9", playerName: "Late Arrival", amount: 75 })]);
    const late = rows.find((r) => r.playerId === "p9");
    expect(late).toBeTruthy();
    expect(late!.name).toBe("Late Arrival");
    expect(late!.rounds).toBe(0);
    expect(late!.net).toBe(0);
    expect(late!.settle).toBe(75);
  });
});
