import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// The store's own rules for this are covered next door in
// practice-bank-topup.test.ts. What that file cannot see is the wire: whether
// `bank:practice-topup` is a message type the server actually knows, whether
// it reads the amount out of the payload, and whether it takes the actor from
// the socket rather than from anything the client sent.
//
// Written after a live check answered "Something went wrong. Please try
// again." - which is errorCopy's text for `unknown_type`, i.e. a server that
// had never heard of the message. That turned out to be a stale dev process
// rather than a real defect, but the reason it took a manual session to find
// out is that nothing here exercised the handler. Now something does.

const PORT = 39644;
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

let reqCounter = 0;
function send(ws: WebSocket, type: string, payload: unknown): Promise<any> {
  const requestId = `w${++reqCounter}`;
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

async function practiceSocket() {
  const ws = await connect();
  const created = await send(ws, "room:create-practice", { firstName: "Tester", botCount: 2, buyIn: 100 });
  const roomId = created.room.roomId as string;
  const banker = created.room.players.find((p: any) => p.type === "admin");
  return { ws, roomId, bankerId: banker.id as string };
}

describe("bank:practice-topup over the wire", () => {
  it("is a message type the server knows, and puts the asked-for amount in", async () => {
    const { ws, roomId, bankerId } = await practiceSocket();
    store.getRoom(roomId)!.wallets[bankerId] = 0;

    const result = await send(ws, "bank:practice-topup", { roomId, amount: 275 });

    expect(result.topUp.amount).toBe(275);
    expect(result.room.wallets[bankerId]).toBe(275);
    ws.close();
  });

  it("refuses a payload with no amount rather than guessing one", async () => {
    const { ws, roomId, bankerId } = await practiceSocket();
    store.getRoom(roomId)!.wallets[bankerId] = 0;

    await expect(send(ws, "bank:practice-topup", { roomId })).rejects.toThrow(/invalid_payload/);
    expect(store.getRoom(roomId)!.wallets[bankerId]).toBe(0);
    ws.close();
  });

  // Server authority rule 1: the actor is the socket's own session, never the
  // payload. A client naming somebody else must not be able to act as them.
  it("ignores a playerId in the payload and uses the socket's own", async () => {
    const { ws, roomId, bankerId } = await practiceSocket();
    store.getRoom(roomId)!.wallets[bankerId] = 0;

    const result = await send(ws, "bank:practice-topup", { roomId, amount: 100, playerId: "somebody-else" });

    expect(result.topUp.amount).toBe(100);
    ws.close();
  });

  it("refuses on a socket that has not joined any room", async () => {
    const ws = await connect();
    await expect(send(ws, "bank:practice-topup", { roomId: "NOPE", amount: 100 })).rejects.toThrow();
    ws.close();
  });
});
