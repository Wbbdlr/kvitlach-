# Kvitlach

Modern take on the Hanukkah-era twenty-one variant featuring a dedicated banker. The active stack is Node.js (Fastify + WebSocket) for the backend and React + Vite + Tailwind for the frontend. Legacy Phoenix/Elixir files remain in the repo for historical reference only.

## Table of Contents
- [Features](#features)
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
- WebSocket-driven gameplay loop with cumulative betting (`Bet` adds to the wager and deals a card) alongside classic `Hit`, `Stand`, and `Skip`, plus bank showdown logic.
- Pre-bet "Blatt" draws let players view cards for free; multiple Blatts are allowed before wagering.
- Card visibility rules: owners always see their own hands; busted/winning/standby hands reveal to everyone; the banker’s first card stays hidden until resolution; banker totals reveal in final/terminate states.
- Banker controls: approve/deny rename and chip requests, top up or drain the bank, adjust any player wallet (with notes), kick players, and end the round when the bank is depleted.
- Round tracking and history: infinite round log with timestamps, balance history, queued-player indicators, banker showdown summary, and notifications for approvals/adjustments.

## Project Structure

```text
backend/   Fastify WebSocket API, game logic, Vitest unit tests
frontend/  React + Vite client, Zustand state, Tailwind styling
deploy/    docker-compose.yml for combined frontend/backend builds
legacy     Root-level Phoenix files retained for reference only
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

Backend unit tests cover turn/round resolution:

```bash
cd backend
npm test
```

Frontend behaviour is currently verified manually; add Vitest/Playwright coverage as the UI stabilises.

Run the Monte Carlo fairness simulator (100k rounds per deck by default) to inspect the Banker/Player edge:

```bash
cd backend
npm run simulate
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

Key message types:
- Client: `room:create`, `room:join`, `room:switch-admin`, `room:get`, `round:start`, `round:get`, `round:banker-end`, `turn:bet`, `turn:hit`, `turn:stand`, `turn:skip`, rename (`player:rename-request|approve|reject|block|cancel`), buy-in (`player:buyin-request|approve|reject|block|cancel`), admin tools (`player:kick`, `player:bank-adjust`), and `room:banker-topup`.
- Server: `room:state`, `round:state`, `round:ended`, `round:banker-ended`, `room:banker-topup`, `player:bank-adjusted`, `ack`, `error`.

Deck sizing defaults to an auto calculation (≈ six cards per seat plus buffer, capped at 16 decks). A 50-player table auto-selects 7 decks; override via deck input if desired.

## Docker / Compose

```bash
docker-compose -f deploy/docker-compose.yml up --build
```

- Backend (Fastify + WS): ports `3000` (HTTP) and `3001` (WS). Set `PORT`/`WS_PORT` if you need different bindings.
- Frontend (static build): port `8080`. Build-time `VITE_WS_URL` should point at your public WSS endpoint (tunnel/load balancer) when serving from a different host.

Individual Dockerfiles live in `backend/Dockerfile` and `frontend/Dockerfile`. For Cloudflare Tunnel, keep containers bound to localhost and forward via tunnel ingress as noted above.

## Assets

Card art and fonts are stored in `frontend/public/` and shared across the UI.
