import { test, expect, Page } from "@playwright/test";

// The turn timer's space, asserted directly rather than as a by-product.
//
// phone-layout.spec.ts already compares k-turnbar against k-hand as part of its
// general sweep, and that is worth having -- but it answers "did anything on the
// felt collide", not "can a player still see how long they have left". This file
// answers the second question, because it is the one that affects play: a hand
// that covers its own timer costs the player the turn, not just the tidiness of
// the felt.
//
// It was a real bug, mobile-only for a structural reason. --k-hand-scale is
// 1/seatShrink, so it is above 1 exactly when seats shrink and exactly 1 on a
// desktop table -- and with the default centre transform-origin the hand grew
// UPWARD into the bar, which a transform does not tell layout about. Measured on
// live v9.5 at 854x384: bar 193-194 against a hand starting at 190, a 4.7px
// overlap. Landscape phone, because that is where seats shrink.
const PHONE = { width: 854, height: 384 };

interface Box { top: number; bottom: number; left: number; right: number; height: number }

async function seatBoxes(page: Page, ownSeat: boolean) {
  return page.evaluate((own) => {
    const seats = [...document.querySelectorAll(".k-seat")];
    const seat = own
      ? seats.find((s) => s.querySelector(".k-hand.is-me"))
      : seats.find((s) => !s.querySelector(".k-hand.is-me") && s.querySelector(".k-turnbar"));
    if (!seat) return null;
    const bar = seat.querySelector(".k-turnbar");
    const hand = seat.querySelector(".k-hand");
    const r = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        top: +b.top.toFixed(1),
        bottom: +b.bottom.toFixed(1),
        left: +b.left.toFixed(1),
        right: +b.right.toFixed(1),
        height: +b.height.toFixed(1),
      };
    };
    return {
      bar: r(bar),
      hand: r(hand),
      live: bar ? bar.classList.contains("is-live") : false,
      handScale: getComputedStyle(seat).getPropertyValue("--k-hand-scale").trim(),
    };
  }, ownSeat);
}

test.describe("the turn timer's row", () => {
  test(`is reserved and uncovered at ${PHONE.width}x${PHONE.height}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: PHONE,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: /Practice Against the Computer/i }).click();

    const bet = page.getByRole("button", { name: "Bet", exact: true });
    await bet.waitFor({ state: "visible", timeout: 30_000 });
    await bet.click();
    await expect(page.locator(".k-hand img").first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);

    const mine = await seatBoxes(page, true);
    expect(mine, "the viewer's own seat should be on the felt").not.toBeNull();
    expect(mine!.bar, "the viewer's seat must always carry a timer row").not.toBeNull();
    expect(mine!.hand).not.toBeNull();

    const bar = mine!.bar as Box;
    const hand = mine!.hand as Box;

    // The whole of the reported bug, stated as one number. Positive = the hand
    // starts below the bar ends; negative = the cards are sitting on it.
    const gap = +(hand.top - bar.bottom).toFixed(1);
    // Printed, not just asserted: the number is the evidence, and a green tick
    // that says nothing is how "already fixed" gets claimed without proof.
    console.log(
      `  viewer seat @ ${PHONE.width}x${PHONE.height}: bar ${bar.top}-${bar.bottom}, ` +
        `hand top ${hand.top}, gap ${gap}px, --k-hand-scale ${mine!.handScale}, live ${mine!.live}`
    );
    expect(
      gap,
      `The viewer's cards overlap their own turn timer by ${-gap}px ` +
        `(bar ${bar.top}-${bar.bottom}, hand starts ${hand.top}, --k-hand-scale ${mine!.handScale}). ` +
        `A player cannot see how long is left on their turn.`
    ).toBeGreaterThan(0);

    // Reserved, not merely present-when-running. A row that only exists while a
    // turn is being timed leaves nothing holding its place, which is how a dealt
    // card landed on it: the space has to be there in the idle state too.
    const other = await seatBoxes(page, false);
    expect(other, "another seat should be on the felt").not.toBeNull();
    expect(other!.bar, "every player seat carries the row, running or not").not.toBeNull();
    expect(
      (other!.bar as Box).height,
      "an idle seat's timer row still occupies its space"
    ).toBeGreaterThan(0);

    // The banker never takes a timed turn, so they get no row and no space for
    // one -- asserted so "always render it" does not quietly become "everywhere".
    const bankerHasBar = await page.evaluate(() => {
      const seat = [...document.querySelectorAll(".k-seat")].find((s) => s.querySelector(".k-hand.is-dealer"));
      return seat ? Boolean(seat.querySelector(".k-turnbar")) : null;
    });
    expect(bankerHasBar, "the banker's seat should carry no timer row").toBe(false);

    await page.screenshot({ path: "screenshots/turn-timer-854x384.png" });
    await context.close();
  });
});
