import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The frontend origin is the only thing on the internet. It reaches the backend
// for exactly one path -- /api/about -- and the config is asserted here because
// nothing else can catch a widening of it.
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

describe("the frontend origin's backend proxy", () => {
  it("proxies exactly one path and no more", () => {
    const passes = CONF.match(/proxy_pass\s+[^;]+;/g) ?? [];
    expect(
      passes,
      "A second proxy_pass is a second public backend route. If one is genuinely " +
        "needed it must be its own exact-match location, and this test updated to name it."
    ).toHaveLength(1);
    expect(passes[0]).toContain("/api/about");
  });

  it("reaches the backend only through an exact match", () => {
    const proxying = locations().filter((loc) => loc.body.includes("proxy_pass"));
    expect(proxying).toHaveLength(1);
    expect(
      { modifier: proxying[0].modifier, path: proxying[0].path },
      "`location =` is the exact match. A prefix match here publishes /admin."
    ).toEqual({ modifier: "=", path: "/api/about" });
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

  it("is GET-only, because the copy is written from /admin and never from the app", () => {
    const about = locations().find((loc) => loc.path === "/api/about");
    expect(about?.body).toContain("limit_except GET");
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
