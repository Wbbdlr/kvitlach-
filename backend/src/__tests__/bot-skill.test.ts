import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";
import { decideBotAction, BOT_SKILLS, isBotSkill } from "../bot.js";
import type { Card } from "../types.js";

// Bot skill levels. Every threshold asserted here is a MEASURED optimum, not a
// preference -- bot.ts carries the full curve over 400,000 simulated rounds.
// If one of these numbers is ever changed, re-run that measurement rather than
// re-fitting the test to the new code: the whole point of the levels is that
// "easy" is genuinely easier by a known amount (a player wins about 52 hands
// in 100 against an easy bank, 45 against a regular one) and the lobby copy
// quotes those figures at the player.

const card = (name: string, values: number[]): Card => ({ name, attributes: { values } });
const hand = (...values: number[]) => values.map((v) => card(String(v), [v]));

describe("the stand threshold per skill", () => {
  it("defaults to what shipped before the setting existed", () => {
    // The back-compatibility guarantee, and the reason every existing caller
    // and test keeps passing: no options at all means normal, means 17.
    expect(decideBotAction(hand(9, 8))).toBe("stand"); // 17
    expect(decideBotAction(hand(9, 7))).toBe("hit"); // 16
    expect(decideBotAction(hand(9, 8), {})).toBe("stand");
    expect(decideBotAction(hand(9, 8), { skill: "normal" })).toBe("stand");
  });

  it("stands early on easy, which is where the whole dial lives", () => {
    expect(decideBotAction(hand(9, 5), { skill: "easy" })).toBe("stand"); // 14
    expect(decideBotAction(hand(9, 4), { skill: "easy" })).toBe("hit"); // 13
    // Measured: a banker standing on 14 hands the player 52.3% of hands
    // against 44.5% at 17. Easy is worth nearly eight points; hard is worth
    // 0.4 (see below), which is why the copy says so out loud.
    expect(decideBotAction(hand(9, 8), { skill: "easy" })).toBe("stand");
  });

  it("pushes one further on hard, and no further than that, for the banker", () => {
    // 18 is the banker's ceiling. 19 measured WORSE for the bank than 17
    // (player 46.3% vs 44.5%) because the extra futches cost more than the
    // extra totals win, so there is deliberately no level above this.
    expect(decideBotAction(hand(9, 8), { skill: "hard", isBanker: true })).toBe("hit"); // 17
    expect(decideBotAction(hand(9, 9), { skill: "hard", isBanker: true })).toBe("stand"); // 18
  });

  it("gives a hard SEAT the shoe instead of a threshold", () => {
    // The one strategy measured to beat a fixed threshold at all: 45.3% vs
    // 44.5%. A seat hits while the chance the next card futches it is at most
    // 50%.
    const allTens = Array.from({ length: 10 }, () => card("10", [10]));
    const allOnes = Array.from({ length: 10 }, () => card("1", [1]));
    // 16 with nothing but tens behind it futches for certain -- stand, even
    // though 16 is under every threshold in the file.
    expect(decideBotAction(hand(9, 7), { skill: "hard", shoe: allTens })).toBe("stand");
    // 19 with nothing but ones behind it cannot futch -- hit, even though 19
    // is over every threshold in the file.
    expect(decideBotAction(hand(9, 10), { skill: "hard", shoe: allOnes })).toBe("hit");
  });

  it("does not count an Eleveroon-protected 11 as a futch", () => {
    // A hand readable as exactly 11 cannot be futched by an 11 (the rule
    // ignores it, and decideBotEleveroon always claims it). Counting those as
    // futches would have a hard seat stand on a hand it cannot lose.
    const allElevens = Array.from({ length: 10 }, () => card("11", [11]));
    expect(decideBotAction(hand(5, 6), { skill: "hard", shoe: allElevens })).toBe("hit");
  });

  it("falls back to a threshold when there is no shoe left to read", () => {
    // An empty shoe is a real state (the deck runs dry roughly every eight
    // rounds by design), and a hard seat must not read that as "every card
    // futches me" and freeze on a 12.
    expect(decideBotAction(hand(9, 3), { skill: "hard", shoe: [] })).toBe("hit");
    expect(decideBotAction(hand(9, 9), { skill: "hard" })).toBe("stand");
  });
});

describe("isBotSkill", () => {
  it("accepts exactly the three levels and nothing else", () => {
    for (const skill of BOT_SKILLS) expect(isBotSkill(skill)).toBe(true);
    for (const junk of ["", "EASY", "impossible", 3, null, undefined, {}]) {
      expect(isBotSkill(junk)).toBe(false);
    }
  });
});

describe("setting it on a table", () => {
  function practice() {
    const s = new GameStore();
    const { room, player } = s.createPracticeRoom({ firstName: "Learner", botCount: 2 });
    return { s, roomId: room.roomId, human: player };
  }

  it("defaults a practice table to normal", () => {
    const { s, roomId } = practice();
    expect(s.getRoom(roomId)!.botSkill).toBe("normal");
  });

  it("takes the level the lobby asked for", () => {
    const s = new GameStore();
    const { room } = s.createPracticeRoom({ firstName: "Learner", botCount: 2, botSkill: "hard" });
    expect(s.getRoom(room.roomId)!.botSkill).toBe("hard");
  });

  it("deals a normal table rather than refusing when the level is unknown", () => {
    // Arrives off a WS payload. A lobby from a different build sending a level
    // this one has never heard of should get a game, not an error.
    const s = new GameStore();
    const { room } = s.createPracticeRoom({ firstName: "Learner", botCount: 2, botSkill: "nightmare" });
    expect(s.getRoom(room.roomId)!.botSkill).toBe("normal");
  });

  it("lets the one human at a practice table change it", () => {
    // The carve-out that matters: a practice banker is a BOT, so an
    // admin-only guard would lock the only person there out of the only
    // setting the mode exists for. Same shape as reshuffleDeck's.
    const { s, roomId, human } = practice();
    expect(s.setBotSkill(roomId, human.id, "easy")).toEqual({ botSkill: "easy" });
    expect(s.getRoom(roomId)!.botSkill).toBe("easy");
  });

  it("refuses a level it does not know", () => {
    const { s, roomId, human } = practice();
    expect(() => s.setBotSkill(roomId, human.id, "nightmare")).toThrow("invalid_bot_skill");
    expect(s.getRoom(roomId)!.botSkill).toBe("normal");
  });

  it("refuses the bots themselves", () => {
    const { s, roomId } = practice();
    const bot = s.getRoom(roomId)!.players.find((p) => p.isBot)!;
    expect(() => s.setBotSkill(roomId, bot.id, "easy")).toThrow("forbidden");
  });

  it("keeps an ordinary seat at a REAL table out of it", () => {
    // The carve-out is practice-only. At a hosted table this is the banker's
    // setting, same as the shoe size.
    const s = new GameStore();
    const { room, player: admin } = s.createRoom({ firstName: "Banker" });
    const { player: seat } = s.joinRoom(room.roomId, { firstName: "Guest" });
    expect(() => s.setBotSkill(room.roomId, seat.id, "easy")).toThrow("forbidden");
    expect(s.setBotSkill(room.roomId, admin.id, "hard")).toEqual({ botSkill: "hard" });
  });
});
