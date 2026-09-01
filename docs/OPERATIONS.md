# Operating the platform

Lockdown and monitoring reference. CLAUDE.md keeps the one rule that is a bug
if broken; the setup detail lives here because it is needed once, not every
session.

## Reaching the admin panel

**It is not on `kvitlach.us`.** `frontend/nginx.conf` serves the SPA only and
proxies nothing, and the backend's HTTP port is published as
`127.0.0.1:25000` — localhost on the server, and nowhere else. Asking for
`https://kvitlach.us/admin` gets the React app via the SPA catch-all, which
looks like the admin page is broken when it was never there. The tunnel
carries `kvitlach.us` → frontend and `ws.kvitlach.us` → 25001; port 25000 has
no public route at all, deliberately.

So: **open a browser on the server itself** (the RDP session) and go to
`http://127.0.0.1:25000/admin?token=$ADMIN_TOKEN`. From a workstation, an SSH
port-forward (`ssh -L 25000:127.0.0.1:25000 …`) reaches the same place. Do not
"fix" this by publishing 25000 or adding an nginx proxy — the token travels in
the query string, which is exactly why the port stays local.

**Every admin route 404s when `ADMIN_TOKEN` is unset**, which is the default.
A wrong or missing token also returns 404 rather than 401/403, so an
unauthenticated probe cannot even confirm the route exists — meaning "404"
tells you nothing about which of the two is wrong. Set it in
`deploy/.env` (compose reads that file automatically, and
`build-tarball.sh` excludes `.env`, so a deploy will not overwrite it):

```bash
cd ~/docker/kvitlach/deploy && grep -q '^ADMIN_TOKEN=' .env 2>/dev/null || echo "ADMIN_TOKEN=$(openssl rand -hex 24)" >> .env; docker compose up -d backend && echo "http://127.0.0.1:25000/admin?token=$(grep '^ADMIN_TOKEN=' .env | cut -d= -f2)"
```

The panel is plain HTML with no JavaScript on purpose (see `escapeHtml`'s
comment in `http-server.ts`). It lists rooms with a force-delete for stuck
Game IDs, and carries the access-mode controls below.

## Access control (`backend/src/access.ts`)

Three modes, changed from **`/admin?token=$ADMIN_TOKEN`** with no restart:

| mode | create | join | practice | resume |
|---|---|---|---|---|
| `open` | yes | yes | yes | yes |
| `invite` | code | code | code | **yes** |
| `closed` | no | no | no | **yes** |

- The mode and codes persist in the `settings` table and **reload on boot,
  overriding the env defaults** — a lockdown must survive the restart that
  usually follows whatever caused it. `ACCESS_MODE` / `ACCESS_CODES` in
  `docker-compose.yml` are boot defaults only.
- `MAINTENANCE_MODE=true` still works and maps to `closed`.
- Codes are case-insensitive and trimmed (they get read down a phone line),
  compared without short-circuiting, capped at 200 codes of 64 chars.
- **There is no per-person allowlist and cannot be**: the platform has no
  accounts, only names and per-room session tokens. A shared code is the only
  "certain people" this data model can express.
- Client side: the lobby shows an access-code field **only after** the server
  refuses with `invite_required` / `invalid_invite`. The mode is never
  published to unauthenticated clients, so the client cannot know in advance.

Capacity caps predate this and are separate: 150 rooms, 25 practice rooms, 100
players/room (`store.ts`), 80 connections/IP and 30 messages/10s
(`ws-server.ts`).

## Health endpoints

- `GET /health` — `{"status":"ok"}`.
- `GET /health/detail` — one flat JSON object for Kuma's **Json Query** monitor
  type, the only one that can threshold on a number: `rooms`, `practiceRooms`,
  `players`, `activeRounds`, `wsConnections`, `eventLoopLagMs`, `rssMb`,
  `uptimeSeconds`, `accessMode`.
- `GET /metrics` — the same gauges as Prometheus text, alongside the
  pre-existing counters.

**`eventLoopLagMs` is the one to watch for overload.** Everything in this
server — every room timer, every WS frame, every broadcast — runs on the one
event loop, so lag climbs while players are already seeing turns land late,
well before CPU or RSS look alarming.

## Uptime Kuma

Kuma runs on the adguard box at `uptime.swdhs.com` / `127.0.0.1:3001`.

**Kuma 2.5.0 has no write API — monitors are created in the GUI, by hand.**
Both Python wrappers were tried against this box and both fail; roughly an hour
has been spent proving it. See `homeserver/CLAUDE.md` item 3. Do not attempt to
automate monitor creation.

Host is `192.168.50.23:25000`, **not** `127.0.0.1` — inside the Kuma container
that is the container itself. No port conflict: Kvitlach is on 25000/25001,
Kuma on 3001.

| type | URL | json query | expect |
|---|---|---|---|
| HTTP(s) | `http://192.168.50.23:25000/health` | — | 200 |
| Json Query | `http://192.168.50.23:25000/health/detail` | `$.eventLoopLagMs` | `< 250` |
| Json Query | `http://192.168.50.23:25000/health/detail` | `$.wsConnections` | `< 300` |
| Json Query | `http://192.168.50.23:25000/health/detail` | `$.accessMode` | `== "open"` |

The last one is a reminder, not an outage: it goes red while the platform is
deliberately locked down, so a lockdown flipped at 2am cannot be forgotten.
