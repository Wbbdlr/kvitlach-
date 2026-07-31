import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// Everything else in this suite either drives the store directly or runs a
// PRACTICE room, where the banker and most seats are bots. This one plays a
// real multiplayer game: a human banker plus three human players, each on
// their own socket, taking real turns over real WebSocket messages, with no
// bot code anywhere in the path.
//
// The point is to confirm the fixes hold for the game people will actually
// play, rather than only for the solo table they were found on. Practice
// rooms reuse the same engine, but "reuses the same engine" is an argument,
// and this is evidence.

const PORT = 39641;
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

interface Client {
  ws: WebSocket;
  playerId: string;
  /** Every payload this client received, in order -- what a real browser sees. */
  received: unknown[];
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

let reqCounter = 0;
function send(ws: WebSocket, type: string, payload: unknown): Promise<any> {
  const requestId = `l${++reqCounter}`;
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

function record(ws: WebSocket): unknown[] {
  const received: unknown[] = [];
  ws.on("message", (data) => received.push(JSON.parse(data.toString())));
  return received;
}

// Walks the whole payload, so a deck nested anywhere still trips it.
function findDeckAnywhere(value: unknown, path = "msg"): string | undefined {
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

const turnOf = (round: any, playerId: string) => round.turns.find((t: any) => t.player.id === playerId);
const isLive = (turn: any) => turn && turn.state === "pending";

/** Plays one whole round to terminate. Players wager then stand; banker draws to 17. */
async function playRound(banker: Client, players: Client[], roomId: string) {
  let round = (await send(banker.ws, "round:start", { roomId })).round;

  for (const p of players) {
    // Betting draws a card, which can resolve the turn outright (bust, or an
    // exact 21) -- so re-check before standing rather than assuming.
    if (isLive(turnOf(round, p.playerId))) {
      round = (await send(p.ws, "turn:bet", { roundId: round.roundId, amount: 5 })).round;
    }
    if (isLive(turnOf(round, p.playerId))) {
      round = (await send(p.ws, "turn:stand", { roundId: round.roundId })).round;
    }
  }

  // Banker plays last, drawing until they'd stand at 17+ or the round ends.
  for (let guard = 0; guard < 25 && round.state !== "terminate"; guard += 1) {
    const bankerTurn = turnOf(round, banker.playerId);
    if (!isLive(bankerTurn)) break;
    const best = bestTotal(bankerTurn.cards);
    if (best !== undefined && best >= 17) {
      round = (await send(banker.ws, "turn:stand", { roundId: round.roundId })).round;
    } else {
      round = (await send(banker.ws, "turn:hit", { roundId: round.roundId })).round;
    }
  }
  return round;
}

// Local mirror of the engine's own reading, so the test drives the banker the
// way a human would rather than importing the thing it is checking.
function bestTotal(cards: any[]): number | undefined {
  let sums = [0];
  for (const card of cards) {
    const next = new Set<number>();
    for (const s of sums) for (const v of card.attributes.values) if (s + v <= 21) next.add(s + v);
    sums = [...next];
  }
  return sums.length ? Math.max(...sums) : undefined;
}

describe("a real multiplayer game (human banker, three human players, no bots)", () => {
  let banker: Client;
  let players: Client[];
  let roomId: string;
  let finalRound: any;
  let roundsPlayed = 0;

  beforeAll(async () => {
    const bws = await connect();
    const bReceived = record(bws);
    const created = await send(bws, "room:create", { firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    roomId = created.room.roomId;
    banker = { ws: bws, playerId: created.player.id, received: bReceived };

    players = [];
    for (const name of ["Alice", "Bruch", "Chana"]) {
      const ws = await connect();
      const received = record(ws);
      const joined = await send(ws, "room:join", { roomId, firstName: name });
      players.push({ ws, playerId: joined.player.id, received });
    }

    // Several rounds, so this covers carry-over between rounds too.
    for (let i = 0; i < 4; i += 1) {
      finalRound = await playRound(banker, players, roomId);
      roundsPlayed += 1;
    }
    await new Promise((r) => setTimeout(r, 200));
  }, 30000);

  afterAll(() => {
    banker.ws.close();
    players.forEach((p) => p.ws.close());
  });

  it("is a genuine live room -- not a practice table", () => {
    const room = store.getRoom(roomId)!;
    expect(room.practice).toBeFalsy();
    expect(room.players.every((p) => !p.isBot)).toBe(true);
    expect(room.players).toHaveLength(4);
    expect(roundsPlayed).toBe(4);
    expect(finalRound.state).toBe("terminate");
  });

  it("never sends the shoe to anybody, in any message, all game long", () => {
    for (const client of [banker, ...players]) {
      expect(client.received.length).toBeGreaterThan(0);
      for (const msg of client.received) {
        expect(findDeckAnywhere(msg)).toBeUndefined();
      }
    }
  });

  it("gives a four-seat table a shoe that lasts, instead of reshuffling every other round", () => {
    // 4 seats -> 3 decks under the session-based sizing (was 1 deck / 48 cards,
    // which a table this size exhausted in about three rounds).
    expect(finalRound.deckCount).toBe(3);

    // The real symptom was the shoe "starting over" constantly, and the server
    // stamps deckReshuffledAt every time it does. Four rounds in, it never has.
    const roundStates = (banker.received as any[]).filter((m) => m.type === "round:state").map((m) => m.payload);
    expect(roundStates.length).toBeGreaterThan(0);
    expect(roundStates.every((r) => r.deckReshuffledAt === undefined)).toBe(true);

    // ...and the count really is draining, i.e. the shoe carries between
    // rounds rather than being rebuilt each time.
    const counts = roundStates.map((r) => r.deckRemaining);
    expect(Math.max(...counts)).toBeLessThan(3 * 48); // cards were dealt from it
    expect(finalRound.deckRemaining).toBe(Math.min(...counts));
    expect(finalRound.deckRemaining).toBeGreaterThan(0);
  });

  it("reports the banker's head-to-head split, matching the players' actual results", () => {
    const bankerTurn = turnOf(finalRound, banker.playerId);
    const wagering = finalRound.turns.filter((t: any) => t.player.type !== "admin" && (t.bet ?? 0) > 0);
    const beatenByBank = wagering.filter((t: any) => t.state === "lost").length;
    const whoBeatTheBank = wagering.filter((t: any) => t.state === "won").length;

    expect(bankerTurn.beat).toBe(beatenByBank);
    expect(bankerTurn.lostTo).toBe(whoBeatTheBank);
    expect(typeof bankerTurn.busted).toBe("boolean");
    // The bug that started this: a busted flag that just echoed the money
    // result. It must track the CARDS.
    expect(bankerTurn.busted).toBe(bestTotal(bankerTurn.cards) === undefined);
  });

  it("keeps every chip accounted for across the whole session", () => {
    const room = store.getRoom(roomId)!;
    const total = Object.values(room.wallets).reduce((a, b) => a + b, 0);
    // 500 banker + 3 x 100 buy-ins, and money only ever moves between seats.
    expect(total).toBe(500 + 3 * 100);
  });

  it("settles every seat -- nobody is left mid-hand when the round ends", () => {
    for (const t of finalRound.turns) {
      expect(t.state).not.toBe("pending");
    }
  });
});
