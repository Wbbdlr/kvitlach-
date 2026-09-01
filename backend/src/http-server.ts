import { timingSafeEqual } from "node:crypto";
import Fastify, { FastifyRequest } from "fastify";
import type { GameStore } from "./store.js";
import { metrics } from "./metrics.js";
import { AccessControl, isAccessMode, parseCodeList } from "./access.js";

// HTML-text and attribute contexts only. Deliberately NOT sufficient for
// interpolating into a <script> or an inline event handler: the HTML parser
// decodes character references in an attribute value BEFORE the JS engine sees
// it, so an escaped `'` arrives at JS as a real quote and closes the string.
// That is why the delete form below passes the room id through a data-
// attribute and reads it via this.dataset rather than pasting it into the
// confirm() call. Today the room-id regex in store.ts (`^[A-Z0-9-]{4,20}$`)
// makes the difference academic -- but that regex lives in another file, and
// if it were ever loosened this page would hand an attacker the ADMIN_TOKEN
// sitting in its own URL. Don't reintroduce the nesting.
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function isValidToken(provided: unknown): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || typeof provided !== "string" || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch rather than just returning
  // false -- a real match requires equal length anyway, so bail out first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Throttles brute-force ADMIN_TOKEN guessing. Keyed by IP, counts only wrong
// guesses (a legitimate admin clicking Delete repeatedly never trips it).
// Bounded to a small tracked-IP set since this is a single-tenant home
// deploy, not internet-scale -- a cheap sweep on overflow is enough.
const MAX_ADMIN_ATTEMPTS = 20;
const ADMIN_ATTEMPT_WINDOW_MS = 5 * 60_000;
const MAX_TRACKED_IPS = 500;
const adminAttempts = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const fromHeader = Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;
  return fromHeader || request.ip || "unknown";
}

function isRateLimited(ip: string): boolean {
  const entry = adminAttempts.get(ip);
  return Boolean(entry && Date.now() < entry.resetAt && entry.count >= MAX_ADMIN_ATTEMPTS);
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  if (adminAttempts.size >= MAX_TRACKED_IPS) {
    for (const [key, entry] of adminAttempts) {
      if (now > entry.resetAt) adminAttempts.delete(key);
    }
    // The sweep only frees ENTRIES THAT EXPIRED, so it frees nothing at all
    // when every tracked IP is still inside its window -- and the set below
    // then grew the map past the cap anyway, once per new IP, without limit.
    // Rotating addresses already evades a per-IP throttle (the comment above
    // says as much), so this was never the thing keeping an attacker out; it
    // was just memory they could spend on a public endpoint. Evicting the
    // entry closest to expiry makes the cap real, and costs the attacker
    // nothing they weren't already getting.
    if (adminAttempts.size >= MAX_TRACKED_IPS) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [key, entry] of adminAttempts) {
        if (entry.resetAt < oldestAt) {
          oldestAt = entry.resetAt;
          oldestKey = key;
        }
      }
      if (oldestKey !== undefined) adminAttempts.delete(oldestKey);
    }
  }
  const entry = adminAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    adminAttempts.set(ip, { count: 1, resetAt: now + ADMIN_ATTEMPT_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function formatIdle(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function renderAdminPage(store: GameStore, access: AccessControl, token: string): string {
  const rooms = store.listRoomsForAdmin().sort((a, b) => a.lastActivityAt - b.lastActivityAt);
  const rows = rooms
    .map((r) => {
      const idleMs = Date.now() - r.lastActivityAt;
      return `<tr>
        <td><code>${escapeHtml(r.roomId)}</code></td>
        <td>${escapeHtml(r.name ?? "")}</td>
        <td>${r.playerCount}</td>
        <td>${r.completedRounds}</td>
        <td>${r.hasActiveRound ? "yes" : "no"}</td>
        <td>${formatIdle(idleMs)}</td>
        <td>
          <form method="post" action="/admin/rooms/${encodeURIComponent(r.roomId)}/delete?token=${encodeURIComponent(token)}"
                data-room="${escapeHtml(r.roomId)}"
                onsubmit="return confirm('Delete room ' + this.dataset.room + '? This frees the Game ID immediately and cannot be undone.');">
            <button type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
    })
    .join("\n");

  const snap = access.snapshot();
  const modeButton = (mode: string, label: string, hint: string) => `
    <form method="post" action="/admin/access?token=${encodeURIComponent(token)}" class="mode">
      <input type="hidden" name="mode" value="${mode}" />
      <button type="submit" class="${snap.mode === mode ? "on" : ""}" ${snap.mode === mode ? "disabled" : ""}>${escapeHtml(label)}</button>
      <span class="meta">${escapeHtml(hint)}</span>
    </form>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Kvitlach admin</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.25rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e7eb; font-size: 0.9rem; }
  th { color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; }
  button { background: #dc2626; color: white; border: none; border-radius: 4px; padding: 0.35rem 0.75rem; cursor: pointer; font-size: 0.85rem; }
  button:hover { background: #b91c1c; }
  .empty { color: #6b7280; margin-top: 1rem; }
  .meta { color: #6b7280; font-size: 0.85rem; }
  fieldset { border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem 1rem 1rem; margin: 0 0 1.5rem; }
  legend { font-size: 0.75rem; text-transform: uppercase; color: #6b7280; font-weight: 600; }
  .mode { display: flex; align-items: center; gap: 0.75rem; margin: 0.4rem 0; }
  .mode button { background: #374151; min-width: 7rem; }
  .mode button:hover { background: #111827; }
  .mode button.on { background: #047857; cursor: default; opacity: 1; }
  textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 0.85rem; padding: 0.4rem; }
  .save { background: #1d4ed8; margin-top: 0.5rem; }
  .save:hover { background: #1e40af; }
</style>
</head>
<body>
  <fieldset>
    <legend>Access &mdash; currently <b>${snap.mode}</b></legend>
    <p class="meta">Takes effect immediately, no restart, and survives one. Never affects a game already
    in progress: reconnecting to a table you are already seated at is not gated.</p>
    ${modeButton("open", "Open", "Anyone can create, join and practise.")}
    ${modeButton("invite", "Invite only", `A code is required to create, join or practise. ${snap.codeCount} code(s) set.`)}
    ${modeButton("closed", "Closed", "No new games at all. Use this when the box is struggling.")}
    <form method="post" action="/admin/access?token=${encodeURIComponent(token)}">
      <label class="meta" for="codes">Access codes &mdash; one per line. Case-insensitive.</label>
      <textarea id="codes" name="codes" rows="4" placeholder="one code per line"></textarea>
      <button type="submit" class="save">Replace codes</button>
      <span class="meta">Existing codes are not shown. Saving replaces the whole list.</span>
    </form>
  </fieldset>

  <h1>Active rooms (${rooms.length})</h1>
  <p class="meta">Rooms auto-expire after 3 days of inactivity. Deleting one here frees its Game ID immediately.</p>
  ${rooms.length === 0 ? '<p class="empty">No active rooms.</p>' : `
  <table>
    <thead>
      <tr><th>Game ID</th><th>Name</th><th>Players</th><th>Rounds</th><th>Round active</th><th>Idle</th><th></th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`}
</body>
</html>`;
}

export function createHttpServer(store: GameStore, access: AccessControl = new AccessControl()) {
  const app = Fastify({
    logger: {
      // The admin routes carry ADMIN_TOKEN as a query param (the plain-HTML
      // admin page has no JS to send it as a header instead) -- redact it
      // here so it doesn't sit in cleartext in the server's own access logs.
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url.replace(/([?&]token=)[^&]+/, "$1[redacted]"),
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    },
  });
  // Counts every response this server sends, /metrics's own scrapes
  // included -- that's normal for a self-counting endpoint and not worth
  // special-casing.
  app.addHook("onResponse", async () => {
    metrics.recordHttpRequest();
  });

  // Fastify parses JSON and text out of the box but NOT form encoding, and
  // the admin page is deliberately plain HTML with no JS (see escapeHtml's
  // comment), so its forms post urlencoded bodies. Six lines of
  // URLSearchParams rather than pulling in @fastify/formbody -- same call
  // this project already made in metrics.ts about prom-client.
  //
  // The 1 KiB cap is well clear of the largest real body (a code list) and
  // keeps an unauthenticated POST from being a place to push bulk at us; the
  // token check still runs afterwards either way.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 1024 },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  app.get("/health", async () => ({ status: "ok" }));

  // Uptime Kuma's Json Query monitor type reads ONE JSON document and
  // compares a JSONPath expression against an expected value, so "is it up"
  // and "is it drowning" have to be answerable from the same response. Hence
  // a flat object of plain numbers rather than the Prometheus text /metrics
  // serves (Kuma cannot threshold on that).
  //
  // Unauthenticated for the same reason /metrics is: aggregate counts only,
  // no room IDs or player data, and the backend HTTP port is not exposed
  // publicly (see deploy/docker-compose.yml). `accessMode` is here so a
  // monitor can alert on the site having been left locked down.
  app.get("/health/detail", async () => {
    const load = store.loadSnapshot();
    return {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      rooms: load.rooms,
      practiceRooms: load.practiceRooms,
      players: load.players,
      activeRounds: load.activeRounds,
      wsConnections: metrics.currentWsConnections,
      eventLoopLagMs: Math.round(metrics.eventLoopLagMs),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      accessMode: access.getMode(),
    };
  });

  // Unauthenticated, like /health: this only ever exposes aggregate counts
  // (no room IDs, no player data), and a Prometheus scraper expects to hit
  // it without a token. The backend HTTP port is only reachable from
  // localhost/the Docker network anyway (see deploy/docker-compose.yml),
  // not the public internet.
  app.get("/metrics", async (request, reply) => {
    metrics.setRoomGauges(store.loadSnapshot());
    reply.type("text/plain; version=0.0.4; charset=utf-8").send(metrics.render());
  });

  // Token-gated admin tooling for freeing up stuck/stale Game IDs -- routes
  // only do anything useful when ADMIN_TOKEN is set. Requests without a
  // valid token get a plain 404 rather than 401/403, so an unauthenticated
  // probe can't even confirm the route exists. A per-IP attempt throttle
  // guards against brute-forcing the token itself.
  app.get("/admin", async (request, reply) => {
    const ip = getClientIp(request);
    if (isRateLimited(ip)) return reply.code(404).send("Not found");
    const token = (request.query as Record<string, unknown>)?.token;
    if (!isValidToken(token)) {
      recordFailedAttempt(ip);
      return reply.code(404).send("Not found");
    }
    reply.type("text/html").send(renderAdminPage(store, access, token as string));
  });

  app.post<{ Params: { roomId: string } }>("/admin/rooms/:roomId/delete", async (request, reply) => {
    const ip = getClientIp(request);
    if (isRateLimited(ip)) return reply.code(404).send("Not found");
    const token = (request.query as Record<string, unknown>)?.token;
    if (!isValidToken(token)) {
      recordFailedAttempt(ip);
      return reply.code(404).send("Not found");
    }
    store.forceDeleteRoom(request.params.roomId);
    reply.redirect(`/admin?token=${encodeURIComponent(token as string)}`);
  });

  // One route for both controls on the panel: the mode buttons post `mode`,
  // the textarea posts `codes`, and neither form carries the other's field.
  // Sending only what changed means saving codes cannot silently reset the
  // mode, and vice versa.
  app.post("/admin/access", async (request, reply) => {
    const ip = getClientIp(request);
    if (isRateLimited(ip)) return reply.code(404).send("Not found");
    const token = (request.query as Record<string, unknown>)?.token;
    if (!isValidToken(token)) {
      recordFailedAttempt(ip);
      return reply.code(404).send("Not found");
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (isAccessMode(body.mode)) access.setMode(body.mode);
    if (typeof body.codes === "string") access.setCodes(parseCodeList(body.codes));
    reply.redirect(`/admin?token=${encodeURIComponent(token as string)}`);
  });

  return app;
}
