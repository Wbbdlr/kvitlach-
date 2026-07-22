import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// Regression coverage for a real vulnerability found during a pre-launch security
// pass: turn:bet / turn:hit / turn:stand / turn:skip used to trust a client-supplied
// `playerId`/`actorId` in the message payload (falling back to the session-bound
// identity only if absent), instead of relying exclusively on the identity the
// socket authenticated as via room:create/join/resume. Any connected player could
// therefore act — or, for turn:skip, exercise admin authority — as any other named
// player in the room simply by setting that field, since player ids are visible to
// everyone via room:state broadcasts. Fixed by ignoring the payload field entirely
// and using only the socket's authenticated `meta.playerId`.

const PORT = 39421;
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

describe("WS authorization — identity must come from the session, never the payload", () => {
  it("turn:bet/turn:hit ignore a spoofed playerId and only ever act as the authenticated socket", async () => {
    const admin = await connect();
    const attacker = await connect();

    const created = await send(admin, "room:create", { firstName: "Admin" });
    const roomId = created.room.roomId;
    const adminId = created.player.id;

    const joined = await send(attacker, "room:join", { roomId, firstName: "Attacker" });
    const attackerId = joined.player.id;

    const started = await send(admin, "round:start", { roomId });
    const roundId = started.round.roundId;

    // Attacker sends turn:bet claiming to act as the admin.
    const afterBet = await send(attacker, "turn:bet", { roundId, amount: 25, playerId: adminId });
    const adminTurn = afterBet.round.turns.find((t: any) => t.player.id === adminId);
    const attackerTurn = afterBet.round.turns.find((t: any) => t.player.id === attackerId);

    expect(adminTurn.bet).toBe(0); // the impersonation target must be untouched
    expect(attackerTurn.bet).toBe(25); // the actual, authenticated socket is the one charged

    const adminCardsBefore = adminTurn.cards.length;
    const afterHit = await send(attacker, "turn:hit", { roundId, playerId: adminId });
    const adminTurnAfterHit = afterHit.round.turns.find((t: any) => t.player.id === adminId);
    expect(adminTurnAfterHit.cards.length).toBe(adminCardsBefore); // admin's hand never moved

    admin.close();
    attacker.close();
  });

  it("turn:skip ignores a spoofed actorId — a non-admin cannot borrow admin authority to skip another player", async () => {
    const admin = await connect();
    const attacker = await connect();
    const victim = await connect();

    const created = await send(admin, "room:create", { firstName: "Admin2" });
    const roomId = created.room.roomId;
    const adminId = created.player.id;

    await send(attacker, "room:join", { roomId, firstName: "Attacker2" });
    const victimJoined = await send(victim, "room:join", { roomId, firstName: "Victim" });
    const victimId = victimJoined.player.id;

    const started = await send(admin, "round:start", { roomId });
    const roundId = started.round.roundId;

    // Attacker is not the admin, but claims to be (via actorId) to skip the victim's turn.
    await expect(
      send(attacker, "turn:skip", { roundId, playerId: victimId, actorId: adminId })
    ).rejects.toThrow("forbidden");

    admin.close();
    attacker.close();
    victim.close();
  });
});
