import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer } from "../http-server.js";
import { GameStore } from "../store.js";
import { ClientErrorLog } from "../client-errors.js";
import { AdminAuth, hashPassword } from "../admin-auth.js";

// The only unauthenticated write this server accepts, so most of what these
// prove is about what it refuses. The value of the feature is elsewhere: a
// render error used to reach console.error on a player's phone and nowhere
// else, which is why a reported white-page crash survived roughly 150 attempts
// to reproduce it.

const PORT = 39762;
const store = new GameStore();
const clientErrors = new ClientErrorLog();
const app = createHttpServer(store, {
  auth: new AdminAuth({ username: "admin", password: hashPassword("pw"), secret: "secret" }),
  clientErrors,
});
const base = `http://127.0.0.1:${PORT}`;
let cookie = "";

const post = (body: unknown) =>
  fetch(`${base}/api/client-error`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  const res = await fetch(`${base}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password: "pw" }),
    redirect: "manual",
  });
  cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
});

describe("reporting a client error", () => {
  it("accepts a report and shows it on the admin page", async () => {
    clientErrors.clear();
    const res = await post({
      message: "Cannot read properties of undefined (reading 'roomId')",
      route: "/table/ABC123",
      version: "12.9",
      stack: "at PlayerDock (PlayerDock.tsx:44)",
      userAgent: "Mozilla/5.0 (iPhone)",
    });
    expect(res.status).toBe(204);

    const html = await (await fetch(`${base}/admin/errors`, { headers: { cookie } })).text();
    expect(html).toContain("Cannot read properties of undefined");
    expect(html).toContain("/table/ABC123");
    expect(html).toContain("PlayerDock.tsx:44");
  });

  it("says nothing back, whatever it did with the report", async () => {
    // No body either way, so a prober cannot tell a kept report from a
    // throttled or discarded one.
    const kept = await post({ message: "something new every time " + Math.random() });
    const junk = await post({ message: "" });
    expect(kept.status).toBe(204);
    expect(junk.status).toBe(204);
    expect((await kept.text()).length).toBe(0);
    expect((await junk.text()).length).toBe(0);
  });

  it("counts a crash loop as one row rather than filling the ring", () => {
    const log = new ClientErrorLog();
    for (let i = 0; i < 4; i += 1) log.record({ message: "same error" }, "10.0.0.1");
    const reports = log.list();
    expect(reports).toHaveLength(1);
    expect(reports[0].count).toBe(4);
  });

  it("throttles one address rather than letting it push everything else out", () => {
    const log = new ClientErrorLog();
    // Five is the per-minute allowance; each message is distinct so none of
    // them is absorbed by the repeat counter above.
    for (let i = 0; i < 8; i += 1) log.record({ message: `error ${i}` }, "10.0.0.2");
    expect(log.list()).toHaveLength(5);
    expect(log.snapshot().dropped).toBe(3);

    // A different device is unaffected, which is the point of it being per-IP.
    expect(log.record({ message: "from somebody else" }, "10.0.0.3")).toBe(true);
  });

  it("clamps every field rather than trusting any of them", () => {
    const log = new ClientErrorLog();
    log.record(
      {
        message: "x".repeat(5000),
        route: "y".repeat(5000),
        version: "z".repeat(500),
        stack: "s".repeat(50_000),
        userAgent: "u".repeat(5000),
      },
      "10.0.0.4"
    );
    const r = log.list()[0];
    expect(r.message.length).toBe(500);
    expect(r.route!.length).toBe(200);
    expect(r.version!.length).toBe(20);
    expect(r.stack!.length).toBe(4000);
    expect(r.userAgent!.length).toBe(300);
  });

  it("ignores a report with no message, and anything that is not an object", () => {
    const log = new ClientErrorLog();
    expect(log.record({ message: "   " }, "10.0.0.5")).toBe(false);
    expect(log.record({ message: 42 }, "10.0.0.5")).toBe(false);
    expect(log.record(null, "10.0.0.5")).toBe(false);
    expect(log.record("a bare string", "10.0.0.5")).toBe(false);
    expect(log.list()).toHaveLength(0);
  });

  it("renders reported text as text, never as markup", async () => {
    clientErrors.clear();
    await post({ message: "<img src=x onerror=alert(1)>", route: "</td><script>bad()</script>" });

    const html = await (await fetch(`${base}/admin/errors`, { headers: { cookie } })).text();
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>bad()");
  });

  it("keeps the list itself behind the admin session", async () => {
    const res = await fetch(`${base}/admin/errors`, { redirect: "manual" });
    expect([401, 404]).toContain(res.status);
  });

  it("clears on request, which is how an operator checks a fix worked", async () => {
    clientErrors.clear();
    await post({ message: "still happening?" });
    expect(clientErrors.list().length).toBeGreaterThan(0);

    const res = await fetch(`${base}/admin/errors/clear`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({}),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(clientErrors.list()).toHaveLength(0);
  });
});
