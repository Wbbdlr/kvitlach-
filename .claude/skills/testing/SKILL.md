---
name: testing
description: How to run Kvitlach's test suites, coverage floors, the WS port convention, the Playwright e2e package and the known backend flake. Use when adding tests, when a suite fails unexpectedly, or before a final handoff.
---

# Testing

Run the **narrowest** relevant check. Full suites are for cross-cutting work
and final handoff only.

```bash
cd backend  && npx vitest run                      # backend suite (~25-30s)
cd frontend && npx vitest run                      # frontend suite (~23-46s)
cd frontend && npx vitest run src/path/to.test.ts  # single file
cd backend  && npx vitest run --coverage           # + coverage thresholds
cd backend  && npm run simulate                    # ~150k hands, odds/rules
```

- **`npx vite build` is the frontend typecheck.** Do **not** use `npx tsc
  --noEmit` there — it reports many pre-existing, unrelated errors from
  vite/vitest ambient types. Backend `npm run build` is clean and is the
  backend typecheck.
- **jsdom has no `ResizeObserver`.** Guard any code that uses it or component
  tests touching it will crash, not merely fail.
- Run `npm run simulate` after changing deck composition, card values, or
  win/bust logic.
- `frontend`'s `npm test` runs once; `npm run test:watch` for watch mode.

## The known flake — check before believing a red suite

The full backend suite fails intermittently (~20–30% of runs), confirmed
pre-existing as of 2026-08-09 and not caused by any specific change. A
different real-WebSocket/real-timer file fails each time — seen:
`ws-auth.test.ts`, `abandoned-banker.test.ts`, `turn-order.test.ts`,
`live-play.test.ts`. **Every one passes cleanly run alone.**

If a full run shows one red file, re-run that file in isolation before
concluding you broke something:

```bash
cd backend && npx vitest run src/__tests__/<file>.test.ts
```

## Conventions

- **Every WS test file binds its own port.** They run in parallel, so a reused
  port fails as a bare `EADDRINUSE` blamed on whichever file lost the race.
  Check what is taken before adding one:
  ```bash
  cd backend && grep -rho '39[0-9]\{3\}' src/__tests__
  ```
- **Backend coverage has floors** (`backend/vitest.config.ts`): statements 84,
  branches 70, functions 90. They are a ratchet against backsliding, not a
  target to chase. Raise them when real coverage rises; never lower one to
  turn a build green without saying why in the same commit.
- **Module-scope state leaks between tests.** `pwa.ts`'s deferred install
  prompt is the live example — tests dispatch `appinstalled` in `beforeEach`
  to reset it. A shared instance passed into a constructor (`new
  GameStore(undefined, limits)`) must be the *same* instance the code under
  test mutates.
- **Flushing a chained promise needs a macrotask.** Two `await
  Promise.resolve()` do not flush `x.then(y)`; use
  `await new Promise((r) => setTimeout(r, 0))`.

## CI

`.github/workflows/ci.yml` runs all three suites on every push and PR: backend
(tests + coverage + `tsc`), frontend (tests + `vite build`), and the Playwright
e2e package. **It does not deploy anything** — deploys stay RDP-driven.

## e2e

`e2e/` is a separate Playwright package (own `package.json`, not part of the
workspaces) covering real two-browser multiplayer flows neither unit suite can
reach. It boots its own backend/frontend on dedicated ports (3100/3101/5273),
so it never touches a developer's `npm run dev` session.

```bash
cd e2e && npm install && npx playwright test
```

Not part of the default "narrowest relevant check" — run it when a change
touches real WS or multi-client behaviour.

## Don't browser-verify what a test pins

The browser is for layout, art, and things only a real engine shows. A jsdom
test is cheaper and it stays. Conversely, **verify UI changes at a real
viewport rather than by reasoning** — the felt layout is genuinely subtle, and
practice mode is the fastest way to a live table.
