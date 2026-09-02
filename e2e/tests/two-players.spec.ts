import { test, expect } from "@playwright/test";
import { betButton, clickIfAppears, createTable, freshRoomId, joinTable, playOutTurn, seatTag } from "./helpers";

// full-round.spec.ts proves one player and a banker stay in sync. This is the
// case that only shows up with a real second player at the table: turn ORDER,
// enforced across three independent WebSocket clients that each learn about it
// only from the server's own round:state. Nothing in the unit suites can reach
// this -- they have no notion of a client that must be told to wait.
test("three clients agree on whose turn it is, and on how both players finished", async ({ browser }) => {
  const roomId = freshRoomId();
  const roomName = "E2E Two Players";

  // Separate CONTEXTS, not tabs: two tabs on one context share localStorage
  // (see the root CLAUDE.md) and would resume as whichever player joined most
  // recently in either one, so they'd be the same identity wearing two hats.
  const bankerContext = await browser.newContext();
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const banker = await bankerContext.newPage();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await createTable(banker, roomId, roomName);

    // Join order is turn order, so Alice acts before Bob. Joining them
    // sequentially (not in parallel) is what makes that deterministic --
    // racing the two joins would leave the seating order up to whichever
    // WebSocket frame the server happened to process first.
    await joinTable(alice, roomId, roomName, "Alicia");
    await joinTable(bob, roomId, roomName, "Bobby");

    // The banker's own felt has to show both arrivals over its live socket --
    // neither joiner's page proves anything about what the BANKER sees.
    await expect(banker.getByText("Alicia")).toBeVisible({ timeout: 15_000 });
    await expect(banker.getByText("Bobby")).toBeVisible({ timeout: 15_000 });

    await banker.getByRole("button", { name: "Deal the first round" }).click();

    // Server authority, checked on the client that would benefit from cheating:
    // the bank's hole card must already read concealed on a player's screen.
    // "Bank " + DOT + " hidden", not "Total: hidden": the dealer's separate
    // status row was deleted and the concealed total moved onto the banker's
    // own nameplate (Dealer.tsx, docs/mobile-ui.md step 2). Asserting the
    // wording, not the element, is the point -- this test is about server
    // authority over the hole card, and it should follow that fact wherever
    // it renders.
    await expect(alice.getByText("Bank · hidden")).toBeVisible({ timeout: 15_000 });

    // --- Turn order, the actual point of this test ---
    // Alice is up, so her dock exists. Bob's must NOT -- canPlayerAct gates it
    // on activeTurnId === playerId (TableRoot.tsx), so a Bet button on Bob's
    // screen right now would mean a client believed it could act out of turn.
    await expect(betButton(alice)).toBeVisible({ timeout: 15_000 });
    await expect(betButton(bob)).toHaveCount(0);

    await playOutTurn(alice);

    // The turn advancing is something Bob only ever learns from the server.
    // Generous timeout: Alice's hand may have taken several draws to resolve.
    await expect(betButton(bob)).toBeVisible({ timeout: 20_000 });
    await playOutTurn(bob);

    // Stand is always legal the instant it's the banker's turn (canBankerAct),
    // so this settles their hand whatever they drew -- and may never appear at
    // all if the round already resolved without them needing to act.
    await clickIfAppears(banker.getByRole("button", { name: "Stand", exact: true }), 10_000);

    for (const page of [banker, alice, bob]) {
      await expect(page.getByText("Round complete")).toBeVisible({ timeout: 20_000 });
    }

    // Every client renders its seats off the SAME round:state broadcast, so a
    // disagreement here is a disagreement about money, not cosmetics -- and
    // with two wagering players it also covers the mid-round settlement path
    // (settleImmediateTurn) that a single-player table barely exercises.
    for (const name of ["Alicia", "Bobby"]) {
      const onBanker = await seatTag(banker, name);
      expect(await seatTag(alice, name)).toBe(onBanker);
      expect(await seatTag(bob, name)).toBe(onBanker);
    }
  } finally {
    await bankerContext.close();
    await aliceContext.close();
    await bobContext.close();
  }
});
