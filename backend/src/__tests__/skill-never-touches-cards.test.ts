import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GameStore } from "../store.js";
import { decideBotAction, decideBotBet, BOT_SKILLS } from "../bot.js";
import type { Card } from "../types.js";

// Difficulty must never touch the cards.
//
// Asked directly: "i hope easy and sharp mode are not actually affecting the
// odds or statistics of the cards being dealt or drawn". They do not, and this
// file is here so that stays true rather than being re-verified by reading.
//
// What a level changes is WHICH LEGAL MOVE a bot picks -- hit or stand. The
// shoe is built, shuffled and dealt by code that has never heard of it: the
// only gameplay site that reads room.botSkill hands it to decideBotAction,
// whose entire return type is "hit" | "stand".
//
// The one place a level even LOOKS at the shoe is a hard seat counting what is
// left in it, which is information anyone at the table can derive from the
// felt and the discard pile. It reads; it never reorders, removes or peeks at
// what is coming next. The first test below is the one that would catch that
// changing.

const card = (name: string, values: number[]): Card => ({ name, attributes: { values } });
const hand = (...values: number[]) => values.map((v) => card(String(v), [v]));

describe("a skill level and the shoe", () => {
  it("never changes the shoe it was given", () => {
    const shoe = [card("10", [10]), card("2", [2]), card("7", [7]), card("11", [11])];
    const before = JSON.stringify(shoe);
    for (const skill of BOT_SKILLS) {
      for (const isBanker of [true, false]) {
        for (const cards of [hand(5), hand(9, 7), hand(9, 9), hand(5, 6)]) {
          decideBotAction(cards, { skill, isBanker, shoe });
        }
      }
    }
    expect(JSON.stringify(shoe), "a skill level reordered or consumed the shoe").toBe(before);
  });

  it("never changes the hand it was given either", () => {
    for (const skill of BOT_SKILLS) {
      const cards = hand(9, 7);
      const before = JSON.stringify(cards);
      decideBotAction(cards, { skill, shoe: [card("3", [3])] });
      expect(JSON.stringify(cards)).toBe(before);
    }
  });

  it("can only ever answer hit or stand", () => {
    // The whole surface area of the feature. If this type ever widens, every
    // assurance in this file has to be re-derived.
    const shoe = [card("4", [4]), card("10", [10])];
    for (const skill of BOT_SKILLS) {
      for (const cards of [hand(3), hand(9, 5), hand(9, 8), hand(9, 9), hand(10, 10)]) {
        expect(["hit", "stand"]).toContain(decideBotAction(cards, { skill, shoe }));
      }
    }
  });
});

describe("the deal itself", () => {
  it("hands out the very next card off the shoe whatever the level is", () => {
    // The real end-to-end check: same forced shoe, same scripted move, three
    // levels. A level that tipped the odds would have to show up here as a
    // different card arriving, and it cannot, because nothing between the
    // decision and the deal knows what level the table is on.
    const dealt: string[] = [];
    for (const skill of BOT_SKILLS) {
      const store = new GameStore();
      const { room, player: admin } = store.createRoom({ firstName: "Banker", bankerBankroll: 500 });
      const { player: seat } = store.joinRoom(room.roomId, { firstName: "Guest" });
      store.setBotSkill(room.roomId, admin.id, skill);
      const round = store.startRound(room.roomId, admin.id);
      const live = store.getRound(round.roundId)!;
      live.deck = [card("5", [5]), card("6", [6]), card("7", [7]), card("8", [8])];
      store.applyBet(round.roundId, seat.id, 5);
      dealt.push(store.getRound(round.roundId)!.turns.find((t) => t.player.id === seat.id)!.cards.at(-1)!.name);
    }
    expect(dealt).toEqual(["5", "5", "5"]);
  });

  it("builds the shoe from a deck count and nothing else", () => {
    // Source-level, because the point is the ABSENCE of an argument: no skill
    // can reach shoe construction if shoe construction cannot accept one.
    const round = readFileSync(resolve(__dirname, "../round.ts"), "utf8");
    const deck = readFileSync(resolve(__dirname, "../deck.ts"), "utf8");
    expect(round).toContain("export function buildShoe(deckCount: number): Card[]");
    expect(round).not.toMatch(/buildShoe\([^)]*skill/i);
    expect(deck).not.toMatch(/skill/i);
    expect(round).not.toMatch(/botSkill/);
  });
});

describe("what a level does NOT reach", () => {
  it("stays out of bet sizing", () => {
    // Bet size is per-BOT temperament hashed off its id (see TEMPERAMENTS) and
    // is the same at every level -- decideBotBet has no skill parameter to
    // pass one to. Worth pinning because it is the thing most people assume a
    // difficulty setting changes.
    const bot = readFileSync(resolve(__dirname, "../bot.ts"), "utf8");
    expect(bot).toContain(
      "export function decideBotBet(wallet: number, available: number, playerId = \"\", buyIn = 0): number"
    );
    // Same wallet, same bot, same table: the level cannot move this number,
    // which is only visible as the spread being identical across levels.
    const draws = new Set<string>();
    for (const skill of BOT_SKILLS) {
      void skill;
      const seen: number[] = [];
      for (let i = 0; i < 200; i += 1) seen.push(decideBotBet(100, 100, "bot-1", 100));
      draws.add(`${Math.min(...seen)}-${Math.max(...seen)}`);
    }
    expect(draws.size, "bet sizing differed by level").toBe(1);
  });

  it("is read at exactly one place in play", () => {
    // If a second read ever appears, it is worth knowing about deliberately:
    // this file's guarantees are all downstream of there being one.
    const store = readFileSync(resolve(__dirname, "../store.ts"), "utf8");
    const all = store.match(/roomRec\.room\.botSkill/g) ?? [];
    const writes = store.match(/roomRec\.room\.botSkill = /g) ?? [];
    // One write (the setter) and one read (the hand-off to decideBotAction).
    expect(writes).toHaveLength(1);
    expect(all.length - writes.length, "botSkill is read somewhere new").toBe(1);
    expect(store).toContain("skill: roomRec.room.botSkill");
  });
});
