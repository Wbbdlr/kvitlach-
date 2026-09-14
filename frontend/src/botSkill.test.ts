import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOT_SKILL_BLURBS, BOT_SKILL_LABELS } from "./types";

// The difficulty setting exists in two packages and its copy quotes numbers
// that live in a third place (a simulation nobody re-runs casually), so what is
// pinned here is the seams between them rather than any rendering -- same
// reasoning as houseStyle.test.ts, which already reads across into the backend
// from this side.
const BOT_TS = readFileSync(resolve(__dirname, "../../backend/src/bot.ts"), "utf8");
const APP = readFileSync(resolve(__dirname, "./App.tsx"), "utf8");
const TABLE_ROOT = readFileSync(resolve(__dirname, "./table/TableRoot.tsx"), "utf8");

describe("the level list", () => {
  it("matches the server's, which is the one that rejects things", () => {
    // The server throws invalid_bot_skill for anything it does not know, so a
    // level offered here and unknown there is a button that fails. Parsed out
    // of BOT_SKILLS rather than imported: the backend is a separate package
    // with its own tsconfig and this file is not allowed to compile it.
    const declared = BOT_TS.match(/export const BOT_SKILLS = \[([^\]]*)\]/)?.[1];
    expect(declared, "BOT_SKILLS is not where this test expects it").toBeTruthy();
    const server = declared!.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    expect(server).toEqual(Object.keys(BOT_SKILL_LABELS));
    expect(server).toEqual(Object.keys(BOT_SKILL_BLURBS));
  });

  it("gives every level a label and a blurb", () => {
    for (const skill of Object.keys(BOT_SKILL_LABELS)) {
      expect(BOT_SKILL_LABELS[skill as keyof typeof BOT_SKILL_LABELS].length).toBeGreaterThan(0);
      expect(BOT_SKILL_BLURBS[skill as keyof typeof BOT_SKILL_BLURBS].length).toBeGreaterThan(20);
    }
  });
});

describe("the copy the player is shown", () => {
  it("quotes the thresholds the code actually plays", () => {
    // The blurbs promise specific behaviour ("the bank stops at 14"). If a
    // threshold moves and the copy does not, the lobby is lying about the game
    // -- and nothing else in either package would notice.
    const thresholds = BOT_TS.match(/STAND_ON: Record<BotSkill, number> = \{([^}]*)\}/)?.[1];
    expect(thresholds, "STAND_ON is not where this test expects it").toBeTruthy();
    for (const [skill, value] of [
      ["easy", "14"],
      ["normal", "17"],
      ["hard", "18"],
    ] as const) {
      expect(thresholds).toContain(`${skill}: ${value}`);
      expect(BOT_SKILL_BLURBS[skill], `the ${skill} blurb does not mention ${value}`).toContain(value);
    }
  });

  it("quotes win rates that are honest about which end the dial lives at", () => {
    // Measured: a player wins about 52 hands in 100 against an easy bank, 45
    // against a regular one and 44 against a sharp one. The point of saying so
    // is that "Sharp" is worth well under a point, and a player choosing it
    // should not be led to expect a different game.
    expect(BOT_SKILL_BLURBS.easy).toContain("52");
    expect(BOT_SKILL_BLURBS.normal).toContain("45");
    expect(BOT_SKILL_BLURBS.hard).toContain("44");
  });
});

describe("where it can be set", () => {
  it("is chosen in the lobby and sent with the table", () => {
    expect(APP).toContain("botSkill: practiceBotSkill");
    expect(APP).toContain("BOT_SKILL_BLURBS[practiceBotSkill]");
  });

  it("stays reachable once the table is up, for a practice player", () => {
    // ManageDrawer is isAdmin-gated and a practice table's banker is a bot, so
    // the drawer is out of reach there -- the same reason the Reshuffle chip
    // beside this one exists. If this chip ever moves into the drawer, the
    // setting silently becomes unreachable at exactly the tables it is for.
    expect(TABLE_ROOT).toContain("room.practice && onSetBotSkill");
    expect(TABLE_ROOT).toContain("onSetBotSkill");
    // Names the current level, because a cycling control that does not say
    // where it is now is unusable.
    expect(TABLE_ROOT).toContain('BOT_SKILL_LABELS[room.botSkill ?? "normal"]');
  });
});
