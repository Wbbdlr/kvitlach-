import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// Regression coverage for a real bug found during manual verification: a
// practice round's RoundContext carries a live `botTimer` (NodeJS.Timeout)
// handle while a bot's turn is pending. sanitizeRound() strips `timer` and
// `turnTimer` before a round gets JSON.stringify'd for broadcast, but the
// first version of this feature forgot `botTimer` too -- every bot-driven
// round:state broadcast during a practice game silently crashed with
// "Converting circular structure to JSON" inside WSServer.send, discarding
// the message. The human's client still eventually saw the *final* result
// (by the time a round terminates, botTimer is already cleared), so this was
// invisible from unit tests against store.ts alone and from a cursory
// glance at the finished game -- only caught by watching live traffic.
// This test asserts the server stays alive and keeps broadcasting normally
// through an entire unattended bot-driven practice round.

const PORT = 39422;
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
  const requestId = `p${++reqCounter}`;
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

describe("practice mode over a live WebSocket connection", () => {
  it("keeps broadcasting round:state through an entire unattended bot cascade, with no serialization errors", async () => {
    const human = await connect();
    const created = await send(human, "room:create-practice", { firstName: "Dovid" });
    const roundId = created.round.roundId;

    const roundStateMessages: any[] = [];
    const errorMessages: any[] = [];
    human.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "round:state") roundStateMessages.push(msg.payload);
      if (msg.type === "error") errorMessages.push(msg);
    });

    // Resolve the human's own turn (a $0 stand -- the simplest legitimate
    // action) so the bank/player bots are free to cascade unattended.
    await send(human, "turn:stand", { roundId });

    // Give the bot cascade (banker + 2 players, ~0.5-1.2s think delay each,
    // possibly several hit/stand cycles) real wall-clock time to play out.
    // Polls instead of a single fixed sleep: a flat 6s wait was intermittently
    // too tight for the full cascade under real machine load/scheduling
    // jitter (observed failing standalone, unrelated to system contention --
    // confirmed by bisecting against a clean git stash), so this resolves the
    // moment a terminal state actually shows up instead of gambling on one
    // fixed budget, with a generous ceiling for a genuine stall.
    const deadline = Date.now() + 14000;
    while (Date.now() < deadline && !roundStateMessages.some((r) => r.state === "terminate")) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(errorMessages).toEqual([]);
    // More than just the ack's own round + one broadcast after the human's
    // stand -- proves the bots' OWN actions kept producing live updates too,
    // which is exactly the path that used to throw on the circular botTimer.
    expect(roundStateMessages.length).toBeGreaterThan(2);

    // The round should have reached a terminal state at some point (won/lost
    // for every non-pending seat) -- confirms the cascade actually completed
    // rather than silently stalling after the first successful broadcast.
    const sawTerminate = roundStateMessages.some((r) => r.state === "terminate");
    expect(sawTerminate).toBe(true);

    human.close();
  }, 20000);
});
