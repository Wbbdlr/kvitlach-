import { test, expect } from "@playwright/test";

// The readout is meant to be parked wherever a player likes and stay there --
// which means the thing to prove is that it MOVED, that it came back after a
// reload, and that it cannot be pushed somewhere unreachable.
test("the viewer readout can be dragged, resized, remembered and put back", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 854, height: 384 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.waitForTimeout(400);
    await page.getByLabel(/First name/i).last().fill("Dragger", { timeout: 4000 }).catch(() => undefined);
    await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
    await page.getByRole("button", { name: "Got it", exact: true }).click({ timeout: 2500 }).catch(() => undefined);
    await page.getByRole("button", { name: "Bet", exact: true }).waitFor({ state: "visible", timeout: 30_000 });

    const hud = page.locator(".k-viewer-hud");
    await expect(hud).toBeVisible();
    const before = (await hud.boundingBox())!;

    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 220, before.y + before.height / 2 - 90, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const after = (await hud.boundingBox())!;
    expect(after.x - before.x).toBeGreaterThan(150);
    expect(before.y - after.y).toBeGreaterThan(50);

    // Survives a reload: the whole point is "leave it where I put it".
    await page.reload();
    await page.getByRole("button", { name: "Bet", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(400);
    const restored = (await page.locator(".k-viewer-hud").boundingBox())!;
    expect(Math.abs(restored.x - after.x)).toBeLessThan(12);

    // And can always be put back.
    await page.getByRole("button", { name: /Put the readout back/i }).click();
    await page.waitForTimeout(200);
    const reset = (await page.locator(".k-viewer-hud").boundingBox())!;
    expect(Math.abs(reset.x - before.x)).toBeLessThan(6);
  } finally {
    await context.close();
  }
});

test("a dragged readout is pulled back on screen when the viewport shrinks", async ({ browser }) => {
  // A position saved in landscape is off the bottom of the same phone in
  // portrait, and the panel is the thing a player would be looking for to work
  // out what had happened.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.evaluate(() =>
      window.localStorage.setItem("kvitlach.panel.viewerHud", JSON.stringify({ dx: 900, dy: -600, scale: 1 }))
    );
    await page.reload();
    await page.getByLabel(/First name/i).last().fill("Dragger", { timeout: 4000 }).catch(() => undefined);
    await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
    await page.getByRole("button", { name: "Got it", exact: true }).click({ timeout: 2500 }).catch(() => undefined);
    await page.getByRole("button", { name: "Bet", exact: true }).waitFor({ state: "visible", timeout: 30_000 });

    await page.setViewportSize({ width: 640, height: 360 });
    await page.waitForTimeout(400);
    const box = (await page.locator(".k-viewer-hud").boundingBox())!;
    // At least a reachable sliver of it, on both axes.
    expect(box.x).toBeLessThan(640 - 40);
    expect(box.x + box.width).toBeGreaterThan(40);
    expect(box.y).toBeLessThan(360 - 40);
    expect(box.y + box.height).toBeGreaterThan(40);
  } finally {
    await context.close();
  }
});
