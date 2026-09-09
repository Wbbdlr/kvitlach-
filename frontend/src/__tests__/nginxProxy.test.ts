import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The frontend origin is the only thing on the internet. It reaches the
// backend for exactly three paths -- /api/about, /api/contact,
// /api/disclaimer, the public GET side of the three operator-authored-copy
// pages -- and the config is asserted here because nothing else can catch a
// widening of it.
//
// The backend's HTTP port also serves /admin, /metrics and /health/detail, and
// the only thing keeping those off the internet is ADMIN_BIND binding that port
// to 127.0.0.1 on the host. This proxy runs INSIDE the compose network, where
// that binding does not apply: nginx dials `backend:25000` directly. So
// changing `location = /api/about` to `location /api/` would not look like a
// security change in review -- it would look like tidying -- and it would
// publish the admin panel through the Cloudflare tunnel.
//
// A unit test cannot run nginx, so it asserts the two structural properties
// that make the exact match hold: there is only ONE proxy_pass in the file, and
// it is inside an exact-match location. Everything else falls through to
// `location /`, which is try_files to index.html and never leaves the container.

const CONF = readFileSync(resolve(__dirname, "../../nginx.conf"), "utf8");

/**
 * The text from `open` to its matching close brace, counting depth. The naive
 * slice-to-first-`}` is wrong here for a real reason: `location = /api/about`
 * opens with a nested `limit_except GET { deny all; }`, so the first `}` lands
 * before proxy_pass and the block reads as empty -- which made the test pass
 * vacuously in the direction that matters.
 */
function blockBody(open: number): string {
  let depth = 1;
  for (let i = open; i < CONF.length; i++) {
    if (CONF[i] === "{") depth++;
    else if (CONF[i] === "}" && --depth === 0) return CONF.slice(open, i);
  }
  throw new Error(`unbalanced braces in nginx.conf from offset ${open}`);
}

/**
 * Every `location <modifier?> <path>` in the file, in order, with the body it
 * opens. The body is taken from the regex's own match index rather than by
 * searching for the header text again -- reconstructing the header from its
 * captured parts loses the original whitespace and finds nothing.
 */
function locations(): { modifier: string; path: string; body: string }[] {
  const out: { modifier: string; path: string; body: string }[] = [];
  const re = /location\s+(=\s+|\^~\s+|~\*?\s+)?([^\s{]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CONF))) {
    out.push({
      modifier: (m[1] ?? "").trim(),
      path: m[2],
      body: blockBody(m.index + m[0].length),
    });
  }
  return out;
}

/**
 * The names of every header an add_header sets in `text`, in order.
 *
 * Comments are stripped first, or the prose explaining add_header in this very
 * file parses as a header called "does".
 */
function headerNames(text: string): string[] {
  const code = text.replace(/#[^\r\n]*/g, "");
  return [...code.matchAll(/add_header\s+([\w-]+)/g)].map((m) => m[1]);
}

/**
 * The config with every location block cut out, leaving the server level.
 *
 * Cut POSITIONALLY, not by name: the whole point of the rule below is that a
 * location repeats the server's own header names, so subtracting the names a
 * location uses would subtract the server's entire set and leave nothing.
 */
function serverLevelText(): string {
  const re = /location\s+(?:=\s+|\^~\s+|~\*?\s+)?[^\s{]+\s*\{/g;
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CONF))) {
    if (m.index < cursor) continue;
    out += CONF.slice(cursor, m.index);
    const bodyStart = m.index + m[0].length;
    cursor = bodyStart + blockBody(bodyStart).length + 1;
    re.lastIndex = cursor;
  }
  return out + CONF.slice(cursor);
}

// The complete, deliberate list of public backend routes. Adding one means
// adding it here too, in the same review -- that duplication is the point, not
// an accident to DRY away. It has already earned its keep once: the
// client-error route below was added to nginx.conf and this test failed, which
// is exactly the review step it exists to force.
const PUBLIC_ROUTES = ["/api/about", "/api/contact", "/api/disclaimer", "/api/config", "/api/family", "/api/client-error"];

// The three content routes are GET-only because each is operator-authored copy
// written from /admin and never from the app. /api/client-error is the mirror
// image and the only public WRITE this origin carries: the app posts a render
// error to it so somebody other than the player can read it, and nothing reads
// it back from here. So the method rule is per-route rather than blanket, and
// a route appearing in NEITHER list is a route nobody decided the methods for.
const GET_ONLY_ROUTES = ["/api/about", "/api/contact", "/api/disclaimer", "/api/config", "/api/family"];
const POST_ONLY_ROUTES = ["/api/client-error"];

describe("the frontend origin's backend proxy", () => {
  it("proxies exactly the known paths and no more", () => {
    const passes = CONF.match(/proxy_pass\s+[^;]+;/g) ?? [];
    expect(
      passes,
      "A proxy_pass count that does not match PUBLIC_ROUTES is a public backend route this " +
        "test does not know about. If one is genuinely needed it must be its own exact-match " +
        "location, and PUBLIC_ROUTES above updated to name it."
    ).toHaveLength(PUBLIC_ROUTES.length);
    for (const route of PUBLIC_ROUTES) {
      expect(passes.some((p) => p.includes(route)), `no proxy_pass found for ${route}`).toBe(true);
    }
  });

  it("reaches the backend only through exact matches, one per known route", () => {
    const proxying = locations().filter((loc) => loc.body.includes("proxy_pass"));
    expect(proxying).toHaveLength(PUBLIC_ROUTES.length);
    for (const loc of proxying) {
      expect(
        { modifier: loc.modifier, path: loc.path },
        "`location =` is the exact match. A prefix match here publishes /admin."
      ).toEqual({ modifier: "=", path: expect.stringMatching(new RegExp(`^(${PUBLIC_ROUTES.join("|")})$`)) });
    }
    // And the reverse: every known route actually has its own location, not
    // just N locations that happen to be exact matches of SOMETHING.
    for (const route of PUBLIC_ROUTES) {
      expect(proxying.some((loc) => loc.path === route), `no exact-match location for ${route}`).toBe(true);
    }
  });

  it("never prefix-matches /api or /admin", () => {
    for (const loc of locations()) {
      if (loc.modifier === "=") continue;
      expect(
        loc.path.startsWith("/api") || loc.path.startsWith("/admin"),
        `location ${loc.modifier} ${loc.path} is not an exact match and would capture backend paths`
      ).toBe(false);
    }
  });

  it("keeps the operator-authored copy read-only, since it is written from /admin and never from the app", () => {
    for (const route of GET_ONLY_ROUTES) {
      const loc = locations().find((l) => l.path === route);
      expect(loc?.body, `no location block found for ${route}`).toContain("limit_except GET");
    }
  });

  it("keeps the one public write to POST, and caps what it will accept", () => {
    for (const route of POST_ONLY_ROUTES) {
      const loc = locations().find((l) => l.path === route);
      expect(loc?.body, `no location block found for ${route}`).toContain("limit_except POST");
      // The backend clamps every field anyway; this stops a large body from
      // reaching the event loop at all.
      expect(loc?.body, `${route} accepts an unbounded body`).toContain("client_max_body_size");
    }
  });

  it("decides the methods for every public route, one way or the other", () => {
    // A route in neither list is one whose methods nobody chose.
    expect([...GET_ONLY_ROUTES, ...POST_ONLY_ROUTES].sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  // nginx's add_header does NOT merge: one add_header in a location discards
  // every add_header inherited from the server block. That is how /assets/ --
  // one Cache-Control line -- came to serve the entire compiled application
  // with no nosniff and no CSP, while the HTML that loads it had all eight.
  // The front page looked correct throughout, which is why nothing caught it.
  it("restates every security header in any location that sets one", () => {
    // The server-level set is DERIVED (every add_header in the file, minus the
    // ones inside a location) rather than hardcoded, so adding a ninth header
    // to the server block extends this test with no edit here.
    const serverHeaders = headerNames(serverLevelText());
    expect(serverHeaders.length, "no server-level add_header found -- the parser moved").toBeGreaterThan(5);
    expect(serverHeaders).toContain("Content-Security-Policy");

    for (const loc of locations()) {
      const own = headerNames(loc.body);
      if (own.length === 0) continue;
      for (const name of serverHeaders) {
        expect(
          own,
          `location ${loc.modifier} ${loc.path} sets a header, which DISCARDS the ` +
            `server block's ${name}. Restate the whole security list inside that block.`
        ).toContain(name);
      }
    }
  });

  // A family's link carries their surname. Everything else on this site is
  // meant to be found; this namespace is not.
  it("tells crawlers not to index a family's link", () => {
    const family = locations().find((loc) => loc.path === "/m/");
    expect(family, "no location for /m/ -- family links would be indexable").toBeDefined();
    expect(family!.modifier, "must beat the SPA catch-all").toBe("^~");
    expect(family!.body).toMatch(/add_header\s+X-Robots-Tag\s+"[^"]*noindex/);
    // It still has to serve the app, or the family's own link 404s.
    expect(family!.body).toContain("try_files");
    expect(family!.body).not.toContain("proxy_pass");
  });

  it("does not put /m/ in robots.txt, which would advertise it", () => {
    // A Disallow is the wrong tool twice over: robots.txt is public, and a
    // disallowed URL is never fetched, so the crawler never reads the noindex
    // and Google can still list the bare URL -- surname included.
    const robots = readFileSync(resolve(__dirname, "../../public/robots.txt"), "utf8");
    expect(robots).not.toContain("/m/");
  });

  // Not a proxy property, but the same blast radius: the SPA fallback is what
  // every non-exact path lands on, and it must stay a local file serve.
  it("falls everything else back to index.html inside the container", () => {
    const root = locations().find((loc) => loc.path === "/" && loc.modifier === "");
    expect(root).toBeDefined();
    expect(root!.body).toContain("try_files");
    expect(root!.body).not.toContain("proxy_pass");
  });
});
