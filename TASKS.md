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
## Done

- [x] End-to-end coverage of a full multi-client round (2026-08-10) --
      `e2e/` is a new, separate Playwright package (own `package.json`, its
      own dedicated ports 3100/3101/5273 so it never collides with a
      developer's own `npm run dev`) covering what unit/component coverage
      structurally can't reach: two real browser CONTEXTS (genuinely
      isolated sessions, sidestepping the shared-localStorage gotcha in this
      file's "Local development" section) with two real WebSocket
      connections on one real table. `full-round.spec.ts`: banker creates a
      room, a second real player joins and is visible on the BANKER's own
      live view (not just the player's), the bank's hand reads concealed to
      the player the instant it's dealt, the player plays a hand, the banker
      resolves theirs, and both clients end up agreeing on the same
      WON/LOST/PUSH outcome off the same `round:state` broadcast. Cards are
      real crypto-random draws, not scripted -- the test drives whichever
      controls actually show up (`clickIfAppears`) rather than assuming one
      fixed Bet-then-Hit-then-Stand path, since a natural stop can
      legitimately resolve a turn at any of several points. 6/6 runs green
      locally across genuinely different random hands. See `e2e/README.md`.
- [x] A real discard pile (2026-08-10, replacing the old in-hand disintegrate
      animation): a rejected Eleveroon card now flies from its hand to a new
      clickable felt element (`DiscardPile.tsx`, styled and positioned like
      the shoe but mirrored to the dealer's other side -- `layout.ts`'s
      `discardPilePosition`) and disappears from the hand for good --
      `CardView.tsx`'s `flown` state renders nothing for an eleveroon-ignored
      card once its one-shot puff/crumble/rebound-then-fly-out sequence
      finishes (`index.css`'s `cardDiscardFly`), and renders nothing AT ALL
      for one that already happened before this client connected (it flew
      off in an earlier session -- the pile's own tap-to-expand review,
      `DiscardPileModal.tsx`, is where it lives now). This is a real
      behavior change from the old design: the permanent in-hand gold ring
      is gone, superseded by the pile as "the record of what happened".
      Scoped to Eleveroon-rejects only, per the open design question this
      closes out -- every OTHER resolved card staying in its hand as before
      was a deliberate line, not an oversight; revisit if a broader "every
      card this round" pile is ever wanted. Covered by 15 new tests
      (`CardView.test.tsx`'s fly-out timing, `DiscardPile.test.tsx`,
      `DiscardPileModal.test.tsx`); the live Eleveroon-reject moment itself
      wasn't reproducible through browser-click automation this session (it
      needs both landing on a hand reading exactly 11 AND then drawing an
      actual 11 -- 8 practice-mode attempts landed on 11 twice but never drew
      the second one), so this shipped on the deterministic test suite +
      code review rather than a live screenshot, the same standard used for
      the BANK! two-frames fix above.
- [x] Fixed both confirmed BANK! "two frames" bugs from the 2026-08-10
      bug-hunting pass (repro'd in `backend/src/__tests__/bank-frames.test.ts`):
      1. A redeal used to overwrite the banker's turn with the fresh hand
         before any `round:state` ever carried the frame that just finished
         -- only the wallet number moved, silently. Fixed by carrying that
         frame forward on a new transient field, `RoundState.lastBankFrame`
         (`store.ts`'s `settleBankOutcome`, only ever set on an actual
         redeal), diffed by client(s) the same way `deckReshuffledAt` is
         (`state.ts`'s `bankFrameNotification`) to toast "Bank showed 18
         (beat 2) -- new hand dealt to keep the table live." to the whole
         table the instant it happens. Chosen over pausing the round to wait
         for an acknowledgment -- the banker is still forced to keep dealing
         regardless, so there's nothing for anyone to actually decide before
         the next card; a toast tells the story without adding a click.
      2. A second BANK! lock later in the same round was double-counting
         seats an earlier frame had already paid out into the banker's
         `beat`/`lostTo` tally (`beat: 2, lostTo: 1` instead of `beat: 0,
         lostTo: 1` in the confirmed repro). Two-part fix: `settleBankOutcome`
         now marks the turns it resolves `settled: true` (mirroring
         `settleImmediateTurn`, `store.ts:787`) and excludes already-`settled`
         seats from a later frame's `involvedEntries` -- which also stops a
         second frame from clobbering an earlier frame's real `settledBet`
         back to 0. `calculateEndState` (`round.ts`) additionally guards its
         own beat/lostTo increment against a turn that's already been paid
         (`bet: 0` but `settledBet` non-zero) re-adding a point on any later
         recompute -- this is the one that actually mattered for the live
         bug, since the round's own final settlement re-runs
         `calculateEndState` over every turn regardless of the
         `involvedEntries` filter. Money was never affected by either bug.
- [x] Eleveroon is now visible to the WHOLE table, not just the player it
      happened to (2026-08-10). Two parts: (1) a public toast
      ("Eleveroon! <Name> just saved a busting eleven.") fires for every
      connected client -- including the player it happened to -- the instant
      a card is newly marked `eleveroonIgnored`, independent of that specific
      card still being concealed from other players by the ordinary bet/hit
      secrecy rules (`state.ts`'s `eleveroonNotification`, diffed off the
      same broadcast round state as the deck-reshuffle/outcome notices).
      (2) A live "I'm calling Eleveroon!" gold star badge on the player's own
      seat (`Seat.tsx`'s `k-elev-mark`) the moment they submit a Bet/Hit with
      the checkbox on -- the real-table equivalent of announcing it out loud,
      independent of whether the draw ends up needing the save. Backed by a
      new `turn.eleveroonCalled` field, overwritten every action from the
      raw checkbox request (never the banker's always-on protection --
      `round.ts`'s `applyEleveroonRule`), shown only while `turn.state` is
      still "pending". Verified live across two real browser clients (a
      banker tab and a player tab, no bots) -- the banker's tab shows the
      star on the player's seat while that player's own cards stay
      concealed, exactly the intended split between "the call is public" and
      "the hand stays private until it resolves".
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
