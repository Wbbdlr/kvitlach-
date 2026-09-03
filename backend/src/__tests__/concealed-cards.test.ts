import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// Regression coverage for a real vulnerability found during a security pass:
// the server sent every player's full, real cards to every socket in the
// room, always -- including the banker's hole card and a standing player's
// hidden hand. Concealment (what should stay face-down until resolution)
// existed only as a RENDERING choice in the frontend (selectors.ts's
// totalDisplay, Seat.tsx/Dealer.tsx's per-card `hide`); the WS payload never
// enforced it. Any already-seated player could read hidden information
// straight out of the browser's Network tab -- no exploit, just looking at
// what the server had already sent them.
//
// Fixed by making ws-server.ts's sanitizeRound PER-RECIPIENT: each Turn's
// cards are redacted (isCardHidden/redactTurn) against the viewer actually
// receiving that copy, mirroring the exact rules the frontend already had.
// These tests drive a real WSServer/GameStore pair and read the actual wire
// payload each player receives -- not the redaction function in isolation --
// because the bug lived in what crossed the network, not in any one
// function's logic.

const PORT = 39770;
const URL = `ws://127.0.0.1:${PORT}`;
const REDACTED = "0"; // matches ws-server.ts's REDACTED_CARD.name

let store: GameStore;
let server: WSServer;

beforeAll(() => {
  store = new GameStore();
  server = new WSServer(store, PORT);
});

afterAll(() => {
  (server as unknown as { wss: { close: () => void } }).wss.close();
});

// A distinct synthetic IP per connection by default: room:create now
// carries its own per-IP throttle (ws-server.ts), and this file's own tests
// each build a fresh table, which would otherwise all collide on the one
// literal address an unheadered local socket resolves to.
let ipCounter = 0;
function connect(ip = `10.66.${++ipCounter}.1`): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { headers: { "x-forwarded-for": ip } });
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

const card = (name: string) => ({ name, attributes: { values: [Number(name)] } });
const cardsOf = (round: any, playerId: string): string[] =>
  round.turns.find((t: any) => t.player.id === playerId).cards.map((c: any) => c.name);

describe("concealed cards -- redaction happens on the server, not just in the UI", () => {
  it("hides the banker's hole card from a player while the banker's turn is still pending", async () => {
    const banker = await connect();
    const punter = await connect();

    const created = await send(banker, "room:create", { firstName: "Banker" });
    const roomId = created.room.roomId;
    const bankerId = created.player.id;
    const joined = await send(punter, "room:join", { roomId, firstName: "Punter" });
    const punterId = joined.player.id;

    const started = await send(banker, "round:start", { roomId });
    const roundId = started.round.roundId;

    // Deal a deterministic hole card so a leak is unambiguous: "7" is not a
    // value redactTurn would ever produce on its own (that's always "0").
    store.getRound(roundId)!.turns.forEach((t) => {
      if (t.player.id === bankerId) t.cards = [card("7")];
    });

    // The banker's OWN ack sees their real hole card...
    const ownView = await send(banker, "round:get", { roundId });
    expect(cardsOf(ownView.round, bankerId)).toEqual(["7"]);

    // ...but the punter, asking for the exact same round, gets a redacted
    // placeholder in that position instead of "7".
    const punterView = await send(punter, "round:get", { roundId });
    expect(cardsOf(punterView.round, bankerId)).toEqual([REDACTED]);

    banker.close();
    punter.close();
  });

  it("reveals the banker's hole card to everyone once the banker's own turn resolves", async () => {
    const banker = await connect();
    const punter = await connect();

    const created = await send(banker, "room:create", { firstName: "Banker2" });
    const roomId = created.room.roomId;
    const bankerId = created.player.id;
    const joined = await send(punter, "room:join", { roomId, firstName: "Punter2" });

    const started = await send(banker, "round:start", { roomId });
    const roundId = started.round.roundId;

    store.getRound(roundId)!.turns.forEach((t) => {
      if (t.player.id === bankerId) {
        t.cards = [card("9")];
        t.state = "lost"; // resolved -- not "pending" any more
      }
    });

    const punterView = await send(punter, "round:get", { roundId });
    expect(cardsOf(punterView.round, bankerId)).toEqual(["9"]);

    void joined;
    banker.close();
    punter.close();
  });

  it("shows a player's free blatt cards to the table but hides the initial deal and any wagered draw", async () => {
    const banker = await connect();
    const punter = await connect();

    const created = await send(banker, "room:create", { firstName: "Banker3" });
    const roomId = created.room.roomId;
    const joined = await send(punter, "room:join", { roomId, firstName: "Punter3" });
    const punterId = joined.player.id;

    const started = await send(banker, "round:start", { roomId });
    const roundId = started.round.roundId;

    // Initial deal (idx 0, secret), one free blatt draw (idx 1, public),
    // then a real wager's draw (idx 2, hidden again) -- betStartIndex is set
    // exactly the way handleBet sets it, matching what a real turn:bet
    // would have produced.
    store.getRound(roundId)!.turns.forEach((t) => {
      if (t.player.id === punterId) {
        t.cards = [card("3"), card("6"), card("8")];
        t.bet = 25;
        t.betStartIndex = 2;
        t.state = "pending";
      }
    });

    const bankerView = await send(banker, "round:get", { roundId });
    expect(cardsOf(bankerView.round, punterId)).toEqual([REDACTED, "6", REDACTED]);

    // The punter's own view is never redacted, regardless of any of this.
    const ownView = await send(punter, "round:get", { roundId });
    expect(cardsOf(ownView.round, punterId)).toEqual(["3", "6", "8"]);

    banker.close();
    punter.close();
  });

  it("keeps a standing player's wager hidden from everyone else, blatts aside", async () => {
    const banker = await connect();
    const punter = await connect();

    const created = await send(banker, "room:create", { firstName: "Banker4" });
    const roomId = created.room.roomId;
    const joined = await send(punter, "room:join", { roomId, firstName: "Punter4" });
    const punterId = joined.player.id;

    const started = await send(banker, "round:start", { roomId });
    const roundId = started.round.roundId;

    store.getRound(roundId)!.turns.forEach((t) => {
      if (t.player.id === punterId) {
        t.cards = [card("4"), card("5"), card("10")];
        t.bet = 10;
        t.betStartIndex = 2;
        // Standing does NOT reveal the hand -- see totalDisplay's own
        // comment on exactly this, and isCardHidden's mirror of it.
        t.state = "standby";
      }
    });

    const bankerView = await send(banker, "round:get", { roundId });
    expect(cardsOf(bankerView.round, punterId)).toEqual([REDACTED, "5", REDACTED]);

    banker.close();
    punter.close();
  });

  it("reveals everything to everyone once the round is fully terminated", async () => {
    const banker = await connect();
    const punter = await connect();

    const created = await send(banker, "room:create", { firstName: "Banker5" });
    const roomId = created.room.roomId;
    const bankerId = created.player.id;
    const joined = await send(punter, "room:join", { roomId, firstName: "Punter5" });
    const punterId = joined.player.id;

    const started = await send(banker, "round:start", { roomId });
    const roundId = started.round.roundId;

    store.getRound(roundId)!.turns.forEach((t) => {
      if (t.player.id === bankerId) t.cards = [card("2")];
      if (t.player.id === punterId) {
        t.cards = [card("11"), card("12")];
        t.bet = 5;
        t.betStartIndex = 1;
      }
      t.state = "lost";
    });
    store.getRound(roundId)!.state = "terminate";

    const punterView = await send(punter, "round:get", { roundId });
    expect(cardsOf(punterView.round, bankerId)).toEqual(["2"]);
    expect(cardsOf(punterView.round, punterId)).toEqual(["11", "12"]);

    banker.close();
    punter.close();
  });

  it("gives a room:watch spectator the same fully-redacted view as a non-member -- nothing hidden included", async () => {
    const banker = await connect();
    const created = await send(banker, "room:create", { firstName: "Banker6" });
    const roomId = created.room.roomId;
    const bankerId = created.player.id;

    const started = await send(banker, "round:start", { roomId });
    const roundId = started.round.roundId;
    store.getRound(roundId)!.turns.forEach((t) => {
      if (t.player.id === bankerId) t.cards = [card("6")];
    });

    const watcher = await connect();
    const token = server.mintWatchToken(roomId);
    const watchAck = await send(watcher, "room:watch", { roomId, token });
    expect(cardsOf(watchAck.round, bankerId)).toEqual([REDACTED]);

    const watcherRoundGet = await send(watcher, "round:get", { roundId });
    expect(cardsOf(watcherRoundGet.round, bankerId)).toEqual([REDACTED]);

    banker.close();
    watcher.close();
  });

  it("redacts the live round:state broadcast too, not only round:get/acks", async () => {
    const banker = await connect();
    const punter = await connect();

    const created = await send(banker, "room:create", { firstName: "Banker7" });
    const roomId = created.room.roomId;
    const bankerId = created.player.id;
    await send(punter, "room:join", { roomId, firstName: "Punter7" });

    const roundStatePromise = new Promise<any>((resolve) => {
      const onMessage = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "round:state") {
          punter.off("message", onMessage);
          resolve(msg.payload);
        }
      };
      punter.on("message", onMessage);
    });

    // round:start broadcasts round:state to the whole room -- that broadcast
    // is what used to carry everyone's real cards to everyone, unredacted.
    await send(banker, "round:start", { roomId });
    const broadcast = await roundStatePromise;
    expect(cardsOf(broadcast, bankerId)).toEqual([REDACTED]);

    banker.close();
    punter.close();
  });
});
