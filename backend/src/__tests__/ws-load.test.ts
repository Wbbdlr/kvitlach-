import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// The design target is a ~50-person night on one table, and the connection cap
// is per IP (MAX_CONNS_PER_IP). That pairing is only safe if the server sees
// real client IPs -- and behind a Cloudflare Tunnel, if X-Forwarded-For ever
// stopped arriving, every player would collapse into a single IP bucket and
// the cap would become a global ceiling instead of an anti-abuse limit.
//
// Every connection in this file comes from 127.0.0.1, so this IS that worst
// case, tested deliberately rather than hoped about: if a full table can
// connect and play when the server thinks they share one address, then the
// shared-IP failure mode cannot take the night down on its own.
//
// Own file, own port, own server: the cap is per IP and counts across a whole
// process, so running this alongside ws-protocol.test.ts's ~28 sockets in one
// file would drift toward the ceiling and fail on test ORDER rather than on
// anything real.
// Test files run in parallel and each binds its own port, so this must be
// unique across the whole __tests__ directory -- 39424 looked free and was
// already reaction-allowlist.test.ts's, which fails as a bare EADDRINUSE
// attributed to whichever file lost the race, not to the one that moved in.
// Check with: grep -rho '39[0-9]\{3\}' src/__tests__
const PORT = 39725;
const URL = `ws://127.0.0.1:${PORT}`;
const TABLE_SIZE = 50;

let store: GameStore;
let server: WSServer;
const openSockets: WebSocket[] = [];

beforeAll(() => {
  store = new GameStore();
  server = new WSServer(store, PORT);
});

afterAll(() => {
  openSockets.forEach((ws) => {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
  });
  (server as unknown as { wss: { close: () => void } }).wss.close();
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const timer = setTimeout(() => reject(new Error("connect timeout")), 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      openSockets.push(ws);
      resolve(ws);
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

let reqCounter = 0;
function send(ws: WebSocket, type: string, payload: unknown): Promise<any> {
  const requestId = `l${++reqCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timed out`)), 15_000);
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.requestId !== requestId) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      if (msg.type === "error") reject(new Error(msg.error?.message ?? "error"));
      else resolve(msg.payload);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type, payload, requestId }));
  });
}

describe("WS load -- a full ~50-person table on a single shared IP", () => {
  it("seats the whole room, deals, and keeps every client live", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker", buyIn: 100, bankerBankroll: 5000 });
    const roomId = created.room.roomId;
    const bankerId = created.player.id;

    // Sequential joins: 50 sockets racing the same room is a load pattern the
    // real thing never produces (people arrive over minutes) and would only be
    // testing the accept backlog, not the app.
    const guests: WebSocket[] = [];
    for (let i = 0; i < TABLE_SIZE; i += 1) {
      const ws = await connect();
      await send(ws, "room:join", { roomId, firstName: `Guest${String(i).padStart(2, "0")}` });
      guests.push(ws);
    }

    const room = store.getRoom(roomId)!;
    expect(room.players).toHaveLength(TABLE_SIZE + 1); // everyone + the banker
    // Nobody was silently dropped by the per-IP cap on the way in.
    expect(new Set(room.players.map((p) => p.id)).size).toBe(TABLE_SIZE + 1);

    const started = await send(banker, "round:start", { roomId });
    // The cap on SEATS is separate from the cap on connections: 11 play, the
    // rest queue. Both have to hold at once for a big night to work.
    expect(started.round.turns.length).toBe(12); // 11 seated + the banker
    expect(store.getRoom(roomId)!.waitingPlayerIds).toHaveLength(TABLE_SIZE - 11);

    // Every socket must still be usable afterwards -- a connection that
    // survives the join but is dead by the first deal is the same outage from
    // the player's side.
    expect(guests.every((ws) => ws.readyState === WebSocket.OPEN)).toBe(true);
    const lastGuest = guests[guests.length - 1];
    const fetched = await send(lastGuest, "room:get", { roomId });
    expect(fetched.room.roomId).toBe(roomId);
    expect(bankerId).toBeTruthy();
  }, 120_000);
});

describe("WS load -- the per-socket message rate limit", () => {
  it("cuts off a flooding socket without disturbing a normal one", async () => {
    // MAX_MSGS_PER_WINDOW is 30 per 10s per socket. A human playing a hand
    // sends single digits in that time, so this should only ever catch a
    // runaway client -- the point of the second half of this test.
    const flooder = await connect();
    await send(flooder, "room:create", { firstName: "Flooder" });

    const closed = new Promise<number>((resolve) => {
      flooder.once("close", (code) => resolve(code));
    });
    for (let i = 0; i < 60; i += 1) {
      if (flooder.readyState !== WebSocket.OPEN) break;
      flooder.send(JSON.stringify({ type: "room:get", payload: {}, requestId: `flood${i}` }));
    }
    // 1008 = policy violation, which is what the server closes with.
    await expect(closed).resolves.toBe(1008);

    // A well-behaved client on its own socket is untouched: the limit is
    // per-socket, so one runaway phone must not take the table down with it.
    const bystander = await connect();
    const made = await send(bystander, "room:create", { firstName: "Bystander" });
    expect(made.room.roomId).toBeTruthy();
  }, 60_000);
});
