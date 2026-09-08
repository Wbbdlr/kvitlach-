---
name: admin-ops
description: Kvitlach admin panel, access lockdown, capacity caps, broadcasts, health endpoints and Uptime Kuma monitors. Use when locking down or reopening the platform, setting an admin password, restricting who can create or join games, changing capacity, or wiring monitoring.
---

# Operating the platform

Setup detail, the `ADMIN_BIND` table and the Kuma monitor list:
[docs/OPERATIONS.md](../../../docs/OPERATIONS.md).

## Setting it up

One paste, no editor - Dockge shows no `.env` editor for this stack:

```bash
cd ~/docker/kvitlach && bash deploy/setup-admin.sh 'username' 'password' 0.0.0.0
```

Third argument is `ADMIN_BIND`: `0.0.0.0` for LAN + Tailscale, `127.0.0.1` for
server-only, or the box's `100.x.y.z` for tailnet-only. Re-run to change the
password; `ADMIN_SESSION_SECRET` is generated once, so re-running does not sign
anyone out. `build-tarball.sh` excludes `.env`, so deploys never overwrite it.

## The `$` trap - this cost an evening

**Docker Compose interpolates `$` in `.env`.** A scrypt hash is
`scrypt$salt$hash`, so both halves were read as undefined variable references,
expanded to nothing, and the backend received the bare word `scrypt`. Every
login failed against a correct password. Compose *did* warn - naming the hex
digest as a missing variable - but the warning scrolled past in a build log.

`setup-admin.sh` now writes **`:` separators**, which nothing interpolates;
`verifyPassword` accepts both forms. `adminAuthFromEnv` logs loudly when the
stored hash is not three parts.

**The general rule: never write a value containing `$` into `deploy/.env`.**
Compose is not the only thing that eats it - `sed`, shells and editors do too.

## Rules that are bugs if broken

- **`room:resume` is never gated, in any access mode.** Resume is how someone
  already seated gets back after their connection blinks; gating it turns
  "stop new load" into "eject everyone mid-hand". Lockdown closes the door; it
  does not empty the building.
- **The admin page has no JavaScript, deliberately.** Every control is a form
  POST then a redirect - no client state to desync, no script that could reach
  the session cookie. Don't add fetch-based controls.
- **`MAX_SEATED_PLAYERS_PER_ROUND = 11` is not a runtime setting** and must not
  become one. It is derived from `layout.ts`'s collision maths and pinned by
  `layout.test.ts`; a web form for it would let the felt be broken from a
  browser. `limits.ts` holds the caps that are safe to change.
- **Access modes and capacity caps persist in the `settings` table and
  override env on boot.** Env vars are boot defaults only - a lockdown must
  survive the restart that usually follows whatever caused it. **Reopening
  means using the panel; editing compose will not do it.**

## Three things not worth rediscovering

- **`/admin` is not reachable at kvitlach.us.** `frontend/nginx.conf` serves
  the SPA and proxies nothing, so that URL renders the React app rather than
  404ing - which reads as a broken admin page. It is on **port 25000**.
- **Kuma 2.5.0 has no write API.** Monitors are GUI-only; both Python wrappers
  were tried against this box and both fail. An hour was spent proving it.
- **There can be no per-person allowlist.** The platform has no accounts, only
  names and per-room session tokens. A shared code is the only "certain
  people" this data model can express.
- **kvitlach's Cloudflare Tunnel config is not in `/etc/cloudflared/`.** It's
  `cloudflared-kvitlach.service` running `/home/adguard/.cloudflared/kvitlach.yml`
  - its own unit, own config, separate from the box's other tunnels. Two wrong
  guesses were made finding this once already. Full ingress table:
  [docs/OPERATIONS.md](../../../docs/OPERATIONS.md#cloudflare-tunnel).
- **The About, Contact and Disclaimer pages are editable from `/admin/about`,
  `/admin/contact`, `/admin/disclaimer`** - no build needed for a wording
  change. See the root `CLAUDE.md`'s code-map entry for the shape (Disclaimer
  is per-section, the other two are one free-text field).
- **`/admin/bot-names` renames the "Play Against the Computer" players** - two
  lists, one per line or comma-separated: the computer banker's names (it draws
  one per table, so the dealer is not the same character every time) and the bot
  seats'. An empty box means "use the built-in list", which is also what Reset
  does. Takes effect on the next practice table; one already in play keeps the
  names it was dealt.

- **The panel's other pages**, all reachable from the top bar: `/admin/rooms/<id>`
  (a table's seats, connections, ledger and round history), `/admin/protections`
  (what the throttles are absorbing), `/admin/errors` (crashes reported by
  players' browsers), `/admin/audit` (who did what, filterable), `/admin/archive`
  (deleted tables' ledgers) and `/admin/appearance` (house felt/chip defaults and
  the win/futch card effects).
- **Capacity, the throttles and the gameplay timings are all live settings now**
  (`limits.ts`, three groups on the panel). Every one is read at the point of use,
  not at boot, so a saved value is the enforced value - keep it that way; a
  limiter that reads its threshold once at startup gives you a panel that reports
  a new limit and enforces the old one. Bounds are fixed in code and the form
  cannot widen them, because every protection can be set to a value that turns it
  off. Pinned by `live-limits.test.ts`.
- **Rotating the Postgres password is `bash deploy/rotate-db-password.sh`**, not
  an edit to `deploy/.env`. `POSTGRES_PASSWORD` only takes effect on a first init
  against an empty volume, so changing the line alone leaves the role untouched
  and breaks `DATABASE_URL` - and the obvious fix for that is `down -v`, which
  destroys the database. The script ALTERs the role first, verifies the new
  password over TCP, then writes `.env`. Run
  `bash deploy/verify-rotate-db-password.sh` before changing it.

## Access model

Each way in is gated separately (`create` / `join` / `practice`), each
`open` | `code` | `closed`, so "anyone can join a table, but only I can start
one" is expressible. Presets set all three; when they disagree the page and
`/health/detail` report `custom`.

## Open TODO - the auth is the weak link

Username + password over cleartext HTTP on the LAN was chosen knowingly as an
interim step. Move it to Tailscale Serve (real HTTPS, tailnet-only hostname), a
Cloudflare Access policy, or client certificates. Until then prefer binding
`ADMIN_BIND` to the Tailscale IP rather than the LAN one.
