import { test, expect } from "@playwright/test";

// Bug #2 as reported: "Banker's chip controls are misplaced and overlapping."
//
// This existed only as a one-off measurement in a capture spec that logs and
// asserts nothing, which is not a closed bug -- it is a bug someone happened to
// look at once. The prompt sat at `top: 22%` of the VIEWPORT, and 22% of a
// 360px-tall phone is 79px against a 141px panel, so it always began above the
// top chrome row: measured at a full table it covered the row carrying Leave
// and the BANK! banner explaining why it was there.
//
// The live state needs a BANK! wager that empties the bank against a human
// banker, which a practice room (bot banker) cannot produce. The real markup
// and the real classes are injected instead, which is honest for this question
// and only this question: what is asserted is where CSS puts a box, not whether
// the flow that shows it works.
const PHONES = [
  { name: "640x360", width: 640, height: 360 },
  { name: "854x384", width: 854, height: 384 },
];

for (const vp of PHONES) {
  test(`the bank-depleted prompt clears the chrome row and the banner at ${vp.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await page.getByLabel(/First name/i).last().fill("Menachem Mendel", { timeout: 5000 }).catch(() => undefined);
      await page.getByRole("button", { name: /Customize table settings/i }).click();
      await page.getByLabel("Number of computer players").fill("10");
      await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
      await page.getByRole("button", { name: "Got it", exact: true }).click({ timeout: 2500 }).catch(() => undefined);
      const bet = page.getByRole("button", { name: "Bet", exact: true });
      await bet.waitFor({ state: "visible", timeout: 30_000 });
      await bet.click();
      await page.locator(".k-hand img").first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1200);

      const hits = await page.evaluate(() => {
        const fit = document.querySelector(".k-fit")!;
        const banner = document.createElement("div");
        banner.className = "k-bank-banner";
        banner.innerHTML = "<span>Menachem Mendel bets BANK! &mdash; $395</span>";
        const decision = document.createElement("div");
        decision.className = "k-bank-decision";
        decision.innerHTML =
          '<div class="headline">Bank depleted</div>' +
          '<div class="subline">Menachem Mendel’s BANK! wager emptied the bank. Add chips to play it out, or end the round here.</div>' +
          '<div class="flex gap-2"><button class="k-btn bet sm">Replenish bank</button>' +
          '<button class="k-btn stand sm">End round now</button></div>';
        fit.appendChild(banner);
        fit.appendChild(decision);
        const overlaps = (a: Element, b: Element) => {
          const x = a.getBoundingClientRect();
          const y = b.getBoundingClientRect();
          return x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom;
        };
        const found: string[] = [];
        // The two things it must never cover: the row carrying Leave, and the
        // banner that says why the prompt is there at all. It DOES cover seats,
        // deliberately -- it is modal in effect, nothing under it can be acted
        // on, and on a 360px-tall phone there is no band that clears both the
        // chrome and the arc.
        if (overlaps(decision, document.querySelector(".k-chrome-top")!)) found.push("chrome row");
        if (overlaps(decision, banner)) found.push("BANK! banner");
        if (overlaps(decision, document.querySelector(".k-controls")!)) found.push("the dock");
        const r = decision.getBoundingClientRect();
        return { found, top: Math.round(r.top), bottom: Math.round(r.bottom) };
      });

      expect(hits.found, `bank-depleted prompt covers: ${hits.found.join(", ")}`).toEqual([]);
      // It must also stay on screen -- centring is only right while it fits.
      expect(hits.top).toBeGreaterThanOrEqual(0);
      expect(hits.bottom).toBeLessThanOrEqual(vp.height);
    } finally {
      await context.close();
    }
  });
}
