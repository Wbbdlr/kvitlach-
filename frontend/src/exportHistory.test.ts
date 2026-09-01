import { describe, expect, it } from "vitest";
import { buildHistoryText, historyFilename, summarize } from "./exportHistory";
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

describe("buildHistoryText", () => {
  it("includes standings and every round", () => {
    const text = buildHistoryText({ rounds, roomId: "ZXD636", roomName: "Chanukah night 3" });
    expect(text).toContain("Chanukah night 3");
    expect(text).toContain("Table ZXD636");
    expect(text).toContain("FINAL STANDINGS");
    expect(text).toContain("Shloime (Banker)");
    expect(text).toContain("Round 1");
    expect(text).toContain("Round 2");
    expect(text).toContain("2 rounds");
  });

  it("writes a personal section only when a player is named", () => {
    expect(buildHistoryText({ rounds })).not.toContain("YOUR NIGHT");
    const mine = buildHistoryText({ rounds, focusPlayerId: "p1" });
    expect(mine).toContain("YOUR NIGHT — Rivky");
    expect(mine).toContain("-$10");
    expect(mine).toContain("2 of 3 at the table");
  });

  it("names the cards rather than scoring them", () => {
    // The 12 is worth 12, 9 or 10 depending on the hand, so a single printed
    // number would be a lie about what was actually dealt.
    expect(buildHistoryText({ rounds })).toContain("[9]");
  });

  it("resolves settlement ids to names", () => {
    expect(buildHistoryText({ rounds })).toContain("Moshe → Rivky: $10");
  });

  it("does not blow up on an empty history", () => {
    const text = buildHistoryText({ rounds: [] });
    expect(text).toContain("0 rounds");
    expect(text).toContain("FINAL STANDINGS");
  });
});

describe("historyFilename", () => {
  it("dates the file and marks a personal copy", () => {
    const now = new Date("2026-01-05T12:00:00");
    expect(historyFilename("ZXD636", false, now)).toBe("kvitlach-history-ZXD636-2026-01-05.txt");
    expect(historyFilename("ZXD636", true, now)).toBe("kvitlach-my-history-ZXD636-2026-01-05.txt");
  });
});
