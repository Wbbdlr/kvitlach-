# CLAUDE.md

Operating notes for Claude Code in this repo. The code is the source of truth;
this file exists to stop you rediscovering things that cost real time.

**This file is charged to every session, so it holds only what you can break
without knowing you were near it** - invariants, traps, "X was tried and does
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

**Kvitlach** - real-time multiplayer web version of a traditional Chanukah card
game (21-style, against a *banker*, not a dealer). One banker hosts; everyone
else plays against them. Built for family and community game nights (~50 people,
one shared table). Live at kvitlach.us, self-hosted via Docker Compose behind a
Cloudflare Tunnel.

React 18 + TypeScript + Vite + Tailwind + Zustand (`state.ts`), Vitest/jsdom on
the front; Node ESM + Fastify + raw `ws` on the back. **Postgres is optional** -
no `DATABASE_URL` means fully in-memory (rooms vanish on restart). No ORM and no
migration tool; the schema is `CREATE TABLE IF NOT EXISTS` in `db.ts:init()`.
**A new SETTING belongs in the existing `settings` key/value row** - a column
per setting would mean a migration. The two tables added since (`audit`,
`archived_rooms`) are records rather than settings: they accumulate rows, are
queried with filters, and carry their own retention sweep. That is the line - if
it is one value an operator edits, it is a settings row.

## Architecture

Two processes: HTTP on 3000 (health, admin, `/metrics`, and the five public
`/api/*` routes - `about`, `contact`, `disclaimer`, `config`, `client-error`)
and **WebSocket on 3001, where all gameplay happens**. There is no gameplay
REST API.

Authoritative state is `GameStore` (`backend/src/store.ts`), an in-memory `Map`
of rooms. **Postgres is a persistence mirror for restart recovery, not the
working store** - read `store.ts`, not SQL, to understand game state. Practice
rooms are never persisted. The client is a thin renderer: it sends intents and
re-renders from `room:state` / `round:state`. It never computes outcomes.

Deeper detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Code map - only the parts that bite

`store.ts` (~1500 lines) and `state.ts` (~1200) are the two hearts. **Grep
before reading either whole.** `table/` holds the felt UI (`TableRoot.tsx`
composes; `layout.ts`/`stage.ts` own coordinates; `selectors.ts` /
`useTableData.ts` hold derived display logic - prefer these over inlining).

- **`router.tsx` is a deliberate single catch-all `*` route. Don't "clean it
  up" into per-path routes.** Two route objects rendering the same element still
  remount it on every path change (React Router keys by route id, not element
  identity), which re-runs `App`'s WS-connect effect and leaves `status` stuck
  on "connecting" after any room transition. `App` parses the room id itself.
- **`errorCopy.ts` is the only place backend error codes become player-facing
  text.** Don't inline an `errorMessage === "..."` ternary anywhere else.
  `errorCopy.test.ts` parses every code out of `backend/src` and fails naming
  any with no entry - it caught eleven falling through to a raw
  `code.replace(/_/g, " ")`, including `insufficient_funds` and `invalid_bet`.
- **`ws-server.ts`: every per-room `Map` entry must be deleted once its last
  socket closes**, not merely have the socket removed from its `Set`. An empty
  Set left behind is a permanent leak in a process meant to run for months.
- **`index.ts`'s `unhandledRejection`/`uncaughtException` handlers are a
  backstop, not a fix.** Anything reaching that log line is a bug to fix at
  source - Node kills the process on an unhandled rejection by default, and one
  dropped socket's failed DB write once took down every room on the server.
- **`useEscapeKey.ts`** - new dialogs use it, not a bespoke `keydown`.
- **Every audio asset's source and license is already recorded** - `audio.ts`'s
  own comments (natural21: Mixkit, free/no attribution) and `About.tsx`'s
  Credits section (Kenney CC0 casino pack: deal/win/shuffle/chip/lose; Micha
  Gamerman: `bgm.m4a`). **`futch.mp3` and `eleveroon.mp3` are the two
  exceptions** - original recordings made for this game, no external source,
  which is why they carry no Credits entry and are the only sounds named in
  Disclaimer.tsx's Ownership section. Don't re-derive this from git log again;
  it took one. Extend the proprietary claim to another asset only once its own
  provenance is actually confirmed, the same way this one was.
- **About, Contact and Disclaimer are all admin-editable without a build** -
  asked for directly ("I don't want to have to fix code every time I want to
  change something on the pages"). `about.ts`/`contact.ts` are one settings
  row each (heading + body, free text, additive: an empty record means the
  page shows only its hardcoded copy). `disclaimer.ts` is deliberately a
  DIFFERENT shape - six independent per-section overrides
  (`DISCLAIMER_SLUGS`), because that page carries the no-gambling/liability/
  ownership language and a single free-text field with no version history is
  how an admin fat-fingers a legal section away with nothing to catch it. A
  section's heading is fixed in code, never editable, only its body. Routes:
  `GET /api/<page>` (public), `GET`/`POST /admin/<page>` (session or
  `?token=`, plain-HTML form, no JS - see admin-ops skill). A public route
  needs its own exact-match `location = /api/<page>` in `frontend/nginx.conf`
  (pinned by `nginxProxy.test.ts`) or it 404s in prod despite working in dev.
- **The practice bots' names are the same kind of setting** (`bot-names.ts`,
  `GET`/`POST /admin/bot-names`) - they used to be two `const` arrays at the
  top of `store.ts`, which made renaming a bot a rebuild. Don't put them back.
  The panel edits `store.botNames` *in place* rather than holding its own
  instance, so a saved list takes effect on the next practice table without a
  restart; keep that. The banker draws a name **per room, never per round** -
  a dealer whose name changed mid-night would read as somebody having taken
  over the table, which is a real event here (`passBankAfterBankDecision`).
- **`Privacy.tsx` is deliberately static, code-only** - unlike the three
  above, it makes factual claims about what the code does with data, so it
  should change when the data-handling code changes (a commit), not drift
  independently via an admin form. If that tradeoff ever gets revisited, say
  so explicitly rather than silently making it editable. **Two retention
  windows are stated on that page and bounded in `limits.ts`**
  (`auditRetentionDays`, `archiveRetentionDays`, both 90 days): change either
  default or its bounds and that page changes in the same commit.
  `audit-trail.test.ts` and `room-archive.test.ts` fail if they drift.
- **The age/legal checkbox (`AgeAckCheckbox` in `App.tsx`) gates Join, Create
  and Practice - never Watch**, which does not wager or "play" in the
  Disclaimer's own sense. One shared `ageAcknowledged` flag, remembered via
  `state.ts`'s `loadAgeAcknowledged`/`persistAgeAcknowledged` (same guarded-
  localStorage shape as the access code) - check it once anywhere, every form
  shows it checked. Frontend-only; there is no server-side enforcement, same
  as virtually every consent checkbox on the web.
- **Practice mode is user-facing as "Play Against the Computer" now, not
  "Practice"** (2026-09-04, direct request) - the framing moved from a demo/
  tutorial mode to a real standalone way to play. `room.practice` (the
  internal flag/logic) is unchanged; only the lobby copy changed. Queued,
  not built: difficulty levels for the bots, bot commentary/"AI remarks"
  during a hand, and other polish for this mode specifically - surface
  toward the user proactively if a session ends up in `bot.ts` or the
  practice-lobby JSX, rather than waiting to be asked.

- **`limits.ts` values are read AT THE POINT OF USE, never captured at module
  load.** Capacity, the seven throttles and the nine gameplay timings are all
  live settings now; a limiter that reads its threshold once at boot gives you
  a panel reporting a new limit and enforcing the old one, and throttles only
  bite under load, so it is discovered on the night it matters. Consumers take
  the `RuntimeLimits` instance, not a number off it. Bounds are fixed in code
  because every protection can be set to a value that disables it. Pinned by
  `live-limits.test.ts`, which also fails if any of the fifteen old constant
  names is declared in `backend/src` again. **`ws` `maxPayload` is the one
  exception** - it is read once when the socket server is built, so it is a
  hard ceiling and the operator's own size cap is enforced on arrival instead.
- **A BANK! frame's winning hand is never broadcast.** `settleBankOutcome`
  pays the frame out and OVERWRITES the banker's turn with their redeal in the
  same call, so the cards that just beat everybody exist only on
  `round.lastBankFrame`. `BankFrameModal` is the one place they are shown; the
  toast is the fallback for anyone who dismissed it. **A bot banker is also
  HELD** (`bankFrameHoldAt`, set only when `bankerTurn.player.isBot`) and
  `syncBotTurn` refuses to arm anything while it is set - otherwise the bot
  plays its next hand out from under the panel. The card IS still drawn before
  the hold: moving that draw breaks settleBankOutcome's `deck_empty` guard,
  which makes the whole settlement a no-op when the shoe is dry. Pinned by
  `bank-frame-hold.test.ts`.
- **Admin links must go through `adminUrl()` (`admin-page.ts`), never
  `` `${path}?foo=1${query}` ``.** `query` is itself `?token=...` for a
  token-authenticated operator, so the naive form yields
  `/admin?refresh=0?token=abc`, the token is swallowed into the value of
  `refresh`, and the page 404s. It broke four pages and only ever on the
  `?token=` path - the escape hatch used when the cookie login is unavailable -
  because the carried query is empty for a cookie session and the naive
  concatenation is accidentally correct there. Pinned by
  `admin-token-links.test.ts`.

- **Family profiles are a LAYER, never a fork** (`family-profiles.ts`,
  `familyProfile.ts`). A family opens `kvitlach.us/m/<slug>`; their device
  remembers it and any table they host is stamped with it. **The house look is
  a profile too** (`HOUSE`), and that is the whole design: nothing in this app
  should ever ask "is this a family table", only which profile is active and
  what field it carries. `get()` therefore never returns undefined. Reserved
  felts work the same way -- a `listed: false` flag the switcher filters on,
  not a "family felts" list.
  - The link is **not a route**. `router.tsx` is a deliberate single catch-all;
    the slug is read off the pathname like `getUrlRoomId` and the URL is
    rewritten to `/`.
  - The lookup is `GET /api/family?slug=` -- a QUERY parameter because
    `nginxProxy.test.ts` requires exact-match locations and a path parameter
    cannot be one. There is deliberately no route that LISTS profiles: a
    profile carries a family's surname.
  - **The card mark is Latin-only and the felt print is Hebrew-only**, because
    Cinzel ships here as an ASCII subset and Frank Ruhl carries a Hebrew-only
    unicode-range. Hebrew in the mark field would draw nothing at all.
  - Precedence, in `theme.ts`: a player's own saved felt > the family profile >
    the operator's house default > shipped. The family and house defaults are
    SEPARATE variables; sharing one made the winner depend on which fetch
    landed first. Pinned by `houseTheme.test.ts`.
  - **A profile's `felt`/`chip` may be EMPTY, and empty means inherit** - not
    navy. Defaulting them to `HOUSE.felt` pinned every family to the SHIPPED
    colour, so an operator's house felt reached everybody except the families.
    The client already falls through correctly (`"" in FELTS` is false); the
    bug was entirely in `normalizeProfile` and the admin `<select>`.
  - Entering family mode rewrites the URL to `/`, so the lobby MUST keep both
    an indicator and `leaveFamily()`. Without them the mode is enterable,
    invisible and permanent - reported from real use.

## Local development

- **`npm run dev` in `frontend/` defaults to the PRODUCTION WebSocket**
  (`wss://ws.kvitlach.us`, hardcoded fallback in `state.ts`). With no local
  backend it silently connects you to the **live server** instead of erroring.
  Don't mistake that for a working local setup, and don't create or join rooms
  there while testing. Run the backend and set `frontend/.env.local`
  (gitignored - recreate after a fresh clone) to `VITE_WS_URL=ws://localhost:3001`.
- **Two tabs on the same `localhost` origin share `localStorage`**, including
  the session-resume token. A second tab resumes as whichever player most
  recently joined in *any* tab - it is not a second identity. Use a second
  browser profile or incognito.

## Game rules that cause bugs

Full rules: [docs/GAME_RULES.md](docs/GAME_RULES.md).

- **A Kvitlach deck is 24 cards** - 1–12, two copies each. Not 52 or 48.
- **The 12 is flexible**: 12, 9, *or* 10, re-read at every evaluation. Never
  collapse it to one value. Totals are the set of achievable sums (`getSums`).
- **Blatt** = a draw with no wager. Never wins or loses money; settles as a push
  even if the cards bust.
- **Futch** = over 21. Distinct from losing the showdown - the banker's
  `state === "lost"` also fires when they merely end down on money, which is why
  `busted` is a separate field.
- **Eleveroon** - opt-in; a drawn 11 that would bust a hand *currently readable
  as exactly 11* is ignored. Check every achievable total, not the best one. It
  saves the player from a futch; it does not save the eleven.
- Ties go to the banker. **The banker never wagers.**

## Server authority - breaking these is a security bug

1. **Actor identity comes from the socket's session, never the payload.** Always
   `meta?.playerId` in `ws-server.ts`. Pinned by `ws-auth.test.ts`.
2. **Never send the deck to clients.** `sanitizeRound` strips it for
   `deckRemaining`. Knowing the shoe order breaks the game.
3. **Never reveal concealed totals or hole cards early.** `totalDisplay` (the
   frontend's rendering rule) and `sanitizeRound`/`isCardHidden` (the
   server's own mirror of that same rule, in `ws-server.ts`) have to agree,
   or one is decorative. Until a security pass, only the frontend enforced
   this - `sanitizeRound` stripped the deck and nothing else, so the
   banker's hole card and a standing player's hand were in every
   `round:state` broadcast to every socket in the room, in full, readable
   straight out of devtools by anyone already seated. `broadcastRound` is
   now PER-RECIPIENT (`isCardHidden` takes a `viewerId`); don't go back to
   one shared payload for a round that isn't `terminate`. Pinned by
   `concealed-cards.test.ts`.
4. **`room:get` and `round:get` require the caller to already belong to the
   room being asked about** (`meta.roomId === roomId`, the same
   server-set-only field every other handler already trusts) - a socket that
   had never sent `room:create`/`join`/`resume`/`watch` used to get the
   room's full state back for the price of knowing its id, `passwordHash`
   included, and a round's full state (unredacted) for the price of knowing
   its `roundId`. Pinned by `room-round-authorization.test.ts`.
5. Banker-only actions go through `isAdmin` checks in `store.ts`. The reverse
   also holds: **`applyBet` rejects a bet from the admin's own turn** (the
   banker never wagers - see the rules above). Found the day the bot banker
   bug was fixed: the first tests for that fix passed with the fix reverted,
   because the bot's stray wager sometimes SUCCEEDED and the round looked
   normal. Before this guard a client that sent `bet` on the admin's turn was
   unopposed, and `calculateEndState` then overwrites `bet` with the round's
   net, erasing the evidence once the round resolved. Pinned by
   `money-validation.test.ts`.
6. **For money, use `normalizeMoney`** (`store.ts`) - whole chips, bounded by
   `MAX_MONEY`, `undefined` on anything else. `Number.isFinite` alone passes
   `10.5` (wallets are floats forever after) and `1e308` (turns `Infinity` on
   the first addition). Found because `createRoom` validated `bankerBankroll`
   but never validated `buyIn`, which becomes every joining player's starting
   wallet. `adjustPlayerWallet` was the one money path that skipped this (it
   moves a wallet both ways, so it normalizes the magnitude and reapplies the
   banker's own sign rather than calling `normalizeMoney` directly).
7. Bots must never authenticate as actors (`!actor.isBot` guards).
8. **`room:resume` is never gated, in any access mode.** Lockdown closes the
   door; it does not eject people mid-hand.
9. **Operator-authored text is stored raw and rendered as text.** Never escape
   on the way in and never assign it as HTML on the way out (`about.ts`,
   `contact.ts`, `disclaimer.ts` - see the code map entry below).
10. **A room's password is never stored or compared as plain text.**
    `RoomState.passwordHash` is a scrypt hash (`admin-auth.ts`'s own
    `hashPassword`/`verifyPassword`, reused rather than reinvented) - the
    plaintext lived in every Postgres backup and, unredacted, in every
    `room:state` broadcast to every player. `RoomInfoDrawer` can no longer
    show the banker their own password back (a one-way hash can't be
    reversed); it only shows that one is set. Pinned by
    `room-password-hashing.test.ts`.
11. **`room:create`/`room:create-practice` carry their own per-IP throttle**
    (`ws-server.ts`), independent of the generic per-socket message-rate
    limiter - that one alone let a single connection exhaust `limits.ts`'s
    `maxRooms` in under a minute. A windowed count (5 per IP per 60s), not a
    flat cooldown after one success - see the constant's own comment for why
    a hard cooldown was tried and rejected (more than one banker can share a
    home NAT on a real night). Pinned by `room-create-throttle.test.ts`.
12. **Per-IP checks (`client-ip.ts`'s `resolveClientIp`) key off
    `CF-Connecting-IP`, not `X-Forwarded-For`.** Cloudflare's edge sets
    `CF-Connecting-IP` itself and overwrites it on every request; it
    APPENDS to `X-Forwarded-For` rather than replacing it, so reading that
    header's first entry (the old code, in both `http-server.ts` and
    `ws-server.ts`) returned whatever a client had put there - a working
    spoof of the WS connection cap and the admin-login brute-force throttle
    alike. `X-Forwarded-For` is still the fallback for a path that bypasses
    Cloudflare (local dev, a direct Tailscale connection). Pinned by
    `client-ip.test.ts`.

## Development rules

- Understand the request, inspect the relevant code, make the **smallest change
  that solves it**. Follow the patterns already here.
- Don't refactor, rename, reformat or "tidy" code you were not asked to touch.
- Don't add dependencies or build a parallel system for something that exists.
- **Comments explain *why*, not *what*.** This codebase's comments carry real
  history - measured numbers, rejected alternatives, post-mortems. Match that.
- **No emoji in UI.** Inline SVG via `table/icons.tsx`. (Emoji in player
  *reactions* are user content - a deliberate exception.)
- **`MAX_SEATED_PLAYERS_PER_ROUND = 11` is derived from `layout.ts` collision
  maths** and pinned by `layout.test.ts`. Changing one without the other breaks
  the table, and it must never become a runtime setting. Overflow players queue.
- Don't commit or push unless asked.
- **Keep this file and the skills current as you go, and keep them SMALL.**
  This file is charged to every session, so it earns its length by holding
  what you can break without knowing you were near it - invariants, traps,
  "X was tried and does not work". When a session ends up teaching one of
  those, write it down then, in the same turn, while the reasoning is still
  in hand. When a session merely adds a feature, write nothing here: that is
  what git log and `VERSION_HISTORY` are for, and a changelog in this file
  makes every future session more expensive, not less.
  - Procedure goes in a **skill** (loaded on demand), reference goes in
    **`docs/`**, and only the traps go here.
  - **Correcting is worth more than appending.** A line here that has quietly
    become false costs more than a missing one, because it will be believed.
    If you touch an area this file describes, check what it claims about that
    area before you move on.
  - Before adding a paragraph, ask whether a test could hold the fact instead.
    A pinned test enforces an invariant; a paragraph only hopes.

## Mobile UI & layout

Most players are on a phone, in landscape.
**[docs/mobile-ui.md](docs/mobile-ui.md) is the design contract - read Part 1
(the scene / HUD split) and Part 2 (the rules) before writing any layout code.**
It holds the hard nevers, the z-index tiers, the spacing defaults, the
orientation model and the verification loop. What produced each rule is in
[docs/mobile-ui-history.md](docs/mobile-ui-history.md), needed only when a rule
looks arbitrary.

The two facts you need before opening it: the felt is a **fixed 1280×760 virtual
stage scaled to the viewport** (`stage.ts`) - position in stage units, never
viewport pixels - and it is **plain DOM + CSS**, no canvas or engine, so
z-index, flex/grid and media queries are the real tools and DevTools sees
everything. Card faces are PNG with a live SVG overlay (`table/cardMark.ts`).
Dev server on **5173**; in Docker nginx serves `dist/` on **4173**. Minimum
supported: **360px wide portrait**, **640×360 landscape** for the table.

## Context economy

Context is the scarce resource in a long session, not tokens on a bill.

- **Default to concise reports.** Lead with what changed, what it fixed, and the
  verification result. Keep reasoning to what the reader needs to make a
  decision; offer the detail rather than including it.
- **Never paste large tool output into chat** - measurement dumps, element
  enumerations, whole files, long logs. Write them to a file and summarise in a
  few lines. A number and its meaning beat the table it came from.
- **Read the part of the file you need**, not the whole file, when a targeted
  read will do. Grep for the anchor, then read the range.
- **Say when context is getting long**, and say what is safe to drop.

## Constraints

- **Never `docker compose down -v`** - it destroys the Postgres volume.
- **`DOCKER_BUILDKIT=0`** when building on the server; BuildKit can't resolve
  DNS through its resolver.
- **The backend runtime image holds `dist/` and nothing else** - no `src/`, no
  `scripts/`. Anything run as `docker compose exec backend <path>` must be in
  `dist` or inlined (`node -e`). `setup-admin.sh` shipped broken once for this.
- **Never write a value containing `$` into `deploy/.env`.** Compose expands it
  to nothing - a scrypt password hash arrived as the bare word `scrypt` and
  every admin login failed against the right password. Shells, `sed` and editors
  eat it too.
- **Bump `APP_VERSION` in `frontend/src/version.ts` by 0.1 before a tarball,
  then run `npx vite build` AFTER the bump** - a scripted bump once truncated
  the file to zero bytes and broke the server build.
- **Never rotate the Postgres password by editing `deploy/.env`.** Run
  `bash deploy/rotate-db-password.sh`. `POSTGRES_PASSWORD` only takes effect on
  a container's first init against an empty volume, so changing the line alone
  leaves the role untouched and breaks `DATABASE_URL` - and the obvious fix for
  that is `down -v`, which destroys the database. The script ALTERs the role
  first, verifies over TCP, then writes `.env`.
- **Secrets go into a container on stdin, not `docker compose exec -e KEY=val`**
  - that string is argv of the host's `docker` process and is readable via `ps`.
  Both deploy scripts had it; both now pipe. Their verifiers grep for it.
- **Never add a `dns:` block to a compose file** deployed to the adguard host.
  Container DNS goes through AdGuard by daemon config; a per-service `dns:`
  silently recreates the bypass. A container that can't resolve something has
  hit a blocklist match - check the query log, don't pin a public resolver.
  Full context: `homeserver/CLAUDE.md`.
- **`frontend/nginx.conf`'s `location = /api/about` must stay an exact match.**
  The backend port also serves `/admin`, and the 127.0.0.1 binding that protects
  it does not apply inside the compose network. Pinned by `nginxProxy.test.ts`.
- **nginx `add_header` does NOT merge: one in a location DISCARDS every
  server-level header.** `location ^~ /assets/` had a lone `Cache-Control`, so
  the entire compiled app was served with no nosniff and no CSP while the HTML
  loading it had all eight - and the front page looked correct throughout. Any
  location setting a header must restate the whole security list. Pinned by
  `nginxProxy.test.ts`.
- **`/m/` is `noindex` via `X-Robots-Tag`, deliberately NOT a robots.txt
  `Disallow`.** A disallowed URL is never fetched, so the crawler never reads
  the noindex and Google can still list the bare URL - publishing the family's
  surname, the exact thing being prevented. robots.txt is public too, so naming
  `/m/` there advertises the namespace.

## Spending credits well

Credits here are limited. These are the mistakes **this repo has paid for**.

- **Check the shape before writing code against it.** Two files were written in
  one session against guessed types and both needed rewriting - `exportHistory`
  assumed `RoundHistoryEntry` when the store holds `CompletedRoundSummary`, and
  a whole `adminRoomList()` was written before noticing `listRoomsForAdmin()`
  existed. One grep first is cheaper than either.
- **Check the environment before writing a path into it.** `setup-admin.sh`
  called a script no image contains, then wrote a `$` Compose eats. A full
  deploy cycle each. Read the Dockerfile.
- **Verify what you cannot test locally, or choose an approach you can.** When
  Docker wasn't available to prove a `$$` escape, switching to a `$`-free format
  was cheaper than shipping another guess.
- **Round trips cost more than edits.** When a choice has variants - a font, a
  placement, a fade - put **all** of them in one sheet and send it once, proofed
  at the size it will actually be seen. The maker's mark was approved on a
  full-resolution sheet and was invisible on a 92px card.
- **Diagnose "it didn't ship" before rebuilding it.** Hash the live asset
  against the local one - caching, a bad build and a too-subtle design look
  identical to the person reporting it.
- **Write findings down as they are found**, not at session end.
