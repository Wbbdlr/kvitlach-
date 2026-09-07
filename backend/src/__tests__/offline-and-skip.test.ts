import { describe, expect, it, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// Being left out of a round, and what happens to the money when you are.
//
// Found by playing, 2026-09-06, as two symptoms of one thing:
//
//   #3  Moshe's phone dropped its connection between rounds. The next two
//       rounds were dealt to everyone else. Nobody told him, nobody told the
//       banker, and he stayed listed at the table with his $100 the whole
//       time. His experience was "everyone is playing and nobody will say why
//       I am not."  (store.ts's startRound filtered on presence === "online"
//       and recorded nothing about who that dropped.)
//
//   #4  Moshe wagered $30, his connection died mid-turn, and the banker used
//       Skip to move the table along. That round the BANK FUTCHED -- the one
//       outcome where everyone still in the hand gets paid -- and Moshe got
//       nothing. A skipped turn is excluded by calculateBalances, so his $30
//       neither lost nor won. His plate still read "$100 - $30" afterwards,
//       which reads like money is still at stake.
//
// The two fixes, and the reasoning behind each:
//
//   A grace window. A screen that locked, a cell handover, a walk to the
//   kitchen -- these land between rounds constantly at a family game. A
//   player who has been gone for seconds is still at the table and is dealt
//   in; the 90-second turn timer already handles them not acting.
//
//   Say who was left out. Beyond the grace window the exclusion is real, so
//   the round records it (satOutPlayerIds) instead of the table silently
//   shrinking. One line of round state answers "why am I not playing" and
//   "who is missing" at the same time.
//
//   The banker may not SKIP a wagered hand. This is the fairness half. Skip
//   is for a seat with nothing at stake. Once chips are down the hand is a
//   real hand and has to resolve like one -- which the code already knows how
//   to do, because the turn timer has always auto-STOOD an absent player
//   (forceTimeoutStand), and a stood hand competes: it loses to a better
//   bank, and it WINS when the bank busts. So the banker's remedy for an
//   absent player with money down is to stand them, not to void them, and
//   that is deliberately not a free option -- standing on one card is a real
//   hand with real downside, which is exactly why it is fair to offer.

const PORT = 39473;
const URL = `ws://127.0.0.1:${PORT}`;

const TWELVE = { name: "12", attributes: { values: [12, 9, 10] } };
const TEN = { name: "10", attributes: { values: [10] } };
const TWO = { name: "2", attributes: { values: [2] } };

/**
 * Put nothing but 2s in the shoe for the rest of the round.
 *
 * Every bet deals a card, and these tests are about what happens to a hand
 * that is still LIVE afterwards -- so a real shuffled shoe makes them a coin
 * flip: draw the right card onto the dealt one and the hand resolves as won
 * (21) or lost (a futch) before the assertion, and the test fails on a
 * shuffle rather than on a bug. They passed by luck until one didn't; caught
 * on a full-suite run, twice in a row on two DIFFERENT tests in this file.
 *
 * A dealt card is at most a 12, so a 2 on top of it cannot reach 21 and
 * cannot bust -- the hand is still pending, every time, which is the state
 * each of these is actually about.
 */
function onlyLowCards(s: GameStore, roundId: string): void {
  s.getRound(roundId)!.deck = Array.from({ length: 30 }, () => ({ ...TWO }));
}

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
  const requestId = `os${++reqCounter}`;
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

/** Backdate a disconnection so it falls outside the grace window. */
function goneFor(s: GameStore, roomId: string, playerId: string, ms: number) {
  s.setPresence(roomId, playerId, "offline");
  const player = s.getRoom(roomId)!.players.find((p) => p.id === playerId)!;
  player.offlineSince = Date.now() - ms;
}

function table(bankroll = 500) {
  const s = new GameStore();
  const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: bankroll });
  const { player: moshe } = s.joinRoom(room.roomId, { firstName: "Moshe", lastName: "B" });
  const { player: sara } = s.joinRoom(room.roomId, { firstName: "Sara", lastName: "K" });
  return { s, roomId: room.roomId, admin, moshe, sara };
}

describe("a momentary disconnection does not cost you the round", () => {
  it("deals in a player who dropped seconds ago", () => {
    const { s, roomId, admin, moshe } = table();
    s.setPresence(roomId, moshe.id, "offline");

    const round = s.startRound(roomId, admin.id);

    // A locked screen or a cell handover between rounds is not leaving the
    // table. He is dealt in; if he really is gone, the turn timer stands him.
    expect(round.turns.some((t) => t.player.id === moshe.id)).toBe(true);
    expect(round.satOutPlayerIds ?? []).toEqual([]);
  });

  it("leaves out a player who has genuinely been gone, and says so", () => {
    const { s, roomId, admin, moshe, sara } = table();
    goneFor(s, roomId, moshe.id, 10 * 60 * 1000);

    const round = s.startRound(roomId, admin.id);

    expect(round.turns.some((t) => t.player.id === moshe.id)).toBe(false);
    expect(round.turns.some((t) => t.player.id === sara.id)).toBe(true);
    // The whole of #3: the exclusion was always correct, it was just silent.
    expect(round.satOutPlayerIds).toEqual([moshe.id]);
  });

  it("names nobody when the whole table is offline and the round runs anyway", () => {
    const { s, roomId, admin, moshe, sara } = table();
    goneFor(s, roomId, moshe.id, 10 * 60 * 1000);
    goneFor(s, roomId, sara.id, 10 * 60 * 1000);
    goneFor(s, roomId, admin.id, 10 * 60 * 1000);

    const round = s.startRound(roomId, admin.id);

    // startRound's existing fallback: if filtering leaves nobody, everybody
    // plays. Nobody was left out, so nobody may be reported as left out --
    // a sat-out list that fires on a normal round is worse than none.
    expect(round.turns).toHaveLength(3);
    expect(round.satOutPlayerIds ?? []).toEqual([]);
  });

  it("never names the banker, who cannot be sat out of their own table", () => {
    const { s, roomId, admin, moshe } = table();
    goneFor(s, roomId, admin.id, 10 * 60 * 1000);
    goneFor(s, roomId, moshe.id, 10 * 60 * 1000);

    const round = s.startRound(roomId, admin.id);

    expect(round.satOutPlayerIds ?? []).not.toContain(admin.id);
  });

  it("clears the previous round's sat-out list rather than carrying it forward", () => {
    const { s, roomId, admin, moshe } = table();
    goneFor(s, roomId, moshe.id, 10 * 60 * 1000);
    const first = s.startRound(roomId, admin.id);
    expect(first.satOutPlayerIds).toEqual([moshe.id]);
    s.finalizeRound(first.roundId);

    s.setPresence(roomId, moshe.id, "online");
    const second = s.startRound(roomId, admin.id);

    expect(second.turns.some((t) => t.player.id === moshe.id)).toBe(true);
    expect(second.satOutPlayerIds ?? []).toEqual([]);
  });
});

describe("a wagered hand cannot be skipped away", () => {
  it("refuses Skip once chips are down", () => {
    const { s, roomId, admin } = table();
    const round = s.startRound(roomId, admin.id);
    onlyLowCards(s, round.roundId);
    const first = round.turns[0].player.id;
    s.applyBet(round.roundId, first, 30);

    // Not a permissions problem -- the banker is allowed to act for an absent
    // player. It is that Skip is the wrong action once there is money on it.
    expect(() => s.applySkip(round.roundId, first)).toThrow(/cannot_skip_wagered/);
    expect(s.getRound(round.roundId)!.turns.find((t) => t.player.id === first)!.state).toBe("pending");
  });

  it("still allows Skip for a seat with nothing at stake", () => {
    const { s, roomId, admin } = table();
    const round = s.startRound(roomId, admin.id);
    const first = round.turns[0].player.id;

    const after = s.applySkip(round.roundId, first);
    expect(after.turns.find((t) => t.player.id === first)!.state).toBe("skipped");
  });

  it("pays an absent player the banker stood for when the bank busts", () => {
    const { s, roomId, admin } = table();
    const round = s.startRound(roomId, admin.id);
    onlyLowCards(s, round.roundId);
    const seats = round.turns.filter((t) => t.player.type !== "admin");
    const absent = seats[0].player.id;
    const other = seats[1].player.id;

    s.applyBet(round.roundId, absent, 30);
    // He is gone. The banker stands his hand rather than voiding it.
    const stood = s.applyStand(round.roundId, absent);
    expect(stood.turns.find((t) => t.player.id === absent)!.state).toBe("standby");

    s.applyBet(round.roundId, other, 10);
    s.applyStand(round.roundId, other);

    // Bank futches.
    const live = s.getRound(round.roundId)!;
    const bankerTurn = live.turns.find((t) => t.player.type === "admin")!;
    bankerTurn.cards = [TWELVE, TWELVE];
    live.deck = [TEN, ...live.deck];
    s.applyHit(round.roundId, admin.id);

    s.finalizeRound(round.roundId);

    // The whole of #4: he had $30 on a bust and he gets paid for it.
    const wallets = s.getRoom(roomId)!.wallets;
    expect(wallets[absent]).toBe(130);
    expect(wallets[other]).toBe(110);
  });

  it("lets the banker stand for the seat the table is waiting on", async () => {
    const bankerWs = await connect();
    const created = await send(bankerWs, "room:create", { firstName: "Zeide", buyIn: 100, bankerBankroll: 500 });
    const roomId = created.room.roomId;
    const playerWs = await connect();
    const joined = await send(playerWs, "room:join", { roomId, firstName: "Moshe", lastName: "B" });
    const moshePid = joined.player.id;

    const started = await send(bankerWs, "round:start", { roomId });
    const roundId = started.round.roundId;
    onlyLowCards(store, roundId);
    await send(playerWs, "turn:bet", { roundId, amount: 20 });

    const after = await send(bankerWs, "turn:stand", { roundId, playerId: moshePid });
    const turn = after.round.turns.find((t: any) => t.player.id === moshePid);
    expect(turn.state).toBe("standby");

    bankerWs.close();
    playerWs.close();
  });

  it("does not let one player stand for another", async () => {
    const bankerWs = await connect();
    const created = await send(bankerWs, "room:create", { firstName: "Zeide", buyIn: 100, bankerBankroll: 500 });
    const roomId = created.room.roomId;
    const aWs = await connect();
    const bWs = await connect();
    await send(aWs, "room:join", { roomId, firstName: "Sara" });
    const bJoin = await send(bWs, "room:join", { roomId, firstName: "Moshe" });

    const started = await send(bankerWs, "round:start", { roomId });
    const roundId = started.round.roundId;

    // Standing somebody else's hand is a banker action, exactly like skipping
    // one. Without the check it is a way to end a rival's turn on one card.
    await expect(send(aWs, "turn:stand", { roundId, playerId: bJoin.player.id })).rejects.toThrow(/forbidden/);

    bankerWs.close();
    aWs.close();
    bWs.close();
  });
});
