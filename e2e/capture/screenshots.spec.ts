import { test, Page } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Renders the game to PNGs at every supported viewport, in one command:
//
//     npm --prefix e2e run screenshots
//
// Not a test -- nothing here asserts. It exists because the layout rule in
// CLAUDE.md is "render it and look at it", and that is only realistic if
// looking costs one command instead of: start two dev servers, open a
// browser, resize it, click through to a dealt hand, repeat eleven times.
//
// Lives in capture/ with its own config so `playwright test` (testDir ./tests)
// never picks it up -- a capture run takes minutes and asserts nothing, so it
// has no business in the regression suite.
// This package is ESM, so no __dirname.
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots");

// Portrait sizes are the four asked for; each has its landscape twin because
// the table requires landscape on a HANDHELD (table/immersive.ts) -- on a
// phone, portrait is the lobby and the gate, landscape is the actual game.
// 768x1024 is the exception and is not a twin of anything: a portrait tablet
// plays the table fine (the stage scales to fit), so it is a supported surface
// in its own right and plays a full round below -- see GATE_MAX_WIDTH. The
// three Galaxy sizes are real devices this was reported broken on, kept in
// step with phone-layout.spec.ts. Desktop is the control.
const VIEWPORTS = [
  { name: "360x640-portrait", width: 360, height: 640, dpr: 3 },
  { name: "390x844-portrait", width: 390, height: 844, dpr: 3 },
  { name: "414x896-portrait", width: 414, height: 896, dpr: 2 },
  { name: "768x1024-portrait", width: 768, height: 1024, dpr: 2 },
  { name: "640x360-landscape", width: 640, height: 360, dpr: 3 },
  { name: "844x390-landscape", width: 844, height: 390, dpr: 3 },
  { name: "896x414-landscape", width: 896, height: 414, dpr: 2 },
  { name: "1024x768-landscape", width: 1024, height: 768, dpr: 2 },
  { name: "800x360-galaxy-s21", width: 800, height: 360, dpr: 3 },
  { name: "854x384-galaxy-s22", width: 854, height: 384, dpr: 3 },
  { name: "915x412-galaxy-s22-ultra", width: 915, height: 412, dpr: 3 },
  { name: "1512x950-desktop", width: 1512, height: 950, dpr: 2 },
];

// WORST-CASE content, not placeholders -- most overlap bugs only show with
// real data. A long double-barrelled Yiddish first name is entirely plausible
// at this table and is far wider than the "Guest" the practice room defaults
// to; the reaction sent below is deliberately the longest phrase in the
// picker, and the bubble is white-space: nowrap.
const LONG_NAME = "Menachem Mendel";

async function shot(page: Page, dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

// Each viewport wipes its own directory before writing, so a run never leaves
// images from a PREVIOUS run sitting beside the current ones. Not tidiness:
// the whole rule this script serves is "render it and look at it", and a stale
// PNG is a picture of code that no longer exists. Renaming one shot (the
// portrait branch) already left orphans that survived a full sweep and read as
// current. Per-viewport rather than one wipe up front, so the run stays safe if
// it is ever parallelised again.
function resetDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/** Waits until the felt stops moving -- see phone-layout.spec.ts's settle(). */
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

// Which viewports the rotate gate refuses, keyed off the SAME bound the gate
// itself uses -- (orientation: portrait) and (max-width: 540px). Deliberately
// not `height > width`: a 768x1024 tablet is portrait and fully supported (the
// stage scales to fit, with vertical room to spare), so it plays a real round
// below like any landscape viewport rather than stopping at a gate it never
// sees. Deliberately not isHandheld()'s 820px short edge either -- that
// predicate answers a different question and matches this tablet. See
// docs/mobile-ui.md Part 4.
const GATE_MAX_WIDTH = 540;

for (const vp of VIEWPORTS) {
  test(`capture ${vp.name}`, async ({ browser }) => {
    const gated = vp.height > vp.width && vp.width <= GATE_MAX_WIDTH;
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
      isMobile: vp.width < 900,
      hasTouch: vp.width < 900,
    });
    const page = await context.newPage();
    const dir = join(OUT, vp.name);
    resetDir(dir);

    await page.goto("/");
    await page.waitForTimeout(600);
    await shot(page, dir, "1-lobby");

    // Longest plausible name, so every nameplate downstream is worst-case.
    await page
      .getByLabel(/First name/i)
      .last()
      .fill(LONG_NAME, { timeout: 4000 })
      .catch(() => undefined);

    await page.getByRole("button", { name: /Practice Against the Computer/i }).click();
    // Attempt-and-ignore rather than check-then-click: the first-run hint
    // dismisses itself on a timer, so isVisible() could report true and the
    // element be gone a tick later -- which failed 4 of 12 viewports on the
    // first run of this script.
    await page
      .getByRole("button", { name: "Got it", exact: true })
      .click({ timeout: 2500 })
      .catch(() => undefined);

    // A gated viewport has no playable felt to photograph -- capture the gate
    // and stop, rather than driving a round nobody can see.
    if (gated) {
      await page.waitForTimeout(1500);
      await shot(page, dir, "2-table-rotate-gate");
      await context.close();
      return;
    }

    const bet = page.getByRole("button", { name: "Bet", exact: true });
    await bet.waitFor({ state: "visible", timeout: 30_000 });
    await bet.click();
    await page.locator(".k-hand img").first().waitFor({ timeout: 20_000 });
    await settle(page);
    await shot(page, dir, "2-table-dealt");

    // Fullest realistic felt: a live reaction bubble (longest phrase) on top
    // of a dealt hand -- the state the "muddled over the banker's total"
    // report came from.
    await page.getByRole("button", { name: "React" }).click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const panel = [...document.querySelectorAll("div")].find((d) =>
        (d.className || "").toString().includes("bottom-full")
      );
      const buttons = [...(panel?.querySelectorAll("button") ?? [])];
      buttons.sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length)[0]?.click();
    });
    await page.waitForTimeout(900);
    await shot(page, dir, "3-table-reaction");

    // Resolved round: the discard pile only exists from here, and the bank's
    // reserved/free split and every status tag are at their longest.
    const stood = await page
      .getByRole("button", { name: "Stand", exact: true })
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (stood) {
      await page.locator(".k-discard").waitFor({ timeout: 30_000 }).catch(() => undefined);
      await settle(page);
      await shot(page, dir, "4-table-resolved");
    }

    await context.close();
  });
}
