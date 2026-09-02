import { test, expect, Page, BrowserContext } from "@playwright/test";

// Bug #1 as reported: "backgrounding the browser breaks the game" -- leave the
// app mid-hand, come back, and the table is dead.
//
// Getting this to fail honestly took three attempts, and the two that did not
// work are worth recording because both LOOKED like they worked:
//
//   - CDP Network.emulateNetworkConditions{offline:true} does not tear down an
//     already-established WebSocket. Measured: navigator.onLine goes false and
//     the client never notices, so no reconnect is ever attempted and the test
//     exercises nothing. A test built on it passed against a deliberately
//     broken build.
//   - Asserting .k-viewer-hud comes back proves nothing either: a disconnected
//     client keeps rendering its last known round, which is the whole point of
//     the HUD, so it never disappears in the first place.
//
// What is left is to kill the socket the way the OS does -- from outside the
// client, with no warning -- and to assert on the one thing that both responds
// to this fix and does not depend on what the shoe dealt: the client's own
// "Connection lost" indicator, and how long it takes to clear.
//
// The margin is what makes this decisive. With the fix, coming back to the app
// reconnects in tens of milliseconds. Without it, the client waits out the
// backoff its last failure earned -- 1.2-1.8s at the very first attempt, and up
// to 15s once a frozen tab has burned a few. 800ms sits clear of both.

const RECONNECT_BUDGET_MS = 800;

// Keeps a handle on every socket the app opens, so a test can close one the way
// a phone does. Must run before app code: WSClient captures the constructor at
// module scope.
async function trackSockets(context: BrowserContext) {
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    (window as unknown as { __sockets: WebSocket[] }).__sockets = [];
    const Patched = function (this: unknown, ...args: [string, (string | string[])?]) {
      const socket = new Native(...args);
      (window as unknown as { __sockets: WebSocket[] }).__sockets.push(socket);
      return socket;
    } as unknown as typeof WebSocket;
    Object.assign(Patched, Native);
    Patched.prototype = Native.prototype;
    window.WebSocket = Patched;
  });
}

async function seatedAtAPracticeTable(page: Page) {
  await page.goto("/");
  await page.getByLabel(/First name/i).last().fill("Backgrounder", { timeout: 5000 }).catch(() => undefined);
  await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
  await page.getByRole("button", { name: "Got it", exact: true }).click({ timeout: 2500 }).catch(() => undefined);
  const bet = page.getByRole("button", { name: "Bet", exact: true });
  await bet.waitFor({ state: "visible", timeout: 30_000 });
  await bet.click();
  await page.locator(".k-hand img").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
}

const setVisibility = (page: Page, state: "hidden" | "visible") =>
  page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

const killSocket = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.at(-1)!.close());

test("coming back to the app reconnects at once, without reloading", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 854, height: 384 }, isMobile: true, hasTouch: true });
  await trackSockets(context);
  const page = await context.newPage();
  try {
    await seatedAtAPracticeTable(page);
    // Stamped on the window so "resumed, not reloaded" is asserted directly
    // rather than inferred from what happens to be on screen.
    await page.evaluate(() => ((window as unknown as { __alive?: number }).__alive = Date.now()));
    const alive = await page.evaluate(() => (window as unknown as { __alive: number }).__alive);

    const reconnecting = page.getByText(/Connection lost|Connecting/i);

    // The order a backgrounded phone actually does it in: the tab goes away
    // first, and the socket dies while nobody is looking.
    await setVisibility(page, "hidden");
    await killSocket(page);
    await expect(reconnecting.first()).toBeVisible({ timeout: 5_000 });

    const cameBack = Date.now();
    await setVisibility(page, "visible");
    await expect(reconnecting).toHaveCount(0, { timeout: RECONNECT_BUDGET_MS });
    const recovery = Date.now() - cameBack;
    console.log(`RECOVERY visibilitychange ${recovery}ms`);

    expect(recovery).toBeLessThan(RECONNECT_BUDGET_MS);
    expect(await page.evaluate(() => (window as unknown as { __alive?: number }).__alive)).toBe(alive);
    // Still their seat, with the round they left still on it.
    await expect(page.locator(".k-viewer-hud")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the network returning reconnects at once, with no tab switch", async ({ browser }) => {
  // The other listener, and it matters on its own: a phone that regains signal
  // while the player is already staring at the table fires `online` and no
  // visibilitychange at all.
  const context = await browser.newContext({ viewport: { width: 854, height: 384 } });
  await trackSockets(context);
  const page = await context.newPage();
  try {
    await seatedAtAPracticeTable(page);
    const reconnecting = page.getByText(/Connection lost|Connecting/i);

    await killSocket(page);
    await expect(reconnecting.first()).toBeVisible({ timeout: 5_000 });

    const cameBack = Date.now();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(reconnecting).toHaveCount(0, { timeout: RECONNECT_BUDGET_MS });
    const recovery = Date.now() - cameBack;
    console.log(`RECOVERY online ${recovery}ms`);
    expect(recovery).toBeLessThan(RECONNECT_BUDGET_MS);
  } finally {
    await context.close();
  }
});
