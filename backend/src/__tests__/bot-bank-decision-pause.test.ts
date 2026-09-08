import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LIMITS, RuntimeLimits, limitBounds } from "../limits.js";

// The bot banker's bank-decision pause used to be botThinkDelay() -- the same
// 500-1200ms the bots use to "consider a card". That is the right length for a
// draw and the wrong length for a prompt a player is supposed to read.
//
// Measured on a practice table before the fix: a BANK! wager that emptied the
// bot bank showed "Bank depleted" and the bot ended the round about a second
// later, so the notice flashed past unread and the "replenish the computer
// bank" offer it leads into (gated on the decision stage having cleared) only
// arrived once the round was already over.
//
// Both delays became admin-editable settings when limits.ts grew its timing
// group, which makes this guard MORE important than when they were constants:
// the bug is now one number in a web form away, not one commit away. So the
// floor moved into the bounds table, where the form itself cannot get past it.
const SRC = readFileSync(resolve(__dirname, "../store.ts"), "utf8");

describe("the bot banker's bank-decision pause", () => {
  it("is its own setting, not the card-draw think delay", () => {
    expect(DEFAULT_LIMITS.botBankDecisionMs).toBeGreaterThan(DEFAULT_LIMITS.botThinkMaxMs);
  });

  it("cannot be set short enough to bring the original bug back", () => {
    // Not a magic number worth guarding to the millisecond -- but a value that
    // slipped back under two seconds would be the flash-past-unread notice
    // again, so the FORM has to refuse it rather than an operator having to
    // know. This is the assertion that replaced reading a constant out of
    // store.ts, and it is a stronger one: it holds for every value the panel
    // can produce, not just the shipped default.
    const [floor] = limitBounds("botBankDecisionMs");
    expect(floor).toBeGreaterThanOrEqual(2000);

    const limits = new RuntimeLimits();
    limits.set("botBankDecisionMs", 100);
    expect(limits.botBankDecisionMs).toBe(floor);
  });

  it("is what schedules playBotBankDecision, and botThinkDelay is not", () => {
    const line = SRC.split("\n").find((l) => l.includes("playBotBankDecision(roundId, bankerId)"));
    expect(line, "the bank-decision scheduling call moved or was renamed").toBeTruthy();
    expect(line).toContain("limits.botBankDecisionMs");
    expect(line).not.toContain("botThinkDelay()");
  });
});
