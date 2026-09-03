# CLAUDE.md

Operating notes for Claude Code in this repo. The code is the source of truth;
this file exists to stop you rediscovering things that cost real time.

**This file is charged to every session, so it holds only what you can break
without knowing you were near it** — invariants, traps, "X was tried and does
not work". Everything procedural lives in a skill or in `docs/`, loaded on
demand. Adding a paragraph here is a recurring bill; think before you do.

| when you are… | load |
|---|---|
| deploying, shipping, releasing a build | skill `deploy` |
| changing card faces or the maker's mark | skill `card-art` |
| locking down access, admin panel, capacity, monitoring | skill `admin-ops` |
| touching phone landscape / fullscreen / PWA install | skill `phone-ui` |
| changing any layout, spacing or z-order | `docs/mobile-ui.md` |
| running or adding tests, chasing a red suite | skill `testing` |
| asked about npm audit / upgrades / build-log warnings | skill `deps` |
| needing full rules, architecture, card geometry, ops setup | `docs/` |

## Project

**Kvitlach** — real-time multiplayer web version of a traditional Chanukah card
game (21-style, against a *banker*, not a dealer). One banker hosts; everyone
else plays against them. Built for family and community game nights (~50 people,
one shared table). Live at kvitlach.us, self-hosted via Docker Compose behind a
Cloudflare Tunnel.

React 18 + TypeScript + Vite + Tailwind + Zustand (`state.ts`), Vitest/jsdom on
the front; Node ESM + Fastify + raw `ws` on the back. **Postgres is optional** —
no `DATABASE_URL` means fully in-memory (rooms vanish on restart). No ORM and no
migration tool; the schema is `CREATE TABLE IF NOT EXISTS` in `db.ts:init()`, so
a new setting belongs in the existing `settings` key/value row.

## Architecture

Two processes: HTTP on 3000 (health, admin, `/metrics`, `/api/about`) and
**WebSocket on 3001, where all gameplay happens**. There is no gameplay REST API.

Authoritative state is `GameStore` (`backend/src/store.ts`), an in-memory `Map`
of rooms. **Postgres is a persistence mirror for restart recovery, not the
working store** — read `store.ts`, not SQL, to understand game state. Practice
rooms are never persisted. The client is a thin renderer: it sends intents and
re-renders from `room:state` / `round:state`. It never computes outcomes.

Deeper detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Code map — only the parts that bite

`store.ts` (~1500 lines) and `state.ts` (~1200) are the two hearts. **Grep
before reading either whole.** `table/` holds the felt UI (`TableRoot.tsx`
composes; `layout.ts`/`stage.ts` own coordinates; `selectors.ts` /
`useTableData.ts` hold derived display logic — prefer these over inlining).

- **`router.tsx` is a deliberate single catch-all `*` route. Don't "clean it
  up" into per-path routes.** Two route objects rendering the same element still
  remount it on every path change (React Router keys by route id, not element
  identity), which re-runs `App`'s WS-connect effect and leaves `status` stuck
  on "connecting" after any room transition. `App` parses the room id itself.
- **`errorCopy.ts` is the only place backend error codes become player-facing
  text.** Don't inline an `errorMessage === "..."` ternary anywhere else.
  `errorCopy.test.ts` parses every code out of `backend/src` and fails naming
  any with no entry — it caught eleven falling through to a raw
  `code.replace(/_/g, " ")`, including `insufficient_funds` and `invalid_bet`.
- **`ws-server.ts`: every per-room `Map` entry must be deleted once its last
  socket closes**, not merely have the socket removed from its `Set`. An empty
  Set left behind is a permanent leak in a process meant to run for months.
- **`index.ts`'s `unhandledRejection`/`uncaughtException` handlers are a
  backstop, not a fix.** Anything reaching that log line is a bug to fix at
  source — Node kills the process on an unhandled rejection by default, and one
  dropped socket's failed DB write once took down every room on the server.
- **`useEscapeKey.ts`** — new dialogs use it, not a bespoke `keydown`.

## Local development

- **`npm run dev` in `frontend/` defaults to the PRODUCTION WebSocket**
  (`wss://ws.kvitlach.us`, hardcoded fallback in `state.ts`). With no local
  backend it silently connects you to the **live server** instead of erroring.
  Don't mistake that for a working local setup, and don't create or join rooms
  there while testing. Run the backend and set `frontend/.env.local`
  (gitignored — recreate after a fresh clone) to `VITE_WS_URL=ws://localhost:3001`.
- **Two tabs on the same `localhost` origin share `localStorage`**, including
  the session-resume token. A second tab resumes as whichever player most
  recently joined in *any* tab — it is not a second identity. Use a second
  browser profile or incognito.

## Game rules that cause bugs

Full rules: [docs/GAME_RULES.md](docs/GAME_RULES.md).

- **A Kvitlach deck is 24 cards** — 1–12, two copies each. Not 52 or 48.
- **The 12 is flexible**: 12, 9, *or* 10, re-read at every evaluation. Never
  collapse it to one value. Totals are the set of achievable sums (`getSums`).
- **Blatt** = a draw with no wager. Never wins or loses money; settles as a push
  even if the cards bust.
- **Futch** = over 21. Distinct from losing the showdown — the banker's
  `state === "lost"` also fires when they merely end down on money, which is why
  `busted` is a separate field.
- **Eleveroon** — opt-in; a drawn 11 that would bust a hand *currently readable
  as exactly 11* is ignored. Check every achievable total, not the best one. It
  saves the player from a futch; it does not save the eleven.
- Ties go to the banker. **The banker never wagers.**

## Server authority — breaking these is a security bug

1. **Actor identity comes from the socket's session, never the payload.** Always
   `meta?.playerId` in `ws-server.ts`. Pinned by `ws-auth.test.ts`.
2. **Never send the deck to clients.** `sanitizeRound` strips it for
   `deckRemaining`. Knowing the shoe order breaks the game.
3. **Never reveal concealed totals or hole cards early.** `totalDisplay` /
   `sanitizeRound` decide who sees what; don't route around them.
4. Banker-only actions go through `isAdmin` checks in `store.ts`.
5. **For money, use `normalizeMoney`** (`store.ts`) — whole chips, bounded by
   `MAX_MONEY`, `undefined` on anything else. `Number.isFinite` alone passes
   `10.5` (wallets are floats forever after) and `1e308` (turns `Infinity` on
   the first addition). Found because `createRoom` validated `bankerBankroll`
   but never validated `buyIn`, which becomes every joining player's starting
   wallet.
6. Bots must never authenticate as actors (`!actor.isBot` guards).
7. **`room:resume` is never gated, in any access mode.** Lockdown closes the
   door; it does not eject people mid-hand.
8. **Operator-authored text is stored raw and rendered as text.** Never escape
   on the way in and never assign it as HTML on the way out (`about.ts`).

**Open, not yet enforced — for the next security pass:** `applyBet` has no
`isAdmin` guard. The banker never wagers (see the rules above), but nothing at
the store rejects a bet *from* the banker; only the callers happen not to send
one. Found the day the bot banker bug was fixed: the first tests for that fix
passed with the fix reverted, because the bot's stray wager sometimes SUCCEEDED
and the round looked normal. A client that sends `bet` on the admin's turn is
currently unopposed, and `calculateEndState` then overwrites that `bet` with the
round's net, so the evidence is gone by the time anyone reads the round back.
Reject it at the store; do not rely on bot logic avoiding it.

## Development rules

- Understand the request, inspect the relevant code, make the **smallest change
  that solves it**. Follow the patterns already here.
- Don't refactor, rename, reformat or "tidy" code you were not asked to touch.
- Don't add dependencies or build a parallel system for something that exists.
- **Comments explain *why*, not *what*.** This codebase's comments carry real
  history — measured numbers, rejected alternatives, post-mortems. Match that.
- **No emoji in UI.** Inline SVG via `table/icons.tsx`. (Emoji in player
  *reactions* are user content — a deliberate exception.)
- **`MAX_SEATED_PLAYERS_PER_ROUND = 11` is derived from `layout.ts` collision
  maths** and pinned by `layout.test.ts`. Changing one without the other breaks
  the table, and it must never become a runtime setting. Overflow players queue.
- Don't commit or push unless asked.

## Mobile UI & layout

Most players are on a phone, in landscape.
**[docs/mobile-ui.md](docs/mobile-ui.md) is the design contract — read Part 1
(the scene / HUD split) and Part 2 (the rules) before writing any layout code.**
It holds the hard nevers, the z-index tiers, the spacing defaults, the
orientation model and the verification loop. What produced each rule is in
[docs/mobile-ui-history.md](docs/mobile-ui-history.md), needed only when a rule
looks arbitrary.

The two facts you need before opening it: the felt is a **fixed 1280×760 virtual
stage scaled to the viewport** (`stage.ts`) — position in stage units, never
viewport pixels — and it is **plain DOM + CSS**, no canvas or engine, so
z-index, flex/grid and media queries are the real tools and DevTools sees
everything. Card faces are PNG with a live SVG overlay (`table/cardMark.ts`).
Dev server on **5173**; in Docker nginx serves `dist/` on **4173**. Minimum
supported: **360px wide portrait**, **640×360 landscape** for the table.

## Context economy

Context is the scarce resource in a long session, not tokens on a bill.

- **Default to concise reports.** Lead with what changed, what it fixed, and the
  verification result. Keep reasoning to what the reader needs to make a
  decision; offer the detail rather than including it.
- **Never paste large tool output into chat** — measurement dumps, element
  enumerations, whole files, long logs. Write them to a file and summarise in a
  few lines. A number and its meaning beat the table it came from.
- **Read the part of the file you need**, not the whole file, when a targeted
  read will do. Grep for the anchor, then read the range.
- **Say when context is getting long**, and say what is safe to drop.

## Constraints

- **Never `docker compose down -v`** — it destroys the Postgres volume.
- **`DOCKER_BUILDKIT=0`** when building on the server; BuildKit can't resolve
  DNS through its resolver.
- **The backend runtime image holds `dist/` and nothing else** — no `src/`, no
  `scripts/`. Anything run as `docker compose exec backend <path>` must be in
  `dist` or inlined (`node -e`). `setup-admin.sh` shipped broken once for this.
- **Never write a value containing `$` into `deploy/.env`.** Compose expands it
  to nothing — a scrypt password hash arrived as the bare word `scrypt` and
  every admin login failed against the right password. Shells, `sed` and editors
  eat it too.
- **Bump `APP_VERSION` in `frontend/src/version.ts` by 0.1 before a tarball,
  then run `npx vite build` AFTER the bump** — a scripted bump once truncated
  the file to zero bytes and broke the server build.
- **Never add a `dns:` block to a compose file** deployed to the adguard host.
  Container DNS goes through AdGuard by daemon config; a per-service `dns:`
  silently recreates the bypass. A container that can't resolve something has
  hit a blocklist match — check the query log, don't pin a public resolver.
  Full context: `homeserver/CLAUDE.md`.
- **`frontend/nginx.conf`'s `location = /api/about` must stay an exact match.**
  The backend port also serves `/admin`, and the 127.0.0.1 binding that protects
  it does not apply inside the compose network. Pinned by `nginxProxy.test.ts`.

## Spending credits well

Credits here are limited. These are the mistakes **this repo has paid for**.

- **Check the shape before writing code against it.** Two files were written in
  one session against guessed types and both needed rewriting — `exportHistory`
  assumed `RoundHistoryEntry` when the store holds `CompletedRoundSummary`, and
  a whole `adminRoomList()` was written before noticing `listRoomsForAdmin()`
  existed. One grep first is cheaper than either.
- **Check the environment before writing a path into it.** `setup-admin.sh`
  called a script no image contains, then wrote a `$` Compose eats. A full
  deploy cycle each. Read the Dockerfile.
- **Verify what you cannot test locally, or choose an approach you can.** When
  Docker wasn't available to prove a `$$` escape, switching to a `$`-free format
  was cheaper than shipping another guess.
- **Round trips cost more than edits.** When a choice has variants — a font, a
  placement, a fade — put **all** of them in one sheet and send it once, proofed
  at the size it will actually be seen. The maker's mark was approved on a
  full-resolution sheet and was invisible on a 92px card.
- **Diagnose "it didn't ship" before rebuilding it.** Hash the live asset
  against the local one — caching, a bad build and a too-subtle design look
  identical to the person reporting it.
- **Write findings down as they are found**, not at session end.
