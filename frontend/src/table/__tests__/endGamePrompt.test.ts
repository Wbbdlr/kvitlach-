import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Read as source rather than rendered, the same way quickBetColumn and
// portraitGate do: the bank-decision prompt lives deep inside TableRoot,
// which needs a full room, round and turn list to mount at all, and what
// matters here is a wiring property that source states plainly -- an
// irreversible action must not be one tap from a prompt that appears without
// warning in the middle of someone else's hand.
const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../TableRoot.tsx"),
  "utf8"
);

// Comments in this file name the old label deliberately (that history is
// the point), so the label check reads the code with them stripped.
const code = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("ending the game from the bank decision", () => {
  it("no longer offers to end only the round", () => {
    expect(code).not.toContain("End round now");
  });

  // The button that ARMS the confirmation must not be the button that fires
  // it. If these ever collapse back into one, a banker tapping through a
  // prompt disconnects the whole table by accident.
  it("arms a confirmation rather than ending the night on the first tap", () => {
    expect(source).toMatch(/onClick=\{\(\) => setEndGameOpen\(true\)\}/);
    expect(source).toMatch(/onClick=\{onEndGame\}/);
    expect(source).not.toMatch(/onClick=\{\(\) => \{?\s*onEndGame\(\)/);
  });

  it("offers a way back out of the confirmation", () => {
    expect(source).toMatch(/onClick=\{\(\) => setEndGameOpen\(false\)\}/);
  });

  // Same reasoning as the pass-bank picker beside it: this is state scoped to
  // one bank-decision moment, and a confirmation left armed from a previous
  // moment is the dangerous version of the stale-picker bug.
  it("disarms the confirmation when the decision is no longer required", () => {
    const effect = source.match(/if \(!bankerDecisionRequired\) \{[\s\S]*?\}/);
    expect(effect).not.toBeNull();
    expect(effect![0]).toContain("setEndGameOpen(false)");
    expect(effect![0]).toContain("setPassBankOpen(false)");
  });
});
