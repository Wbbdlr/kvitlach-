import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// Coverage was the reason this file exists, not a hunch: a v8 run put
// ws-server.ts at 57% statements / 37% BRANCH, with one unbroken uncovered
// block spanning roughly every handler from round:void-abandoned through
// room:reshuffle-deck. That block is the whole admin and money surface --
// rename, buy-in, kick, close, bank-adjust, banker-topup, watermark, reshuffle
// -- and it is where untrusted client payloads land. ws-auth.test.ts already
// pins the identity invariant for the four turn:* handlers; this pins
// authorization and validation for the rest.
//
// Port is deliberately distinct from ws-auth.test.ts (39421) and
// practice-ws.test.ts (39422): the suite runs files in parallel by default and
// a shared port would bind-conflict rather than fail with anything readable.
const PORT = 39423;
const URL = `ws://127.0.0.1:${PORT}`;

let store: GameStore;
let server: WSServer;
const openSockets: WebSocket[] = [];

beforeAll(() => {
  store = new GameStore();
  server = new WSServer(store, PORT);
});

afterAll(() => {
  openSockets.forEach((ws) => {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
  });
  (server as unknown as { wss: { close: () => void } }).wss.close();
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once("open", () => {
      openSockets.push(ws);
      resolve(ws);
    });
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

// A banker plus one ordinary player, both on real sockets.
async function makeTable() {
  const bankerWs = await connect();
  const playerWs = await connect();
  const created = await send(bankerWs, "room:create", { firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
  const roomId = created.room.roomId;
  const bankerId = created.player.id;
  const joined = await send(playerWs, "room:join", { roomId, firstName: "Player" });
  return { bankerWs, playerWs, roomId, bankerId, playerId: joined.player.id };
}

function walletOf(roomId: string, playerId: string): number {
  return store.getRoom(roomId)!.wallets[playerId] ?? 0;
}

describe("WS protocol -- admin-gated handlers reject an ordinary player", () => {
  // Every one of these moves money, changes who is at the table, or changes
  // what the table looks like. The handlers themselves only check that SOME
  // authenticated actor sent the message; the actual authorization lives one
  // layer down in the store's isAdmin. That split is fine, but it means
  // nothing at the protocol boundary was proving it held -- which is exactly
  // the shape of the bug class this suite exists to catch.
  it("refuses all of them, and leaves the table untouched", async () => {
    const { playerWs, roomId, bankerId, playerId } = await makeTable();

    const forbidden: Array<[string, unknown]> = [
      ["player:kick", { roomId, playerId: bankerId }],
      ["room:close", { roomId }],
      ["player:bank-adjust", { roomId, playerId, amount: 1_000_000 }],
      ["room:banker-topup", { roomId, amount: 1_000_000 }],
      ["room:set-watermark", { roomId, text: "pwned" }],
      ["room:reshuffle-deck", { roomId }],
      ["player:rename-approve", { roomId, playerId }],
      ["player:rename-reject", { roomId, playerId }],
      ["player:rename-block", { roomId, playerId, block: true }],
      ["player:buyin-approve", { roomId, playerId }],
      ["player:buyin-reject", { roomId, playerId }],
      ["player:buyin-block", { roomId, playerId, block: true }],
    ];

    const walletBefore = walletOf(roomId, playerId);
    const bankBefore = walletOf(roomId, bankerId);

    for (const [type, payload] of forbidden) {
      await expect(send(playerWs, type, payload), `${type} must be refused`).rejects.toThrow();
    }

    // Refusing but still mutating would be the worse bug of the two.
    expect(walletOf(roomId, playerId)).toBe(walletBefore);
    expect(walletOf(roomId, bankerId)).toBe(bankBefore);
    expect(store.getRoom(roomId)).toBeDefined(); // room:close did not land
    expect(store.getRoom(roomId)!.players).toHaveLength(2); // player:kick did not land
  });
});

describe("WS protocol -- a room id in the payload cannot borrow authority from another room", () => {
  // roomId is taken as `payload.roomId ?? session.roomId` (unlike actorId,
  // which is session-only). Room ids are the codes people read aloud to each
  // other, so treating one as a capability would be a real hole: anyone who
  // hosts their own table would become banker-equivalent everywhere they knew
  // a code. What actually stops it is that the store scopes isAdmin to the
  // specific room's roster -- worth pinning at this boundary, because nothing
  // in the handler itself says so.
  it("a banker of their own table cannot act as banker on someone else's", async () => {
    const victim = await makeTable();
    const attacker = await makeTable(); // genuinely an admin -- of their OWN room

    const victimBankBefore = walletOf(victim.roomId, victim.bankerId);

    await expect(
      send(attacker.bankerWs, "player:kick", { roomId: victim.roomId, playerId: victim.playerId })
    ).rejects.toThrow();
    await expect(
      send(attacker.bankerWs, "player:bank-adjust", { roomId: victim.roomId, playerId: attacker.bankerId, amount: 5000 })
    ).rejects.toThrow();
    await expect(send(attacker.bankerWs, "room:close", { roomId: victim.roomId })).rejects.toThrow();

    expect(store.getRoom(victim.roomId)).toBeDefined();
    expect(store.getRoom(victim.roomId)!.players).toHaveLength(2);
    expect(walletOf(victim.roomId, victim.bankerId)).toBe(victimBankBefore);
    // And no money materialised in the attacker's own room either.
    expect(walletOf(attacker.roomId, attacker.bankerId)).toBe(500);
  });
});

describe("WS protocol -- money handlers move exactly what they say", () => {
  it("a buy-in only lands once the banker approves it", async () => {
    const { bankerWs, playerWs, roomId, playerId } = await makeTable();
    const before = walletOf(roomId, playerId);

    await send(playerWs, "player:buyin-request", { roomId, amount: 50, note: "more chips" });
    // Requesting must not itself be a payment.
    expect(walletOf(roomId, playerId)).toBe(before);

    await send(bankerWs, "player:buyin-approve", { roomId, playerId });
    expect(walletOf(roomId, playerId)).toBe(before + 50);
  });

  it("a rejected buy-in pays nothing", async () => {
    const { bankerWs, playerWs, roomId, playerId } = await makeTable();
    const before = walletOf(roomId, playerId);

    await send(playerWs, "player:buyin-request", { roomId, amount: 50 });
    await send(bankerWs, "player:buyin-reject", { roomId, playerId });

    expect(walletOf(roomId, playerId)).toBe(before);
  });

  it("bank-adjust moves a wallet both ways but never below zero", async () => {
    const { bankerWs, roomId, playerId } = await makeTable();
    const before = walletOf(roomId, playerId);

    await send(bankerWs, "player:bank-adjust", { roomId, playerId, amount: 25 });
    expect(walletOf(roomId, playerId)).toBe(before + 25);

    await send(bankerWs, "player:bank-adjust", { roomId, playerId, amount: -25 });
    expect(walletOf(roomId, playerId)).toBe(before);

    // Overdrawing is refused rather than clamped -- a silently clamped
    // adjustment would look like it worked and quietly invent chips.
    await expect(
      send(bankerWs, "player:bank-adjust", { roomId, playerId, amount: -(before + 1) })
    ).rejects.toThrow();
    expect(walletOf(roomId, playerId)).toBe(before);
  });

  it("banker-topup adjusts the bank's own wallet", async () => {
    const { bankerWs, roomId, bankerId } = await makeTable();
    const before = walletOf(roomId, bankerId);

    await send(bankerWs, "room:banker-topup", { roomId, amount: 250 });
    expect(walletOf(roomId, bankerId)).toBe(before + 250);
  });
});

describe("WS protocol -- payload validation", () => {
  // Invariant 5 in CLAUDE.md: validate anything off a WS payload before use.
  // Money amounts are the ones worth being paranoid about -- NaN or Infinity
  // reaching a wallet would not throw, it would poison the balance silently
  // and every later arithmetic on it would inherit the poison.
  it("refuses non-finite and missing amounts instead of poisoning a wallet", async () => {
    const { bankerWs, playerWs, roomId, playerId, bankerId } = await makeTable();

    const bad: Array<[string, unknown]> = [
      ["player:bank-adjust", { roomId, playerId, amount: null }],
      ["player:bank-adjust", { roomId, playerId, amount: "50" }],
      ["player:bank-adjust", { roomId, playerId }],
      ["player:bank-adjust", { roomId, amount: 50 }], // no target
      ["room:banker-topup", { roomId, amount: null }],
      ["room:banker-topup", { roomId }],
    ];
    for (const [type, payload] of bad) {
      await expect(send(bankerWs, type, payload), `${type} ${JSON.stringify(payload)}`).rejects.toThrow();
    }

    // JSON has no NaN/Infinity literal, so the wire form of "poison this
    // wallet" is a string that Number() would happily coerce. Number.isFinite
    // (not the looser isFinite) is what refuses it.
    await expect(send(playerWs, "player:buyin-request", { roomId, amount: "Infinity" })).rejects.toThrow();

    expect(Number.isFinite(walletOf(roomId, playerId))).toBe(true);
    expect(Number.isFinite(walletOf(roomId, bankerId))).toBe(true);
    expect(walletOf(roomId, bankerId)).toBe(500);
  });

  it("refuses a watermark that isn't a string, and a rename with no name", async () => {
    const { bankerWs, playerWs, roomId } = await makeTable();

    await expect(send(bankerWs, "room:set-watermark", { roomId, text: 42 })).rejects.toThrow();
    await expect(send(bankerWs, "room:set-watermark", { roomId })).rejects.toThrow();
    await expect(send(playerWs, "player:rename-request", { roomId, firstName: "" })).rejects.toThrow();
    await expect(send(playerWs, "player:rename-request", { roomId })).rejects.toThrow();
  });

  it("refuses a rename/buy-in block flag that isn't a real boolean", async () => {
    const { bankerWs, roomId, playerId } = await makeTable();

    // "true"/1 are the classic near-misses a hand-rolled client sends.
    await expect(send(bankerWs, "player:rename-block", { roomId, playerId, block: "true" })).rejects.toThrow();
    await expect(send(bankerWs, "player:buyin-block", { roomId, playerId, block: 1 })).rejects.toThrow();
  });
});

describe("WS protocol -- the rename flow end to end", () => {
  it("takes effect only on approval, and a block stops it being asked for at all", async () => {
    const { bankerWs, playerWs, roomId, playerId } = await makeTable();

    await send(playerWs, "player:rename-request", { roomId, firstName: "Renamed" });
    // Pending, not applied: a player renaming themselves at will would let
    // them impersonate someone else mid-game.
    expect(store.getRoom(roomId)!.players.find((p) => p.id === playerId)!.firstName).toBe("Player");

    await send(bankerWs, "player:rename-approve", { roomId, playerId });
    expect(store.getRoom(roomId)!.players.find((p) => p.id === playerId)!.firstName).toBe("Renamed");

    await send(bankerWs, "player:rename-block", { roomId, playerId, block: true });
    await expect(send(playerWs, "player:rename-request", { roomId, firstName: "Again" })).rejects.toThrow();
    expect(store.getRoom(roomId)!.players.find((p) => p.id === playerId)!.firstName).toBe("Renamed");
  });

  it("lets a player withdraw their own pending request", async () => {
    const { playerWs, roomId, playerId } = await makeTable();

    await send(playerWs, "player:rename-request", { roomId, firstName: "Maybe" });
    expect(store.getRoom(roomId)!.renameRequests.some((r) => r.playerId === playerId)).toBe(true);

    await send(playerWs, "player:rename-cancel", {});
    expect(store.getRoom(roomId)!.renameRequests.some((r) => r.playerId === playerId)).toBe(false);
  });
});

describe("WS protocol -- kick and close", () => {
  it("the banker can kick a player, and cannot kick themselves", async () => {
    const { bankerWs, roomId, bankerId, playerId } = await makeTable();

    await expect(send(bankerWs, "player:kick", { roomId, playerId: bankerId })).rejects.toThrow();
    expect(store.getRoom(roomId)!.players).toHaveLength(2);

    await send(bankerWs, "player:kick", { roomId, playerId });
    expect(store.getRoom(roomId)!.players.some((p) => p.id === playerId)).toBe(false);
  });

  it("the banker can close their own room", async () => {
    const { bankerWs, roomId } = await makeTable();
    await send(bankerWs, "room:close", { roomId });
    expect(store.getRoom(roomId)).toBeUndefined();
  });
});
