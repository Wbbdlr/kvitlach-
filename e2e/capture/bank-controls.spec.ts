import { test } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Where the banker's "bank depleted" prompt actually lands, at a full table.
//
// The state itself needs a BANK! wager that empties the bank against a live
// human banker, which a practice room (bot banker) cannot produce -- so the
// real markup and the real classes are injected instead. That is honest for
// this question and only this question: what is being photographed is where
// CSS puts a box, not whether the flow that shows it works.
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "bank-controls");

const VIEWPORTS = [
  { name: "640x360", width: 640, height: 360 },
  { name: "854x384", width: 854, height: 384 },
  { name: "1512x950", width: 1512, height: 950 },
];

for (const vp of VIEWPORTS) {
  test(`bank controls ${vp.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.width < 1000,
      hasTouch: vp.width < 1000,
    });
    const page = await context.newPage();
    const dir = join(OUT, vp.name);
    try {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      await page.goto("/");
      await page.waitForTimeout(500);
      await page.getByLabel(/First name/i).last().fill("Menachem Mendel", { timeout: 4000 }).catch(() => undefined);
      await page.getByRole("button", { name: /Customize table settings/i }).click();
      await page.getByLabel("Number of computer players").fill("10");
      await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
      await page.getByRole("button", { name: "Got it", exact: true }).click({ timeout: 2500 }).catch(() => undefined);
      const bet = page.getByRole("button", { name: "Bet", exact: true });
      await bet.waitFor({ state: "visible", timeout: 30_000 });
      await bet.click();
      await page.locator(".k-hand img").first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);

      const overlaps = await page.evaluate(() => {
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

        const hit = (a: Element, b: Element) => {
          const x = a.getBoundingClientRect();
          const y = b.getBoundingClientRect();
          return x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom;
        };
        const chrome = document.querySelector(".k-chrome-top") as HTMLElement;
        // The other half of the same report: the banker's "add chips" prompts
        // are inline in a nowrap row that is anchored to the RIGHT edge, so
        // anything long grows leftward into the branding rather than wrapping.
        // The report also implicated the banker's inline "Bank is empty -- tap
        // to add chips" prompt, which lives in a nowrap row anchored to the
        // RIGHT edge, so anything long would grow leftward into the branding
        // rather than wrapping. Measured, with the tag appended, at all three
        // sizes: the row's left edge does not move and stays clear of the
        // branding TEXT. (Measuring against .k-topbar's own box says otherwise
        // and means nothing -- it is a full-width container, so every
        // right-anchored thing on screen "overlaps" it.) Kept as a measurement
        // rather than deleted: it is the thing 3b fixed for the wrapping case,
        // and a longer string would put it back.
        const brandRect = document.querySelector(".k-logo-tag, .k-logo-word")!.getBoundingClientRect();
        const warn = document.createElement("button");
        warn.className = "k-tag warn";
        warn.textContent = "Bank is empty — tap to add chips";
        chrome.appendChild(warn);
        const seats = [...document.querySelectorAll(".k-seat")];
        return {
          decisionVsChrome: hit(decision, chrome),
          decisionVsBanner: hit(decision, banner),
          decisionVsSeats: seats.filter((s) => hit(decision, s)).length,
          // Against the branding TEXT, not .k-topbar's box -- that is a
          // full-width container and everything trivially "overlaps" it.
          chromeVsBrandText: chrome.getBoundingClientRect().left < brandRect.right,
          brandTextRight: Math.round(brandRect.right),
          chromeLeft: Math.round(chrome.getBoundingClientRect().left),
          chromeWidth: Math.round(chrome.getBoundingClientRect().width),
          viewportWidth: window.innerWidth,
          decisionRect: (() => {
            const r = decision.getBoundingClientRect();
            return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) };
          })(),
        };
      });
      console.log(`BANKCTL ${vp.name} ` + JSON.stringify(overlaps));
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(dir, "1-bank-decision.png") });
    } finally {
      await context.close();
    }
  });
}
