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
| changing any layout, spacing or z-order | **Mobile UI & layout** below |
| running or adding tests, chasing a red suite | skill `testing` |
| asked about npm audit / upgrades / build-log warnings | skill `deps` |
| needing full rules, architecture, card geometry, ops setup | `docs/` |

## Project

**Kvitlach** — a real-time multiplayer web version of a traditional Chanukah
card game (21-style, against a *banker*, not a dealer). One banker hosts;
everyone else plays against them. Built for family/community game nights
(~50 people, one shared table). Live at kvitlach.us, self-hosted via Docker
Compose behind a Cloudflare Tunnel.

- **Frontend**: React 18 + TypeScript, Vite, Tailwind, Zustand (`state.ts`),
  react-router-dom. Vitest + @testing-library/react (jsdom).
- **Backend**: Node + TypeScript (ESM), Fastify (HTTP), raw `ws` (WebSocket).
- **Database**: PostgreSQL via `pg` — **optional**. No `DATABASE_URL` means
  fully in-memory (rooms vanish on restart). No ORM, no migration tool; schema
  is `CREATE TABLE IF NOT EXISTS` in `db.ts:init()`.

## Architecture

Two processes: HTTP on 3000 (health, admin, `/metrics`) and **WebSocket on
3001, where all gameplay happens**. There is no gameplay REST API.

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
  up" into per-path routes.** Two route objects rendering the same element
  still remount it on every path change (React Router keys by route id, not
  element identity), which re-runs `App`'s WS-connect effect and leaves
  `status` stuck on "connecting" after any room transition — the socket's
  `onopen` fires once, and a no-op reconnect never flips it back. `App` parses
  the room id out of the path itself.
- **`errorCopy.ts` is the only place backend error codes become player-facing
  text.** Don't inline an `errorMessage === "..."` ternary anywhere else.
  `errorCopy.test.ts` parses every code out of `backend/src` and fails naming
  any with no entry — it caught eleven codes falling through to a raw
  `code.replace(/_/g, " ")`, including `insufficient_funds` and `invalid_bet`.
- **`ws-server.ts`: every per-room `Map` entry must be deleted once its last
  socket closes**, not merely have the socket removed from its `Set`. An empty
  Set left behind is a permanent leak in a process meant to run for months.
- **`index.ts`'s `unhandledRejection`/`uncaughtException` handlers are a
  backstop, not a fix.** Every fire-and-forget call should already catch at
  its own site. Anything reaching the backstop log line is a bug to fix at
  source. Node kills the process on an unhandled rejection by default —
  before this existed, one dropped socket's failed DB write during cleanup
  could take down every room on the server.
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
- **Blatt** = a draw with no wager. Never wins or loses money; settles as a
  push even if the cards bust.
- **Futch** = over 21. Distinct from losing the showdown — the banker's
  `state === "lost"` also fires when they merely end down on money, which is
  why `busted` is a separate field.
- **Eleveroon** — opt-in; a drawn 11 that would bust a hand *currently readable
  as exactly 11* is ignored. Check every achievable total, not the best one.
- Ties go to the banker.

## Server authority — breaking these is a security bug

1. **Actor identity comes from the socket's session, never the payload.**
   Always `meta?.playerId` in `ws-server.ts`. Pinned by `ws-auth.test.ts`.
2. **Never send the deck to clients.** `sanitizeRound` strips it for
   `deckRemaining`. Knowing the shoe order breaks the game.
3. **Never reveal concealed totals or hole cards early.** `totalDisplay` /
   `sanitizeRound` decide who sees what; don't route around them.
4. Banker-only actions go through `isAdmin` checks in `store.ts`.
5. **For money, use `normalizeMoney`** (`store.ts`) — whole chips, bounded by
   `MAX_MONEY`, `undefined` on anything else. `Number.isFinite` alone is not
   enough: it passes `10.5` (wallets are floats forever after) and `1e308`
   (turns `Infinity` on the first addition). Found because `createRoom`
   validated `bankerBankroll` but never validated `buyIn`, which becomes every
   joining player's starting wallet.
6. Bots must never authenticate as actors (`!actor.isBot` guards).
7. **`room:resume` is never gated, in any access mode.** Lockdown closes the
   door; it does not eject people mid-hand.

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
- The felt is a fixed 1280-wide virtual stage scaled to the viewport
  (`stage.ts`). Position in stage units, never viewport pixels.
- Don't commit or push unless asked.

## Mobile UI & layout

Most players are on a phone, in landscape.
**[docs/mobile-ui.md](docs/mobile-ui.md) is the design contract — read Part 1
(the scene / HUD split) and Part 6 (the bug ledger) before writing any layout
code.** It also holds the four rules, the z-index tiers, the orientation model,
the verification loop and the refactor plan. Six of the ledger's ten bugs were
one structural bug wearing six hats; Part 1 is what stops the seventh.

**Stack:** plain DOM + CSS. React 18 + Tailwind, no canvas, no WebGL, no engine
— so z-index, flex/grid and media queries are the real tools, and DevTools sees
everything. Card faces are PNG with a live SVG overlay (`table/cardMark.ts`).
Dev server `npm run dev` in `frontend/` on **5173** (backend 3000/3001); in
Docker the built `dist/` is served by **nginx on 4173**. Minimum supported:
**360px wide portrait**, **640×360 landscape** for the table.

**Orientation** (precise form; the short version is false — docs Part 4):
portrait lobby and landing; the table **requires landscape on a handheld**
(`isHandheld()`, short edge ≤ 820px) and is gated in portrait there; **larger
viewports render the table in any orientation**, because the stage scales to fit
— a 768×1024 portrait tablet is a supported surface, not a broken one.

```bash
npm --prefix e2e run screenshots
```

12 viewports into `e2e/screenshots/` (gitignored), ~3 min. Also
`npx playwright test tests/phone-layout.spec.ts` for the automated overlap
assertions.

### Hard rules

- **Never call a layout change done from reading code. Render it and look.**
  Both open bugs in the ledger were found by the first capture run, in code
  that had already been measured element-by-element and passed its suite.
- **Never `100vh`** for full-height mobile — `dvh`/`svh` or a JS-set property.
  `.k-fit` already does `height: 100vh; height: 100dvh`, in that order.
- **Never "fix" overflow or overlap with `overflow: hidden`, a negative margin,
  `!important`, or a smaller font.** Those hide it. Find the rule causing it.
- **Account for device pixel ratio.** Card art ships at 946×1438 and `blank.png`
  is deliberately oversized so a 3x screen stays crisp; captures run at dpr 2–3.
- **Layer tiers, and any cross-tier overlap must be deliberate:** felt/oval
  (z 0–9) → seats and gameplay (10–20) → HUD, dock, bank (25–45) → chrome and
  modals (46+). A reaction bubble at z 45 sitting over a total is *inside* one
  tier, which is exactly how that bug hid.
- **If the same layout bug survives two fix attempts, stop patching and report
  the structural cause.** See ledger #3/#5/#7 — one crowded centre column
  wearing three hats.

### Strong defaults (deviate only with a one-line why)

- Spacing **4 / 8 / 12 / 16 / 24 / 32 / 48px** for chrome, HUD and menus.
  Felt geometry is exempt: derive it from the 1280×760 stage and `--vf`, and
  say which.
- Adaptive layout for anything responding to screen size. Absolute positioning
  is legitimate *inside* the stage (that is what stage units are for) — mark
  genuinely pinned chrome as intentional.
- **Controls ≥44×44px.** Cards may be smaller when the felt demands it, but
  need forgiving hitboxes and real separation.
- Respect safe-area insets — `viewport-fit=cover` is already set.

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
  `dist` or inlined (`node -e`). `setup-admin.sh` shipped broken once for
  exactly this.
- **Never write a value containing `$` into `deploy/.env`.** Compose
  interpolates it and expands it to nothing — a scrypt password hash arrived as
  the bare word `scrypt` and every admin login failed against the right
  password. Shells, `sed` and editors eat it too.
- **Bump `APP_VERSION` in `frontend/src/version.ts` by 0.1 before a tarball,
  then run `npx vite build` AFTER the bump** — a scripted bump once truncated
  the file to zero bytes and broke the server build.
- **Never add a `dns:` block to a compose file** deployed to the adguard host.
  Container DNS goes through AdGuard by daemon config; a per-service `dns:`
  silently recreates the bypass. If a container can't resolve something, that
  is a blocklist match — check the query log, don't pin a public resolver.
  Full context: `homeserver/CLAUDE.md`.

## Spending credits well

Credits here are limited. Generic tool hygiene lives in the workspace
`CLAUDE.md`. These are mistakes **this repo has paid for**, costliest first.

- **Check the shape before writing code against it.** Two files were written in
  one session against guessed types and both needed rewriting — `exportHistory`
  assumed `RoundHistoryEntry` when the store holds `CompletedRoundSummary`, and
  a whole `adminRoomList()` was written before noticing `listRoomsForAdmin()`
  existed. One grep first is cheaper than either.
- **Check the environment before writing a path into it.** Same mistake, other
  half: `setup-admin.sh` called a script no image contains, then wrote a `$`
  Compose eats. Both cost a full deploy cycle each. Read the Dockerfile.
- **Verify what you cannot test locally, or choose an approach you can.** When
  Docker wasn't available to prove a `$$` escape, switching to a `$`-free
  format was cheaper than shipping another guess.
- **Round trips cost more than edits.** When a choice has variants — a font, a
  placement, a fade — put **all** of them in one sheet and send it once.
- **Proof at the size it will be seen.** The maker's mark was approved on a
  full-resolution sheet and was invisible on a 92px card.
- **Send images, don't read them.** `SendUserFile` is free; read one back only
  to catch a rendering bug, never one differing by a constant.
- **Measure rasters with a script.** Ink bounds, collisions, clearances: a
  five-line Python one-liner prints the number.
- **Diagnose "it didn't ship" before rebuilding it.** Hash the live asset
  against the local one — caching, a bad build and a too-subtle design look
  identical to the person reporting it.
- **Write findings down as they are found**, not at session end.
