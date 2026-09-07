import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// The store's rules are covered next door in seat-claim.test.ts. What that
// file cannot see is the wire, and the wire is where this feature is unusual:
// a claimant has NO session and is in NO room, so none of the ordinary
// broadcast paths reach them. The approval has to find its way back to a
// socket the server is holding on the side, or the player sits on "waiting
// for the banker" forever while the banker sees the seat handed over.
const PORT = 39651;
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
  const requestId = `sc${++reqCounter}`;
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

function waitFor(ws: WebSocket, type: string, ms = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`never received ${type}`));
    }, ms);
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(msg.payload);
    };
    ws.on("message", onMessage);
  });
}

async function tableWithAnEmptySeat() {
  const host = await connect();
  const created = await send(host, "room:create", { firstName: "Banker", buyIn: 100, bankerBankroll: 400 });
  const roomId = created.room.roomId as string;

  const rivka = await connect();
  const joined = await send(rivka, "room:join", { roomId, firstName: "Rivka", lastName: "S" });
  const seatId = joined.player.id as string;
  store.getRoom(roomId)!.wallets[seatId] = 75;

  // She closes the tab. The seat and its $75 stay on the table.
  rivka.close();
  await new Promise((r) => setTimeout(r, 80));
  return { host, roomId, seatId };
}

describe("claiming a seat back over the wire", () => {
  it("hands the returning player their original seat, id and chips", async () => {
    const { host, roomId, seatId } = await tableWithAnEmptySeat();

    const back = await connect();
    // A plain join is refused -- this is the refusal the lobby turns into a
    // question rather than a red box.
    await expect(send(back, "room:join", { roomId, firstName: "Rivka", lastName: "S" })).rejects.toThrow(
      "seat_claimable"
    );

    const lodged = await send(back, "room:claim-seat", { roomId, firstName: "Rivka", lastName: "S" });
    expect(lodged.wallet).toBe(75);

    // Nothing has been granted yet.
    const approved = waitFor(back, "seat:claim-approved");
    await send(host, "room:claim-approve", { roomId, claimId: lodged.claim.id });
    const payload = await approved;

    expect(payload.player.id).toBe(seatId);
    expect(payload.session.playerId).toBe(seatId);
    expect(payload.session.token).toBeTruthy();
    expect(payload.room.wallets[seatId]).toBe(75);
    expect(payload.room.players.filter((p: any) => p.type === "player")).toHaveLength(1);

    host.close();
    back.close();
  });

  it("tells the claimant when the banker says no", async () => {
    const { host, roomId } = await tableWithAnEmptySeat();
    const back = await connect();
    const lodged = await send(back, "room:claim-seat", { roomId, firstName: "Rivka", lastName: "S" });

    const rejected = waitFor(back, "seat:claim-rejected");
    await send(host, "room:claim-reject", { roomId, claimId: lodged.claim.id });
    await rejected;

    host.close();
    back.close();
  });

  // Server authority: approving hands over somebody's chips, so it is the
  // banker's call and nobody else's.
  it("refuses approval from a socket that is not the banker", async () => {
    const { host, roomId } = await tableWithAnEmptySeat();
    const back = await connect();
    const lodged = await send(back, "room:claim-seat", { roomId, firstName: "Rivka", lastName: "S" });

    const other = await connect();
    await send(other, "room:join", { roomId, firstName: "Moshe" });
    await expect(send(other, "room:claim-approve", { roomId, claimId: lodged.claim.id })).rejects.toThrow("forbidden");

    host.close();
    back.close();
    other.close();
  });

  // A dead socket held in the claim map is exactly the leak this file's own
  // rule is about, in a process meant to run for months.
  it("stops holding a claimant's socket once it closes", async () => {
    const { host, roomId } = await tableWithAnEmptySeat();
    const back = await connect();
    await send(back, "room:claim-seat", { roomId, firstName: "Rivka", lastName: "S" });
    const claims = (server as any).claimSockets as Map<string, unknown>;
    expect(claims.size).toBe(1);

    back.close();
    await new Promise((r) => setTimeout(r, 120));
    expect(claims.size).toBe(0);

    host.close();
  });
});
