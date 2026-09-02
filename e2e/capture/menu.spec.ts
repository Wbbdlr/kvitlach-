import { test } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The chrome menu, open, at the two landscape phone sizes -- the one screen a
// player goes to when they want chips or a name change, and the one this
// change is about. Separate from the sweep because the sweep photographs the
// felt at rest and this is a popover that only exists once you tap.
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "menu");

const VIEWPORTS = [
  { name: "640x360", width: 640, height: 360 },
  { name: "854x384", width: 854, height: 384 },
];

for (const vp of VIEWPORTS) {
  test(`chrome menu ${vp.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const dir = join(OUT, vp.name);
    try {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      await page.goto("/");
      await page.waitForTimeout(600);
      await page.getByLabel(/First name/i).last().fill("Menachem Mendel", { timeout: 4000 }).catch(() => undefined);
      await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
      await page.getByRole("button", { name: "Got it", exact: true }).click({ timeout: 2500 }).catch(() => undefined);
      await page.getByRole("button", { name: "Bet", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: "Table controls" }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(dir, "1-menu-open.png") });
    } finally {
      await context.close();
    }
  });
}
