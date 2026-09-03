import { describe, expect, it } from "vitest";
import { buildHistoryHtml, historyFilename, summarize, verdict } from "./exportHistory";
import type { CompletedRoundSummary } from "./state";

// The file this produces is the only thing a player takes home, and it is
// generated once at the end of a night that cannot be replayed. A wrong total
// here is not a bug anyone catches in time.

// These fixtures are the shape the SERVER actually produces, which the
// original ones were not: they set `settledNet` on every turn and used a
// "push" state that no TurnState has. Both were invented, and the export was
// written to match the invention -- so the suite passed green while every
// real sheet printed $0 down each column and called every round a push.
//
// What round.ts's calculateEndState really leaves behind, per turn:
//   player -- state "won" / "lost" / "skipped", `bet` still holding the wager,
//             and NO settledNet. A hand played entirely as blatt keeps bet 0.
//   banker -- `bet` OVERWRITTEN with the round's signed net (they never
//             wager), plus beat / lostTo / busted. No settledNet either.
// The BANK!-lock path (store.ts) is the one exception and is covered on its
// own further down: there the seat's `bet` is zeroed with settledBet keeping
// the stake, and the banker's net moves to settledNet.
const seat = (id: string, name: string, bet: number, state: string, extra: Record<string, unknown> = {}) => ({
  player: { id, firstName: name, type: "player" },
  state,
  cards: [{ name: "9", attributes: { values: [9] } }],
  bet,
  ...extra,
});

// `bet` IS the net here -- that is not a shorthand for the test, it is what
// the field holds on an admin turn once the round is resolved.
const banker = (net: number, extra: Record<string, unknown> = {}) => ({
  player: { id: "b", firstName: "Shloime", type: "admin" },
  state: net < 0 ? "lost" : "standby",
  cards: [{ name: "9", attributes: { values: [9] } }],
  bet: net,
  ...extra,
});

const BUST = [
  { name: "10", attributes: { values: [10] } },
  { name: "9", attributes: { values: [9] } },
  { name: "9", attributes: { values: [9] } },
];

const rounds = [
  {
    roundId: "r1",
    roundNumber: 1,
    completedAt: new Date("2026-01-01T20:00:00Z").getTime(),
    turns: [seat("p1", "Rivky", 10, "won"), seat("p2", "Moshe", 10, "lost"), banker(0)],
    balances: [{ payer: "p2", payee: "p1", amount: 10 }],
  },
  {
    roundId: "r2",
    roundNumber: 2,
    completedAt: new Date("2026-01-01T20:20:00Z").getTime(),
    // Moshe futched with $5 up: a bust IS a loss, and his cards are the only
    // record of it -- a live player's turn carries no `busted` flag.
    turns: [seat("p1", "Rivky", 20, "lost"), seat("p2", "Moshe", 5, "lost", { cards: BUST }), banker(25)],
    balances: [],
  },
] as unknown as CompletedRoundSummary[];

describe("summarize", () => {
  it("adds up each player across every round", () => {
    const totals = summarize(rounds);
    const rivky = totals.find((t) => t.playerId === "p1")!;
    expect(rivky.net).toBe(-10);
    expect(rivky.wagered).toBe(30);
    expect(rivky.rounds).toBe(2);
    expect(rivky.wins).toBe(1);
    expect(rivky.losses).toBe(1);
    expect(rivky.best).toBe(10);
    expect(rivky.worst).toBe(-20);
  });

  it("ranks by net, richest first, and marks the banker", () => {
    const totals = summarize(rounds);
    expect(totals.map((t) => t.playerId)).toEqual(["b", "p1", "p2"]);
    expect(totals[0].isBanker).toBe(true);
  });

  it("counts a futch, and counts it as a loss rather than a push", () => {
    const moshe = summarize(rounds).find((t) => t.playerId === "p2")!;
    expect(moshe.busts).toBe(1);
    // Both rounds went against him: $10 lost at showdown, $5 futched away.
    // The old fixture handed him a $0 net for the futch, so the sheet called
    // it a push -- a player who busted with money up was told he broke even.
    expect(moshe.losses).toBe(2);
    expect(moshe.pushes).toBe(0);
    expect(moshe.net).toBe(-15);
  });

  // A blatt is a draw with nothing at stake. It never wins or loses money, so
  // it is a push whatever the cards ended up saying -- including a bust.
  it("pushes a hand played with nothing at stake", () => {
    const blatt = [
      { ...rounds[0], turns: [seat("p1", "Rivky", 0, "won"), banker(0)] },
    ] as unknown as CompletedRoundSummary[];
    const rivky = summarize(blatt).find((t) => t.playerId === "p1")!;
    expect(rivky.pushes).toBe(1);
    expect(rivky.wins).toBe(0);
    expect(rivky.wagered).toBe(0);
    expect(rivky.net).toBe(0);
  });

  // A9. calculateEndState overwrites the admin turn's `bet` with the round's
  // signed net, so reading it as a wager booked the bank's winnings as money
  // it had put up -- and the banker never wagers anything.
  it("never credits the banker with a wager, whatever their net", () => {
    const totals = summarize(rounds);
    const shloime = totals.find((t) => t.playerId === "b")!;
    expect(shloime.wagered).toBe(0);
    expect(shloime.net).toBe(25); // 0 in round 1, +25 in round 2
    expect(shloime.wins).toBe(1);
  });

  // The BANK!-lock settlement path is the one place the fields move: the
  // seat's `bet` is zeroed once it has been paid out and settledBet keeps
  // what was at risk, while the banker's net moves to settledNet. Reading
  // `bet` alone here would report the stake as $0 and the round as a push.
  it("reads a seat settled mid-round by a BANK! wager", () => {
    const locked = [
      {
        ...rounds[0],
        turns: [
          seat("p1", "Rivky", 0, "lost", { settledBet: 40, settled: true }),
          banker(0, { bet: 0, settledNet: 40 }),
        ],
      },
    ] as unknown as CompletedRoundSummary[];
    const totals = summarize(locked);
    expect(totals.find((t) => t.playerId === "p1")!.net).toBe(-40);
    expect(totals.find((t) => t.playerId === "p1")!.wagered).toBe(40);
    expect(totals.find((t) => t.playerId === "b")!.net).toBe(40);
  });

  // Someone who renames mid-session should appear under the name they
  // finished the night with, not the one they started it with.
  it("uses the most recent name for a player who renamed", () => {
    const renamed = [
      { ...rounds[0], turns: [seat("p1", "Rivky", 10, "won")] },
      { ...rounds[1], turns: [seat("p1", "Rivky Schlesinger", 10, "won")] },
    ] as unknown as CompletedRoundSummary[];
    expect(summarize(renamed)[0].name).toBe("Rivky Schlesinger");
  });

  it("survives a round with no turns at all", () => {
    expect(summarize([{ roundId: "x", roundNumber: 1, completedAt: 0 }] as unknown as CompletedRoundSummary[])).toEqual([]);
  });
});

describe("buildHistoryHtml", () => {
  it("is a self-contained document with no external requests", () => {
    const html = buildHistoryHtml({ rounds, roomId: "ZXD636", roomName: "Chanukah night 3" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // It has to still render years from now on a machine with no network, so
    // nothing may be fetched: no fonts, images, scripts or stylesheets.
    expect(html).not.toMatch(/<script|<img|https?:\/\/[^"']*\.(css|js|woff|png|jpg)/);
  });

  it("carries the table's identity and every round", () => {
    const html = buildHistoryHtml({ rounds, roomId: "ZXD636", roomName: "Chanukah night 3" });
    expect(html).toContain("Chanukah night 3");
    expect(html).toContain("ZXD636");
    expect(html).toContain("Round 1");
    expect(html).toContain("Round 2");
    expect(html).toContain("Final standings");
    expect(html).toContain("Ah freilichin Chanuka");
  });

  it("leads with the player's own number when one is named", () => {
    expect(buildHistoryHtml({ rounds })).not.toContain('class="who"&gt;Rivky');
    const mine = buildHistoryHtml({ rounds, focusPlayerId: "p1" });
    expect(mine).toContain("Rivky");
    expect(mine).toContain("−$10");
    expect(mine).toContain("2 of 3");
  });

  // The sheet is built from user-supplied names, so a name is the one place
  // markup could get in. A player called "<b>" must not bold the document.
  it("escapes player names rather than rendering them", () => {
    const nasty = [
      { ...rounds[0], turns: [seat("p1", "<script>x</script>", 10, "won")] },
    ] as unknown as CompletedRoundSummary[];
    const html = buildHistoryHtml({ rounds: nasty });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>x</script>");
  });

  it("names the cards rather than scoring them", () => {
    // The 12 is worth 12, 9 or 10 depending on the hand, so a single printed
    // number would misreport what was actually dealt.
    expect(buildHistoryHtml({ rounds })).toContain("9");
  });

  it("does not blow up on an empty history", () => {
    const html = buildHistoryHtml({ rounds: [] });
    expect(html).toContain("No completed rounds.");
    expect(html).toContain("Final standings");
  });
});

describe("verdict", () => {
  const base = { playerId: "p", name: "N", isBanker: false, wagered: 0, best: 0, worst: 0, wins: 0, losses: 0, pushes: 0, busts: 0 };
  it("says something different for winning, losing and breaking even", () => {
    expect(verdict({ ...base, rounds: 5, net: 50, streak: 1 }, 1, 4)).toMatch(/top of the table/i);
    expect(verdict({ ...base, rounds: 5, net: 50, streak: 1 }, 3, 4)).toMatch(/finished up, 3 of 4/i);
    expect(verdict({ ...base, rounds: 5, net: 0, streak: 0 }, 2, 4)).toMatch(/exactly even/i);
    expect(verdict({ ...base, rounds: 5, net: -50, streak: 0 }, 4, 4)).toMatch(/down on the night/i);
  });

  // Losing money is the common case, so it is the one that most needs
  // something better to say than the number already above it.
  it("finds the consolation in a losing night with a streak in it", () => {
    expect(verdict({ ...base, rounds: 9, net: -20, streak: 4 }, 3, 4)).toMatch(/4 in a row/);
  });

  it("talks about the bank, not placings, for the banker", () => {
    expect(verdict({ ...base, isBanker: true, rounds: 6, net: 30, streak: 2 }, 1, 4)).toMatch(/held the bank/i);
  });
});

// This is the only thing a person sees when they go looking for the keepsake
// months later, and every table on the same night used to sort together under
// an identical "kvitlach-table-" prefix followed by a room ID nobody
// recognises.
describe("historyFilename", () => {
  const now = new Date("2026-01-05T12:00:00");

  it("leads with the table's name, and with yours on a personal copy", () => {
    expect(historyFilename("ZXD636", false, now, { roomName: "Chanukah night 3" })).toBe(
      "Kvitlach - Chanukah night 3 - 2026-01-05.html"
    );
    expect(
      historyFilename("ZXD636", true, now, { roomName: "Chanukah night 3", playerName: "Rivky S" })
    ).toBe("Kvitlach - Rivky S - Chanukah night 3 - 2026-01-05.html");
  });

  it("falls back through the room ID to a bare date, never to nothing", () => {
    expect(historyFilename("ZXD636", false, now)).toBe("Kvitlach - ZXD636 - 2026-01-05.html");
    expect(historyFilename(undefined, false, now)).toBe("Kvitlach - 2026-01-05.html");
  });

  // A room name is player-typed and lands straight in a Downloads folder.
  it("strips what a filesystem would reject, and keeps it short", () => {
    const name = historyFilename("R1", false, now, { roomName: 'a/b\\c:d*e?f"g<h>i|j' });
    expect(name).toBe("Kvitlach - a b c d e f g h i j - 2026-01-05.html");
    expect(name).not.toMatch(/[\/:*?"<>|]/);

    const long = historyFilename("R1", false, now, { roomName: "x".repeat(200) });
    expect(long.length).toBeLessThan(80);
  });

  // A name of nothing but punctuation must not leave a stray separator or a
  // file that starts with a dot.
  it("drops a name that sanitises away to nothing", () => {
    expect(historyFilename("ZXD636", false, now, { roomName: "  ///  " })).toBe(
      "Kvitlach - ZXD636 - 2026-01-05.html"
    );
    expect(historyFilename("ZXD636", false, now, { roomName: "..." })).toBe(
      "Kvitlach - ZXD636 - 2026-01-05.html"
    );
  });
});

// The round-by-round blocks had their own copy of the same wrong read, so
// even a sheet with correct standings printed every individual hand as $0.
describe("the round-by-round hands", () => {
  it("prints what each hand was actually worth", () => {
    const html = buildHistoryHtml({ rounds, roomId: "ZXD636" });
    expect(html).toContain("+$10"); // Rivky's first round
    expect(html).toContain("−$20"); // and her second
    expect(html).toContain("+$25"); // the bank's second
  });

  it("shows a futched hand as futched, and as a loss", () => {
    const html = buildHistoryHtml({ rounds, roomId: "ZXD636" });
    expect(html).toContain("FUTCHED!");
    expect(html).toContain("−$5");
  });
});

// Asked for directly: the sheet is the only place anyone re-reads the night
// from, so the two things it must not blur are how a hand was lost and
// whether anything was ever at stake.
describe("what the sheet calls each hand", () => {
  it("separates a futch from losing the showdown", () => {
    const html = buildHistoryHtml({ rounds, roomId: "R1" });
    expect(html).toContain("FUTCHED!"); // Moshe went over 21 in round 2
    expect(html).toContain("LOST"); // Rivky was simply out-drawn
  });

  it("calls a stakeless hand a blatt, not a push", () => {
    const blatt = [
      { ...rounds[0], turns: [seat("p1", "Rivky", 0, "won"), banker(0)] },
    ] as unknown as CompletedRoundSummary[];
    const html = buildHistoryHtml({ rounds: blatt, roomId: "R1" });
    expect(html).toContain("BLATT");
    expect(html).not.toContain("PUSH");
  });

  // Skipped is also stakeless and is emphatically not a blatt -- nobody drew.
  it("does not call a skipped turn a blatt", () => {
    const skipped = [
      { ...rounds[0], turns: [seat("p1", "Rivky", 0, "skipped"), banker(0)] },
    ] as unknown as CompletedRoundSummary[];
    expect(buildHistoryHtml({ rounds: skipped, roomId: "R1" })).not.toContain("BLATT");
  });

  it("never calls the banker's own hand a blatt -- they never wager", () => {
    const html = buildHistoryHtml({ rounds, roomId: "R1" });
    const bankerLines = html.split("\n").filter((l) => l.includes("Banker"));
    expect(bankerLines.some((l) => l.includes("BLATT"))).toBe(false);
  });
});
