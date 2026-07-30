import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// player:react re-validates every reaction against its own server-side
// allow-list (a copy of frontend/src/table/selectors.ts's REACTION_EMOJIS /
// REACTION_PHRASES / REACTION_GAME_CALLS) rather than trusting the client,
// so the two lists have to be kept in sync by hand. This locks in that the
// newest additions (REACTION_GAME_CALLS, plus the emoji swapped in when the
// flatter-looking glyphs were dropped) are actually accepted, and that an
// arbitrary string is still rejected rather than broadcast verbatim.

const PORT = 39424;
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
  const requestId = `r${++reqCounter}`;
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

function nextReaction(ws: WebSocket): Promise<{ emoji: string }> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== "reaction:new") return;
      ws.off("message", onMessage);
      resolve(msg.payload);
    };
    ws.on("message", onMessage);
  });
}

describe("player:react allow-list over a live WebSocket connection", () => {
  it("accepts a new emoji, a game-call phrase, and an existing Hebrew phrase, but substitutes an arbitrary string", async () => {
    const ws = await connect();
    await send(ws, "room:create", { firstName: "Host" });

    const gotJoker = nextReaction(ws);
    await send(ws, "player:react", { emoji: "🃏" });
    expect((await gotJoker).emoji).toBe("🃏");

    const gotBank = nextReaction(ws);
    await send(ws, "player:react", { emoji: "BANK!" });
    expect((await gotBank).emoji).toBe("BANK!");

    const gotHebrew = nextReaction(ws);
    await send(ws, "player:react", { emoji: "גוואלד" });
    expect((await gotHebrew).emoji).toBe("גוואלד");

    const gotSleep = nextReaction(ws);
    await send(ws, "player:react", { emoji: "💤" }); // re-added after briefly being dropped
    expect((await gotSleep).emoji).toBe("💤");

    const gotGaiShoyn = nextReaction(ws);
    await send(ws, "player:react", { emoji: "גיי שוין" });
    expect((await gotGaiShoyn).emoji).toBe("גיי שוין");

    const gotFallback = nextReaction(ws);
    await send(ws, "player:react", { emoji: "<script>alert(1)</script>" });
    expect((await gotFallback).emoji).toBe("👏");

    ws.close();
  });

  it("rejects a dropped-emoji fallback the same way (no longer allowed once removed from the list)", async () => {
    const ws = await connect();
    await send(ws, "room:create", { firstName: "Host2" });

    const gotFallback = nextReaction(ws);
    await send(ws, "player:react", { emoji: "✅" }); // removed for reading as flat/monochrome
    expect((await gotFallback).emoji).toBe("👏");

    ws.close();
  });
});
