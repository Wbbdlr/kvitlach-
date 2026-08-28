# E2E tests

Playwright, driving two real browser contexts against the real backend and
frontend dev servers -- the one thing `backend/` and `frontend/`'s own unit/
component suites structurally can't reach: two genuine WebSocket clients on
one table. See `playwright.config.ts` for why this runs on its own ports
(3100/3101/5273) rather than the interactive dev ports from the root
CLAUDE.md -- a `playwright test` run boots and tears down its own backend +
frontend processes, so it never collides with (or gets silently reused by) a
developer's own `npm run dev` session on 3000/3001/5173.

## What's covered

- `full-round.spec.ts` — a banker and one player play a hand to completion and
  agree on the outcome. Also pins that the bank's hole card reads concealed on
  the player's screen.
- `two-players.spec.ts` — turn ORDER across three independent clients: while
  the first player is up, the second must have no dock at all (`canPlayerAct`
  gates it on `activeTurnId === playerId`), and the turn advancing is something
  the second player only ever learns from the server. Ends with all three
  clients agreeing on both players' outcomes.
- `reconnect.spec.ts` — a player reloads mid-round, after betting, and must
  come back to the same single seat with the wager intact. The duplicate-seat
  case is the one that matters: a resume that registered a new player instead
  of reclaiming the session would leave a wager nobody is sitting behind.
- `seat-cap.spec.ts` — 12 players for 11 seats. The one left out must be told
  they're queued, given no dock to act with, and be genuinely absent from the
  felt; then they rotate in on the next round and somebody else waits. The cap
  and rotation themselves are `backend/src/__tests__/seat-cap.test.ts`'s job —
  this covers only whether the client honours them. It drives 13 browser
  contexts and is by far the slowest spec here (~1 minute), which is why
  `workers` is capped in the config.

## Running

```bash
cd e2e
npm install
npx playwright install --with-deps chromium   # first time only
npx playwright test
```

`npm install` really is required before the first run even though
`node_modules/` looks populated -- it can hold the `.bin` shims without
`@playwright/test` itself, which fails as a confusing `Cannot find module
.../@playwright/test/cli.js` rather than anything about a missing install.

These tests wait on real WebSocket round trips between two or three live
browsers, so they are slow by nature: ~15s each run alone, and noticeably more
when several run at once. `timeout` in `playwright.config.ts` is raised from
Playwright's 30s default for that reason -- at 30s, contention alone failed
every spec including the ones that pass comfortably on their own.

No `DATABASE_URL` is set for the spawned backend, so every run starts from a
genuinely empty in-memory `GameStore` (see `backend/src/index.ts`) --
practice-room-style isolation, nothing persisted, nothing to clean up after.

`npx playwright show-trace <path>` opens the trace Playwright captures on a
failed run's retry (`trace: "retain-on-failure"` in the config) -- a full
timeline with DOM snapshots at each step, the fastest way to see what a
failing assertion actually saw.

## Why tests drive whichever buttons show up, not one fixed path

Cards are dealt from the real, crypto-random shuffle (`deck.ts`) -- nothing
here pins a hand. A bet can settle itself immediately (a natural stop), one
Hit can land on 21 or a bust and resolve on its own, or an explicit Stand can
be needed -- all three are legitimately-played turns. `full-round.spec.ts`'s
`clickIfAppears` helper clicks a control only if it actually shows up within
a short timeout, so the test follows whatever the shoe actually dealt this
run instead of asserting one specific path and flaking on the others.
