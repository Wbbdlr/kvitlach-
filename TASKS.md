# Current Backlog

Reconciled against the implementation on 2026-08-05. See [CLAUDE.md](CLAUDE.md)
for how to work in this repo.

## Open

- [ ] Investigate the backend suite's intermittent full-run flake (found
      2026-08-09). Running `cd backend && npx vitest run` shows a failure in
      roughly 20–30% of runs; which file fails is not consistent (seen:
      `ws-auth.test.ts`, `abandoned-banker.test.ts`, `turn-order.test.ts`,
      one each on separate runs) and every failing file passes cleanly
      100% of the time run alone. Confirmed pre-existing and unrelated to
      this session's changes — reproduces identically on commit `b83be16`,
      before the crypto RNG swap or `/metrics` work. Likely several real
      `WSServer` instances + real `setTimeout` turn/session timers racing
      for CPU across parallel Vitest workers, not a game-logic bug. Never
      reproduces file-by-file; only under a full parallel run.
- [ ] Replace the natural-21 sound asset. `natural21` currently reuses
      `card-slide-1.ogg`, a card-motion sample — it fires correctly (verified
      live) but doesn't *read* as a distinct moment, so it's currently layered
      with the win sound as a workaround. A real fanfare would let that
      layering be dropped.
- [ ] Decide whether the app needs richer URLs (e.g. `/table/:roomId`,
      shareable practice-mode link). Today everything is `/?room=CODE`.
      Back-button support (below) is done; the remaining trade-offs are a
      product decision, not a fix. See "URL model" below.
- [ ] End-to-end coverage of a full multi-client round (Playwright or similar).
      Unit/component coverage is good; nothing exercises two real browsers
      against one table.
## Done

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

## URL model (context for the open item above)

`main.tsx` routes only `/`, `/about`, `/disclaimer`, `/contact`. The entire
game — lobby, joined-but-waiting, and live table — renders at `/`, with the
current room reflected as `?room=CODE`.

Entering a room pushes a history entry (`history.pushState`); every other
URL update for an already-shown room (reconnects, kicks, room-closed) uses
`history.replaceState` so it doesn't add another. A `popstate` listener
(the browser Back button firing while in a room) tears the session down and
reloads at the lobby -- see `state.ts`'s `teardownRoomSession` and the
comment above `setUrlRoomId`.

Reconnection does **not** depend on the URL: it uses a session token in
`localStorage` (generic + per-room keys). `?room=` only pre-fills the join
form, so an invite link still asks for a name rather than silently seating
someone.

Remaining known trade-offs of the current model:

- No shareable link for practice mode.
- Lobby and table are indistinguishable by URL (analytics/bookmarks can't tell
  them apart).

Neither is a correctness bug, and the session model would not get simpler
with real routes — so this remains a product decision, not a fix.
