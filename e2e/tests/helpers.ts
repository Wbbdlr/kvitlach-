import { Locator, Page, expect } from "@playwright/test";

// Shared by the specs added alongside full-round.spec.ts, which predates this
// file and carries its own copies of freshRoomId/clickIfAppears. Left as-is
// rather than refactored -- it passes, and churning a green E2E test to
// de-duplicate two helpers isn't worth the risk of breaking the one piece of
// real two-browser coverage that already exists.

// Custom Game ID is capped at 20 chars (App.tsx's maxLength) and Playwright's
// fill() respects native maxlength, so an over-long id would be silently
// truncated in the BANKER's field while the joiner's uncapped Game ID field
// kept the full string -- the two ends of "the same room" quietly not matching.
export function freshRoomId(): string {
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 1000);
  return `E2E-${ts}-${rand}`;
}

// Clicks a control only if it actually appears. Cards come from the real
// crypto-random shuffle (deck.ts) -- nothing here pins a hand -- so a turn can
// legally end at several different points: a natural stop right off the bet,
// one Hit that lands on 21 or busts, or an explicit Stand. Driving whatever
// shows up keeps these tests honest about that instead of flaking on whatever
// the shoe happened to deal.
export async function clickIfAppears(locator: Locator, timeout = 3000): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout });
  } catch {
    return false;
  }
  await locator.click();
  return true;
}

export async function createTable(page: Page, roomId: string, roomName: string, firstName = "Banker") {
  await page.goto("/");
  await page.getByRole("button", { name: "Banker: Host the table, set wagers, etc." }).click();
  // Scoped to #banker-create-fields: once expanded, this form and the Join
  // form's own "First name (required)" both sit in the DOM at once, and an
  // unscoped getByLabel would match both.
  const form = page.locator("#banker-create-fields");
  await form.getByLabel("Game Name").fill(roomName);
  await form.getByLabel("Custom Game ID (optional)").fill(roomId);
  await form.getByLabel("First name (required)").fill(firstName);
  await form.getByRole("button", { name: "Create", exact: true }).click();
  // room.name || room.roomId (TableRoot.tsx) -- proves we landed on the table
  // we asked for, not merely some table.
  await expect(page.getByText(roomName)).toBeVisible({ timeout: 15_000 });
}

export async function joinTable(page: Page, roomId: string, roomName: string, firstName: string) {
  await page.goto("/");
  await page.getByLabel("Game ID").fill(roomId);
  await page.getByLabel("First name (required)").fill(firstName);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByText(roomName)).toBeVisible({ timeout: 15_000 });
}

// The dock (TableRoot.tsx) renders only when canPlayerAct, which requires
// activeTurnId === playerId -- so the presence of this button is the client's
// own answer to "is it my turn," straight off the server's round:state.
export function betButton(page: Page): Locator {
  return page.getByRole("button", { name: "Bet", exact: true });
}

// Plays out whatever the real hand calls for, from the bet onward. The draw
// button relabels Blatt -> Hit off turn.bet the instant the wager lands
// server-side (PlayerDock.tsx), and may never appear at all if the bet itself
// resolved the turn.
export async function playOutTurn(page: Page) {
  await expect(betButton(page)).toBeVisible({ timeout: 15_000 });
  await betButton(page).click();
  await clickIfAppears(page.getByRole("button", { name: "Hit", exact: true }));
  await clickIfAppears(page.getByRole("button", { name: "Stand", exact: true }));
}

// The player's own resolved tag (WON/LOST/PUSH/FUTCHED!, never blank) as it
// reads on one specific client's screen.
export async function seatTag(page: Page, playerName: string): Promise<string> {
  // A player's OWN seat carries no nameplate and no status tag any more: both
  // moved into the bottom-left HUD (ViewerHud.tsx, and Seat.tsx's identityInHud
  // suppressing them on the felt), so on their own screen `.k-seat` filtered by
  // their name matches nothing at all and this hung until the test timed out.
  //
  // Resolved here rather than at each call site, because every caller is asking
  // the same question -- "what does THIS page say about that player's round?"
  // -- and the answer spanning two elements is an implementation detail of
  // where it renders, not of what is being compared. Both read statusInfo.label
  // from selectors.ts, so the strings are directly comparable across clients.
  //
  // Identified positively (the HUD naming that player) rather than by the seat
  // being absent, so a seat that simply has not rendered yet still waits on
  // .k-seat instead of silently reading the wrong player's status. Safe at the
  // desktop viewport these specs run at; the compact breakpoint hides
  // .k-viewer-hud-name, and a mobile-sized caller would need its own handle.
  const ownHud = page.locator(".k-viewer-hud", { hasText: playerName });
  const tag = (await ownHud.count()) > 0
    ? ownHud.locator(".k-viewer-hud-tag").first()
    : page.locator(".k-seat", { hasText: playerName }).locator(".k-tag").first();
  const text = await tag.textContent();
  expect(text).toBeTruthy();
  return text!.trim();
}
