import { timingSafeEqual } from "node:crypto";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import type { GameStore } from "./store.js";
import { metrics } from "./metrics.js";
import { AccessControl, isAccessMode, isActionMode, parseCodeList } from "./access.js";
import type { GatedAction } from "./access.js";
import { GATED_ACTIONS } from "./access.js";
import { AboutContent } from "./about.js";
import { RuntimeLimits, isLimitKey } from "./limits.js";
import { AdminAuth } from "./admin-auth.js";
import { renderAdminPage, renderLoginPage } from "./admin-page.js";

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

export interface HttpServerDeps {
  access?: AccessControl;
  limits?: RuntimeLimits;
  /** Operator-authored About copy. Read by a PUBLIC route, unlike everything
   *  else on this server -- see GET /api/about. */
  about?: AboutContent;
  auth?: AdminAuth;
  /** Set by index.ts once the WS server exists; the broadcast form needs it.
   *  `roomId` targets one table; omitted, every table. */
  broadcast?: (text: string, level: "info" | "warning", roomId?: string) => number;
  /** Origin of the player-facing app, for the admin panel's Watch links.
   *  The panel is on port 25000 and the app is behind the tunnel, so the
   *  panel cannot build a working table URL from its own request host. */
  appUrl?: string;
  /** Mints the per-room grant the panel's Watch links carry. Wired to the WS
   *  server, which is the only thing that can redeem one. */
  watchToken?: (roomId: string) => string;
}

export function createHttpServer(store: GameStore, deps: HttpServerDeps | AccessControl = {}) {
  // Older callers (and every existing test) pass an AccessControl positionally.
  const opts: HttpServerDeps = deps instanceof AccessControl ? { access: deps } : deps;
  const access = opts.access ?? new AccessControl();
  const limits = opts.limits ?? new RuntimeLimits();
  const about = opts.about ?? new AboutContent();
  const auth = opts.auth ?? new AdminAuth();
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

  // The ONE public route on this server. Everything else here is admin or
  // operator telemetry and is protected by ADMIN_BIND defaulting to localhost;
  // this is reached from a browser, via an exact-path nginx proxy on the
  // frontend origin (frontend/nginx.conf). Exact path, GET only, no auth, and
  // it returns nothing that is not already meant for the About page -- widen
  // that proxy and the admin panel goes public with it.
  app.get("/api/about", async (_request, reply) => {
    const record = about.toRecord();
    // A minute of caching: the copy changes when an operator edits it, which is
    // rarely, and the About page should not wait on the backend to paint.
    reply.header("cache-control", "public, max-age=60");
    return record;
  });

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
  // Two ways in, both landing on the same session check.
  //
  //  - ADMIN_USERNAME + ADMIN_PASSWORD(_HASH): a login form and a signed
  //    session cookie. This is what makes the page usable from another
  //    machine, since a query-string token would then sit in proxy logs,
  //    browser history and Referer headers.
  //  - ADMIN_TOKEN in the query string: the original mechanism, kept because
  //    it works from a shell with curl and because removing it would lock out
  //    a deploy that has only ever had the token set.
  //
  // Neither being configured leaves the whole panel 404ing, which is the
  // default. A wrong credential returns 404 as well, so an unauthenticated
  // probe cannot even confirm the route exists -- meaning a 404 says nothing
  // about WHICH of the two is wrong. That is deliberate, and it is also the
  // single most confusing thing about this page when setting it up.
  const authorized = (request: FastifyRequest): "session" | "token" | undefined => {
    if (auth.verifySession(request.headers.cookie)) return "session";
    const token = (request.query as Record<string, unknown>)?.token;
    if (isValidToken(token)) return "token";
    return undefined;
  };

  // Token callers must keep carrying the token on every form POST; cookie
  // callers must not have it appended, or it would end up in their history.
  const carry = (request: FastifyRequest, how: "session" | "token"): string =>
    how === "token"
      ? `?token=${encodeURIComponent(String((request.query as Record<string, unknown>).token))}`
      : "";

  const guard = (request: FastifyRequest, reply: FastifyReply): "session" | "token" | undefined => {
    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      void reply.code(404).send("Not found");
      return undefined;
    }
    const how = authorized(request);
    if (!how) {
      recordFailedAttempt(ip);
      // A login form instead of a 404, but only when a username is actually
      // configured -- otherwise the 404 has to stay total, or its presence
      // would advertise the route to anyone who asks.
      if (auth.enabled) void reply.code(401).type("text/html").send(renderLoginPage());
      else void reply.code(404).send("Not found");
      return undefined;
    }
    return how;
  };

  app.get("/admin", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const query = request.query as Record<string, unknown>;
    return reply.type("text/html").send(
      renderAdminPage({
        store,
        access,
        limits,
        about,
        query: carry(request, how),
        // On unless explicitly stopped. An operator opens this page to watch
        // load, and a stale page is worse than useless -- it is misleading.
        refresh: query.refresh !== "0",
        appUrl: opts.appUrl,
        watchToken: opts.watchToken,
        notice: typeof query.ok === "string" ? query.ok.slice(0, 120) : undefined,
      })
    );
  });

  app.post("/admin/login", async (request, reply) => {
    const ip = getClientIp(request);
    if (isRateLimited(ip)) return reply.code(404).send("Not found");
    if (!auth.enabled) return reply.code(404).send("Not found");
    const body = (request.body ?? {}) as Record<string, unknown>;
    const session = auth.login(body.username, body.password);
    if (!session) {
      recordFailedAttempt(ip);
      return reply.code(401).type("text/html").send(renderLoginPage("Wrong username or password."));
    }
    return reply.header("set-cookie", auth.cookieHeader(session)).redirect("/admin");
  });

  app.post("/admin/logout", async (_request, reply) =>
    reply.header("set-cookie", auth.clearedCookieHeader()).code(200).type("text/html").send(renderLoginPage("Signed out."))
  );

  app.post<{ Params: { roomId: string } }>("/admin/rooms/:roomId/delete", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    store.forceDeleteRoom(request.params.roomId);
    return reply.redirect(`/admin${carry(request, how)}`);
  });

  // One route for every access control on the page. Each form posts only its
  // own field, so applying a preset cannot silently wipe the codes, changing
  // one action cannot reset the other two, and saving codes cannot reopen a
  // locked-down platform.
  app.post("/admin/access", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (isAccessMode(body.mode)) access.setMode(body.mode);
    if (typeof body.action === "string" && GATED_ACTIONS.includes(body.action as GatedAction) && isActionMode(body.actionMode)) {
      access.setActionMode(body.action as GatedAction, body.actionMode);
    }
    if (typeof body.codes === "string") access.setCodes(parseCodeList(body.codes));
    return reply.redirect(`/admin${carry(request, how)}`);
  });

  app.post("/admin/limits", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body.reset === "1") limits.resetToDefaults();
    else if (isLimitKey(body.key)) limits.set(body.key, body.value);
    return reply.redirect(`/admin${carry(request, how)}`);
  });

  app.post("/admin/about", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const changed = body.clear === "1" ? about.clear() : about.set(body.heading, body.body);
    const note = changed ? "About page updated." : "No change.";
    const sep = carry(request, how) ? "&" : "?";
    return reply.redirect(`/admin${carry(request, how)}${sep}ok=${encodeURIComponent(note)}`);
  });

  app.post("/admin/broadcast", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 200) : "";
    const level = body.level === "warning" ? "warning" : "info";
    // "" is the All tables option. Anything else targets that room only, and
    // an id that no longer exists delivers to nobody rather than to everyone.
    const roomId = typeof body.roomId === "string" && body.roomId.trim() ? body.roomId.trim() : undefined;
    const sent = text && opts.broadcast ? opts.broadcast(text, level, roomId) : 0;
    const where = roomId ? `table ${roomId}` : "all tables";
    const note = !text
      ? "Nothing to send."
      : !opts.broadcast
        ? "No WebSocket server attached; nothing sent."
        : `Sent to ${sent} connection(s) on ${where}.`;
    const sep = carry(request, how) ? "&" : "?";
    return reply.redirect(`/admin${carry(request, how)}${sep}ok=${encodeURIComponent(note)}`);
  });

  return app;
}
