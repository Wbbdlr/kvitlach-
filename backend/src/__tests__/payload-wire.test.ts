import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// The unit tests in payload.test.ts cover the rule; this covers the WIRING --
// that it actually sits in front of every handler, over a real socket, and
// that a rejected payload comes back as a clean protocol error instead of the
// opaque "server_error" a TypeError deep in the store used to produce.
const PORT = 39733;
const URL = `ws://127.0.0.1:${PORT}`;

let store: GameStore;
let server: WSServer;

beforeAll(() => {
  store = new GameStore();
  server = new WSServer(store, PORT);
});
afterAll(() => {
  (server as unknown as { wss: { close: () => void } }).wss.close();
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

let n = 0;
function send(ws: WebSocket, type: string, payload: unknown): Promise<any> {
  const requestId = `p${++n}`;
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

describe("payload validation over a real socket", () => {
  it("rejects an object where a name is expected, rather than crashing in the store", async () => {
    const ws = await connect();
    // `{}` is truthy, so ws-server's own `if (!firstName)` guard passed it
    // straight through to sanitizeName's .trim().
    await expect(send(ws, "room:create", { firstName: { toString: "nope" } })).rejects.toThrow("invalid_payload");
    ws.close();
  });

  it("rejects a non-finite amount before it can reach a wallet", async () => {
    const ws = await connect();
    const created = await send(ws, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;
    const started = await send(ws, "round:start", { roomId });
    await expect(
      send(ws, "turn:bet", { roundId: started.round.roundId, amount: Infinity })
    ).rejects.toThrow("invalid_payload");
    ws.close();
  });

  it("still accepts a perfectly ordinary payload", async () => {
    const ws = await connect();
    const created = await send(ws, "room:create", { firstName: "Real", lastName: "Player", buyIn: 100 });
    expect(created.room.roomId).toBeTruthy();
    expect(created.player.firstName).toBe("Real");
    ws.close();
  });
});
