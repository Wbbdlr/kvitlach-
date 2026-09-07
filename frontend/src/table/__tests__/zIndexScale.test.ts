import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
// Comment prose talks about z-index constantly in this file -- three of the
// "39 raw z-index declarations" counted during the review turned out to be
// sentences describing the problem, not the problem.
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function tokens(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of CODE.matchAll(/(--z-[a-z-]+):\s*(\d+)\s*;/g)) out[m[1]] = Number(m[2]);
  return out;
}

/**
 * The stacking order this app actually had before the scale existed, lowest
 * first, captured from the raw numbers in index.css at v11.5.
 *
 * This list is the entire safety net for the refactor. Tokens are only worth
 * having if they mean the same thing the numbers meant, and "I replaced 34
 * numbers with 20 names" is not something review can check by reading. Any
 * deliberate reordering (there is one queued -- see the fly-card test at the
 * bottom) has to edit THIS list, in its own commit, on purpose.
 */
const ORDER: Array<[string, number]> = [
  ["--z-felt-decor", 1],
  ["--z-scene-links", 2],
  ["--z-scene-reserve", 9],
  ["--z-seat", 10],
  ["--z-scene-props", 11],
  ["--z-seat-raised", 20],
  ["--z-hud", 25],
  ["--z-hud-status", 30],
  ["--z-hud-top", 40],
  ["--z-preround", 42],
  ["--z-hud-float", 45],
  ["--z-bank-banner", 46],
  ["--z-bank-decision", 48],
  ["--z-scrim", 50],
  ["--z-popover", 60],
  // Step 2 moved the fly card BELOW the modal (was 80, above 70). This pair
  // is the one deliberate departure from the numbers this scale replaced --
  // everything else in this list still means exactly what it meant.
  ["--z-fly", 65],
  ["--z-modal", 70],
  ["--z-reaction", 85],
  ["--z-gate", 90],
];

describe("the z-index scale exists at all", () => {
  it("defines every tier the app actually uses", () => {
    const t = tokens();
    for (const [name] of ORDER) expect(t[name], `${name} is not defined`).toBeTypeOf("number");
  });

  it("is used, not merely declared", () => {
    // docs/mobile-ui.md described this scale as landed for months while
    // `grep -c "z-index: var(--z-"` returned 0. A declared-but-unused scale
    // is worse than none: it reads as true.
    const uses = (CODE.match(/z-index:\s*var\(--z-/g) ?? []).length;
    expect(uses).toBeGreaterThanOrEqual(ORDER.length);
  });
});

describe("the scale preserves the stacking it replaced", () => {
  it("orders the tiers exactly as the raw numbers did", () => {
    const t = tokens();
    const now = ORDER.map(([name]) => t[name]);
    const before = ORDER.map(([, raw]) => raw);
    const rank = (xs: number[]) => xs.map((v) => xs.filter((o) => o < v).length);
    expect(rank(now)).toEqual(rank(before));
  });

  it("gives every tier a distinct value, so nothing falls back to DOM order", () => {
    const t = tokens();
    const values = ORDER.map(([name]) => t[name]);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("nothing that competes globally is still a bare number", () => {
  // The refined rule, and the correction to docs/mobile-ui.md Part 3's
  // "a raw z-index number in new code is a bug": that is true of anything
  // competing on the page, and false of siblings inside one parent. A card's
  // place in a fan (.k-hand, 2..8) and the dock's grip-over-reset (1, 2) are
  // meaningless outside their own stacking context and must NOT be dragged
  // onto a global scale -- doing so would make them look comparable to the
  // rotate gate, which is the confusion the scale exists to remove.
  const LOCAL_ONLY = [".k-hand", ".k-dock-grip", ".k-dock-reset"];

  it("leaves no raw z-index outside the local sibling orderings", () => {
    const offenders: string[] = [];
    const lines = CODE.split("\n");
    lines.forEach((line, i) => {
      if (!/z-index:\s*\d/.test(line)) return;
      let sel = "";
      for (let j = i; j >= 0; j -= 1) {
        const s = lines[j].trim();
        if (s.endsWith("{") && !s.startsWith("@") && s.length > 1) {
          sel = s.slice(0, -1).trim();
          break;
        }
      }
      if (!LOCAL_ONLY.some((l) => sel.includes(l))) offenders.push(`${sel} (line ${i + 1})`);
    });
    expect(offenders).toEqual([]);
  });
});

// Step 2 of the refactor, kept out of the token swap on purpose so the swap
// could be reviewed as the pure no-op it was.
//
// This is the ONE ordering change docs/mobile-ui.md Part 3 asks for that was
// not already true. Its other two turned out to be describing the code:
// reaction bubbles were already over announcements (85 > 48) and the rotate
// gate was already on top (90). Only the fly card was genuinely wrong.
describe("a dealt card does not animate over an open dialog", () => {
  it("puts the fly card under the modal", () => {
    // A card sliding across an open BANK! confirmation -- the one dialog
    // where the player is being asked to commit their whole stack -- reads
    // as the table carrying on without them. The modal wins.
    const t = tokens();
    expect(t["--z-fly"]).toBeLessThan(t["--z-modal"]);
  });

  it("keeps reaction bubbles above the fly card, which is why 85 existed", () => {
    // The relationship the old raw 85 was chosen for (see .k-reaction's own
    // comment): bubbles portal to document.body alongside the fly card, and
    // were reported getting covered by dealt cards. Moving the fly card must
    // not quietly undo that.
    const t = tokens();
    expect(t["--z-reaction"]).toBeGreaterThan(t["--z-fly"]);
  });

  it("still keeps both above every announcement", () => {
    const t = tokens();
    expect(t["--z-fly"]).toBeGreaterThan(t["--z-bank-decision"]);
  });
});
