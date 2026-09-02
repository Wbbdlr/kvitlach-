import { test, Page } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A FULL table -- eleven seats, the cap -- photographed at the two landscape
// phone sizes, with the bottom corners cropped out on their own.
//
//     npm --prefix e2e run shot:full-table
//
// Separate from screenshots.spec.ts because it answers a different question.
// That sweep asks "does anything break at this size"; this one asks "where
// does the seat arc actually reach when the table is as crowded as it can get",
// which is a placement decision about the two bottom corners -- the persistent
// readout is in one of them today and the reaction bubbles are going into one
// of them next. The regular sweep's practice table seats two bots, so it can
// never show it.
//
// Eleven is not a round number picked for effect: MAX_SEATED_PLAYERS_PER_ROUND
// in backend/src/store.ts is 11, and createPracticeRoom's 10-bot cap plus the
// one human hits it exactly. The banker is a twelfth player who is not on the
// arc at all.
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "full-table");

const VIEWPORTS = [
  { name: "640x360", width: 640, height: 360 },
  { name: "854x384", width: 854, height: 384 },
];

// Tall enough to take in the dock, the HUD column and the lowest seats on the
// arc, which is the whole question being asked. Wider than half so the two
// crops overlap slightly in the middle rather than butting up against a seam.
const CORNER_H = 150;
const CORNER_W_FRACTION = 0.58;

async function settle(page: Page, quietMs = 400, timeoutMs = 20_000) {
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
}

for (const vp of VIEWPORTS) {
  test(`full table ${vp.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const dir = join(OUT, vp.name);
    // try/finally for the same reason screenshots.spec.ts has one: a throw
    // partway must not leave the context and its renderers alive.
    try {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      await page.goto("/");
      await page.waitForTimeout(600);

      // Worst-case name, same reasoning as the sweep's: a long double-barrelled
      // one is entirely plausible here and is far wider than "Guest".
      await page
        .getByLabel(/First name/i)
        .last()
        .fill("Menachem Mendel", { timeout: 4000 })
        .catch(() => undefined);

      // The bot slider lives behind the collapsed settings panel, and its
      // default is 2 -- which is the whole reason the regular sweep cannot
      // answer this question.
      await page.getByRole("button", { name: /Customize table settings/i }).click();
      await page.getByLabel("Number of computer players").fill("10");

      await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
      await page
        .getByRole("button", { name: "Got it", exact: true })
        .click({ timeout: 2500 })
        .catch(() => undefined);

      const bet = page.getByRole("button", { name: "Bet", exact: true });
      await bet.waitFor({ state: "visible", timeout: 30_000 });
      await bet.click();
      await page.locator(".k-hand img").first().waitFor({ timeout: 20_000 });
      await settle(page);

      await page.screenshot({ path: join(dir, "1-full-table.png") });

      const w = Math.round(vp.width * CORNER_W_FRACTION);
      const y = vp.height - CORNER_H;
      await page.screenshot({
        path: join(dir, "2-bottom-left.png"),
        clip: { x: 0, y, width: w, height: CORNER_H },
      });
      await page.screenshot({
        path: join(dir, "3-bottom-right.png"),
        clip: { x: vp.width - w, y, width: w, height: CORNER_H },
      });

    } finally {
      await context.close();
    }
  });
}
