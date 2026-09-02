import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A media query adds NO specificity. `.k-reaction` inside
// `@media (max-width: 520px)` and `.k-reaction` at the top level are equally
// specific, so the one written LATER in the file wins -- media query or not.
//
// This is not a hypothetical. The mobile sizing for .k-reaction sat ~1500
// lines ABOVE the base rule that set `font-size: 14px`, so the base rule
// overrode it and the override had never applied on any phone since the day it
// was written. It was found by probing a live 854x384 page: the query matched,
// --stage-scale resolved, and a freshly attached .k-reaction still computed the
// base 14px. Reported as reaction emoji being too small to make out.
//
// Nothing else can catch this. It is valid CSS, it looks correct where it is
// written, and no render test asserts a font-size that only differs on a phone.
// So the file's ORDER is what gets asserted.

const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

/** Index of `<selector> {` at the top level (not inside an @media block). */
function baseRuleIndex(selector: string): number {
  // Top-level rules in this file start at column 0; rules nested in an @media
  // are indented. That is the whole distinction, and it holds throughout.
  const re = new RegExp(`^\\${selector} \\{`, "m");
  const m = CSS.match(re);
  return m?.index ?? -1;
}

/** Index of the LAST `<selector> {` written indented, i.e. inside an @media. */
function lastMediaRuleIndex(selector: string): number {
  const re = new RegExp(`^[ \\t]+\\${selector} \\{`, "gm");
  let last = -1;
  for (const m of CSS.matchAll(re)) last = m.index ?? last;
  return last;
}

describe("compact-viewport overrides are written after the rules they override", () => {
  // Every selector whose phone sizing is expressed as an @media override of a
  // top-level rule. Add to this list rather than trusting review to spot it.
  const selectors = [".k-reaction"];

  it.each(selectors)("%s's @media override wins", (selector) => {
    const base = baseRuleIndex(selector);
    const media = lastMediaRuleIndex(selector);

    expect(base, `no top-level '${selector} {' found -- did the rule move?`).toBeGreaterThan(-1);
    expect(media, `no @media '${selector} {' found -- did the override go away?`).toBeGreaterThan(-1);
    expect(
      media,
      `'${selector}' has an @media override at char ${media} but a base rule at ${base}. ` +
        `A media query adds no specificity, so the base rule wins and the override is dead code.`
    ).toBeGreaterThan(base);
  });

  it("catches the ordering it is meant to catch", () => {
    // Teeth: the same comparison against a file with the blocks the wrong way
    // round must fail, or this test is only ever asserting that a file parses.
    const broken = `.k-thing {\n  font-size: 14px;\n}\n`;
    const withMediaFirst = `@media (max-width: 520px) {\n  .k-thing {\n    font-size: 20px;\n  }\n}\n${broken}`;
    const baseIdx = withMediaFirst.match(/^\.k-thing \{/m)?.index ?? -1;
    let mediaIdx = -1;
    for (const m of withMediaFirst.matchAll(/^[ \t]+\.k-thing \{/gm)) mediaIdx = m.index ?? mediaIdx;

    expect(baseIdx).toBeGreaterThan(-1);
    expect(mediaIdx).toBeGreaterThan(-1);
    expect(mediaIdx).toBeLessThan(baseIdx); // i.e. the dead-override arrangement
  });
});
