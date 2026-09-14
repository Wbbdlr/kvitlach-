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
  --noEmit` there - it reports many pre-existing, unrelated errors from
  vite/vitest ambient types. Backend `npm run build` is clean and is the
  backend typecheck.
- **jsdom has no `ResizeObserver`.** Guard any code that uses it or component
  tests touching it will crash, not merely fail.
- Run `npm run simulate` after changing deck composition, card values, or
  win/bust logic.
- `frontend`'s `npm test` runs once; `npm run test:watch` for watch mode.

## The known flake - check before believing a red suite

The full backend suite fails intermittently (~20–30% of runs), confirmed
pre-existing as of 2026-08-09 and not caused by any specific change. A
different real-WebSocket/real-timer file fails each time - seen:
`ws-auth.test.ts`, `abandoned-banker.test.ts`, `turn-order.test.ts`,
`live-play.test.ts`. **Every one passes cleanly run alone.**

If a full run shows one red file, re-run that file in isolation before
concluding you broke something:

```bash
cd backend && npx vitest run src/__tests__/<file>.test.ts
```

## The other kind of red: an assertion that was never deterministic

The rule above ("passes alone, so it is the timing flake") is a trap on its
own, because it only fits a file that passes alone. `room-names.test.ts`
failed **alone**, on roughly three runs in five, at a commit nobody had
touched it in - and the cause was the assertion, not the clock.

It drew 60 random names from each of two paths and asserted every name from
one appeared in the other's sample. That is a coupon-collector problem
wearing an invariant's clothes: with 19 names in the bag, one is missing from
60 draws about 4% of the time, so the whole assertion held about 40% of the
time. It shipped green because the runs that mattered happened to be lucky
ones, and a green run of a 40% test proves nothing at all.

So when a file fails alone, **measure it before believing either story**:

```bash
cd backend && for i in 1 2 3 4 5 6 7 8; do npx vitest run src/__tests__/<file>.test.ts 2>&1 | grep -E "Tests "; done
```

A clean 8/8 means the failure was real and you broke something. A mixed
result on a file with no timers and no sockets means the assertion samples
where it should compare - fix the assertion against the source of truth
(export the constant and check membership), never by drawing more samples.

## The runner's own defaults are a silent input

Found upgrading Vitest 1 -> 3 (2026-09-14). Both packages sat on the runner's
defaults for things the suites turn out to be sensitive to, so a tooling bump
changed test behaviour without a line of test code moving.

- **`pool` changed default from `threads` to `forks` in Vitest 2.** The
  frontend config set `poolOptions.threads` with a comment explaining the cap
  (don't pin every core); the default move ORPHANED that block, and the suite
  fanned back out. Eight tests then failed in a full run and passed alone.
  Frontend now pins `pool: "threads"` so its cap binds again.
- **The backend went the other way, and the numbers decided it.** Pinning
  `threads` back there made its known intermittent flake markedly worse --
  0 of 2 full runs clean (3 and 5 failures) against 2 of 3 on forks, then 3 of
  3 clean once left on forks. A fork per file is the stronger isolation and
  this suite needs it. Left on the default, with that measurement recorded in
  the config.

The general rule: when a runner upgrade turns tests red, measure both settings
over several full runs before touching a test. A default that moved looks
exactly like a change that broke something.

## Never wipe `document.body` in a cleanup hook

`afterEach(() => { document.body.innerHTML = ""; })` in two component test
files was a real bug that only surfaced under a newer runner. These components
portal into the body (`StageOverlay`), so wiping it by hand pulls those nodes
out from under React; its own unmount then cannot find them and throws
`NotFoundError: The node to be removed is not a child of this node`. It had
survived only because the old runner happened to order the hook after Testing
Library's own cleanup. Use `cleanup()` from `@testing-library/react`.

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
  prompt is the live example - tests dispatch `appinstalled` in `beforeEach`
  to reset it. A shared instance passed into a constructor (`new
  GameStore(undefined, limits)`) must be the *same* instance the code under
  test mutates.
- **Flushing a chained promise needs a macrotask.** Two `await
  Promise.resolve()` do not flush `x.then(y)`; use
  `await new Promise((r) => setTimeout(r, 0))`.

## CI

`.github/workflows/ci.yml` runs all three suites on every push and PR: backend
(tests + coverage + `tsc`), frontend (tests + `vite build`), and the Playwright
e2e package. **It does not deploy anything** - deploys stay RDP-driven.

## e2e

`e2e/` is a separate Playwright package (own `package.json`, not part of the
workspaces) covering real two-browser multiplayer flows neither unit suite can
reach. It boots its own backend/frontend on dedicated ports (3100/3101/5273),
so it never touches a developer's `npm run dev` session.

```bash
cd e2e && npm install && npx playwright test
```

Not part of the default "narrowest relevant check" - run it when a change
touches real WS or multi-client behaviour.

## Don't browser-verify what a test pins

The browser is for layout, art, and things only a real engine shows. A jsdom
test is cheaper and it stays. Conversely, **verify UI changes at a real
viewport rather than by reasoning** - the felt layout is genuinely subtle, and
practice mode is the fastest way to a live table.
