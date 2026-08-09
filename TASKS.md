# Current Backlog

Reconciled against the implementation on 2026-08-05. See [CLAUDE.md](CLAUDE.md)
for how to work in this repo.

## Open

- [ ] Switch deck shuffling to a cryptographically secure RNG (`crypto.randomInt`
      in `deck.ts`'s Fisher-Yates). Currently `Math.random()`. Not a fairness
      problem in practice for a family game, but it is the one place the shuffle
      is predictable in principle.
- [ ] Instrument the server with basic telemetry (request counts, WS
      connections, round durations) behind a `/metrics` endpoint. Today
      `http-server.ts` exposes only `/health` and the token-gated `/admin`.
- [ ] Replace the natural-21 sound asset. `natural21` currently reuses
      `card-slide-1.ogg`, a card-motion sample — it fires correctly (verified
      live) but doesn't *read* as a distinct moment, so it's currently layered
      with the win sound as a workaround. A real fanfare would let that
      layering be dropped.
- [ ] Decide whether the app needs richer URLs (e.g. `/table/:roomId`,
      shareable practice-mode link, back-button support). Today everything is
      `/?room=CODE` synced via `replaceState`. See "URL model" below.
- [ ] End-to-end coverage of a full multi-client round (Playwright or similar).
      Unit/component coverage is good; nothing exercises two real browsers
      against one table.
- [ ] Retire or archive the root-level legacy Elixir/Phoenix files. They no
      longer run, contain stale rules (`deck.ex` still builds a 48-card deck),
      and shadow the real filenames in `backend/src/`.

## Done

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
current room reflected as `?room=CODE` via `history.replaceState`.

Reconnection does **not** depend on the URL: it uses a session token in
`localStorage` (generic + per-room keys). `?room=` only pre-fills the join
form, so an invite link still asks for a name rather than silently seating
someone.

Known trade-offs of the current model:

- No history entries, so the browser Back button leaves the site instead of
  returning to the lobby.
- No shareable link for practice mode.
- Lobby and table are indistinguishable by URL (analytics/bookmarks can't tell
  them apart).

None of these are correctness bugs, and the session model would not get simpler
with real routes — so this is a product decision, not a fix.
