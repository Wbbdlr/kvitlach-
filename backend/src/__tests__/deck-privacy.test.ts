import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// The round object the server holds carries `deck` -- the live shoe, in
// DEALING ORDER. sanitizeRound() used to strip only the timer handles, so
// every round payload shipped that array to every client: a player could open
// devtools and read the next cards before deciding whether to hit. In a game
// people wager real chips on, that's the whole game.
//
// These assert on the raw JSON that actually crosses the socket rather than on
// sanitizeRound's return type, because a type is not what protects players --
// and because every ack, resume and broadcast funnels through that one method,
// so a single careless spread would reopen it everywhere at once.

const PORT = 39518;
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
  const requestId = `d${++reqCounter}`;
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

// Walks the whole payload rather than checking payload.deck, so a deck nested
// somewhere new (a round tucked inside an ack, say) still trips it.
function findDeckAnywhere(value: unknown, path = "payload"): string | undefined {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findDeckAnywhere(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "deck") return `${path}.deck`;
      const hit = findDeckAnywhere(child, `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe("the shoe never leaves the server", () => {
  it("sends a count instead of the cards, in acks and broadcasts alike", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker", buyIn: 100 });
    const roomId = created.room.roomId;

    const player = await connect();
    await send(player, "room:join", { roomId, firstName: "Alice" });

    // Capture what a NON-banker actually receives off the wire.
    const broadcasts: any[] = [];
    player.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "round:state") broadcasts.push(msg.payload);
    });

    const started = await send(banker, "round:start", { roomId });

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(findDeckAnywhere(started)).toBeUndefined();
    expect(broadcasts.length).toBeGreaterThan(0);
    for (const payload of broadcasts) {
      expect(findDeckAnywhere(payload)).toBeUndefined();
    }

    // ...and the count that replaced it is real, not a placeholder zero: two
    // seats have been dealt one card each out of a full shoe.
    const remaining = broadcasts[broadcasts.length - 1].deckRemaining;
    expect(typeof remaining).toBe("number");
    const shoeSize = store.getRound(started.round.roundId)!.deckCount! * 48;
    expect(remaining).toBe(shoeSize - 2);

    banker.close();
    player.close();
  });

  it("keeps it out of a resume, which replays a round mid-hand", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker", buyIn: 100 });
    const roomId = created.room.roomId;
    const token = created.session.token;
    await send(banker, "round:start", { roomId });

    const resumed = await connect();
    const payload = await send(resumed, "room:resume", { roomId, playerId: created.player.id, token });

    expect(findDeckAnywhere(payload)).toBeUndefined();
    expect(typeof payload.round.deckRemaining).toBe("number");

    banker.close();
    resumed.close();
  });
});
