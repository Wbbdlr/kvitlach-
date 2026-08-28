import { test, expect } from "@playwright/test";
import { betButton, clickIfAppears, createTable, freshRoomId, joinTable } from "./helpers";

// A phone locking, a tab being restored, a wifi blip at a 50-person game night
// -- reconnecting mid-round is ordinary, not an edge case, and it is the one
// flow where a bug costs someone their seat and their wager at the same time.
// state.ts's resume path is unit-tested against a mock socket; this is the
// only place it meets a real server holding real round state, with a real
// second client watching to confirm the table saw one player throughout.
test("a player who reloads mid-round resumes the same seat, once, with their wager intact", async ({ browser }) => {
  const roomId = freshRoomId();
  const roomName = "E2E Reconnect";

  const bankerContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const banker = await bankerContext.newPage();
  const player = await playerContext.newPage();

  try {
    await createTable(banker, roomId, roomName);
    await joinTable(player, roomId, roomName, "Reconnie");
    await expect(banker.getByText("Reconnie")).toBeVisible({ timeout: 15_000 });

    await banker.getByRole("button", { name: "Deal the first round" }).click();

    // Put real money on the table before dropping the connection: a resume
    // that loses the seat is obvious, but one that silently loses the WAGER
    // would look fine until the round settled.
    await expect(betButton(player)).toBeVisible({ timeout: 15_000 });
    await betButton(player).click();

    // The wager has to be visible to the OTHER client before the reload, or
    // this proves nothing about what survived it -- the banker's copy is the
    // server's own view of the bet, not the player's local optimism.
    const playerSeatOnBanker = banker.locator(".k-seat", { hasText: "Reconnie" });
    await expect(playerSeatOnBanker).toContainText("$", { timeout: 15_000 });
    const wagerBeforeReload = await playerSeatOnBanker.textContent();

    // --- The reconnect itself. Same context, so localStorage (and the session
    //     token in it) survives exactly as it would for a real returning
    //     tab; state.ts re-sends room:resume on load. ---
    await player.reload();

    // Back at the table, not dumped to the lobby. The lobby has no room name.
    await expect(player.getByText(roomName)).toBeVisible({ timeout: 20_000 });

    // Explicit timeouts, not the 5s default: room:state and round:state are
    // separate broadcasts, and until the ROUND lands TableRoot renders the
    // pre-round "Table ready" roster instead of any .k-seat at all. Waiting
    // only 5s made this fail roughly one run in three purely on that window.
    // toHaveCount(1) keeps its teeth through the wait -- it retries until the
    // count IS one, so a resume that duplicated the seat would sit at 2 and
    // still fail rather than being papered over by the longer timeout.
    await expect(player.locator(".k-seat", { hasText: "Reconnie" })).toHaveCount(1, { timeout: 20_000 });

    // The failure this really guards against: a resume that registers a NEW
    // player instead of reclaiming the existing session leaves the table with
    // two Reconnies, one of them holding a wager nobody is sitting behind.
    await expect(banker.locator(".k-seat", { hasText: "Reconnie" })).toHaveCount(1, { timeout: 20_000 });
    await expect(playerSeatOnBanker).toHaveText(wagerBeforeReload!.trim(), { timeout: 15_000 });

    // Still a real, playable seat afterwards -- not a spectator view that
    // merely looks right. Whether a control appears depends on what the shoe
    // dealt, so finishing the round is the assertion, not any one button.
    await clickIfAppears(player.getByRole("button", { name: "Hit", exact: true }));
    await clickIfAppears(player.getByRole("button", { name: "Stand", exact: true }));
    await clickIfAppears(banker.getByRole("button", { name: "Stand", exact: true }), 10_000);

    await expect(banker.getByText("Round complete")).toBeVisible({ timeout: 20_000 });
    await expect(player.getByText("Round complete")).toBeVisible({ timeout: 20_000 });
  } finally {
    await bankerContext.close();
    await playerContext.close();
  }
});
