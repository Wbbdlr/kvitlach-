import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// applyBet is the only place that BUILDS an error code instead of naming one:
// `bank_limit:${available}`, carrying the number the wager has to fit inside.
// The catch-all in handleMessage decides what reaches a client by the SHAPE of
// the message, and its shape test had no room for the colon -- so this one
// code, on the most consequential refusal in the game, was rewritten to
// "server_error" and surfaced to the player as "Something went wrong on our
// end. Please try again." after they tapped BANK!.
//
// errorCopy already had the right sentence for it and could never be reached.
// Nothing tested the join between the two, which is why it survived: the
// backend suite only ever asserted the throw, and the frontend suite only ever
// asserted the copy.
const PORT = 39647;
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
  const requestId = `bl${++reqCounter}`;
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

describe("a refused BANK! wager over the wire", () => {
  it("tells the client the bank's number instead of server_error", async () => {
    const host = await connect();
    const created = await send(host, "room:create", { firstName: "Banker", buyIn: 100, bankerBankroll: 15 });
    const roomId = created.room.roomId as string;

    const guest = await connect();
    await send(guest, "room:join", { roomId, firstName: "Player" });

    const started = await send(host, "round:start", { roomId });
    const roundId = started.round.roundId as string;
    const firstSeat = started.round.turns.find((t: any) => t.player.type !== "admin").player.id as string;
    const actor = firstSeat === created.player.id ? host : guest;

    // 20 against a 15-chip bank. The wager is refused either way; what this
    // asserts is what the player is told about it.
    await expect(send(actor, "turn:bet", { roundId, amount: 20, bank: true })).rejects.toThrow("bank_limit:15");

    host.close();
    guest.close();
  });

  // The other half of the shape test, which is the reason it exists at all: a
  // real exception must still be masked. Widening it to admit `code:<digits>`
  // must not widen it to admit `TypeError: cannot read properties of ...`.
  it("still masks an exception that is not a protocol code", async () => {
    const ws = await connect();
    // Whatever this refusal turns out to be, the one thing it must never be
    // is prose: no exception text, no table or column names, no internals.
    await expect(send(ws, "turn:bet", { roundId: "nope", amount: 5 })).rejects.toThrow(/^[a-z][a-z0-9_]*(:[0-9]+(\.[0-9]+)?)?$/);
    ws.close();
  });
});

// The cause behind the code above, pinned separately because fixing the
// message would have left the refusal itself in place.
//
// Wallets move mid-round (settleImmediateTurn), but the room used to be
// broadcast only at "terminate". Every client therefore rendered the bank's
// pre-payout balance for the rest of the round -- and BANK! sizes its wager
// off exactly that number, so the client sent one the bank could no longer
// cover and got refused for it.
describe("wallets moving mid-round", () => {
  it("broadcasts the room on a turn action, not only when the round ends", async () => {
    const host = await connect();
    const created = await send(host, "room:create", { firstName: "Banker", buyIn: 100, bankerBankroll: 400 });
    const roomId = created.room.roomId as string;

    const guest = await connect();
    await send(guest, "room:join", { roomId, firstName: "Player" });
    const started = await send(host, "round:start", { roomId });
    const roundId = started.round.roundId as string;

    const seat = started.round.turns.find((t: any) => t.player.type !== "admin").player.id as string;
    const actor = seat === created.player.id ? host : guest;

    const rooms: any[] = [];
    const listen = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "room:state") rooms.push(msg.payload.room);
    };
    guest.on("message", listen);

    await send(actor, "turn:bet", { roundId, amount: 5 });
    await new Promise((r) => setTimeout(r, 50));

    // The round is still live -- this is the broadcast that did not exist.
    expect(rooms.length).toBeGreaterThan(0);
    guest.off("message", listen);
    host.close();
    guest.close();
  });
});
