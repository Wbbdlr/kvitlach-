import { timingSafeEqual } from "node:crypto";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import type { GameStore } from "./store.js";
import { metrics } from "./metrics.js";
import { AccessControl, isAccessMode, isActionMode, parseCodeList } from "./access.js";
import type { GatedAction } from "./access.js";
import { GATED_ACTIONS } from "./access.js";
import { AboutContent } from "./about.js";
import { ContactContent } from "./contact.js";
import { DisclaimerContent, isDisclaimerSlug } from "./disclaimer.js";
import { RuntimeLimits, isLimitKey } from "./limits.js";
import { AdminAuth } from "./admin-auth.js";
import { renderAboutEditor, renderAdminPage, renderBotNamesEditor, renderContactEditor, renderDisclaimerEditor, renderLoginPage, renderClientErrorsPage, renderProtectionsPage, renderRoomDetail } from "./admin-page.js";
import type { ProtectionSnapshot } from "./ws-server.js";
import { ClientErrorLog } from "./client-errors.js";
import { resolveClientIp } from "./client-ip.js";

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
// Cumulative since boot, for the panel's Protections page.
//
// adminAttempts above is per-window and forgets on purpose: an IP that burned
// through twenty guesses an hour ago leaves no entry behind. That is right for
// the throttle and wrong for the operator, whose question is about the hour
// that already happened.
const adminAttemptTotals = { failures: 0, blocked: 0, lastAt: 0, lastIp: undefined as string | undefined };

/**
 * The admin-login throttle's own live state, for the Protections page.
 *
 * Exported from this module rather than passed in as a dep because the map it
 * reads is this module's, and the route rendering it is this module's too --
 * a getter injected from index.ts would be a longer way round to the same
 * object with one more place for the two to drift apart.
 */
export type AdminLoginSnapshot = ReturnType<typeof adminLoginSnapshot>;

export function adminLoginSnapshot(top = 25) {
  const now = Date.now();
  return {
    limit: MAX_ADMIN_ATTEMPTS,
    windowMs: ADMIN_ATTEMPT_WINDOW_MS,
    ...adminAttemptTotals,
    tracked: adminAttempts.size,
    ips: Array.from(adminAttempts.entries())
      .filter(([, entry]) => entry.resetAt > now)
      .map(([ip, entry]) => ({ ip, count: entry.count, resetAt: entry.resetAt, blocked: entry.count >= MAX_ADMIN_ATTEMPTS }))
      .sort((a, b) => b.count - a.count || a.ip.localeCompare(b.ip))
      .slice(0, top),
  };
}

function getClientIp(request: FastifyRequest): string {
  return resolveClientIp(request.headers, request.ip);
}

function isRateLimited(ip: string): boolean {
  const entry = adminAttempts.get(ip);
  const limited = Boolean(entry && Date.now() < entry.resetAt && entry.count >= MAX_ADMIN_ATTEMPTS);
  if (limited) adminAttemptTotals.blocked += 1;
  return limited;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  adminAttemptTotals.failures += 1;
  adminAttemptTotals.lastAt = now;
  adminAttemptTotals.lastIp = ip;
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
  /** Same as `about`, for the Contact page -- see GET /api/contact. */
  contact?: ContactContent;
  /** Per-section overrides for the Disclaimer page -- see GET /api/disclaimer. */
  disclaimer?: DisclaimerContent;
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
  /** Live throttle state for the Protections page. Wired to the WS server,
   *  which owns three of the four limiters; the fourth (admin login) lives in
   *  this module. Omitted, the page renders the login throttle alone and says
   *  so rather than showing four empty tables. */
  protections?: (top?: number) => ProtectionSnapshot;
  /** Injectable only so tests can assert against the same instance the route
   *  writes to. Left out, the server owns its own. */
  clientErrors?: ClientErrorLog;
}

export function createHttpServer(store: GameStore, deps: HttpServerDeps | AccessControl = {}) {
  // Older callers (and every existing test) pass an AccessControl positionally.
  const opts: HttpServerDeps = deps instanceof AccessControl ? { access: deps } : deps;
  const access = opts.access ?? new AccessControl();
  const limits = opts.limits ?? new RuntimeLimits();
  const about = opts.about ?? new AboutContent();
  const contact = opts.contact ?? new ContactContent();
  const disclaimer = opts.disclaimer ?? new DisclaimerContent();
  // Deliberately the STORE's own instance rather than a dep of its own: the
  // panel has to edit the very object createPracticeRoom reads, or an operator
  // saves a list that nothing uses and nothing says why.
  const botNames = store.botNames;
  const auth = opts.auth ?? new AdminAuth();
  // Owned here rather than injected: nothing outside this file writes to it,
  // and the route that fills it and the route that reads it are both here.
  const clientErrors = opts.clientErrors ?? new ClientErrorLog();
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
  // The 4 KiB cap is well clear of the largest real body -- a code list, or
  // the rooms table's multi-select delete, which sends one roomId per ticked
  // box -- and keeps an unauthenticated POST from being a place to push bulk
  // at us; the token check still runs afterwards either way.
  //
  // A repeated key becomes an ARRAY. Object.fromEntries alone keeps only the
  // last value for a repeated name, which is exactly what a set of same-named
  // checkboxes sends: ticking five rooms and deleting one of them is the kind
  // of quiet wrong answer a destructive form must not give. Single-valued
  // fields are untouched -- every other form here sends each key once and
  // still reads a plain string.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 4096 },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        const out: Record<string, string | string[]> = {};
        for (const key of new Set(params.keys())) {
          const all = params.getAll(key);
          out[key] = all.length > 1 ? all : all[0];
        }
        done(null, out);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // The public, operator-authored-content routes. Everything else here is
  // admin or operator telemetry and is protected by ADMIN_BIND defaulting to
  // localhost; these are reached from a browser, via exact-path nginx proxies
  // on the frontend origin (frontend/nginx.conf). Exact path, GET only, no
  // auth, and each returns nothing that is not already meant for its public
  // page -- widen one of those proxies and the admin panel goes public with it.
  app.get("/api/about", async (_request, reply) => {
    const record = about.toRecord();
    // A minute of caching: the copy changes when an operator edits it, which is
    // rarely, and the About page should not wait on the backend to paint.
    reply.header("cache-control", "public, max-age=60");
    return record;
  });

  app.get("/api/contact", async (_request, reply) => {
    reply.header("cache-control", "public, max-age=60");
    return contact.toRecord();
  });

  // The one PUBLIC WRITE this server accepts, and the only reason it is worth
  // the risk: a render error currently reaches console.error on a player's
  // phone and nowhere else, which is why a reported white-page crash survived
  // roughly 150 attempts to reproduce it.
  //
  // Everything that makes it safe is somewhere else on purpose. ClientErrorLog
  // clamps every field on arrival, holds a fixed 50-entry ring in memory (no
  // database -- an unauthenticated write must not be able to grow storage),
  // and throttles hard per IP because a component that throws on every render
  // posts as fast as React can re-render it. The admin page renders the text
  // through escapeHtml like everything else there.
  //
  // Always 204, never a body: an attacker learns nothing about whether a
  // report was kept, throttled or discarded, and the client has nothing useful
  // to do with the answer either -- it is already showing the player a crash.
  app.post("/api/client-error", async (request, reply) => {
    clientErrors.record(request.body, getClientIp(request));
    return reply.code(204).send();
  });

  app.get("/api/disclaimer", async (_request, reply) => {
    reply.header("cache-control", "public, max-age=60");
    return disclaimer.toRecord();
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
        contact,
        disclaimer,
        botNames,
        query: carry(request, how),
        // On unless explicitly stopped. An operator opens this page to watch
        // load, and a stale page is worse than useless -- it is misleading.
        refresh: query.refresh !== "0",
        appUrl: opts.appUrl,
        watchToken: opts.watchToken,
        notice: typeof query.ok === "string" ? query.ok.slice(0, 120) : undefined,
        // Filtering happens in the renderer, over listRoomsForAdmin's output.
        // Deliberately not pushed into the store: at these room counts the
        // walk is nothing, and a store method taking a search string is a
        // second place for "what counts as a match" to live.
        filter: {
          q: typeof query.q === "string" ? query.q.slice(0, 60) : "",
          kind: query.kind === "real" || query.kind === "practice" ? query.kind : "all",
          sort: query.sort === "idle" || query.sort === "rounds" || query.sort === "id" ? query.sort : "players",
        },
      })
    );
  });

  // One room, in full. Its own page rather than an expanding row: the panel is
  // scriptless (see admin-page.ts), so "expand" means re-rendering the whole
  // table anyway, and this page carries IP addresses that have no business
  // being on a screen an operator leaves open on a shared desk.
  app.get<{ Params: { roomId: string } }>("/admin/rooms/:roomId", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const query = request.query as Record<string, unknown>;
    const room = store.getRoomForAdmin(request.params.roomId);
    if (!room) return reply.code(404).type("text/html").send(renderRoomDetail({ roomId: request.params.roomId, room: undefined, connections: [], hasDb: store.hasDatabase, query: carry(request, how), appUrl: opts.appUrl, watchToken: opts.watchToken }));
    // Awaited, not fired off: this is the one admin page that reads Postgres,
    // and an empty list because the query had not come back yet would read as
    // "nobody has ever connected" rather than "still loading".
    const connections = await store.getConnectionSummaries(room.roomId);
    return reply.type("text/html").send(
      renderRoomDetail({
        roomId: room.roomId,
        room,
        connections,
        hasDb: store.hasDatabase,
        query: carry(request, how),
        appUrl: opts.appUrl,
        watchToken: opts.watchToken,
        notice: typeof query.ok === "string" ? query.ok.slice(0, 120) : undefined,
      })
    );
  });

  // What crashed in players' browsers. Its own page, and a POST to clear it
  // once a bug is fixed so the list means "still happening".
  app.get("/admin/errors", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const query = request.query as Record<string, unknown>;
    return reply.type("text/html").send(
      renderClientErrorsPage({
        snapshot: clientErrors.snapshot(),
        query: carry(request, how),
        refresh: query.refresh !== "0",
        notice: typeof query.ok === "string" ? query.ok.slice(0, 120) : undefined,
      })
    );
  });

  app.post("/admin/errors/clear", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const cleared = clientErrors.clear();
    const sep = carry(request, how) ? "&" : "?";
    const note = cleared === 1 ? "1 report cleared." : `${cleared} reports cleared.`;
    return reply.redirect(`/admin/errors${carry(request, how)}${sep}ok=${encodeURIComponent(note)}`);
  });

  // The four throttles, live. Its own page for the same reason the room detail
  // is: IP addresses, and a main panel that is already long enough.
  app.get("/admin/protections", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const query = request.query as Record<string, unknown>;
    return reply.type("text/html").send(
      renderProtectionsPage({
        login: adminLoginSnapshot(),
        ws: opts.protections?.(),
        query: carry(request, how),
        refresh: query.refresh !== "0",
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

  // Kept alongside the bulk route below: it is a stable URL an operator may
  // have bookmarked or scripted, and it costs one line.
  app.post<{ Params: { roomId: string } }>("/admin/rooms/:roomId/delete", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    store.forceDeleteRoom(request.params.roomId);
    return reply.redirect(`/admin${carry(request, how)}#rooms`);
  });

  // Delete however many rooms were ticked. One round of confirmation for the
  // whole set rather than one per room, which is the point -- clearing a
  // night's abandoned tables was eight separate confirm dialogs.
  //
  // The redirect carries #rooms so the page comes back where it was left. A
  // plain /admin sent the browser to the top of a long page after every
  // delete, which on a board with several rooms means scrolling back down to
  // reach the next one.
  app.post("/admin/rooms/delete", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const raw = (request.body as Record<string, unknown> | undefined)?.roomId;
    // One box ticked arrives as a string, several as an array (see the body
    // parser above). Normalized here rather than at each use.
    const roomIds = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    for (const roomId of roomIds) store.forceDeleteRoom(roomId);
    const sep = carry(request, how) ? "&" : "?";
    const note = roomIds.length === 1 ? "Deleted 1 room." : `Deleted ${roomIds.length} rooms.`;
    return reply.redirect(`/admin${carry(request, how)}${sep}ok=${encodeURIComponent(note)}#rooms`);
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

  // Same page-per-form reasoning as /admin/about: the panel auto-refreshes and
  // a <meta refresh> landing mid-edit eats an unsaved textarea of names.
  app.get("/admin/bot-names", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const query = request.query as Record<string, unknown>;
    return reply.type("text/html").send(
      renderBotNamesEditor({
        botNames,
        query: carry(request, how),
        notice: typeof query.ok === "string" ? query.ok.slice(0, 120) : undefined,
      })
    );
  });

  app.post("/admin/bot-names", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    // Reset and "cleared both boxes" are the same operation by construction --
    // an empty pool falls back to the built-in list (see bot-names.ts) -- so
    // the button exists for discoverability, not as a second code path.
    const changed = body.reset === "1" ? botNames.set("", "") : botNames.set(body.banker, body.players);
    const note = changed ? "Computer player names updated." : "No change.";
    const sep = carry(request, how) ? "&" : "?";
    // Back to the editor: an operator who just saved a name list is usually
    // about to add another one.
    return reply.redirect(`/admin/bot-names${carry(request, how)}${sep}ok=${encodeURIComponent(note)}`);
  });

  // Its own page, because /admin auto-refreshes every 15s and a <meta refresh>
  // mid-typing eats the field. See renderAboutEditor.
  app.get("/admin/about", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const query = request.query as Record<string, unknown>;
    return reply.type("text/html").send(
      renderAboutEditor({
        about,
        query: carry(request, how),
        notice: typeof query.ok === "string" ? query.ok.slice(0, 120) : undefined,
      })
    );
  });

  app.post("/admin/about", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const changed = body.clear === "1" ? about.clear() : about.set(body.heading, body.body);
    const note = changed ? "About page updated." : "No change.";
    const sep = carry(request, how) ? "&" : "?";
    // Back to the editor, not the panel: an operator who just saved a credits
    // list is usually about to add another name.
    return reply.redirect(`/admin/about${carry(request, how)}${sep}ok=${encodeURIComponent(note)}`);
  });

  // Same page-per-field reasoning as /admin/about: this panel auto-refreshes,
  // and a <meta refresh> mid-typing eats an unsaved field.
  app.get("/admin/contact", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const query = request.query as Record<string, unknown>;
    return reply.type("text/html").send(
      renderContactEditor({
        contact,
        query: carry(request, how),
        notice: typeof query.ok === "string" ? query.ok.slice(0, 120) : undefined,
      })
    );
  });

  app.post("/admin/contact", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const changed = body.clear === "1" ? contact.clear() : contact.set(body.heading, body.body);
    const note = changed ? "Contact page updated." : "No change.";
    const sep = carry(request, how) ? "&" : "?";
    return reply.redirect(`/admin/contact${carry(request, how)}${sep}ok=${encodeURIComponent(note)}`);
  });

  // One page for all six sections (unlike About/Contact's own single
  // fields) -- each section is its own <form>, posting only its own slug and
  // body, so saving one section can never touch another's wording. See
  // disclaimer.ts for why a section can be overridden or cleared but never
  // added, removed or renamed from here.
  app.get("/admin/disclaimer", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const query = request.query as Record<string, unknown>;
    return reply.type("text/html").send(
      renderDisclaimerEditor({
        disclaimer,
        query: carry(request, how),
        notice: typeof query.ok === "string" ? query.ok.slice(0, 120) : undefined,
      })
    );
  });

  app.post("/admin/disclaimer", async (request, reply) => {
    const how = guard(request, reply);
    if (!how) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    // An unrecognised slug (a stale form, a tampered field) changes nothing --
    // isDisclaimerSlug/set both reject it rather than creating a new section.
    const changed = body.clear === "1" ? disclaimer.clear(body.slug) : disclaimer.set(body.slug, body.body);
    const label = isDisclaimerSlug(body.slug) ? body.slug : "section";
    const note = changed ? `Disclaimer (${label}) updated.` : "No change.";
    const sep = carry(request, how) ? "&" : "?";
    return reply.redirect(`/admin/disclaimer${carry(request, how)}${sep}ok=${encodeURIComponent(note)}`);
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
