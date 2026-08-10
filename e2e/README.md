# E2E tests

Playwright, driving two real browser contexts against the real backend and
frontend dev servers -- the one thing `backend/` and `frontend/`'s own unit/
component suites structurally can't reach: two genuine WebSocket clients on
one table. See `playwright.config.ts` for why this runs on its own ports
(3100/3101/5273) rather than the interactive dev ports from the root
CLAUDE.md -- a `playwright test` run boots and tears down its own backend +
frontend processes, so it never collides with (or gets silently reused by) a
developer's own `npm run dev` session on 3000/3001/5173.

## Running

```bash
cd e2e
npm install
npx playwright install --with-deps chromium   # first time only
npx playwright test
```

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
