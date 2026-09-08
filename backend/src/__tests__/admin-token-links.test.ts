import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer } from "../http-server.js";
import { GameStore } from "../store.js";

// The `?token=` escape hatch is what an operator reaches for when they cannot
// use the cookie login -- locked out, a fresh browser, a phone over Tailscale.
// So every link the panel renders has to keep carrying it, and four pages did
// not: they built `/admin?refresh=0` and then appended the carried query,
// producing `/admin?refresh=0?token=abc`. Fastify then parses `refresh` as
// "0?token=abc" and there is no `token` param at all, so guard() 404s the
// operator out of the very page they were on.
//
// Cookie sessions never saw it, because the carried query is empty for them
// and the naive concatenation happens to be correct. That is precisely why it
// survived: the way it is normally used is the way it works.

const PORT = 39784;
const TOKEN = "letmein-token";
const store = new GameStore();
const app = createHttpServer(store, {});
const base = `http://127.0.0.1:${PORT}`;

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

/** Every href on the page that points back into /admin. */
function linksIn(html: string): string[] {
  return [...html.matchAll(/href="([^"]*\/admin[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

beforeAll(async () => {
  process.env.ADMIN_TOKEN = TOKEN;
  await app.listen({ port: PORT, host: "127.0.0.1" });
});

afterAll(async () => {
  await app.close();
  delete process.env.ADMIN_TOKEN;
});

describe("every admin link keeps the token usable", () => {
  const pages = ["/admin", "/admin/protections", "/admin/errors", "/admin/audit", "/admin/archive"];

  it("serves each page to a token caller in the first place", async () => {
    for (const page of pages) {
      const res = await get(`${page}?token=${TOKEN}`);
      expect(res.status, page).toBe(200);
    }
  });

  it("never renders a link with two question marks in it", async () => {
    for (const page of pages) {
      const html = await (await get(`${page}?token=${TOKEN}`)).text();
      for (const href of linksIn(html)) {
        expect(href.split("?").length - 1, `${page} renders ${href}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("carries a usable token on every link, and following one still works", async () => {
    for (const page of pages) {
      const html = await (await get(`${page}?token=${TOKEN}`)).text();
      for (const href of linksIn(html)) {
        // The logout form posts without a token by design; skip anything that
        // is not a GET target of the panel itself.
        if (href.startsWith("http")) continue;
        const url = new URL(href, base);
        expect(url.searchParams.get("token"), `${page} renders ${href} with no usable token`).toBe(TOKEN);

        const res = await get(url.pathname + url.search);
        expect(res.status, `following ${href} from ${page}`).toBe(200);
      }
    }
  });

  it("still turns auto-refresh off when that link is followed", async () => {
    // The other half of the same bug: `refresh` arrived as "0?token=abc",
    // which is not "0", so the page kept refreshing and the operator kept
    // losing whatever they were typing.
    const html = await (await get(`/admin?token=${TOKEN}`)).text();
    const stop = linksIn(html).find((h) => h.includes("refresh=0"));
    expect(stop, "no stop-auto-refresh link on the panel").toBeTruthy();

    const url = new URL(stop!, base);
    expect(url.searchParams.get("refresh")).toBe("0");
    const after = await (await get(url.pathname + url.search)).text();
    expect(after).not.toContain('http-equiv="refresh"');
  });
});
