# Operating the platform

The admin panel and what it controls. CLAUDE.md keeps only the rules that are
bugs if broken; the setup detail lives here because it is needed once.

## Reaching the admin panel

**It is not on `kvitlach.us`.** `frontend/nginx.conf` serves the SPA only and
proxies nothing, and the backend's HTTP port is not carried by the tunnel.
Asking for `https://kvitlach.us/admin` gets the React app via the SPA
catch-all, which looks like the admin page is broken when it was never there.

The panel is on **port 25000**, and `ADMIN_BIND` in `deploy/.env` decides who
can reach it:

| `ADMIN_BIND` | reachable from | notes |
|---|---|---|
| `127.0.0.1` (default) | the server itself | browser on the box, or `ssh -L 25000:127.0.0.1:25000 …` |
| `100.x.y.z` (Tailscale IP) | the tailnet | encrypted end to end by WireGuard. Safest option that works off-site. |
| `192.168.50.23` | the LAN | login crosses the wire as **cleartext HTTP** |
| `0.0.0.0` | LAN **and** tailnet | the only way to get both from one mapping |

**Port 25000 also serves `/health`, `/health/detail` and `/metrics`.** Anything
that can reach the panel can read those. None of these bindings creates public
exposure on their own — nothing forwards 25000 from the router and the tunnel
only carries the frontend — but `0.0.0.0` covers every *future* interface too,
so re-check it if this box ever joins another network.

> **TODO — replace password auth with something stronger.** A username and
> password over plain HTTP on the LAN is the weak link here, and it is
> deliberate and temporary. Better options, roughly in order of effort:
> Tailscale Serve (gives it real HTTPS and a tailnet-only hostname for free),
> a Cloudflare Access policy in front of it, or client certificates. Until one
> of those lands, prefer `ADMIN_BIND` = the Tailscale IP over the LAN IP.

## Turning it on

The panel **404s entirely** unless credentials are configured, which is the
default. A wrong password also returns 401 and a wrong token 404, so an
unauthenticated probe cannot confirm what exists — meaning the response tells
you nothing about *which* thing is misconfigured.

Two mechanisms, either works:

- **Username + password** (use this): `ADMIN_USERNAME` plus
  `ADMIN_PASSWORD_HASH`. Gives a login form and a signed session cookie
  lasting 12 hours. `ADMIN_PASSWORD` (plaintext) also works and warns on every
  boot. Set `ADMIN_SESSION_SECRET` to keep sessions alive across restarts;
  unset means a fresh random secret per boot, so a restart signs you out.
- **`ADMIN_TOKEN` in the query string**: the original mechanism, kept because
  it works from a shell with `curl`. Do not use it once the port is reachable
  from other machines — a token in the URL is a token in every proxy log,
  browser history entry and `Referer` header.

**One paste sets everything up** — no editor, which matters because Dockge
only shows the compose and `.env` files for stacks inside its own stacks
directory, and this one lives in `~/docker/kvitlach`:

```bash
cd ~/docker/kvitlach && bash deploy/setup-admin.sh 'yourname' 'your password' 0.0.0.0
```

It hashes the password (inside the running container, so the host needs no
node), writes `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_BIND` and a
generated `ADMIN_SESSION_SECRET` into `deploy/.env`, clears any stale
`ADMIN_TOKEN`, restarts the backend and prints the URLs to open. Re-run it to
change the password; the session secret is only generated once, so re-running
does not sign you out. `build-tarball.sh` excludes `.env`, so deploys never
overwrite it.

The third argument is `ADMIN_BIND` and defaults to `0.0.0.0`. Pass `127.0.0.1`
for server-only, or the box's `100.x.y.z` for tailnet-only.

## What the panel does

- **Load** — rooms (against the current cap), players, live rounds, WS
  connections, event-loop lag, memory, uptime. `auto-refresh` toggles a 15s
  meta refresh; it is opt-in because refreshing while someone is typing a list
  of access codes would eat it.
- **Who can play** — presets and per-action modes, below.
- **Capacity** — max rooms, max practice rooms, max players per room, live.
  Lowering a cap never evicts anyone; it refuses the next one over the line.
- **Broadcast** — pushes a banner to everyone currently at a table. Not
  stored, so someone joining afterwards will not see it.
- **Rooms** — busiest first, with banker, player/bot/waiting counts, rounds
  played, whether a round is live, idle time, and force-delete to free a
  stuck Game ID.

**`eventLoopLagMs` is the number to watch.** Everything in this server — every
room timer, every WS frame, every broadcast — runs on one event loop, so lag
climbs while players are already seeing turns land late, well before memory or
room count look alarming.

## Access control (`backend/src/access.ts`)

Each way in is gated separately, so "anyone can join a table, but only I can
start one" is expressible — set **Start a table** to *Needs a code* and leave
the other two on *Anyone*.

| per action | meaning |
|---|---|
| `open` | anyone |
| `code` | one of the access codes is required |
| `closed` | nobody |

The presets set all three at once: **Open** (all `open`), **Invite only** (all
`code`), **Closed** (all `closed`). When the three disagree the page and
`/health/detail` both report `custom`.

- Changes apply immediately, no restart, and **persist in the `settings`
  table, overriding the env defaults on boot** — a lockdown must survive the
  restart that usually follows whatever caused it. `ACCESS_MODE` /
  `ACCESS_CODES` / `MAX_ROOMS` etc. are boot defaults only. **To reopen, set
  it back in the panel; editing compose will not do it.**
- `MAINTENANCE_MODE=true` still works and maps to all-`closed`.
- Codes are case-insensitive and trimmed (they get read down a phone line),
  compared without short-circuiting, capped at 200 codes of 64 chars. Existing
  codes are never displayed; saving replaces the whole list.
- **There is no per-person allowlist and cannot be**: the platform has no
  accounts, only names and per-room session tokens. A shared code is the only
  "certain people" this data model can express.
- Client side: the lobby shows an access-code field **only after** the server
  refuses. The mode is never published to unauthenticated clients, so the
  client cannot know in advance; the error lands on whichever of the three
  forms was actually submitted.

Rate limits are separate and still fixed in code: 80 connections/IP and 30
messages/10s (`ws-server.ts`).

## Health endpoints

- `GET /health` — `{"status":"ok"}`.
- `GET /health/detail` — flat JSON for Kuma's **Json Query** monitor, the only
  type that can threshold on a number: `rooms`, `practiceRooms`, `players`,
  `activeRounds`, `wsConnections`, `eventLoopLagMs`, `rssMb`, `uptimeSeconds`,
  `accessMode`.
- `GET /metrics` — the same gauges as Prometheus text.

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

Those thresholds match the panel's own colour bands on purpose — the page and
the alert should not disagree about what "bad" means. The last monitor is a
reminder, not an outage: it goes red whenever access is restricted, so a
lockdown flipped at 2am cannot be forgotten.
