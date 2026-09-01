import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// The admin panel's Watch link. Its whole reason to exist is that the operator
// is NOT at the table: the first version was a plain link to /table/<id>, which
// dropped them on the lobby's join form and seated them as an ordinary player
// in the game they meant to observe. These pin the two halves of the fix --
// that a watcher is invisible and inert, and that a watch needs a real grant.
const PORT = 39741;
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
  const requestId = `w${++n}`;
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

/** Resolves with the next unsolicited broadcast of `type` (no requestId). */
function nextBroadcast(ws: WebSocket, type: string, ms = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`no ${type} broadcast within ${ms}ms`));
    }, ms);
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== type || msg.requestId) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(msg.payload);
    };
    ws.on("message", onMessage);
  });
}

describe("admin watch", () => {
  it("subscribes without seating anyone the table can see", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;

    const before = store.getRoom(roomId)!.players.length;
    const watcher = await connect();
    const ack = await send(watcher, "room:watch", { roomId, token: server.mintWatchToken(roomId) });

    expect(ack.watching).toBe(true);
    expect(ack.room.roomId).toBe(roomId);
    // The point of the feature: nothing was added to the roster, so there is
    // nothing for the players to render.
    expect(store.getRoom(roomId)!.players).toHaveLength(before);

    // And the subscription is real -- the watcher sees the table move.
    const seen = nextBroadcast(watcher, "round:state");
    await send(banker, "round:start", { roomId });
    expect((await seen).roundId).toBeTruthy();

    banker.close();
    watcher.close();
  });

  it("cannot act on the table it is watching", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;

    const watcher = await connect();
    await send(watcher, "room:watch", { roomId, token: server.mintWatchToken(roomId) });

    // Not a special-cased rejection: every action handler reads meta.playerId,
    // and attachWatcher deliberately never sets one.
    await expect(send(watcher, "round:start", { roomId })).rejects.toThrow("invalid_payload");

    banker.close();
    watcher.close();
  });

  it("refuses a missing, wrong-room or expired grant", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;
    const other = await send(banker, "room:create", { firstName: "Elsewhere" });

    const watcher = await connect();
    await expect(send(watcher, "room:watch", { roomId })).rejects.toThrow("watch_not_allowed");
    await expect(send(watcher, "room:watch", { roomId, token: "not-a-real-token" }))
      .rejects.toThrow("watch_not_allowed");
    // A grant is for ONE room. Without this, one Watch click would open every
    // table on the server to whoever kept the link.
    await expect(
      send(watcher, "room:watch", { roomId, token: server.mintWatchToken(other.room.roomId) })
    ).rejects.toThrow("watch_not_allowed");
    await expect(
      send(watcher, "room:watch", { roomId, token: server.mintWatchToken(roomId, -1) })
    ).rejects.toThrow("watch_not_allowed");

    banker.close();
    watcher.close();
  });

  it("leaves no room entry behind when the watcher disconnects", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;
    const watcher = await connect();
    await send(watcher, "room:watch", { roomId, token: server.mintWatchToken(roomId) });

    const tracked = server.trackedRoomCount;
    await new Promise<void>((resolve) => {
      watcher.once("close", () => resolve());
      watcher.close();
    });
    // The socket set must shrink, not just be forgotten -- a watcher left in it
    // would keep receiving a table it has closed, and hold the entry open.
    await new Promise((r) => setTimeout(r, 50));
    expect(server.trackedRoomCount).toBe(tracked);

    banker.close();
  });
});
