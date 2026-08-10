import { test, expect, Locator } from "@playwright/test";

// The one thing unit/component coverage structurally can't reach: two real
// browsers, two real WebSocket connections, one real table -- see TASKS.md's
// "End-to-end coverage" entry. Each test gets its own room id so multiple
// runs (or a future second test) never collide against the same in-memory
// backend process (see playwright.config.ts's reuseExistingServer: false --
// that only guarantees a clean *process* per `playwright test` invocation,
// not per test case within one).
function freshRoomId(): string {
  // Custom Game ID is capped at 20 chars (App.tsx's maxLength) -- a full
  // Date.now() plus a random suffix overflowed that, silently truncating
  // what the BANKER's field actually held (Playwright's fill() respects
  // native maxlength) while the player's own Game ID field has no such cap,
  // so the two ends of "the same room id" quietly stopped matching. Last 8
  // digits of the timestamp + a 3-digit random suffix stays well under the
  // cap and is still unique enough for sequential -- or a handful of
  // parallel -- runs.
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 1000);
  return `E2E-${ts}-${rand}`;
}

// Clicks a button if it shows up within `timeout`, otherwise gives up
// quietly. Real cards are crypto-random, not scripted (deck.ts's shuffle --
// see CLAUDE.md), so a hand can legally settle itself at several different
// points -- a natural stop right off the bet, one Hit that happens to land
// on 21 or a bust, or an explicit Stand -- and every one of those is a
// correctly-played turn. Driving whichever controls actually appear, rather
// than asserting one fixed path, is what makes this test resilient to that
// instead of flaking on whatever the shoe happened to deal this run.
async function clickIfAppears(locator: Locator, timeout = 3000): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout });
  } catch {
    return false;
  }
  await locator.click();
  return true;
}

test("banker deals, a real second player plays a hand, banker resolves, both sides agree on the outcome", async ({ browser }) => {
  const roomId = freshRoomId();
  const roomName = "E2E Test Table";

  // Two genuinely independent sessions -- browser CONTEXTS, not just tabs.
  // Two tabs on one context would share localStorage (see CLAUDE.md's
  // "Local development" note) and resume as whichever player most recently
  // joined in EITHER tab; separate contexts sidestep that entirely, the same
  // way a second browser profile does for a human tester.
  const bankerContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const banker = await bankerContext.newPage();
  const player = await playerContext.newPage();

  try {
    // --- Banker creates the table ---
    await banker.goto("/");
    await banker.getByRole("button", { name: "Banker: Host the table, set wagers, etc." }).click();
    // Scoped to #banker-create-fields (App.tsx) -- once expanded, this form
    // and the Join form's own "First name (required)" both sit in the DOM
    // at once, and an unscoped getByLabel would match both.
    const bankerForm = banker.locator("#banker-create-fields");
    await bankerForm.getByLabel("Game Name").fill(roomName);
    await bankerForm.getByLabel("Custom Game ID (optional)").fill(roomId);
    await bankerForm.getByLabel("First name (required)").fill("Banker");
    await bankerForm.getByRole("button", { name: "Create", exact: true }).click();

    // room.name || room.roomId, TableRoot.tsx -- confirms we actually landed
    // on the table we asked for, not just some table.
    await expect(banker.getByText(roomName)).toBeVisible({ timeout: 15_000 });

    // --- A real second player joins the same room ---
    await player.goto("/");
    await player.getByLabel("Game ID").fill(roomId);
    await player.getByLabel("First name (required)").fill("Playerone");
    await player.getByRole("button", { name: "Join", exact: true }).click();
    await expect(player.getByText(roomName)).toBeVisible({ timeout: 15_000 });

    // The banker's felt picks up the join over its own WS connection --
    // nothing about the player's own page proves the BANKER's view is
    // actually live and in sync, which is the whole point of this test.
    await expect(banker.getByText("Playerone")).toBeVisible({ timeout: 15_000 });

    // --- Banker deals the first round ---
    await banker.getByRole("button", { name: "Deal the first round" }).click();

    // The instant the round is dealt is the one moment guaranteed to show
    // this regardless of how the hands go on to play out below: the bank's
    // own hand must already read concealed on the PLAYER's screen (server
    // authority -- sanitizeRound/totalDisplay -- never routed around
    // client-side).
    await expect(player.getByText("Total: hidden")).toBeVisible({ timeout: 15_000 });

    // --- Player bets, then plays out whatever their real hand calls for ---
    await expect(player.getByRole("button", { name: "Bet", exact: true })).toBeVisible({ timeout: 15_000 });
    await player.getByRole("button", { name: "Bet", exact: true }).click();
    // Same button, PlayerDock.tsx relabels Blatt -> Hit off turn.bet the
    // instant the wager lands server-side, not a local flag. It may never
    // show at all (a natural stop resolves the turn right off the bet).
    await clickIfAppears(player.getByRole("button", { name: "Hit", exact: true }));
    await clickIfAppears(player.getByRole("button", { name: "Stand", exact: true }));

    // --- Banker's own turn: Stand is always legal the instant it's their
    //     turn (canAct), so this alone settles it regardless of what they
    //     drew. May never appear at all if the round already resolved
    //     without needing the bank to act. ---
    await clickIfAppears(banker.getByRole("button", { name: "Stand", exact: true }), 8_000);

    // --- Round complete, both clients agree ---
    await expect(banker.getByText("Round complete")).toBeVisible({ timeout: 15_000 });
    await expect(player.getByText("Round complete")).toBeVisible({ timeout: 15_000 });

    // The player's own resolved tag (WON/LOST/PUSH, never blank) must read
    // identically on both screens -- the banker's copy comes off the SAME
    // round:state broadcast as the player's own, so a mismatch here would
    // mean the two clients disagree about money, not just cosmetics.
    const playerOutcomeOnOwnScreen = await player
      .locator(".k-seat", { hasText: "Playerone" })
      .locator(".k-tag")
      .first()
      .textContent();
    expect(playerOutcomeOnOwnScreen).toBeTruthy();
    await expect(
      banker.locator(".k-seat", { hasText: "Playerone" }).locator(".k-tag").first()
    ).toHaveText(playerOutcomeOnOwnScreen!.trim());
  } finally {
    await bankerContext.close();
    await playerContext.close();
  }
});
