import { describe, expect, it, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// Leaving a table, and coming back to it.
//
// Found by playing, 2026-09-06. A player with $75 tapped Leave (no
// confirmation, instant reload) and rejoined under the same name. The table
// then read:
//
//   Rivka S  $75      <- the seat she left, still holding her chips
//   Rivka S  $100     <- a brand new seat, freshly bought in
//
// Two people, one of whom nobody can reach, and $100 of chips that did not
// exist a moment earlier. The banker's only tools were Kick (which destroys
// the stranded $75) or Adjust (which invents more).
//
// The cause was not subtle once found: `GameStore.leaveRoom` existed but had
// NO CALLERS ANYWHERE -- no `room:leave` message type, no handler, nothing in
// ws-server.ts. The Leave button only ever cleared the browser's own session
// token and reloaded the page. The server was never told, so the seat stayed
// forever (offline), and the returning player -- now with no session token to
// resume from -- could only ever arrive as a stranger.
//
// leaveRoom was also incomplete next to its own sibling: kickPlayer strips the
// player's turn from the live round, clears a bankLock held by them, deletes
// their wallet and cleans four id lists; leaveRoom filtered `players` and
// `waitingPlayerIds` and stopped. Wiring it up as it stood would have traded
// one orphan for a subtler one.
//
// The fix is two doors instead of one, because there are genuinely two
// intentions behind that button and they want opposite things:
//
//   Step away     -- keep the seat and the stack; the session token survives,
//                    so coming back resumes exactly where you were. This is
//                    what an accidental tap, a dying battery or "I'll restart
//                    the app to fix it" should do.
//   Leave for good -- send room:leave; the seat and the wallet entry both go,
//                    the same complete removal a kick performs.
//
// The invariant these tests exist to hold: **no chips may ever belong to a
// player who is not seated.** Either the seat is there with its stack, or
// neither is.

const PORT = 39471;
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
  const requestId = `lv${++reqCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`no ack for ${type}`));
    }, 3000);
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.requestId !== requestId) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      if (msg.type === "error") reject(new Error(msg.error?.code ?? msg.error?.message ?? "error"));
      else resolve(msg.payload);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type, payload, requestId }));
  });
}

/**
 * Every chip the room believes exists, wherever it is sitting.
 *
 * The number itself is not the point -- a real buy-in legitimately adds chips
 * to a table, the way handing the banker cash does. What must never happen is
 * this total counting money held by a seat nobody occupies.
 */
function chipsOnTable(room: { wallets: Record<string, number> }) {
  return Object.values(room.wallets).reduce((sum, n) => sum + n, 0);
}

function orphanedWallets(room: { wallets: Record<string, number>; players: { id: string }[] }) {
  const seated = new Set(room.players.map((p) => p.id));
  return Object.keys(room.wallets).filter((id) => !seated.has(id));
}

describe("leaving for good", () => {
  it("takes the seat and the chips together, leaving nothing orphaned", () => {
    const s = new GameStore();
    const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 600 });
    const { player: rivka } = s.joinRoom(room.roomId, { firstName: "Rivka", lastName: "S" });
    s.adjustPlayerWallet(room.roomId, admin.id, rivka.id, -25);
    expect(s.getRoom(room.roomId)!.wallets[rivka.id]).toBe(75);

    s.leaveRoom(room.roomId, rivka.id);

    const after = s.getRoom(room.roomId)!;
    expect(after.players.find((p) => p.id === rivka.id)).toBeUndefined();
    // The half leaveRoom never did: her $75 stayed in room.wallets, attached
    // to nobody, counted by every total the room reports.
    expect(after.wallets[rivka.id]).toBeUndefined();
    expect(orphanedWallets(after)).toEqual([]);
    expect(chipsOnTable(after)).toBe(600);
  });

  it("is the exact scenario from the felt: leave, rejoin under the same name, one seat", () => {
    const s = new GameStore();
    const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 600 });
    const { player: rivka } = s.joinRoom(room.roomId, { firstName: "Rivka", lastName: "S" });
    s.adjustPlayerWallet(room.roomId, admin.id, rivka.id, -25);

    s.leaveRoom(room.roomId, rivka.id);
    const { player: rivkaAgain } = s.joinRoom(room.roomId, { firstName: "Rivka", lastName: "S" });

    const after = s.getRoom(room.roomId)!;
    const bearingHerName = after.players.filter((p) => p.firstName === "Rivka");
    expect(bearingHerName).toHaveLength(1);
    expect(bearingHerName[0].id).toBe(rivkaAgain.id);
    expect(orphanedWallets(after)).toEqual([]);
    // She bought in again, so there is more money on the table than before --
    // that part is correct and mirrors handing the banker another $100. What
    // must not survive is the $75 seat she left behind.
    expect(chipsOnTable(after)).toBe(700);
  });

  it("does the same complete removal a kick does when the player is mid-round", () => {
    const s = new GameStore();
    const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 600 });
    const { player: rivka } = s.joinRoom(room.roomId, { firstName: "Rivka" });
    s.joinRoom(room.roomId, { firstName: "Sara" });
    const round = s.startRound(room.roomId, admin.id);
    expect(round.turns.some((t) => t.player.id === rivka.id)).toBe(true);

    s.leaveRoom(room.roomId, rivka.id);

    // A turn left behind in the round is a seat the felt still draws and the
    // bank still reserves chips against, for a player who is gone.
    const live = s.getRound(round.roundId)!;
    expect(live.turns.some((t) => t.player.id === rivka.id)).toBe(false);
    expect(orphanedWallets(s.getRoom(room.roomId)!)).toEqual([]);
  });

  it("clears the bank lock if the leaver was the one holding it", () => {
    const s = new GameStore();
    const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 500, bankerBankroll: 100 });
    const { player: rivka } = s.joinRoom(room.roomId, { firstName: "Rivka" });
    let r = s.startRound(room.roomId, admin.id);
    r = s.applyBet(r.roundId, rivka.id, 100, { bank: true });
    expect(s.getRound(r.roundId)!.bankLock?.playerId).toBe(rivka.id);

    s.leaveRoom(room.roomId, rivka.id);

    // A lock naming an absent player freezes the table for everyone still in
    // it, with no one able to resolve it.
    expect(s.getRound(r.roundId)!.bankLock).toBeUndefined();
  });

  it("removes the leaver from every id list that can name them", () => {
    const s = new GameStore();
    const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 600 });
    const { player: rivka } = s.joinRoom(room.roomId, { firstName: "Rivka" });
    s.requestRename(room.roomId, rivka.id, "Rivkie");
    s.requestBuyIn(room.roomId, rivka.id, 50);
    s.startRound(room.roomId, admin.id);
    const { player: late } = s.joinRoom(room.roomId, { firstName: "Late" });
    expect(s.getRoom(room.roomId)!.waitingPlayerIds).toContain(late.id);

    s.leaveRoom(room.roomId, rivka.id);
    s.leaveRoom(room.roomId, late.id);

    const after = s.getRoom(room.roomId)!;
    expect(after.renameRequests.some((r) => r.playerId === rivka.id)).toBe(false);
    expect(after.buyInRequests.some((r) => r.playerId === rivka.id)).toBe(false);
    expect(after.waitingPlayerIds).not.toContain(late.id);
  });

  // The bank is the banker's own wallet, so a banker who deleted themselves
  // would take the bank with them and leave a table nobody can deal at. They
  // have two real exits already: pass the bank, or end the game.
  it("refuses to let the banker delete themselves out of their own table", () => {
    const s = new GameStore();
    const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 600 });
    s.joinRoom(room.roomId, { firstName: "Rivka" });

    expect(() => s.leaveRoom(room.roomId, admin.id)).toThrow("banker_cannot_leave");
    expect(s.getRoom(room.roomId)!.players.some((p) => p.id === admin.id)).toBe(true);
    expect(s.getRoom(room.roomId)!.wallets[admin.id]).toBe(600);
  });

  it("is a no-op for a player who is not in the room", () => {
    const s = new GameStore();
    const { room } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 600 });
    const before = JSON.stringify(s.getRoom(room.roomId));
    expect(() => s.leaveRoom(room.roomId, "nobody")).not.toThrow();
    expect(JSON.stringify(s.getRoom(room.roomId))).toBe(before);
  });
});

describe("stepping away", () => {
  it("keeps the seat and the stack, so resuming lands on the same player", () => {
    const s = new GameStore();
    const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 600 });
    const { player: rivka, sessionToken } = s.joinRoom(room.roomId, { firstName: "Rivka" });
    s.adjustPlayerWallet(room.roomId, admin.id, rivka.id, -25);

    // Stepping away is a disconnect, not a departure -- exactly what the
    // socket closing already does.
    s.setPresence(room.roomId, rivka.id, "offline");
    const resumed = s.resumePlayer(room.roomId, rivka.id, sessionToken);

    expect(resumed).toBeTruthy();
    expect(s.getRoom(room.roomId)!.players.some((p) => p.id === rivka.id)).toBe(true);
    expect(s.getRoom(room.roomId)!.wallets[rivka.id]).toBe(75);
    expect(chipsOnTable(s.getRoom(room.roomId)!)).toBe(675);
  });
});

describe("room:leave over the wire", () => {
  it("removes the sender's own seat", async () => {
    const host = await connect();
    const created = await send(host, "room:create", { firstName: "Zeide", buyIn: 100, bankerBankroll: 600 });
    const roomId = created.room.roomId;

    const guest = await connect();
    const joined = await send(guest, "room:join", { roomId, firstName: "Rivka" });
    expect(store.getRoom(roomId)!.players).toHaveLength(2);

    await send(guest, "room:leave", { roomId });

    const after = store.getRoom(roomId)!;
    expect(after.players.some((p) => p.id === joined.player.id)).toBe(false);
    expect(after.wallets[joined.player.id]).toBeUndefined();
    host.close();
    guest.close();
  });

  // CLAUDE.md, server authority #1: the actor is the socket's own session,
  // never the payload. Without this, `room:leave` is a way to throw anyone
  // off the table -- including the banker -- for the price of knowing their id.
  it("cannot be aimed at somebody else", async () => {
    const host = await connect();
    const created = await send(host, "room:create", { firstName: "Zeide", buyIn: 100, bankerBankroll: 600 });
    const roomId = created.room.roomId;
    const hostPlayerId = created.player.id;

    const guest = await connect();
    await send(guest, "room:join", { roomId, firstName: "Rivka" });

    await send(guest, "room:leave", { roomId, playerId: hostPlayerId });

    // The banker is still seated; only the sender left.
    expect(store.getRoom(roomId)!.players.some((p) => p.id === hostPlayerId)).toBe(true);
    host.close();
    guest.close();
  });
});
