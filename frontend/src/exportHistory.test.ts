import { describe, expect, it } from "vitest";
import { buildHistoryHtml, historyFilename, summarize, verdict } from "./exportHistory";
import type { CompletedRoundSummary } from "./state";

// The file this produces is the only thing a player takes home, and it is
// generated once at the end of a night that cannot be replayed. A wrong total
// here is not a bug anyone catches in time.

const turn = (id: string, name: string, bet: number, net: number, extra: Record<string, unknown> = {}) => ({
  player: { id, firstName: name, type: id === "b" ? "admin" : "player" },
  state: net > 0 ? "won" : net < 0 ? "lost" : "push",
  cards: [{ name: "9", attributes: { values: [9] } }],
  bet,
  settledNet: net,
  ...extra,
});

const rounds = [
  {
    roundId: "r1",
    roundNumber: 1,
    completedAt: new Date("2026-01-01T20:00:00Z").getTime(),
    turns: [turn("p1", "Rivky", 10, 10), turn("p2", "Moshe", 10, -10), turn("b", "Shloime", 0, 0)],
    balances: [{ payer: "p2", payee: "p1", amount: 10 }],
  },
  {
    roundId: "r2",
    roundNumber: 2,
    completedAt: new Date("2026-01-01T20:20:00Z").getTime(),
    turns: [turn("p1", "Rivky", 20, -20), turn("p2", "Moshe", 5, 0, { busted: true }), turn("b", "Shloime", 0, 20)],
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

  it("counts a bust and treats a zero net as a push", () => {
    const moshe = summarize(rounds).find((t) => t.playerId === "p2")!;
    expect(moshe.busts).toBe(1);
    expect(moshe.pushes).toBe(1);
  });

  // Someone who renames mid-session should appear under the name they
  // finished the night with, not the one they started it with.
  it("uses the most recent name for a player who renamed", () => {
    const renamed = [
      { ...rounds[0], turns: [turn("p1", "Rivky", 10, 10)] },
      { ...rounds[1], turns: [turn("p1", "Rivky Schlesinger", 10, 10)] },
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
      { ...rounds[0], turns: [turn("p1", "<script>x</script>", 10, 10)] },
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

describe("historyFilename", () => {
  it("dates the file and marks a personal copy", () => {
    const now = new Date("2026-01-05T12:00:00");
    expect(historyFilename("ZXD636", false, now)).toBe("kvitlach-table-ZXD636-2026-01-05.html");
    expect(historyFilename("ZXD636", true, now)).toBe("kvitlach-my-night-ZXD636-2026-01-05.html");
  });
});
