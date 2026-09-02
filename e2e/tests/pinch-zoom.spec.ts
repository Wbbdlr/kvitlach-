import { test, expect } from "@playwright/test";

// Drives a genuine two-finger pinch through CDP touch input -- Playwright's
// own API has no pinch, and dispatching synthetic TouchEvents would only prove
// the listener runs, not that the browser lets it have the gesture at all
// (touch-action is decided by the compositor, above JS).
test("pinch zooms the felt and the reset returns it", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 854, height: 384 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.waitForTimeout(500);
    await page.getByLabel(/First name/i).last().fill("Zoomer", { timeout: 4000 }).catch(() => undefined);
    await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
    await page.getByRole("button", { name: "Got it", exact: true }).click({ timeout: 2500 }).catch(() => undefined);
    await page.getByRole("button", { name: "Bet", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(600);

    const cdp = await context.newCDPSession(page);
    const touch = (x1: number, y1: number, x2: number, y2: number, type: string) =>
      cdp.send("Input.dispatchTouchEvent", {
        type: type as "touchStart" | "touchMove" | "touchEnd",
        touchPoints:
          type === "touchEnd"
            ? []
            : [
                { x: x1, y: y1, id: 1 },
                { x: x2, y: y2, id: 2 },
              ],
      });

    const cx = 427;
    const cy = 170;
    await touch(cx - 40, cy, cx + 40, cy, "touchStart");
    for (const gap of [60, 90, 120, 150]) {
      await touch(cx - gap, cy, cx + gap, cy, "touchMove");
      await page.waitForTimeout(40);
    }
    await touch(0, 0, 0, 0, "touchEnd");
    await page.waitForTimeout(200);

    const zoom = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".felt-table")!).getPropertyValue("--user-zoom").trim()
    );
    await page.screenshot({ path: "screenshots/zoomed.png" }).catch(() => undefined);
    console.log("ZOOM AFTER PINCH:", zoom);
    expect(Number(zoom)).toBeGreaterThan(1.5);

    const reset = page.getByRole("button", { name: /Reset zoom/i });
    await expect(reset).toBeVisible();
    await reset.click();
    await page.screenshot({ path: "screenshots/zoom-reset.png" }).catch(() => undefined);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".felt-table")!).getPropertyValue("--user-zoom").trim()
    );
    console.log("ZOOM AFTER RESET:", after);
    expect(Number(after)).toBe(1);
  } finally {
    await context.close();
  }
});
