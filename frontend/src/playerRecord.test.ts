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
