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

Two processes. The backend exposes HTTP on 3000 (health + token-gated admin
only) and **WebSocket on 3001, which is where all gameplay happens**. There is
no gameplay REST API.

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
- `ws-server.ts` — WS protocol, auth, rate limits. `http-server.ts` — health/admin.
- `simulate.ts` — Monte Carlo fairness/odds harness (`npm run simulate`).

**Frontend** (`frontend/src/`)
- `state.ts` — Zustand store, WS message handling, session/localStorage. The
  single place client state is mutated. **~1200 lines; grep before reading whole.**
- `table/` — the felt table UI. `TableRoot.tsx` (~850 lines) composes it;
  `layout.ts` + `stage.ts` own the coordinate system; `selectors.ts` /
  `useTableData.ts` hold derived display logic (prefer these over inlining
  logic in components).
- `App.tsx` — lobby (join / host / practice) plus in-room chrome and sound.
  ~1000 lines.

### ⚠️ Dead code at the repo root

The repository root holds an abandoned **Elixir/Phoenix** implementation
(`deck.ex`, `round.ex`, `turn.ex`, `room.ex`, `game_rules.ex`, `mix.exs`, …)
plus loose card PNGs. **None of it runs.** It is kept for historical reference
only — and its filenames shadow the real ones in `backend/src/`.

This matters because a grep for `deck`, `round`, or `turn` will hit those files,
and they are **actively out of date** — e.g. `deck.ex` still builds a 48-card
deck (4 copies of each card), which is the bug fixed in `deck.ts`. Always work
in `backend/src/` and `frontend/src/`. Never take a rule from a `.ex` file.

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
```

- **`npm test` in `frontend/` starts watch mode and will hang.** Use
  `npx vitest run`.
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

## Constraints

- **Never** `docker compose down -v` — it destroys the Postgres volume.
- Use `DOCKER_BUILDKIT=0` when building on the server (BuildKit has failed there).
- Bump `APP_VERSION` in `frontend/src/version.ts` by 0.1 before building a
  deploy tarball, so testers can confirm which build they're on.
- `backend/src/__tests__/ws-auth.test.ts` currently carries an uncommitted local
  `console.log("DEBUG_DUMP", ...)` line and is excluded from commits by standing
  convention. Leave it alone unless asked.
- Don't commit or push unless asked.
