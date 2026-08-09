# Architecture

Deeper reference for the parts of Kvitlach that aren't obvious from the code
layout. See [CLAUDE.md](../CLAUDE.md) for the short version.

## Shape

```
browser (React/Zustand) ──WS:3001──> ws-server.ts ──> GameStore (in-memory)
                                                          │
                                          HTTP:3000       └─(mirror)─> Postgres
                                          health + admin              (optional)
```

Gameplay is **WebSocket-only**. The Fastify HTTP server serves `/health`, a
token-gated `/admin` surface for freeing stuck Game IDs, and `/metrics`
(Prometheus text format, unauthenticated) — nothing else. Do not add gameplay
REST endpoints; the client has no code path for them.

## Server authority

`GameStore` owns all authoritative state. The flow for every player action is:

1. Client sends an intent (`turn:bet`, `turn:hit`, …) with a `requestId`.
2. `ws-server.ts` resolves the actor from **the socket's own attached session**
   (`meta?.playerId`) — never from the message payload.
3. `GameStore` validates (whose turn, is the turn pending, is the actor the
   banker where required) and mutates.
4. The result is broadcast to the whole room; the sender also gets an `ack`
   echoing its `requestId`.

The client never derives outcomes. It renders what it's told and uses
`requestId` correlation to attribute errors to the action that caused them
(see the `pending*RequestId` variables in `state.ts` — that pattern exists so an
error surfaces on the right form/toast instead of a generic one).

### What the client is not allowed to know

`sanitizeRound` strips the shoe (`deck`) and sends only `deckRemaining`.
Concealed hands and totals are filtered per-viewer. Two rules follow:

- Anything sent to clients is public. If a value must stay secret, it must not
  leave the server — hiding it in the UI is not sufficient.
- `totalDisplay` (frontend) mirrors, but does not enforce, that policy. The
  server is the enforcement point.

## Rounds, seating, rotation

- A **room** is long-lived; a **round** is one hand for everyone.
- `startRound` takes online players, rotates the starting seat by one each
  round (`nextStart`), seats the first `MAX_SEATED_PLAYERS_PER_ROUND` (11), and
  queues the rest into `waitingPlayerIds`. Rotation guarantees a queued player
  gets seated within N rounds.
- 11 is a **geometric** limit from `frontend/src/table/layout.ts` — the point at
  which seat plates start colliding on the oval. It is pinned by
  `layout.test.ts`. Both numbers must move together.
- `startRound` deliberately mutates nothing until `createRound` succeeds, so a
  failed deal (e.g. `deck_low`) can be retried onto the identical rotation
  rather than skipping a player.
- The shoe **carries across rounds** and is not auto-reshuffled. If it can't
  cover the table, the deal fails with `deck_low` and the banker must reshuffle
  — the dealer decides when a new shoe comes in, as at a real table.

## Sessions and reconnection

- On join/create the server issues a session token (`sessions` map, 7-day TTL)
  and the client persists it to `localStorage` under both a generic key and a
  per-room key (21-day window, matching the server's room-inactivity GC).
- On connect, the client auto-sends `room:resume`. A `room_not_found` from
  *that specific request* clears the stale session silently; the same error from
  a manual join shows the user their typo. This is why auto-resume's
  `requestId` is tracked separately.
- Rooms are garbage-collected after inactivity: 3 days normally, 30 minutes for
  practice rooms.

## Persistence

Postgres is optional and is a **mirror**, not the working store. `db.ts` holds
three tables (`rooms`, `rounds`, `connections`) with JSONB state blobs; schema
is created idempotently at boot. `loadFromDB()` rehydrates rooms on start.
Practice rooms are never written. There are no migrations — changing
`RoomState`'s shape must stay backward-compatible with blobs already on disk,
or old rooms will fail to rehydrate.

## The stage coordinate system

The felt is authored on a fixed **1280 × 760 virtual stage** and scaled to fit
the viewport. `stage.ts`'s `computeFit()` returns:

- `scale` — uniform zoom. Width always binds first, so the felt reaches both
  side edges (no pillarboxing), capped at `MAX_SCALE`.
- `vf` — vertical flatten factor (0.5–1). Squashes the oval, seat ellipse and
  dealer when the viewport is short (landscape phones), instead of shrinking
  everything.
- `playTop` — top chrome band reserved above the play area.

Consequences when changing UI:

- Position in **stage units**, not viewport pixels.
- Anything that must stay a constant on-screen size (top branding, toasts)
  counter-scales against `--stage-scale`. That's why those rules look inverted.
- Chrome living *outside* the scaled stage (`.k-chrome-top`, `.k-controls`)
  uses real pixels and aligns to the felt's rendered box via `--stage-w/h`.
- `computeFit` is pure and covered by `stage.test.ts` — test layout maths there
  rather than by eyeballing the browser, then confirm visually.

## Bots / practice mode

Practice rooms (`practice: true`) are ordinary rooms whose banker and most seats
are bots. `bot.ts` is a pure decision module; `store.ts`'s `syncBotTurn`
schedules a randomized "thinking" delay and then applies the bot's action
through the *same* code path a human uses. Bots can never authenticate
(`!actor.isBot` guards), and the human player is allowed to start rounds in
their own practice room even though they aren't the admin.

## Rate limiting and abuse

`ws-server.ts` enforces per-IP connection caps and a per-socket message rate
window. `MAX_CONNS_PER_IP` is deliberately high because a whole family behind
one home NAT is the normal case, not an attack. Concurrent practice rooms are
capped separately in `store.ts`.
