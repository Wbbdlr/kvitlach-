import { test, expect, Page } from "@playwright/test";
import { betButton, createTable, freshRoomId, joinTable } from "./helpers";

// The backend's own seat cap and rotation are well covered by
// backend/src/__tests__/seat-cap.test.ts -- 11 non-banker seats, the rest
// queued, the queue advancing by one each round, everyone seated within a
// cycle. None of that says whether the CLIENT honours it, which is the only
// part a unit test structurally can't reach: that the player left out is told
// so, is given no way to act, and actually rotates in next round.
//
// Thirteen live browser contexts is genuinely heavy, so this is the one spec
// that needs its own budget rather than the file-wide 90s.
const SEATS = 11;
const PLAYERS = SEATS + 1; // one more than fits, which is the entire point

async function queuedBadgeCount(page: Page): Promise<number> {
  return page.getByText("You're queued").count();
}

test("the player past the seat cap is queued rather than seated, cannot act, and rotates in next round", async ({ browser }) => {
  test.setTimeout(240_000);

  const roomId = freshRoomId();
  const roomName = "E2E Seat Cap";

  const bankerContext = await browser.newContext();
  const banker = await bankerContext.newPage();
  const playerContexts = [];
  const players: Array<{ page: Page; name: string }> = [];

  try {
    await createTable(banker, roomId, roomName);

    // Zero-padded so no name is a substring of another -- `hasText` matches on
    // substrings, so a plain "P1" would also match "P10"/"P11"/"P12" and every
    // seat assertion below would quietly mean nothing.
    for (let i = 1; i <= PLAYERS; i += 1) {
      const context = await browser.newContext();
      playerContexts.push(context);
      const page = await context.newPage();
      const name = `Pzz${String(i).padStart(2, "0")}`;
      // Sequential, not parallel: join order is seating order, and racing the
      // joins would leave it up to whichever frame the server saw first.
      await joinTable(page, roomId, roomName, name);
      players.push({ page, name });
    }

    await banker.getByRole("button", { name: "Deal the first round" }).click();

    // 11 seated players plus the dealer, which shares the .k-seat class
    // (Dealer.tsx) rather than having its own -- so the cap holding looks like
    // 12 here, not 11.
    await expect(banker.locator(".k-seat")).toHaveCount(SEATS + 1, { timeout: 30_000 });
    await expect(banker.getByText("1 queued for next round")).toBeVisible({ timeout: 30_000 });

    // Which player got left out is the rotation's business, not this test's --
    // find them by the badge their own client shows instead of assuming it's
    // the last to join.
    const queuedFlags = await Promise.all(players.map((p) => queuedBadgeCount(p.page)));
    expect(queuedFlags.filter((n) => n > 0)).toHaveLength(1);
    const queued = players[queuedFlags.findIndex((n) => n > 0)];

    // The two things that actually matter to the person left out: they are
    // told, and they are given nothing to press. A dock here would mean a
    // client believed it could bet into a round it isn't in.
    await expect(queued.page.getByText("You're queued")).toBeVisible();
    await expect(betButton(queued.page)).toHaveCount(0);
    // And they really are absent from the felt, not merely seated-but-idle.
    await expect(queued.page.locator(".k-seat", { hasText: queued.name })).toHaveCount(0);
    await expect(banker.locator(".k-seat", { hasText: queued.name })).toHaveCount(0);

    // --- Retire the round so the queue can advance. Skip is the banker's own
    //     per-seat control (Seat.tsx), not a test-only shortcut, and it's the
    //     only way to clear 11 seats without playing 11 real hands. ---
    const skips = banker.getByRole("button", { name: "Skip" });
    let remaining = await skips.count();
    expect(remaining).toBe(SEATS);
    while (remaining > 0) {
      await skips.first().click();
      // Wait for the broadcast to land before the next click, so this can't
      // race ahead of the re-render and click a seat that already resolved.
      remaining -= 1;
      await expect(skips).toHaveCount(remaining, { timeout: 20_000 });
    }

    await expect(banker.getByText("Round complete")).toBeVisible({ timeout: 30_000 });
    await banker.getByRole("button", { name: "Start next round" }).click();

    // The whole point of a queue rather than a hard cap: the player who sat
    // out is now in, and their own client is the one that has to show it.
    // .k-viewer-hud, not their own .k-seat: a player's own seat no longer
    // carries their name or total -- both moved into the bottom-left HUD
    // (ViewerHud.tsx / Seat.tsx's identityInHud), so from THEIR view the seat
    // is cards only and this locator matched nothing. The HUD renders exactly
    // when they hold a seat in the round, which is what is being asserted.
    await expect(queued.page.locator(".k-viewer-hud")).toHaveCount(1, { timeout: 30_000 });
    await expect(queued.page.getByText("You're queued")).toHaveCount(0);

    // Still exactly one person out -- the cap is a standing rule, not a
    // first-round-only quirk -- and it is now somebody else's turn to wait.
    await expect(banker.getByText("1 queued for next round")).toBeVisible({ timeout: 30_000 });
    const secondQueuedFlags = await Promise.all(players.map((p) => queuedBadgeCount(p.page)));
    expect(secondQueuedFlags.filter((n) => n > 0)).toHaveLength(1);
    expect(players[secondQueuedFlags.findIndex((n) => n > 0)].name).not.toBe(queued.name);
  } finally {
    await bankerContext.close();
    await Promise.all(playerContexts.map((c) => c.close()));
  }
});
