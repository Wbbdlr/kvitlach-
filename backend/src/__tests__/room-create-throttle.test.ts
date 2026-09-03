import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// Regression coverage for a real finding from a security pass: room:create
// had no cost of its own beyond the generic per-socket message-rate limiter
// (30 messages / 10s), which is nowhere near enough to protect a shared,
// platform-wide resource -- one connection sending room:create in a loop
// could exhaust limits.ts's maxRooms (150 by default) in under a minute,
// denying every OTHER player on the box the ability to create a table for as
// long as those rooms live (up to three days for a real room). Fixed with a
// per-IP WINDOWED COUNT (see ws-server.ts's own comment for why not a flat
// cooldown after one success -- a real family/friends night can have more
// than one banker behind the same home NAT, and a hard cooldown would have
// blocked the second one's entirely ordinary room:create).

const PORT = 39781;
const URL = `ws://127.0.0.1:${PORT}`;
// Mirrors ws-server.ts's own MAX_ROOM_CREATES_PER_WINDOW -- kept as a local
// constant rather than imported so this test proves the OBSERVABLE behaviour
// (the Nth create really does throttle) rather than merely echoing whatever
// the constant says, which would pass even if the enforcement code were
// deleted entirely.
const WINDOW_LIMIT = 5;

let store: GameStore;
let server: WSServer;

beforeAll(() => {
  store = new GameStore();
  server = new WSServer(store, PORT);
});

afterAll(() => {
  (server as unknown as { wss: { close: () => void } }).wss.close();
});

// A distinct x-forwarded-for per test simulates a distinct client IP -- the
// same technique ws-load.test.ts documents: every unheadered connection in
// this process shares the literal remoteAddress, so telling two IPs apart in
// a test means setting the header the server actually keys its per-IP maps
// off of.
function connect(ip?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, ip ? { headers: { "x-forwarded-for": ip } } : undefined);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

let reqCounter = 0;
function send(ws: WebSocket, type: string, payload: unknown): Promise<any> {
  const requestId = `t${++reqCounter}`;
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.requestId !== requestId) return;
      ws.off("message", onMessage);
      if (msg.type === "error") reject(new Error(msg.error?.message ?? "error"));
      else resolve(msg.payload);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type, payload, requestId }));
  });
}

describe("room:create throttle -- a per-IP cost the generic message limiter doesn't provide", () => {
  it("allows a real family/friends night's worth of creates from one IP without tripping", async () => {
    // The whole reason this is a WINDOWED COUNT and not a flat cooldown: two
    // different bankers behind the same home NAT, each creating their own
    // table minutes apart, is entirely ordinary and must not be punished.
    const ip = "198.51.100.10";
    for (let i = 0; i < WINDOW_LIMIT; i += 1) {
      const ws = await connect(ip);
      await expect(send(ws, "room:create", { firstName: `Banker${i}` })).resolves.toBeDefined();
      ws.close();
    }
  });

  it("refuses the create past the window's limit from the same IP, even on a fresh socket", async () => {
    const ip = "198.51.100.11";
    for (let i = 0; i < WINDOW_LIMIT; i += 1) {
      const ws = await connect(ip);
      await send(ws, "room:create", { firstName: `Banker${i}` });
      ws.close();
    }
    const oneTooMany = await connect(ip);
    await expect(send(oneTooMany, "room:create", { firstName: "OneTooMany" })).rejects.toThrow(
      "room_create_throttled",
    );
    oneTooMany.close();
  });

  it("does not throttle a different IP", async () => {
    const ip = "198.51.100.20";
    for (let i = 0; i < WINDOW_LIMIT; i += 1) {
      const ws = await connect(ip);
      await send(ws, "room:create", { firstName: `Banker${i}` });
      ws.close();
    }

    const other = await connect("198.51.100.21");
    await expect(send(other, "room:create", { firstName: "Other" })).resolves.toBeDefined();
    other.close();
  });

  it("keeps the real-room and practice-room throttles independent", async () => {
    const ip = "198.51.100.30";
    for (let i = 0; i < WINDOW_LIMIT; i += 1) {
      const ws = await connect(ip);
      await send(ws, "room:create", { firstName: `Real${i}` });
      ws.close();
    }

    // The real-room pool is exhausted for this IP, but the entirely separate
    // practice pool (a different capacity cap in limits.ts) must not be --
    // trying the practice table after hosting several real ones (or the
    // reverse) is an ordinary sequence, not abuse.
    const practice = await connect(ip);
    await expect(send(practice, "room:create-practice", { firstName: "Practice" })).resolves.toBeDefined();
    practice.close();
  });

  it("throttles room:create-practice the same way, independently of room:create", async () => {
    const ip = "198.51.100.40";
    for (let i = 0; i < WINDOW_LIMIT; i += 1) {
      const ws = await connect(ip);
      await send(ws, "room:create-practice", { firstName: `Practice${i}` });
      ws.close();
    }
    const oneTooMany = await connect(ip);
    await expect(
      send(oneTooMany, "room:create-practice", { firstName: "OneTooMany" }),
    ).rejects.toThrow("room_create_throttled");
    oneTooMany.close();
  });
});
