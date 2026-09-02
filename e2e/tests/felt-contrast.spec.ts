import { test, expect, Page } from "@playwright/test";

// The felt is a USER-CHOSEN colour, so no element's legibility can be judged
// against "the background" -- there are three, and the player picks. See
// frontend/src/theme.ts: FELTS is a fixed set (green / burgundy / navy),
// persisted per-client in localStorage, never synced, applied by writing
// --felt-hi / --felt-lo / --felt-rail onto :root.
//
// This is the colour half of the containment rule in docs/mobile-ui.md Part 2:
// don't compute a property from a sibling you don't control. A caption sitting
// directly on the felt has its contrast decided by a preference in someone
// else's localStorage. It must carry its own background instead, and then it
// is legible on all three by construction rather than by inspection.
//
// A screenshot sweep structurally cannot catch this -- every capture is taken
// on whichever felt the client defaulted to (green), so the other two are
// unphotographed. Same blind spot as the per-viewpoint one in Part 8.
const FELTS = {
  green: { hi: "#24503a", lo: "#12271c" },
  burgundy: { hi: "#5a2733", lo: "#280f16" },
  navy: { hi: "#24405e", lo: "#0d1a2b" },
} as const;

// Anything at or above this alpha is doing the job -- it is a background of
// its own, not a wash the felt shows through. Below it, the felt's colour is
// still most of what the eye receives, which is exactly the dependency being
// removed. Deliberately not 1.0: a heavy scrim is a legitimate answer.
const OPAQUE_ENOUGH = 0.6;

// Measured, argued and left alone -- not "known failures to fix later".
//
// .k-banktotal carries a 55% dark tint, just under the bar above, and that
// tint puts it at 8.9:1 on the worst felt (green centre) against AA's 4.5.
// Its contrast is technically felt-dependent and the dependency is worth
// about one point of ratio, so raising it to the shared scrim would change
// how the bank pill looks for no legibility gain. Consistency is not a reason
// to repaint something that reads fine.
//
// If either of these ever moves, delete its entry rather than adjusting the
// number: the exemption is the measurement, and a stale measurement is worse
// than no exemption.
const EXEMPT = new Set(["k-banktotal"]);

type Bare = { name: string; text: string; color: string; layers: string[] };

async function bareTextOverFelt(page: Page): Promise<Bare[]> {
  return page.evaluate(
    ({ minAlpha }) => {
      const parseAlpha = (bg: string): number => {
        if (!bg || bg === "transparent") return 0;
        const m = bg.match(/rgba?\(([^)]+)\)/);
        if (!m) return 1;
        const parts = m[1].split(",").map((v) => parseFloat(v));
        return parts.length < 4 ? 1 : parts[3];
      };
      const nameOf = (el: Element) => {
        const raw = (el as HTMLElement).className;
        const str = typeof raw === "string" ? raw : (raw as unknown as SVGAnimatedString)?.baseVal ?? "";
        const k = str.split(/\s+/).filter((c) => c.startsWith("k-"));
        return k.length ? k.slice(0, 2).join(".") : el.tagName.toLowerCase();
      };

      const felt = document.querySelector(".felt-table");
      if (!felt) return [];
      const fr = felt.getBoundingClientRect();
      const out: { name: string; text: string; color: string; alpha: number }[] = [];

      for (const el of [...document.querySelectorAll("*")]) {
        // Only elements holding their OWN text -- a wrapper's textContent
        // would report every ancestor of every caption.
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (!own) continue;

        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;

        // Only what actually sits over the felt. Chrome out in the letterbox
        // surround reads against .k-fit, which no preference recolours.
        const overFelt =
          Math.min(r.right, fr.right) - Math.max(r.left, fr.left) > 0 &&
          Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top) > 0;
        if (!overFelt) continue;

        // Walk up looking for a background of its own. Stops AT the felt: the
        // felt's own gradient is the thing we are refusing to depend on.
        // Every translucent layer between the text and the felt, innermost
        // first. Alpha COMPOSES -- three 30% washes are not 30% -- so the
        // question is what the stack adds up to, not what any one rule says.
        let cur: Element | null = el;
        const layers: string[] = [];
        let backed = false;
        let covered = 0;
        while (cur && cur !== felt && cur !== document.body) {
          const s = getComputedStyle(cur);
          if (s.backgroundImage !== "none") {
            backed = true;
            break;
          }
          const a = parseAlpha(s.backgroundColor);
          if (a > 0) {
            layers.push(s.backgroundColor);
            covered = covered + a * (1 - covered);
            if (covered >= minAlpha) {
              backed = true;
              break;
            }
          }
          cur = cur.parentElement;
        }
        if (backed) continue;

        out.push({ name: nameOf(el), text: own.slice(0, 40), color: cs.color, layers });
      }
      return out;
    },
    { minAlpha: OPAQUE_ENOUGH }
  );
}

// Contrast is reported rather than asserted: the assertion is structural (does
// it carry its own background), because that is the property that holds for
// all three felts and for any felt added later. A ratio only ever describes
// the three that exist today.
function rgb(c: string): [number, number, number, number] {
  if (c.startsWith("#")) {
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  const p = m ? m[1].split(",").map((v) => parseFloat(v)) : [255, 255, 255, 1];
  return [p[0], p[1], p[2], p.length < 4 ? 1 : p[3]];
}

// What the eye actually receives behind the text: the felt, with every
// translucent layer painted over it in order. Reporting a ratio against the
// RAW felt would understate the backed cases and overstate nothing -- and the
// point of this file is numbers someone can act on.
function composite(layers: string[], feltHex: string): string {
  let [r, g, b] = rgb(feltHex);
  for (const layer of [...layers].reverse()) {
    const [lr, lg, lb, la] = rgb(layer);
    r = lr * la + r * (1 - la);
    g = lg * la + g * (1 - la);
    b = lb * la + b * (1 - la);
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function contrast(fg: string, bgHex: string): number {
  const lum = (r: number, g: number, b: number) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const m = fg.match(/rgba?\(([^)]+)\)/);
  const [fr, fg2, fb] = m ? m[1].split(",").map((v) => parseFloat(v)) : [255, 255, 255];
  const [br, bg, bb] = rgb(bgHex);
  const l1 = lum(fr, fg2, fb);
  const l2 = lum(br, bg, bb);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

for (const [feltName, felt] of Object.entries(FELTS)) {
  test(`no text reads directly against raw felt (${feltName})`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 854, height: 384 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    try {
      const page = await context.newPage();
      // theme.ts reads this on mount; setting it before first paint avoids a
      // flash of the default and any transition mid-measure.
      await page.addInitScript((name) => {
        window.localStorage.setItem("kvitlach.felt", name);
      }, feltName);
      await page.goto("/");
      await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
      await page
        .getByRole("button", { name: "Got it", exact: true })
        .click({ timeout: 2500 })
        .catch(() => undefined);

      const bet = page.getByRole("button", { name: "Bet", exact: true });
      await bet.waitFor({ state: "visible", timeout: 30_000 });
      await bet.click();
      await page.locator(".k-hand img").first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1200);

      // Both phases, same reason phone-layout.spec.ts checks two: the discard
      // pile's own caption does not render until a round has resolved
      // (DiscardPile.tsx returns null at zero), and the resolved outcome tags
      // are different strings from the mid-hand ones.
      const dealt = await bareTextOverFelt(page);
      await page
        .getByRole("button", { name: "Stand", exact: true })
        .click({ timeout: 5000 })
        .catch(() => undefined);
      await page.locator(".k-discard").waitFor({ timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const resolved = await bareTextOverFelt(page);

      // Deduped by class+text: the same caption on eleven seats is one bug,
      // and a list of eleven identical lines buries the other findings.
      const seen = new Set<string>();
      const bare = [...dealt, ...resolved].filter((b) => {
        if (EXEMPT.has(b.name.split(".")[0])) return false;
        const key = `${b.name}|${b.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const report = bare
        .map((b) => {
          const hi = composite(b.layers, felt.hi);
          const lo = composite(b.layers, felt.lo);
          const ink = (bg: string) => composite([b.color], bg);
          const cover = b.layers.length ? ` [${b.layers.length} wash]` : " [BARE]";
          return (
            `  ${b.name}${cover}  "${b.text}"  ${b.color}` +
            `  centre ${contrast(ink(hi), hi).toFixed(1)}:1` +
            `  edge ${contrast(ink(lo), lo).toFixed(1)}:1`
          );
        })
        .join("\n");
      expect(
        bare.map((b) => b.name),
        `Text sitting directly on the ${feltName} felt, with no background of its own -- ` +
          `its contrast is decided by a preference in the player's localStorage:\n${report}`
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

// The second themeable axis, and the reason it needs its own check: CHIPS
// (theme.ts) recolours --chip-ink, so the TEXT on every .k-chip-btn is a user
// preference too. Felt and chips are chosen independently, so the real surface
// is 3 x 4, which is not something a screenshot sweep should try to cover.
//
// It does not need to. .k-chip-btn already carries its own 60% background, so
// the felt is at most 40% of what is behind that text and the four inks differ
// from each other far more than the three felts do. Measured rather than
// assumed, on the felt that composites lightest.
// Mirrors theme.ts's CHIPS inks. Duplicated rather than imported -- e2e/ is a
// separate package with its own tsconfig, and reaching across into frontend/src
// for four strings is not worth the build coupling. The gold entry is asserted
// against what the app actually renders below, so drift is caught rather than
// silently measured against stale values.
const CHIP_INKS = {
  gold: "#e6d3ab",
  ruby: "#e0b8b4",
  sapphire: "#b9c8e0",
  silver: "#d2d8dd",
} as const;
const AA_NORMAL = 4.5;

test("every chip theme's chrome text stays legible on every felt", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 854, height: 384 } });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
    const btn = page.locator(".k-chip-btn").first();
    await btn.waitFor({ timeout: 30_000 });

    // One page, twelve combinations: applyFelt/applyChip do nothing but write
    // these custom properties onto :root, so setting them here is the same
    // operation the app performs -- and twelve reloads (each creating its own
    // practice room) timed out and ran into the server's room cap.
    const rendered = await btn.evaluate((el) => getComputedStyle(el).color);
    expect(rendered, "chip default no longer renders theme.ts's gold ink -- CHIP_INKS is stale")
      .toBe("rgb(230, 211, 171)");
    const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);

    const failures: string[] = [];
    for (const [feltName, felt] of Object.entries(FELTS)) {
      for (const [chipName, ink] of Object.entries(CHIP_INKS)) {
        for (const [where, feltHex] of [["centre", felt.hi], ["edge", felt.lo]] as const) {
          const behind = composite([bg], feltHex);
          const ratio = contrast(composite([ink], behind), behind);
          if (ratio < AA_NORMAL) {
            failures.push(`  ${feltName}/${chipName} ${where}: ${ratio.toFixed(1)}:1  ink ${ink}`);
          }
        }
      }
    }

    expect(
      failures,
      `Chip-theme chrome text under AA (${AA_NORMAL}:1) on some felt:\n${failures.join("\n")}`
    ).toEqual([]);
  } finally {
    await context.close();
  }
});
