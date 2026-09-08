import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
// Asserted against the source rather than by running a timer: the delay lives
// inside a private setTimeout on a store method that also needs a live bot
// room and a real bank lock to reach, and what actually matters here is that
// the two delays stay DIFFERENT numbers -- which is exactly the thing a future
// tidy-up ("why are there two delays?") would undo.
const SRC = readFileSync(resolve(__dirname, "../store.ts"), "utf8");

function constant(name: string): number {
  const m = SRC.match(new RegExp(`const ${name} = (\\d+)`));
  if (!m) throw new Error(`${name} is gone from store.ts`);
  return Number(m[1]);
}

describe("the bot banker's bank-decision pause", () => {
  it("is its own constant, not the card-draw think delay", () => {
    const decision = constant("BOT_BANK_DECISION_DELAY_MS");
    const thinkMax = constant("BOT_THINK_DELAY_MAX_MS");
    expect(decision).toBeGreaterThan(thinkMax);
  });

  it("leaves the notice up long enough to actually read", () => {
    // Not a magic number worth guarding to the millisecond -- but a value that
    // slipped back under two seconds would be the original bug again.
    expect(constant("BOT_BANK_DECISION_DELAY_MS")).toBeGreaterThanOrEqual(2000);
  });

  it("is what schedules playBotBankDecision, and botThinkDelay is not", () => {
    const line = SRC.split("\n").find((l) => l.includes("playBotBankDecision(roundId, bankerId)"));
    expect(line, "the bank-decision scheduling call moved or was renamed").toBeTruthy();
    expect(line).toContain("BOT_BANK_DECISION_DELAY_MS");
    expect(line).not.toContain("botThinkDelay()");
  });
});
