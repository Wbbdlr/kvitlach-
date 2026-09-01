# Operating the platform

Lockdown and monitoring reference. CLAUDE.md keeps the one rule that is a bug
if broken; the setup detail lives here because it is needed once, not every
session.

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
