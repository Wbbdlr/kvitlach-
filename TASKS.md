# Current Backlog

Reconciled against the implementation on 2026-08-05. See [CLAUDE.md](CLAUDE.md)
for how to work in this repo.

## Open

- [ ] The backend suite's intermittent full-run flake (found 2026-08-09) is
      now rare but not fully eliminated. Root-caused and fixed 3 confirmed
      instances (`turn-order.test.ts`, `ws-auth.test.ts`,
      `abandoned-banker.test.ts` — see "Done" below): tests calling
      `applyBet`/`applyHit` right after `startRound()` without pinning that
      seat's hand first, so a real crypto-random card can rarely complete a
      natural 21/bust and resolve the turn before the test's own scripted
      moves run. NOT a concurrency race (reproduces with
      `--no-file-parallelism` too). Post-fix measured rate: 1 failure in the
      last ~63 full-suite runs (down from ~20–30%). That one residual
      failure's specific file/cause wasn't captured — if it recurs, capture
      full output (`npx vitest run > /tmp/out.log 2>&1`) and grep the same
      "randomly-dealt card auto-resolves a turn early" pattern before
      assuming a new bug.
- [ ] End-to-end coverage of a full multi-client round (Playwright or similar).
      Unit/component coverage is good; nothing exercises two real browsers
      against one table.
- [ ] A real discard pile (2026-08-10): a rejected Eleveroon card currently
      still sits in the hand, marked/greyed with a disintegrate animation --
      it does NOT fly out to any pile (there isn't one yet). Deliberately
      scoped down to just the animation for now; a real pile would be a
      clickable felt element (like the shoe) the card actually flies into
      and disappears from the hand, expandable to review every card
      discarded that round. Open design question if revisited: Eleveroon-
      rejects only, or every resolved card in the round.

## Done

- [x] Fixed a live-reported bug: Eleveroon did nothing on the Bet path (only
      Hit had the rule). See `round.ts`'s `applyEleveroonRule` comment --
      pinned by `backend/src/__tests__/eleveroon.test.ts`, which also proves
      a rejected card is permanently gone from the deck, not just excluded
      from the hand's total. Added a disintegrate animation for the
      rejected card (puff/crumble/rebound, sequenced after its deal-in) and
      fixed the existing glow/badge-pop animations replaying on every
      reconnect instead of only the first time (`CardView.tsx`, `index.css`).
- [x] Live "BANK 21!" indicator for the banker's own natural 21, mirroring
      FUTCHED! (`selectors.ts`'s `statusDisplay`).
- [x] Motion toggle (footer checkbox / TableRoot chip icon, matching
      Music/SFX) -- blanket-kills all animation/transition via a single
      `motion-off` class on `<html>`, independent of `prefers-reduced-motion`.
- [x] Credited ComputerRabbis.com as the developer (site-wide footer +
      About page), and the natural-21 fanfare's Mixkit source (About).
- [x] Card-dealing animation report (2026-08-10): the mechanism itself
      (`k-card-in`/`cardDealIn` in `index.css`, dealDx/dealDy per seat,
      round-scoped keys, first-paint gate) was already correctly wired and
      verified live -- what was actually invisible is that it went fully
      silent under `prefers-reduced-motion: reduce`, which every other
      animation in `index.css` respects. Decided this one shouldn't: it's
      the only visual cue a card was dealt at all, not just decorative
      polish, so `.k-card-in` was pulled out of that media block and now
      always plays. Confirmed live with `prefers-reduced-motion: reduce`
      still on.
- [x] Real natural-21 fanfare (`frontend/public/sounds/natural21.mp3`,
      Mixkit's "Fantasy game success notification" -- Mixkit License, no
      attribution required). Replaces the reused `card-slide-1.ogg`
      card-motion sample; the "win" sound is no longer layered underneath it
      as a workaround (`audio.ts`, `App.tsx`).
- [x] Fixed 3 confirmed sources of the intermittent backend flake (see the
      still-open item above for the small residual). Each test dealt with
      real crypto-random cards without pinning the hand before a bet/hit
      that could resolve it early: `turn-order.test.ts` (preset all hands
      before betting), `ws-auth.test.ts` (same, plus removed the now-
      resolved standing `DEBUG_DUMP` debug line), `abandoned-banker.test.ts`
      (stacked the deck for a bet that was only half-guarded).
- [x] Richer URLs — distinguishable lobby vs. table (`/table/:roomId`,
      `frontend/src/router.tsx`). Shareable practice-mode link was
      explicitly decided against (practice mode stays single-human). See
      "URL model" below for the current shape and the remount pitfall this
      needed to avoid.
- [x] Browser Back button support. Entering a room now pushes a history
      entry (`history.pushState` in `state.ts`'s `setUrlRoomId`, only on a
      genuinely new room -- reconnects re-confirming the same room still use
      `replaceState`, so they don't pile up duplicate entries). A `popstate`
      listener tears the session down and returns to the lobby the same way
      the explicit Leave button does (shared `teardownRoomSession` helper),
      instead of leaving the site. Verified live (create a practice table,
      press Back, land cleanly on the lobby with no stale session) and with
      5 new tests in `state.test.ts`.
- [x] `/metrics` endpoint (Prometheus text format, unauthenticated like
      `/health`) — `backend/src/metrics.ts`. Tracks HTTP request count, WS
      connections (current gauge + total), WS messages received, rounds
      completed, and round duration (histogram, deal to finalize).
- [x] Retired the root-level legacy Elixir/Phoenix tree — 121 dead files
      (~20MB: compiled JS/CSS bundles, `kvitlech-master.zip`, `fly.toml` for
      an old Fly.io deploy, duplicate card art, `mix.exs`/`.ex` sources) removed
      from the working tree; still recoverable from git history if ever needed.
      `notes/2026-01-01-change-summary.md` (a real changelog about the live
      `store.ts`, not legacy code) was kept.
- [x] Cryptographically secure shuffle RNG — `deck.ts`'s Fisher-Yates now
      uses `crypto.randomInt` instead of `Math.random()`. Fairness sim
      (`npm run simulate`) confirms unchanged odds/distributions.
- [x] Automated frontend coverage for key flows — 169 tests across lobby,
      table view, dock, drawers, stage maths, and store/WS handling.
- [x] Persistence layer so tables survive process restarts — `db.ts`
      (`rooms` / `rounds` / `connections`), rehydrated by `loadFromDB()`.
      Optional: no `DATABASE_URL` runs fully in-memory.
- [x] Production deploy recipe — `deploy/docker-compose.yml`,
      `deploy/build-tarball.sh`, and the Cloudflare Tunnel section in the README.
- [x] Ambient music player with a mute toggle.
- [x] Sound effects for deal, bet, hit/stand, win, futch, Eleveroon, reshuffle,
      and natural 21, with an independent SFX mute toggle.

## URL model

`router.tsx` (not `main.tsx` -- see below) routes `/about`, `/disclaimer`,
`/contact`, and a catch-all `*` for everything else (the lobby, joined-but-
waiting, and live table, all still rendered by the one `App` component,
switching on Zustand `room`/`round` state exactly as before). The active
room is reflected in the path as `/table/CODE`, not a query param.

**Why a catch-all route, not separate `/` and `/table/:roomId` entries:**
two distinct route objects rendering the same `<App/>` element would still
make React Router remount it on every lobby<->table transition (route
matches are keyed by route id, not element identity) -- re-running its
WS-connect effect. `WSClient.connect()` safely no-ops on an already-open
socket, but the re-run would still re-arm `store.init()`'s "connecting"
status with nothing left to flip it back (the socket's `onopen` handler is
only ever assigned once, on the original `connect()`, and won't fire again).
A single `*` route never remounts on a path change, so this doesn't happen.
`App` parses the room id out of the path itself (`state.ts`'s
`getUrlRoomId`) rather than via `useParams()`, since it has to work either
way -- state.ts is a vanilla Zustand store, no hook access.

Entering a room pushes a history entry via the router's own imperative
`router.navigate()` (not raw `history.pushState` -- that would move the
address bar without React Router's internal location state ever finding
out, leaving the *next* navigation routed from a stale idea of where we
are). Every other URL update for an already-shown room (reconnects, kicks,
room-closed) replaces in place instead. A `popstate` listener (the browser
Back button firing while in a room) tears the session down and reloads at
the lobby -- see `state.ts`'s `teardownRoomSession` and the comment above
`setUrlRoomId`.

A stale/invalid `/table/CODE` (no matching per-room session -- an old
bookmark, a deleted room) folds back into `/?room=CODE` on load, both in
`state.ts` (once the WS connects) and immediately in `App.tsx`'s own
pre-fill effect (covers the gap before that, and stale-by-mount cases) --
unlike `/table/`, a bare `?room=` was never a "you're seated here" claim,
just an invite-link hint, so this is the same fallback an ordinary invite
link already gets: the Game ID field gets filled in, not a silent reset.

`?room=CODE` itself is unchanged: it's still the invite-link format
(`RoomInfoDrawer`'s copy-link/WhatsApp-share both use it), pre-filling the
join form for someone who hasn't joined yet. Reconnection does **not**
depend on the URL either way -- it uses a session token in `localStorage`
(generic + per-room keys), so `?room=`/`/table/CODE` are both just hints,
never the source of truth.

Shareable practice-mode links were explicitly decided against (2026-08-09)
-- practice mode stays single-human, no multi-join support planned.
