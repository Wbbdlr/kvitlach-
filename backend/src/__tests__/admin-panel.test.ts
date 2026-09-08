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
  // A stub rather than a live WSServer: protections.test.ts already proves
  // the real snapshot counts real rejections, and what these tests are for is
  // the route rendering whatever it is handed.
  protections: () => ({
    kinds: [
      { kind: "connections", limit: 80, rejected: 2, lastAt: Date.now(), lastIp: "203.0.113.9" },
      { kind: "messages", limit: 30, windowMs: 10_000, rejected: 0, lastAt: 0 },
      { kind: "roomCreates", limit: 5, windowMs: 60_000, rejected: 0, lastAt: 0 },
      { kind: "practiceCreates", limit: 5, windowMs: 60_000, rejected: 0, lastAt: 0 },
    ],
    connectionsByIp: [{ ip: "198.51.100.4", count: 3 }],
    createWindows: [{ ip: "198.51.100.4", kind: "roomCreates" as const, count: 2, resetAt: Date.now() + 30_000 }],
    trackedIps: { connections: 1, roomCreates: 1, practiceCreates: 0 },
  }),
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

function get(path: string) {
  return fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" });
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

  // The names the practice tables use. Same wiring risk as limits above, with
  // a sharper edge: the panel and the store must hold ONE BotNames instance or
  // an operator saves a list that no table ever draws from. http-server takes
  // it off the store for exactly that reason, so this asserts through a real
  // practice room rather than through the settings object.
  it("changes the names a new practice table deals with", async () => {
    await post("/admin/bot-names", { banker: "Der Zeide", players: "Alef, Beis, Gimmel" });

    const { room } = store.createPracticeRoom({ firstName: "Rivka", botCount: 3 });
    expect(room.players.find((p) => p.type === "admin")!.firstName).toBe("Der Zeide");
    const bots = room.players.filter((p) => p.isBot && p.type === "player").map((p) => p.firstName);
    expect(bots.sort()).toEqual(["Alef", "Beis", "Gimmel"]);
  });

  it("puts the built-in names back when reset", async () => {
    await post("/admin/bot-names", { banker: "Der Zeide", players: "Alef" });
    expect(store.botNames.isDefault("players")).toBe(false);

    await post("/admin/bot-names", { reset: "1" });
    expect(store.botNames.isDefault("players")).toBe(true);
    expect(store.botNames.isDefault("banker")).toBe(true);
  });

  it("renders the current lists back into the editor's textareas", async () => {
    await post("/admin/bot-names", { banker: "Der Zeide", players: ["Alef","Beis"].join(String.fromCharCode(10)) });
    const res = await fetch(`${base}/admin/bot-names`, { headers: { cookie } });
    const html = await res.text();
    // Editable means editable: a form that shows an empty box over a saved
    // list makes every edit a retype, which is how a name gets lost.
    expect(html).toContain("Der Zeide");
    expect(html).toContain(["Alef","Beis"].join(String.fromCharCode(10)));
    await post("/admin/bot-names", { reset: "1" });
  });

  it("refuses the name editor without a session", async () => {
    const res = await fetch(`${base}/admin/bot-names`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ players: "Sneaky" }),
      redirect: "manual",
    });
    expect(res.status).toBe(401);
    expect(store.botNames.isDefault("players")).toBe(true);
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

// Clearing a night's abandoned tables was one confirm dialog per room, and the
// page jumped back to the top after each one -- so the next room needed a
// scroll before it could be reached. Both are the same form now.
describe("deleting rooms from the panel", () => {
  it("deletes every ticked room in one post", async () => {
    store.createRoom({ firstName: "B1", roomId: "BULK-A" });
    store.createRoom({ firstName: "B2", roomId: "BULK-B" });
    store.createRoom({ firstName: "B3", roomId: "BULK-C" });

    // Same shape a set of same-named checkboxes actually sends. URLSearchParams
    // with repeated keys is exactly what the browser puts on the wire.
    const body = new URLSearchParams();
    body.append("roomId", "BULK-A");
    body.append("roomId", "BULK-C");
    const res = await fetch(`${base}/admin/rooms/delete`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body,
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    const ids = store.listRoomsForAdmin().map((r) => r.roomId);
    // The regression this pins: Object.fromEntries keeps only the LAST value
    // for a repeated key, so a five-room delete used to remove exactly one.
    expect(ids).not.toContain("BULK-A");
    expect(ids).not.toContain("BULK-C");
    expect(ids).toContain("BULK-B");

    store.forceDeleteRoom("BULK-B");
  });

  it("comes back to the rooms table rather than the top of the page", async () => {
    store.createRoom({ firstName: "B4", roomId: "ANCHOR-1" });
    const res = await post("/admin/rooms/delete", { roomId: "ANCHOR-1" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("#rooms");
  });

  it("handles a single ticked box, which arrives as a string not an array", async () => {
    store.createRoom({ firstName: "B5", roomId: "SOLO-1" });
    await post("/admin/rooms/delete", { roomId: "SOLO-1" });
    expect(store.listRoomsForAdmin().map((r) => r.roomId)).not.toContain("SOLO-1");
  });

  it("does nothing at all when nothing was ticked", async () => {
    store.createRoom({ firstName: "B6", roomId: "KEEP-1" });
    const before = store.listRoomsForAdmin().length;
    const res = await post("/admin/rooms/delete", {});
    expect(res.status).toBe(302);
    expect(store.listRoomsForAdmin()).toHaveLength(before);
    store.forceDeleteRoom("KEEP-1");
  });

  it("still honours the old per-room URL, and anchors it too", async () => {
    store.createRoom({ firstName: "B7", roomId: "LEGACY-1" });
    const res = await post("/admin/rooms/LEGACY-1/delete", {});
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("#rooms");
    expect(store.listRoomsForAdmin().map((r) => r.roomId)).not.toContain("LEGACY-1");
  });
});

describe("room detail page", () => {
  it("shows the seats, chips and history of one table", async () => {
    const { room, player: banker } = store.createRoom({ firstName: "Reb", lastName: "Boruch", roomId: "PANEL-D1", buyIn: 250 });
    const { player: alice } = store.joinRoom(room.roomId, { firstName: "Alice", lastName: "K" });
    store.adjustPlayerWallet(room.roomId, banker.id, alice.id, -40, "paid the pizza");

    const html = await (await get("/admin/rooms/PANEL-D1")).text();
    expect(html).toContain("Alice K");
    expect(html).toContain("Reb Boruch");
    // The correction, with its note and its sign, off the same ledger the
    // banker's own drawer reads.
    expect(html).toContain("paid the pizza");
    expect(html).toContain("-40");
    store.forceDeleteRoom("PANEL-D1");
  });

  it("says the room is gone rather than 500ing on a stale link", async () => {
    const res = await get("/admin/rooms/NOT-A-ROOM");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("no longer on the server");
  });

  it("never renders a room's password hash", async () => {
    store.createRoom({ firstName: "B", roomId: "PANEL-D2", password: "hunter2" });
    const html = await (await get("/admin/rooms/PANEL-D2")).text();
    expect(html).toContain("password protected");
    expect(html).not.toContain("hunter2");
    store.forceDeleteRoom("PANEL-D2");
  });

  it("is behind the same session check as everything else", async () => {
    const res = await fetch(`${base}/admin/rooms/PANEL-D1`, { redirect: "manual" });
    expect([401, 404]).toContain(res.status);
  });
});

describe("protections page", () => {
  it("renders the live limits and rejection counts it is handed", async () => {
    const html = await (await get("/admin/protections")).text();
    expect(html).toContain("Sockets per IP");
    expect(html).toContain("203.0.113.9");
    expect(html).toContain("198.51.100.4");
  });

  it("counts a failed sign-in from the same tracker the throttle enforces", async () => {
    const before = await (await get("/admin/protections")).text();
    await fetch(`${base}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "admin", password: "wrong" }),
      redirect: "manual",
    });
    const after = await (await get("/admin/protections")).text();
    // Nothing recorded this before: a wrong password reached the throttle's
    // map and nowhere an operator could ever look.
    expect(after).not.toEqual(before);
    expect(after).toContain("wrong credentials");
  });

  it("is behind the same session check as everything else", async () => {
    const res = await fetch(`${base}/admin/protections`, { redirect: "manual" });
    expect([401, 404]).toContain(res.status);
  });
});

describe("room table search and sorting", () => {
  it("filters to the rooms whose id, name or banker match", async () => {
    store.createRoom({ firstName: "Chaim", roomId: "FIND-ME", roomName: "Cholent Corner" });
    store.createRoom({ firstName: "Yossi", roomId: "OTHER-1", roomName: "Kugel Table" });

    const matched = await (await get("/admin?q=cholent")).text();
    expect(matched).toContain("FIND-ME");
    expect(matched).not.toContain("OTHER-1");

    // By banker, not just by name -- "whose table is this" is the question an
    // operator actually arrives with.
    const byBanker = await (await get("/admin?q=yossi")).text();
    expect(byBanker).toContain("OTHER-1");
    expect(byBanker).not.toContain("FIND-ME");

    store.forceDeleteRoom("FIND-ME");
    store.forceDeleteRoom("OTHER-1");
  });

  it("says a filter matched nothing rather than looking like an empty server", async () => {
    store.createRoom({ firstName: "Chaim", roomId: "EXISTS-1" });
    const html = await (await get("/admin?q=zzzznothing")).text();
    expect(html).toContain("No rooms match that filter");
    expect(html).not.toContain("No active rooms");
    store.forceDeleteRoom("EXISTS-1");
  });

  it("separates practice tables from real ones", async () => {
    store.createRoom({ firstName: "Chaim", roomId: "REAL-1" });
    const practice = store.createPracticeRoom({ firstName: "Solo" });

    const realOnly = await (await get("/admin?kind=real")).text();
    expect(realOnly).toContain("REAL-1");
    expect(realOnly).not.toContain(practice.room.roomId);

    const practiceOnly = await (await get("/admin?kind=practice")).text();
    expect(practiceOnly).toContain(practice.room.roomId);
    expect(practiceOnly).not.toContain("REAL-1");

    store.forceDeleteRoom("REAL-1");
    store.forceDeleteRoom(practice.room.roomId);
  });
});
