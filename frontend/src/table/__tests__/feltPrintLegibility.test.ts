import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Two phone-layout reports from an Android landscape table, both about text
// landing on top of other text:
//
//   "the reserved amount indicator for bank (and total) overlap the table
//    felt marker (mishpachas schlesinger kvitlach)"
//   "long bank names have the online indicator on top of the banker's name"
//
// jsdom lays out neither @media queries nor the flex/ellipsis interaction
// these turn on, so nothing here renders -- same reasoning as
// dockOverflowClip.test.ts. What is pinned is the two declarations that were
// missing, each measured live at 915x412 before and after.
const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

/**
 * The body of a rule with this exact, standalone selector.
 *
 * Scanned rather than matched with a built RegExp: the selectors here carry
 * dots and a `::after`, and hand-escaping those into a pattern is how the
 * first version of this file arrived with a broken character class.
 */
function ruleBody(selector: string): string {
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(selector, from);
    if (at < 0) throw new Error(`no rule found for ${selector}`);
    const before = at === 0 ? "\n" : CSS[at - 1]!;
    const rest = CSS.slice(at + selector.length);
    const brace = rest.match(/^\s*\{/);
    // A standalone selector: not the tail of a longer one (.k-readout must
    // not match .k-readout.is-muted), and followed by its own block.
    const standalone = before === "\n" || before === " " || before === "," || before === "\r";
    if (standalone && brace) {
      const open = at + selector.length + brace[0].length;
      const close = CSS.indexOf("}", open);
      return CSS.slice(open, close);
    }
    from = at + selector.length;
  }
}

/** The alpha of the LAST background declaration in a rule body. */
function backgroundAlpha(body: string): number {
  const decls = [...body.matchAll(/(?<![\w-])background:\s*rgba?\(([^)]*)\)/g)];
  expect(decls.length, "expected a background declaration").toBeGreaterThan(0);
  const parts = decls[decls.length - 1]![1]!.split(/[,/]/).map((p) => p.trim());
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

describe("the felt print showing through the readouts on it", () => {
  // The print (.k-oval::after) is deliberately behind everything and meant to
  // be painted over -- cards manage it because cards are opaque. These pills
  // did not, so 40% of a 20px gold watermark came through the digits. The
  // overlap itself is real and is not going away: measured at 915x412 the
  // reserved row sits at y164-181 and the print's line box at y172-196.
  it("keeps the bank total and the readouts effectively opaque", () => {
    for (const selector of [".k-readout", ".k-banktotal"]) {
      const alpha = backgroundAlpha(ruleBody(selector));
      expect(alpha, `${selector} lets the felt print bleed through its text`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("keeps the two on one row at the SAME alpha", () => {
    // They share .k-bank-hud-row. A different alpha on each reads as one of
    // them being lit rather than as one row.
    expect(backgroundAlpha(ruleBody(".k-readout"))).toBe(backgroundAlpha(ruleBody(".k-banktotal")));
  });

  it("still leaves the print itself alone", () => {
    // The fix must stay a change to what sits ON the felt, not a retreat from
    // having a felt print at all. Three earlier attempts tried to find the
    // watermark a gap of its own and all three lost; see .k-oval::after.
    const body = ruleBody(".k-oval::after");
    expect(body).toContain("content: var(--wm");
    expect(body).toContain("rgba(230, 164, 75,");
  });
});

describe("a banker name longer than its plate", () => {
  it("is bounded so the ellipsis can actually fire", () => {
    // .k-plate is a flex ROW (avatar | name column | presence dot). The name
    // column carries min-w-0 and shrinks correctly; the NAME did not, because
    // the column is align-items: flex-start, which sizes a child's width to
    // its content instead of stretching it. overflow:hidden then had nothing
    // to clip against and the text painted straight out of its box: measured
    // with a 32-character name, column 77px, name 171px, 90px of it lying
    // across the dot.
    const body = ruleBody(".k-plate-name");
    expect(body).toContain("max-width: 100%");
    // The four only work together -- drop any one and the name is back over
    // the dot, or the ellipsis becomes a hard cut.
    expect(body).toContain("overflow: hidden");
    expect(body).toContain("text-overflow: ellipsis");
    expect(body).toContain("white-space: nowrap");
  });

  it("bounds the wallet line too, which is a SIBLING and not covered by the above", () => {
    // Asked for directly after the first fix -- "we need to make sure it is
    // fixed for other people's name pills too, not just banker."
    //
    // The name and the wallet line are two children of the same flex column,
    // so capping one says nothing about the other. The name is shared CSS and
    // so was already fixed for every seat; the wallet line was not bounded at
    // all, and it grows with the money. Measured on a seat plate at 915x412:
    // it clears the presence dot by 3.4px at "$999,999 - +$99,999" and lands
    // ON the dot at "$5,000,000 - -$1,250,000".
    const body = ruleBody(".k-plate-sub");
    expect(body).toContain("max-width: 100%");
    expect(body).toContain("overflow: hidden");
    expect(body).toContain("text-overflow: ellipsis");
  });

  it("bounds the name through shared CSS, so every seat gets it, not just the dealer", () => {
    // Seat.tsx and Dealer.tsx build the same plate: avatar, a min-w-0 column
    // holding .k-plate-name over .k-plate-sub, then the presence element. One
    // rule covers both, and that is the reason it does -- if either file ever
    // grows its own name class, this stops being true silently.
    const seat = readFileSync(resolve(__dirname, "../Seat.tsx"), "utf8");
    const dealer = readFileSync(resolve(__dirname, "../Dealer.tsx"), "utf8");
    for (const source of [seat, dealer]) {
      expect(source).toContain('className="k-plate-name"');
      expect(source).toContain("flex flex-col items-start leading-tight min-w-0");
    }
    // Swept live at 915x412 with a 28-character name and the extreme wallet
    // line on all eleven plates at once: zero overflowed their presence mark.
    expect(seat).toContain("k-presence flex-none");
  });

  it("still has a dot to keep clear of", () => {
    // If the presence dot ever stops being a flex sibling of the name, the
    // max-width above is guarding nothing and this should be re-derived.
    const dealer = readFileSync(resolve(__dirname, "../Dealer.tsx"), "utf8");
    expect(dealer).toContain("rounded-full flex-none");
    expect(dealer).toContain('aria-label={isOffline ? "Offline" : "Online"}');
  });
});
