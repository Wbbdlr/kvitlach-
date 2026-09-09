import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The admin panel's own legibility, measured rather than eyeballed.
//
// The bug this pins: the dark-mode block restated the SURFACES (body, table,
// fieldset) and not the muted TEXT, so every hint, table header, legend and
// status word kept its light-mode grey on a near-black card -- measured
// 2.74-3.87:1 where small text needs 4.5. It was reported by the operator, not
// caught here, because nothing was checking. Now something is.

const SRC = readFileSync(resolve(__dirname, "../admin-page.ts"), "utf8");
const STYLE = SRC.slice(SRC.indexOf("const STYLE = `"), SRC.indexOf("`;", SRC.indexOf("const STYLE = `")));
const DARK = STYLE.slice(STYLE.indexOf("@media (prefers-color-scheme: dark)"));
const LIGHT = STYLE.slice(0, STYLE.indexOf("@media (prefers-color-scheme: dark)"));

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every TEXT colour a rule in `block` sets, so a new muted rule cannot dodge
 * this. The lookbehind is load-bearing: without it `border-color` and
 * `outline-color` match too, and the first run of this test failed on a border
 * that is not text and does not need 4.5:1.
 */
const colorsIn = (block: string) =>
  [...block.matchAll(/(?<![\w-])color:\s*(#[0-9a-f]{6})/g)].map((m) => m[1]);

// AA for body text. The muted styles here are 0.68-0.88rem, so the small-text
// threshold is the right one -- 3:1 is for 18pt and up, which none of this is.
const AA = 4.5;

describe("the panel is readable in the operator's own theme", () => {
  it("clears AA for every text colour in light mode", () => {
    // Both grounds: the page is #f9fafb and the cards on it are #fff.
    for (const c of colorsIn(LIGHT)) {
      if (c === "#ffffff" || c === "#fff") continue;
      if (contrast(c, "#ffffff") < AA && contrast(c, "#f9fafb") < AA) {
        // Button fills and focus rings are not text; they are checked by eye.
        expect(LIGHT).toMatch(new RegExp(`background:\s*${c}`));
      }
    }
  });

  it("restates the muted text colours in dark mode, not only the surfaces", () => {
    // Naming them explicitly: this is the exact set that was missed.
    for (const selector of ["th", ".meta", "legend", ".tile .k"]) {
      expect(DARK, selector).toContain(selector);
    }
    for (const status of [".ok", ".warn", ".bad"]) {
      expect(DARK, status).toContain(status);
    }
  });

  it("clears AA for every text colour in dark mode", () => {
    const grounds = ["#111827", "#0b1220"];
    const fills = [...DARK.matchAll(/background:\s*(#[0-9a-f]{6})/g)].map((m) => m[1]);
    for (const c of colorsIn(DARK)) {
      if (fills.includes(c)) continue;
      const best = Math.max(...grounds.map((g) => contrast(c, g)));
      expect(Number(best.toFixed(2)), `${c} on the dark ground`).toBeGreaterThanOrEqual(AA);
    }
  });
});
