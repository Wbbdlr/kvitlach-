# CLAUDE.md

Operating notes for Claude Code in this repo. Assume the code is the source of
truth; this file exists to stop you rediscovering things that cost real time.

## Project

**Kvitlach** — a real-time multiplayer web version of a traditional Chanukah
card game (a 21-style game against a *banker*, not a dealer). One banker hosts a
table; everyone else plays against them. Built for family/community game nights
(design target: ~50 people, one shared table).

Live at kvitlach.us, self-hosted via Docker Compose behind a Cloudflare Tunnel.

## Technology

- **Frontend**: React 18 + TypeScript, Vite, Tailwind, Zustand (`state.ts`),
  react-router-dom. Tests: Vitest + @testing-library/react (jsdom).
- **Backend**: Node + TypeScript (ESM), Fastify (HTTP), raw `ws` (WebSocket).
  Tests: Vitest.
- **Database**: PostgreSQL via `pg` — **optional**. No `DATABASE_URL` means the
  server runs fully in-memory (rooms vanish on restart). There is no ORM and no
  migration tool; schema is `CREATE TABLE IF NOT EXISTS` in `db.ts:init()`.
- **Deploy**: `deploy/docker-compose.yml`; the tarball ships **source**, and the
  server builds the images.

## Architecture

Two processes. The backend exposes HTTP on 3000 (health, token-gated admin,
and `/metrics`) and **WebSocket on 3001, which is where all gameplay
happens**. There is no gameplay REST API.

Authoritative game state lives in `GameStore` (`backend/src/store.ts`) as an
in-memory `Map` of rooms. Postgres is a **persistence mirror** for restart
recovery, not the working store — read `store.ts`, not SQL, to understand game
state. Practice rooms are never persisted.

The client is a thin renderer: it sends intents over WS and re-renders from
`room:state` / `round:state` broadcasts. It never computes authoritative
outcomes.

Deeper detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Important locations

**Backend** (`backend/src/`)
- `store.ts` — the heart. Rooms, sessions, seating/rotation, bots, timers, all
  mutations. **~1500 lines; grep before reading whole.**
- `round.ts` / `turn.ts` — pure game logic (hit/stand/bet, totals, end-state).
- `deck.ts` — deck composition. `bot.ts` — computer-player decisions.
- `ws-server.ts` — WS protocol, auth, rate limits. Every per-room `Map` entry
  here (`rooms`, and any new one like it) must be deleted once its last
  socket closes, not just have the socket removed from its `Set` — an empty
  Set left behind is a permanent leak in a process meant to run for months.
  `http-server.ts` — health/admin/metrics.
- `metrics.ts` — in-process counters/gauges, rendered as Prometheus text by `/metrics`.
- `simulate.ts` — Monte Carlo fairness/odds harness (`npm run simulate`).
- `index.ts` — process-level `unhandledRejection`/`uncaughtException`
  handlers live here as a **backstop, not a fix**: every real fire-and-forget
  call (DB writes, `ws-server.ts`'s post-close cleanup) should already catch
  at its own call site. If something reaches the backstop log line, that's a
  bug to go fix at its source, not evidence the backstop is doing its job.
  Node 20 kills the whole process on an unhandled rejection by default —
  before this existed, a single dropped socket's failed DB write during
  cleanup could take down every room on the server.

**Frontend** (`frontend/src/`)
- `state.ts` — Zustand store, WS message handling, session/localStorage. The
  single place client state is mutated. **~1200 lines; grep before reading whole.**
- `table/` — the felt table UI. `TableRoot.tsx` (~850 lines) composes it;
  `layout.ts` + `stage.ts` own the coordinate system; `selectors.ts` /
  `useTableData.ts` hold derived display logic (prefer these over inlining
  logic in components).
- `App.tsx` — lobby (join / host / practice) plus in-room chrome and sound.
  ~1000 lines.
- `errorCopy.ts` — the **only** place backend error codes (`throw new
  Error("some_code")` in `store.ts`/`ws-server.ts`) get turned into player-
  facing text. Don't inline a new `errorMessage === "..."` ternary anywhere
  else. `errorCopy.test.ts` parses every code straight out of `backend/src`
  and fails naming any with no entry here — it caught eleven codes silently
  falling through to a raw `code.replace(/_/g, " ")` before this existed,
  including ones players hit routinely (`insufficient_funds`, `invalid_bet`).
  Add a new backend error code and this test is what tells you to add its
  copy, not a manual audit.
- `useEscapeKey.ts` — shared hook so every modal closes on Escape. New
  dialogs should use it rather than a bespoke `keydown` listener.
- `router.tsx` — a deliberate single catch-all `*` route to `App`, not
  separate `/` and `/table/:roomId` entries. **Don't "clean this up" into
  proper per-path routes** — two route objects rendering the same element
  still remount it on every path change (React Router keys matches by route
  id, not element identity), which would re-run `App`'s WS-connect effect
  and leave `status` stuck on "connecting" after any room transition (the
  socket's `onopen` only fires once; a no-op reconnect never flips it back).
  `App` parses the room id out of the path itself — see TASKS.md's "URL
  model" for the full reasoning.

## Local development

- **`npm run dev` in `frontend/` defaults to the PRODUCTION WebSocket**
  (`wss://ws.kvitlach.us`, hardcoded fallback in `state.ts` when `VITE_WS_URL`
  isn't set). A plain `npm run dev` with no local backend running will silently
  connect you to the live server instead of erroring — don't mistake that for a
  working local setup, and don't create/join rooms there while testing.
  Point at a local backend instead: run the `kvitlach-backend` launch config (or
  `cd backend && npm run dev`) and set `frontend/.env.local` (gitignored, so
  recreate it after a fresh clone) to:
  ```
  VITE_WS_URL=ws://localhost:3001
  ```
- **Two tabs on the same `localhost` origin share `localStorage`**, including
  the session-resume token — opening a second tab to test as a different player
  just resumes as whichever player most recently created/joined in *any* tab, it
  does not give you a second identity. For a genuine second player, use a second
  browser profile or an incognito window (or `localStorage.removeItem`ing the
  session keys before joining fresh in the second tab).

## Game rules Claude must know

Full rules: [docs/GAME_RULES.md](docs/GAME_RULES.md). The ones that cause bugs:

- **A Kvitlach deck is 24 cards** — numbers 1–12, two copies each. Not a
  standard 52- or 48-card deck. Bigger tables combine more decks.
- **The 12 is flexible**: it counts as 12, 9, *or* 10, and re-reads itself at
  every evaluation. Never collapse it to one value. Totals are computed as the
  set of all achievable sums (`getSums`), not a single number.
- **Blatt** = a draw with no wager. It can never win or lose money; it settles
  as a push even if the cards bust.
- **Futch** = going over 21. Distinct from merely losing the showdown — the
  banker's `state === "lost"` also fires when they just end the round down on
  money, which is why `busted` is a separate field.
- **Eleveroon** — opt-in rule; a drawn 11 that would bust a hand *currently
  readable as exactly 11* is ignored instead. Must check every achievable
  total, not the best one.
- Ties go to the banker.

## Multiplayer & server authority

Non-negotiable invariants — breaking these is a security bug, not a style issue:

1. **Actor identity comes from the socket's session, never the payload.** In
   `ws-server.ts` handlers, always `meta?.playerId`. Never trust a `playerId`
   in a client message. Pinned by `__tests__/ws-auth.test.ts`.
2. **Never send the deck to clients.** `sanitizeRound` strips `deck` and
   replaces it with `deckRemaining`. Knowing the shoe order breaks the game.
3. **Never reveal concealed totals/hole cards early.** `totalDisplay` /
   `sanitizeRound` decide who may see what; don't route around them.
4. Banker-only actions go through `isAdmin` checks in `store.ts`.
5. Validate anything off a WS payload (finite, in range, sane) before use.
   For money specifically, use `normalizeMoney` (`store.ts`) — whole chips,
   bounded by `MAX_MONEY`, returns `undefined` on anything else. Plain
   `Number.isFinite` is not enough by itself: it passes `10.5` (wallets are
   floats forever after) and `1e308` (turns `Infinity` on the first
   addition). Found because `createRoom` validated `bankerBankroll` this way
   but never validated `buyIn` at all, even though `buyIn` becomes every
   joining player's starting wallet.
6. Bots must never authenticate as actors (`!actor.isBot` guards).

## Development rules

- Understand the request, inspect the relevant code, then make the **smallest
  change that solves it**. Follow the patterns already here.
- Don't refactor, rename, reformat, or "tidy" code you were not asked to change.
- Don't add dependencies or invent parallel systems for something that exists.
- **Comments explain *why*, not *what*.** This codebase's comments carry real
  history (measured numbers, rejected alternatives, bug post-mortems). Match
  that; don't strip it, and don't narrate the obvious.
- **No emoji in UI.** Use inline SVG via `table/icons.tsx`. (Emoji are fine in
  player *reactions* — that's user content, a deliberate exception.)
- Seat geometry: `MAX_SEATED_PLAYERS_PER_ROUND = 11` in `store.ts` is derived
  from `layout.ts` collision math and pinned by `layout.test.ts`. Changing one
  without the other breaks the table. Overflow players queue and rotate in.
- The felt renders on a fixed 1280-wide virtual stage scaled to the viewport
  (`stage.ts`). Position things in stage units; don't hardcode viewport pixels.

## Testing

Run the **narrowest** relevant check; full suites only for cross-cutting work.

```bash
cd backend  && npx vitest run                    # backend suite (~25s)
cd frontend && npx vitest run                    # frontend suite (~23s)
cd frontend && npx vitest run src/path/to.test.ts  # single file
cd backend  && npx vitest run --coverage         # + coverage, enforces thresholds
```

- **CI runs all three suites on every push and PR** (`.github/workflows/ci.yml`):
  backend (tests + coverage thresholds + `tsc`), frontend (tests + `vite build`),
  and the Playwright e2e package. It does not deploy anything — deploys stay
  RDP-driven and manual.
- **Backend coverage has floors** (`backend/vitest.config.ts`): statements 84,
  branches 70, functions 90. They are a ratchet against backsliding, not a
  target to chase. Raise them when real coverage rises; never lower one to turn
  a build green without saying why in the same commit.
- **Every WS test file binds its own port.** They run in parallel, so a reused
  port fails as a bare `EADDRINUSE` blamed on whichever file lost the race.
  Check what's taken before adding one: `grep -rho '39[0-9]\{3\}' src/__tests__`

- `frontend/`'s `npm test` runs once (`vitest run`); use `npm run test:watch`
  for watch mode.
- **Do not use `npx tsc --noEmit` in `frontend/`** — it reports many
  pre-existing, unrelated errors (vite/vitest ambient types). The real
  typecheck is `npx vite build`. Backend `npm run build` is clean and is the
  backend typecheck.
- `npm run simulate` (backend) validates game odds/rules over ~150k hands.
  Run it after changing deck composition, card values, or win/bust logic.
- Verify UI changes in a real browser at a real viewport, not by reasoning
  alone — layout here is genuinely subtle. Practice mode is the fastest way to
  reach a live table.
- jsdom (the frontend test env) has no `ResizeObserver` — guard any code that
  uses it or component tests touching it will crash, not just fail.
- **The full backend suite has a known intermittent flake** (~20–30% of runs,
  confirmed pre-existing as of 2026-08-09, not caused by any specific
  change — see TASKS.md). A different real-WebSocket/real-timer test file
  fails each time (seen: `ws-auth.test.ts`, `abandoned-banker.test.ts`,
  `turn-order.test.ts`); every one passes cleanly run alone. If a full-suite
  run shows one red file, re-run it in isolation
  (`npx vitest run src/__tests__/<file>.test.ts`) before concluding you broke
  something — it almost certainly didn't fail because of your change.
- **`e2e/`** is a separate Playwright package (own `package.json`, not part of
  the backend/frontend workspaces) covering real two-browser multiplayer
  flows neither unit suite can reach — `cd e2e && npm install && npx
  playwright test` (see `e2e/README.md`). It boots its own backend/frontend
  processes on dedicated ports (3100/3101/5273), so it never touches a
  developer's own `npm run dev` session. Not part of the "narrowest relevant
  check" default above — run it when a change touches real WS/multi-client
  behavior, not for routine backend/frontend-only work.

## Deploy

Deploys are RDP-driven, not CI. **Whenever a push to `origin/main` touches
`backend/` or `frontend/`, build the deploy tarball and hand the user one
pastable server-side block as part of that same turn — don't wait to be
asked separately.** Skip this for doc-only pushes (README/CLAUDE.md/docs/,
no runtime-code diff); nothing running needs to change for those.

1. Bump `APP_VERSION` in `frontend/src/version.ts` by 0.1 first (see
   Constraints below), so the footer badge proves which build is live.
2. Build the tarball:
   ```bash
   bash deploy/build-tarball.sh
   ```
   This writes `C:\Users\sws22\Downloads\kvitlach-deploy.tar.gz`, overwriting
   any previous one — there should only ever be one canonical "deploy this"
   tarball in Downloads. Confirm it landed in **Downloads**, not the repo; a
   tarball built anywhere else means the user's next RDP copy grabs a stale
   one already sitting in Downloads instead.
3. Give the user exactly this block (they copy the tarball from their PC's
   Downloads to the server's Downloads over RDP, then paste this in the
   server terminal):
   ```bash
   cd ~/docker/kvitlach && tar -xzf ~/Downloads/kvitlach-deploy.tar.gz && cd deploy && DOCKER_BUILDKIT=0 docker compose up -d --build backend frontend db && echo "DONE."
   ```
   Always a full rebuild — both containers build from source (Vite/tsc), so
   there's no lighter `docker compose cp`-and-restart path here the way
   there is for plain-file-copy apps on other projects. `DOCKER_BUILDKIT=0`
   is required (BuildKit can't resolve DNS through this server's resolver).
   One block only — never "run this, then run that": the user pastes
   directly into an RDP terminal, and multiple blocks means multiple paste
   operations and more chances for error.
   **Never add `-v` to any `docker compose down`** in a command given to the
   user — it destroys the Postgres volume (all round/room history).

## Constraints

- **Never** `docker compose down -v` — it destroys the Postgres volume.
- Use `DOCKER_BUILDKIT=0` when building on the server (BuildKit has failed there).
- Bump `APP_VERSION` in `frontend/src/version.ts` by 0.1 before building a
  deploy tarball, so testers can confirm which build they're on.
- Don't commit or push unless asked.
