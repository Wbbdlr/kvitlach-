# Kvitlach

Modern take on the traditional Chanukah twenty-one variant featuring a dedicated banker. The active stack is Node.js (Fastify + WebSocket) for the backend and React + Vite + Tailwind for the frontend.

> **Working on this repo with Claude Code?** Start with [CLAUDE.md](CLAUDE.md) — it carries the project rules, invariants, and the non-obvious test/build commands.
>
> **Heads up:** the root-level Phoenix/Elixir files (`deck.ex`, `round.ex`, `turn.ex`, …) are dead code kept for historical reference. They do not run and contain stale rules. The live implementation is `backend/src/` and `frontend/src/`.

## Table of Contents
- [Features](#features)
- [Documentation](#documentation)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
	- [Local Development](#local-development)
	- [GitHub Codespaces / Remote URLs](#github-codespaces--remote-urls)
- [Testing](#testing)
- [Production Builds](#production-builds)
- [WebSocket Contract](#websocket-contract)
- [Docker / Compose](#docker--compose)
- [Assets](#assets)

## Features
- Multiplayer rooms with banker ownership, optional join passwords, rotating starting players, and auto-sized decks (up to 16). Bankers can still override deck count.
- Practice mode: a solo table against 2–7 computer players, with configurable buy-in, bank bankroll, and deck count. No room code needed.
- WebSocket-driven gameplay loop with cumulative betting (`Bet` adds to the wager and deals a card) alongside classic `Hit`, `Stand`, and `Skip`, plus Bank! showdown logic.
- Pre-bet "Blatt" draws let players view cards for free; multiple Blatts are allowed before wagering, and standing with no wager auto-resolves as a push.
- Card visibility rules: owners always see their own hands; busted/winning/standby hands reveal to everyone; the banker’s first card stays hidden until resolution; banker totals reveal in final/terminate states; pre-bet Blatts stay visible to the table, wagered cards stay hidden until resolved.
- Eleveroon support: banker always-on; players can toggle it per-hit to ignore a single busting eleven; indicators mark ignored cards.
- Banker controls: approve/deny rename and chip requests, top up or drain the bank, adjust any player wallet (with notes), kick players, end the round when the bank is depleted, and handle Bank! showdown exposures.
- Round tracking and history: persisted per-room history in the browser, showdown summaries, queued-player indicators, and notifications for approvals/adjustments.
- UI affordances: inline bet validation (shows insufficient-funds hint beside the wager), standby indicator while waiting on banker resolution, bank toggle that auto-fills to the remaining available bank.
- Felt table UI that scales to any viewport (phone landscape/portrait through 4K), with tap-to-fan-out for overlapping hands, animated dealing, reactions, sound effects, fullscreen, and wake-lock during play.

## Documentation

| Document | Contents |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Working rules, invariants, commands. Read this first when changing code. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Server authority, sessions, persistence, seating/rotation, the scaled-stage coordinate system. |
| [docs/GAME_RULES.md](docs/GAME_RULES.md) | Rules as implemented — deck composition, the flexible 12, blatt, futch, Eleveroon, showdown. |
| [TASKS.md](TASKS.md) | Current backlog. |

## Project Structure

```text
backend/   Fastify HTTP + WebSocket server, game logic, Vitest tests
frontend/  React + Vite client, Zustand state, Tailwind styling
deploy/    docker-compose.yml and build-tarball.sh
docs/      Architecture and game-rules reference
*.ex       Dead legacy Phoenix files, reference only — see the note above
```

## Getting Started

### Prerequisites
- Node.js 18+
- npm 9+

Install dependencies once per workspace:

```bash
npm --prefix backend install
npm --prefix frontend install
```

### Local Development

Run the backend (HTTP on 3000, WebSocket on 3001):

```bash
cd backend
HOST=0.0.0.0 WS_PORT=3001 PORT=3000 npm run dev
```

Run the frontend (Vite on 4173, pointing to the local WebSocket server):

```bash
cd frontend
VITE_WS_URL=ws://localhost:3001 npm run dev -- --host --port 4173
```

Visit `http://localhost:4173` for the UI. Both commands watch for changes.

### GitHub Codespaces / Remote URLs

Expose port `3001` publicly. Use the full Codespaces subdomain for the WebSocket URL:

```bash
VITE_WS_URL="wss://<codespace-id>-3001.app.github.dev" npm run dev -- --host --port 4173
```

The frontend defaults to this pattern automatically, but explicit `VITE_WS_URL` avoids browser caching issues. The backend command remains the same.

## Testing

Backend (turn/round resolution, store, WS auth, seating, persistence):

```bash
cd backend && npm test          # vitest run — one-shot
```

Frontend (lobby, table view, dock, drawers, stage maths, store/WS handling):

```bash
cd frontend && npx vitest run   # note: `npm test` starts WATCH mode
```

Typecheck: `npm run build` in `backend/`, and `npx vite build` in `frontend/`.
(`npx tsc --noEmit` in `frontend/` surfaces many pre-existing, unrelated
ambient-type errors and is not a useful signal.)

Run the Monte Carlo simulator (50k rounds per deck count) to check rules and the
Banker/Player edge — worth running after any change to deck composition, card
values, or win/bust logic:

```bash
cd backend && npm run simulate
```

## Production Builds
- Backend: `npm run build` then `node dist/index.js` (binds 0.0.0.0, configurable via `PORT`/`WS_PORT`).
- Frontend: `npm run build` then serve `frontend/dist` (e.g. `npm run preview`, static host, or a CDN). Set `VITE_WS_URL` at build time to your public WSS endpoint.

### Cloudflare Tunnel / Custom Domain
- Run backend and frontend containers bound to localhost on your Ubuntu host (see Docker section).
- Create Cloudflare Tunnel ingress rules, for example:
	- `https://game.example.com` → `http://localhost:8080` (frontend)
	- `wss://ws.example.com` → `http://localhost:3001` (WebSocket)
- Build the frontend with `VITE_WS_URL=wss://ws.example.com` so the client connects through the tunnel.
- Keep ports closed publicly; let Cloudflare terminate TLS.

## WebSocket Contract
- Client → server envelope: `{ type, roomId?, playerId?, requestId?, payload }`
- Server → client envelope: `{ type, roomId?, playerId?, requestId?, payload, error? }`
- `ack` responses echo the originating `requestId`; failures use `error` with `{ message, code?, details? }`.

Gameplay is WebSocket-only — the HTTP server exposes just `/health` and a token-gated `/admin`. The authoritative list of message types is the `switch` in `backend/src/ws-server.ts`; the main ones:

- Client: `room:create`, `room:create-practice`, `room:join`, `room:resume`, `room:switch-admin`, `room:get`, `room:close`, `round:start`, `round:get`, `round:banker-end`, `round:void-abandoned`, `turn:bet`, `turn:hit`, `turn:stand`, `turn:skip`, `player:react`, rename (`player:rename-request|approve|reject|block|cancel`), buy-in (`player:buyin-request|approve|reject|block|cancel`, `player:practice-topup`), admin tools (`player:kick`, `player:bank-adjust`, `room:set-watermark`, `room:reshuffle-deck`), and `room:banker-topup`.
- Server: `room:state`, `round:state`, `round:ended`, `round:banker-ended`, `room:closed`, `reaction:new`, `room:banker-topup`, `player:bank-adjusted`, `ack`, `error`.

**Actor identity always comes from the socket's authenticated session, never from a `playerId` in the payload** — see [CLAUDE.md](CLAUDE.md) and `backend/src/__tests__/ws-auth.test.ts`.

### URLs

The app routes only `/`, `/about`, `/disclaimer`, and `/contact`. The whole game (lobby, waiting, live table) renders at `/`, with the active room mirrored as `?room=CODE` via `history.replaceState`. Reconnection uses a session token in `localStorage`, not the URL; `?room=` only pre-fills the join form, so invite links still ask for a name.

Deck sizing defaults to an auto calculation (`recommendedDeckCount` in `round.ts`: ~4 cards/hand × 8 rounds per seat, divided by the 24-card Kvitlach deck -- 2 copies of each of 1-12, not a standard playing-card deck -- capped at 16 decks). A 50-player table auto-selects the 16-deck cap; override via deck input if desired.

## Docker / Compose

```bash
docker-compose -f deploy/docker-compose.yml up --build
```

- Backend (Fastify + WS): ports `3000` (HTTP) and `3001` (WS). Set `PORT`/`WS_PORT` if you need different bindings.
- Frontend (static build): port `8080`. Build-time `VITE_WS_URL` should point at your public WSS endpoint (tunnel/load balancer) when serving from a different host.

Individual Dockerfiles live in `backend/Dockerfile` and `frontend/Dockerfile`. For Cloudflare Tunnel, keep containers bound to localhost and forward via tunnel ingress as noted above.

## Assets

Card art and fonts are stored in `frontend/public/` and shared across the UI.
