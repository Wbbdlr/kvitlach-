import { test, expect, Page } from "@playwright/test";
import { clickIfAppears } from "./helpers";

// Nothing here checks a feature. It checks that the felt's elements do not sit
// on top of each other, which is a thing unit tests structurally cannot see:
// layout.ts's collision maths is pinned by layout.test.ts and was passing
// throughout, because the pair that actually collided was one it never
// compared.
//
// Reported from a real Galaxy in fullscreen landscape: "a bunch of the
// elements of the game were overlapping onto each other ... it makes playing
// the game unbearable on phones, and that's how most people will be playing."
// Measured at 854x384: the play band is 252px and had to hold a 106px dealer
// seat above a 146px viewer seat, with the bank pill between them. Three
// separate causes, all invisible to the existing suites:
//
//   1. seatScale() compares player seats against each other. The DEALER is
//      rendered separately and was in no comparison at all, so the seats
//      never shrank -- their transform was pure translation.
//   2. bankPanelTop() was tuned when MIN_VF was 0.5. At the current 0.4 its
//      two walls cross: a NEGATIVE corridor, which no vertical arithmetic
//      can place a pill inside.
//   3. The felt/chip hint's own escape hatch keys on `max-width: 540px`, and
//      a landscape phone is 854 wide. Same bug, other axis.
//
// Viewports are real device sizes, not round numbers: Galaxy-class phones in
// landscape, which is what the table locks itself to on a handheld.
// Not only phones any more. The branding-vs-chrome collision above was
// reported at a maximized desktop window and would have been invisible here:
// every viewport in this list was a landscape phone, so the widths where that
// pair actually collided were never rendered. One desktop size, chosen as the
// one the report came from rather than a round number.
const VIEWPORTS = [
  { name: "Galaxy S21 landscape", width: 800, height: 360 },
  { name: "Galaxy S22 landscape", width: 854, height: 384 },
  { name: "Galaxy S22 Ultra landscape", width: 915, height: 412 },
  { name: "maximized desktop", width: 1512, height: 950 },
  // The branding/chrome report named "every ordinary tablet-portrait and
  // small-laptop width" as the range where .k-chrome-top's row grew wide enough
  // to reach the wordmark. 1512 is comfortably past that; this one is inside it.
  { name: "small laptop", width: 1024, height: 640 },
];

// An ALLOWLIST, not a denylist -- the denylist this started as had to grow
// every run and still reported things that are correct by design:
//
//   - cards within one hand overlap deliberately (the fan, see .k-hand's
//     negative margin), so card-vs-card is meaningless;
//   - toasts are floating overlays whose whole job is to sit above the felt;
//   - a reservation chip's CONNECTOR LINE is one SVG whose bounding box spans
//     the whole felt by construction, so the line is exempt -- but the CHIP is
//     not, and used to be exempt with it. See k-resv in CHECKED below;
//   - the felt oval and the full-stage SVG layer contain everything.
//
// These are the elements that carry a player's information -- nameplates,
// totals, hands, the bank -- and none of them may ever sit on another. Using
// the hand CONTAINER rather than individual cards is what keeps the fan from
// reading as a defect while still catching one player's hand on another's.
// k-discard is here because the bank cluster's new home is described as "the
// empty left interior" -- and the discard pile is the one thing that lives on
// the dealer's LEFT (`left: 50% - 145px`, the shoe's mirror image). Measured
// at 854x384 after a resolved round they are 186px apart horizontally and 60px
// vertically -- the pile rides high beside the dealer, the bank sits low --
// but "empty" was an eyeball claim about a screenshot taken before the pile
// existed, and that is exactly the kind of claim this file is for.
// k-reaction is here because a reaction bubble is a floating overlay that
// LOOKS like it should be exempt (toasts are), and is not: it lives for 10
// seconds anchored to a seat, and at the reported viewport the viewer's own
// bubble rose off the bottom-centre seat straight onto the banker's total
// (measured x404-450 y154-166 against the dealer's readout x356-435 y145-167)
// -- "muddled ... not even readable". It is information covering information,
// which is exactly what this file is for.
// k-turnbar and k-resv were BOTH absent from this set, and they failed in
// the two different ways a checked set fails.
//
// k-turnbar was simply never listed. It carries a player's own
// information -- how long is left on their turn -- and on a phone the viewer's
// cards sat straight on top of it (measured -4.7px on live v9.5 at 854x384).
// Nothing here compared it against anything, so the suite was green while the
// bug was on screen. It is also why the fix has to RESERVE its row rather than
// dodge: a conditionally-mounted element is one this file cannot see at all
// when it is unmounted.
//
// k-resv was worse: it was deliberately excluded, on the stated grounds that
// chips "REST against a seat". That was the assumption the bug was made of.
// They did not rest against a seat -- they were placed at a fraction along the
// bank-to-seat line and floated in open felt, which is the whole of the report
// "nowhere near the player's spot". An exemption justified by an unchecked
// claim about layout is the one thing this file exists to refuse; the
// exemption belongs to the connector LINE, which really does span the felt,
// not to the chip riding on it.
//
// The shared lesson, and it is the same one that let a discard entry sit inert:
// an element is not exempt because it is small, transient, or believed to be
// attached to something. If it carries a player's information it goes in here,
// and if it is believed to be anchored, that belief is what gets measured.
const CHECKED = new Set([
  "k-seat", "k-plate", "k-plate-name", "k-plate-sub",
  "k-turnbar", "k-resv",
  // The branding cluster and the chrome row. These are the ONE pair in this
  // file with a documented past collision -- "the felt colour swatches sitting
  // directly on top of the tagline", reported 2026-08-30 with a screenshot at a
  // maximized desktop window (see .k-chrome-top in index.css). It was fixed with
  // a CSS rule, and nothing has asserted it since, because none of the three
  // classes involved was in this set. A fixed bug with no test is a bug waiting
  // for its second turn.
  // .k-topbar and .k-chrome-top themselves stay OUT: both are full-width
  // containers of these, and a container always intersects its own contents --
  // that is the false positive .k-topbar produced when it was measured directly.
  "k-logo-word", "k-logo-tag", "k-chip-btn",
  "k-readout", "k-tag", "k-banktotal", "k-bank-split",
  "k-hand", "k-shoe", "k-discard", "k-reaction", "k-fs-hint", "k-controls",
  // The bottom-left HUD column and both of its occupants. These share one
  // corner: the viewer's own name/total/status sits at the bottom and round
  // toasts stack above it. The column is bottom-anchored and flow-laid so an
  // arriving toast grows it UPWARD and never moves the readout -- but that is
  // a claim about layout, and this is where claims about layout get checked.
  // Worth checking rather than eyeballing because the worst case is not one
  // toast: state.ts keeps up to 5 (slice(-5)) and auto-dismisses at 18s, so
  // five can be stacked over the readout at once.
  "k-viewer-hud", "k-toast",
]);

// Two boxes touching by a few px is antialiasing and rounding, not a layout
// bug. This is calibrated to catch what a player sees: the smallest real
// defect found on the reported viewport was a nameplate 5px inside the
// dealer's box, at 21% of the smaller element.
const MIN_OVERLAP_FRACTION = 0.18;
const MIN_OVERLAP_PX = 3;

interface Overlap {
  a: string;
  b: string;
  pct: number;
  px: string;
}

/**
 * Waits until the felt stops moving.
 *
 * A card in flight is legitimately on top of things it will not be on top of
 * a moment later, so sampling mid-deal reports overlaps that do not exist. A
 * fixed sleep was tried first and passed alone but failed under Playwright's
 * default two workers -- the deal simply takes longer on a contended machine,
 * which is a property of the harness, not of the layout. Sampling positions
 * until they repeat measures the thing actually being waited for.
 */
// Waits until the felt stops moving -- and THROWS if it never does.
//
// It used to return quietly on timeout, which meant a run slow enough to still
// be animating at the deadline went on to assert against a half-laid-out felt
// and reported whatever it caught mid-flight as an overlap. That is the whole
// explanation of this spec's intermittent failures at 800x360 and 854x384:
// both pass every time on --workers=1 and only fail under contention, and the
// pairs they reported were never reproducible. A silent fallthrough turns a
// slow machine into a fake layout bug, which is worse than a red test, because
// it sends someone looking for a collision that is not there.
async function settle(page: Page, quietMs = 400, timeoutMs = 45_000): Promise<void> {
  const snapshot = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".k-hand img, .k-seat, .k-banktotal")]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}`;
        })
        .join("|")
    );
  const deadline = Date.now() + timeoutMs;
  let previous = await snapshot();
  while (Date.now() < deadline) {
    await page.waitForTimeout(quietMs);
    const current = await snapshot();
    if (current === previous && current.length > 0) return;
    previous = current;
  }
  throw new Error(
    `Layout never settled within ${timeoutMs}ms -- the felt was still moving, so any ` +
      `overlap measured now would be an artifact of the animation, not a real collision.`
  );
}

async function findOverlaps(page: Page): Promise<Overlap[]> {
  return page.evaluate(
    ({ checked, minFraction, minPx }) => {
      const allowed = new Set(checked);
      // Both the selector below and nameOf() key on the `k-` prefix, so an
      // element that does not follow the convention is invisible to this file
      // no matter what CHECKED says. The turn timer was the one felt element
      // that did not: it was `turn-bar-track`, matched neither gate, and so
      // could never have been caught here. It has been renamed k-turnbar
      // rather than special-cased, so the convention stays the single rule for
      // what this spec can see.
      const nameOf = (el: Element) => {
        const raw = (el as HTMLElement).className;
        const str = typeof raw === "string" ? raw : (raw as unknown as SVGAnimatedString)?.baseVal ?? "";
        return str.split(/\s+/).filter((c) => c.startsWith("k-")).slice(0, 2).join(".");
      };
      const visible = [...document.querySelectorAll("[class*='k-']")].filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const name = nameOf(el);
        // 1px, not 8px. The 8px floor was a cheap way to skip decorative
        // slivers back when this walked EVERY k- element, but CHECKED is an
        // allowlist -- membership already means "this carries a player's
        // information", so a second filter guessing at importance by size can
        // only overrule it wrongly. It did: k-turnbar is 110x3, so the turn
        // timer would have been dropped here even once it was named in
        // CHECKED, and adding it there would have looked like a fix and
        // changed nothing.
        return (
          r.width > 1 && r.height > 1 &&
          cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0" &&
          name && allowed.has(name.split(".")[0])
        );
      });
      const found: { a: string; b: string; pct: number; px: string }[] = [];
      for (let i = 0; i < visible.length; i += 1) {
        for (let j = i + 1; j < visible.length; j += 1) {
          const a = visible[i];
          const b = visible[j];
          // An element inside another is nesting, not collision.
          if (a.contains(b) || b.contains(a)) continue;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (ox < minPx || oy < minPx) continue;
          const fraction = (ox * oy) / Math.min(ra.width * ra.height, rb.width * rb.height);
          if (fraction < minFraction) continue;
          found.push({
            a: nameOf(a), b: nameOf(b),
            pct: Math.round(fraction * 100),
            px: `${Math.round(ox)}x${Math.round(oy)}`,
          });
        }
      }
      return found.sort((x, y) => y.pct - x.pct);
    },
    { checked: [...CHECKED], minFraction: MIN_OVERLAP_FRACTION, minPx: MIN_OVERLAP_PX }
  );
}

for (const vp of VIEWPORTS) {
  test(`felt has no overlapping elements on ${vp.name} (${vp.width}x${vp.height})`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto("/");

    // Practice needs no second browser and no room code, and it seats bots --
    // so the arc is populated, which is what makes the seats collide at all.
    await page.getByRole("button", { name: /Practice Against the Computer/i }).click();

    const check = async (phase: string) => {
      await settle(page);
      const overlaps = await findOverlaps(page);
      expect(
        overlaps,
        `Overlapping elements on ${vp.width}x${vp.height} (${phase}):\n` +
          overlaps.map((o) => `  ${o.pct}% (${o.px}px)  ${o.a}  X  ${o.b}`).join("\n")
      ).toEqual([]);
    };

    // TWO phases, because no single moment of a round has every element on the
    // felt at once, and each phase owns something the other cannot show:
    //
    //   mid-hand  -- the bank's reservation split only exists against a LIVE
    //                wager, and the viewer's seat is at its tallest with cards
    //                in it. Both are load-bearing for the seat maths.
    //   resolved  -- the discard pile does not render at all until the round
    //                has its first entry (DiscardPile.tsx returns null at
    //                zero), so a check that stops at the deal can never see
    //                the pile, no matter what the allowlist says.
    const bet = page.getByRole("button", { name: "Bet", exact: true });
    await bet.waitFor({ state: "visible", timeout: 30_000 });
    await bet.click();
    await expect(page.locator(".k-hand img").first()).toBeVisible({ timeout: 15_000 });
    await check("mid-hand, live wager");

    // A live reaction bubble on the felt, before the hand resolves. Sent from
    // the picker exactly the way a player does it, and deliberately the
    // LONGEST phrase in the list -- the bubble is white-space: nowrap, so the
    // longest string is the widest box and the only one worth checking.
    await page.getByRole("button", { name: "React" }).click();
    const phrases = page.locator('[role="dialog"], .relative.z-30 > div').first();
    await phrases.waitFor({ timeout: 10_000 });
    const longest = await page.evaluate(() => {
      const panel = [...document.querySelectorAll("div")].find((d) =>
        d.className.includes("bottom-full")
      );
      const buttons = [...(panel?.querySelectorAll("button") ?? [])];
      const pick = buttons.sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length)[0];
      pick?.click();
      return pick?.textContent?.trim() ?? "";
    });
    expect(longest.length, "expected a reaction phrase to send").toBeGreaterThan(0);
    await expect(page.locator(".k-reaction")).toBeVisible({ timeout: 10_000 });
    await check(`reaction bubble up ("${longest}")`);
    // Guards the guard: the bubble removes itself after 10s, so if settle()
    // ever ran long the check above would have measured a felt with no bubble
    // on it and passed for the wrong reason.
    await expect(page.locator(".k-reaction")).toBeVisible();

    // Tolerant, because Stand may not be there to click: the bet or a hit can
    // have already resolved this turn, and the round:state saying so can land
    // between the button appearing and the click. Clicking it blind spent the
    // whole test budget waiting for a button that was never coming back, which
    // is the same race clickIfAppears documents -- this call site simply
    // predated the helper. What the round actually needs to reach is the
    // discard pile, and that is asserted on the next line either way.
    await clickIfAppears(page.getByRole("button", { name: "Stand", exact: true }), 10_000);
    await expect(page.locator(".k-discard")).toBeVisible({ timeout: 30_000 });
    // Resolving the round also raises an outcome toast, which lands in the
    // bottom-RIGHT HUD column now -- it shared the left one with the viewer's
    // readout until that was reported as every announcement shoving the one
    // panel a player checks mid-hand up the screen. Waiting
    // for it is what makes .k-toast/.k-viewer-hud in CHECKED mean anything --
    // an allowlist entry for an element that never rendered is inert, which is
    // exactly how .k-discard sat in here measuring a felt the pile had never
    // appeared on. state.ts auto-dismisses at 18s, so this is a real window,
    // not a permanent fixture.
    await expect(page.locator(".k-toast").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".k-viewer-hud")).toBeVisible();
    await check("round resolved, discard pile up, outcome toast over the viewer readout");

    await context.close();
  });
}
