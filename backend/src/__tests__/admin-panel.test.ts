import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer } from "../http-server.js";
import { GameStore } from "../store.js";
import { AccessControl } from "../access.js";
import { RuntimeLimits } from "../limits.js";
import { AdminAuth, hashPassword } from "../admin-auth.js";

// The panel drives the live AccessControl, RuntimeLimits and GameStore that
// gameplay reads. Unit tests prove each of those behaves; these prove the
// routes are actually wired to the same instances -- the failure where an
// operator flips a switch, the page redirects happily, and nothing changes.

const PORT = 39755;
const access = new AccessControl();
const limits = new RuntimeLimits();
// The store must share the SAME limits instance the panel mutates -- that is
// exactly the wiring these tests exist to prove, and index.ts does it too.
const store = new GameStore(undefined, limits);
const broadcasts: Array<{ text: string; level: string; roomId?: string }> = [];

const app = createHttpServer(store, {
  access,
  limits,
  auth: new AdminAuth({ username: "admin", password: hashPassword("pw"), secret: "secret" }),
  broadcast: (text, level, roomId) => {
    broadcasts.push({ text, level, roomId });
    return 3;
  },
});

const base = `http://127.0.0.1:${PORT}`;
let cookie = "";

async function login(): Promise<string> {
  const res = await fetch(`${base}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password: "pw" }),
    redirect: "manual",
  });
  return res.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function post(path: string, body: Record<string, string>) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams(body),
    redirect: "manual",
  });
}

beforeAll(async () => {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  cookie = await login();
});

afterAll(async () => {
  await app.close();
});

describe("admin panel auth", () => {
  it("shows a login form rather than the panel when unauthenticated", async () => {
    const res = await fetch(`${base}/admin`);
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("Sign in");
    // The thing that must never leak to an unauthenticated request.
    expect(html).not.toContain("Access codes");
  });

  it("refuses the wrong password", async () => {
    const res = await fetch(`${base}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "admin", password: "nope" }),
      redirect: "manual",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("serves the panel with a valid session cookie", async () => {
    const res = await fetch(`${base}/admin`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Who can play");
    expect(html).toContain("Capacity");
    expect(html).toContain("Broadcast");
  });

  it("rejects a forged cookie", async () => {
    const res = await fetch(`${base}/admin`, { headers: { cookie: "kvitlach_admin=99999999999.deadbeef" } });
    expect(res.status).toBe(401);
  });
});

describe("admin panel controls", () => {
  it("applies a preset to the same AccessControl gameplay reads", async () => {
    await post("/admin/access", { mode: "closed" });
    expect(access.getMode()).toBe("closed");
    expect(() => access.assertAllowed("join")).toThrow("locked_down");
  });

  // The whole reason the gate went per-action: "anyone can join, only I can
  // start a table" was not expressible before.
  it("sets one action without touching the other two", async () => {
    await post("/admin/access", { mode: "open" });
    await post("/admin/access", { action: "create", actionMode: "code" });
    await post("/admin/access", { codes: "latke" });

    expect(() => access.assertAllowed("create")).toThrow("invite_required");
    expect(() => access.assertAllowed("create", "LATKE")).not.toThrow();
    expect(() => access.assertAllowed("join")).not.toThrow();
    expect(() => access.assertAllowed("practice")).not.toThrow();
    expect(access.getMode()).toBe("custom");
  });

  // Each form posts only its own field, so saving codes must not reopen a
  // platform somebody deliberately restricted.
  it("saving codes leaves the modes alone", async () => {
    const before = access.getModes();
    await post("/admin/access", { codes: "one\ntwo" });
    expect(access.getModes()).toEqual(before);
  });

  it("changes a capacity cap and enforces it immediately", async () => {
    await post("/admin/limits", { key: "maxRooms", value: "1" });
    expect(limits.maxRooms).toBe(1);
    await post("/admin/access", { mode: "open" });
    store.createRoom({ firstName: "First" });
    expect(() => store.createRoom({ firstName: "Second" })).toThrow("room_capacity");
    await post("/admin/limits", { reset: "1" });
    expect(limits.maxRooms).toBe(150);
  });

  it("ignores a junk capacity value instead of removing the cap", async () => {
    await post("/admin/limits", { key: "maxRooms", value: "abc" });
    expect(limits.maxRooms).toBe(150);
    await post("/admin/limits", { key: "notAKey", value: "5" });
    expect(limits.maxRooms).toBe(150);
  });

  it("hands a broadcast to the WS server", async () => {
    broadcasts.length = 0;
    await post("/admin/broadcast", { text: "  restarting in 5  ", level: "warning" });
    expect(broadcasts).toEqual([{ text: "restarting in 5", level: "warning", roomId: undefined }]);
  });

  // "All tables" posts an empty roomId. It has to arrive as undefined, not "",
  // or the WS server would look up a room named "" and reach nobody -- the
  // whole-platform announcement would silently go nowhere.
  it("treats a blank room as all tables, not as a room named blank", async () => {
    broadcasts.length = 0;
    await post("/admin/broadcast", { text: "everyone", level: "info", roomId: "" });
    expect(broadcasts).toEqual([{ text: "everyone", level: "info", roomId: undefined }]);
  });

  it("targets a single table when one is picked", async () => {
    broadcasts.length = 0;
    await post("/admin/broadcast", { text: "just you", level: "info", roomId: " ABC123 " });
    expect(broadcasts).toEqual([{ text: "just you", level: "info", roomId: "ABC123" }]);
  });

  it("does not broadcast an empty message", async () => {
    broadcasts.length = 0;
    await post("/admin/broadcast", { text: "   ", level: "info" });
    expect(broadcasts).toHaveLength(0);
  });

  it("refuses every control without a session", async () => {
    const before = access.getModes();
    const res = await fetch(`${base}/admin/access`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ mode: "closed" }),
      redirect: "manual",
    });
    expect(res.status).toBe(401);
    expect(access.getModes()).toEqual(before);
  });
});
