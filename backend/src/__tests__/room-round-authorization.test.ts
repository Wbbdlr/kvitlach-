import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// Regression coverage for a real vulnerability found during a security pass:
// room:get and round:get had NO authorization at all. Unlike every other
// handler (turn:bet, round:start, player:kick...), which derives its actor
// from meta.playerId and lets the store reject a mismatch, these two just
// took an id from the client and handed back the raw object -- reachable by
// a socket that had never sent room:create/join/resume/watch at all.
//
// room:get returned the FULL RoomState, including the room's plaintext
// password (store.ts's getRoom does no redaction) -- so a "password
// protected" table's password could be read by anyone who knew the room id,
// without attempting to join and without knowing the password. Room ids are
// exactly the string players are told to share to join, so this was not a
// brute-force problem; it was zero-effort against a code shared in good
// faith.
//
// round:get returned the full round (via sanitizeRound, which only strips
// the internal deck/timers -- see the separate concealed-cards fix) to
// anyone who knew a roundId, again with no membership check.
//
// Fixed the same way every other handler already worked: the caller's own
// attached room (meta.roomId, set server-side by attach()/attachWatcher(),
// never client-supplied) has to match the room being asked about.

const PORT = 39762;
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

// A distinct synthetic IP per connection by default -- see
// concealed-cards.test.ts's identical comment; room:create's own per-IP
// throttle would otherwise collide across this file's several fresh rooms.
let ipCounter = 0;
function connect(ip = `10.55.${++ipCounter}.1`): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { headers: { "x-forwarded-for": ip } });
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

describe("room:get / round:get authorization — a bystander is not a member", () => {
  it("refuses room:get to a socket that never joined that room, and never leaks the password", async () => {
    const banker = await connect();
    const bystander = await connect();

    const created = await send(banker, "room:create", { firstName: "Banker", password: "family-night" });
    const roomId = created.room.roomId;

    // The bystander has an open, fully working connection -- it just never
    // sent room:create/join/resume/watch for THIS room. That is the entire
    // bar this is meant to clear: knowing a room id is not membership.
    await expect(send(bystander, "room:get", { roomId })).rejects.toThrow("forbidden");

    banker.close();
    bystander.close();
  });

  it("still lets an actual member read their own room", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;

    const result = await send(banker, "room:get", { roomId });
    expect(result.room.roomId).toBe(roomId);

    banker.close();
  });

  it("refuses round:get to a socket that never joined the round's room", async () => {
    const banker = await connect();
    const bystander = await connect();

    const created = await send(banker, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;
    const started = await send(banker, "round:start", { roomId });
    const roundId = started.round.roundId;

    // The bystander is attached to no room at all -- meta.roomId is
    // undefined, which must not accidentally equal an undefined round lookup
    // and slip through.
    await expect(send(bystander, "round:get", { roundId })).rejects.toThrow("forbidden");

    // Nor does being a member of a DIFFERENT room help -- knowing another
    // table's roundId is exactly the same "knew an id" bar as above.
    const otherRoom = await send(bystander, "room:create", { firstName: "OtherBanker" });
    await expect(send(bystander, "round:get", { roundId })).rejects.toThrow("forbidden");
    void otherRoom;

    banker.close();
    bystander.close();
  });

  it("still lets an actual member of the round's room read it", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;
    const started = await send(banker, "round:start", { roomId });
    const roundId = started.round.roundId;

    const result = await send(banker, "round:get", { roundId });
    expect(result.round.roundId).toBe(roundId);

    banker.close();
  });

  it("a room:watch grant counts as membership for both", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;
    const started = await send(banker, "round:start", { roomId });
    const roundId = started.round.roundId;

    const watcher = await connect();
    const token = server.mintWatchToken(roomId);
    await send(watcher, "room:watch", { roomId, token });

    await expect(send(watcher, "room:get", { roomId })).resolves.toMatchObject({ room: { roomId } });
    await expect(send(watcher, "round:get", { roundId })).resolves.toMatchObject({ round: { roundId } });

    banker.close();
    watcher.close();
  });
});
