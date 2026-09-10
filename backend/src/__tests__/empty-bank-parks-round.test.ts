import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";
import { decideBotBet } from "../bot.js";

// A bank with nothing in it must stop the round, not quietly deal it out.
//
// Reported from a practice table after a BANK! showdown the player won:
// "with no money left available, it continued playing and dealing cards with
// the other computer players, and only after that did the pop up show up" --
// and, on a second look at the felt, "the subsequent players were playing but
// not actually wagering anything".
//
// Both halves come from the same hole. applyBet refuses an empty bank with
// bank_empty and always did; applyHit never checked at all, so a seat that
// had not wagered could still be dealt a whole hand. For a bot that is the
// DEFAULT path, not an edge case -- see the last test here.

const NINE = { name: "9", attributes: { values: [9] } };
const TWELVE = { name: "12", attributes: { values: [12, 9, 10] } };
const TWO = { name: "2", attributes: { values: [2] } };

function table() {
  const s = new GameStore();
  const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 60 });
  const { player: p1 } = s.joinRoom(room.roomId, { firstName: "Moshe" });
  const { player: p2 } = s.joinRoom(room.roomId, { firstName: "Sara" });
  const round = s.startRound(room.roomId, admin.id);
  return { s, roomId: room.roomId, admin, p1, p2, roundId: round.roundId, round };
}

describe("a bank that has run out mid-round", () => {
  it("parks on the banker's decision instead of dealing on", () => {
    const { s, roomId, admin, roundId, round } = table();
    const seats = round.turns.filter((t) => t.player.type !== "admin");
    const first = seats[0]!.player.id;

    // However the bank got here -- this test is about what the table allows
    // AFTER, and the drain routes each have their own coverage.
    s.getRoom(roomId)!.wallets[admin.id] = 0;

    const after = s.applyStand(roundId, first);
    expect(after.bankLock?.stage).toBe("decision");
  });

  it("refuses to deal another card once it has parked", () => {
    const { s, roomId, admin, roundId, round } = table();
    const seats = round.turns.filter((t) => t.player.type !== "admin");
    s.getRoom(roomId)!.wallets[admin.id] = 0;
    s.applyStand(roundId, seats[0]!.player.id);

    // This is the exact call that used to succeed and hand a seat a second
    // card with nothing on it.
    expect(() => s.applyHit(roundId, seats[1]!.player.id)).toThrow("banker_deciding");
    expect(() => s.applyBet(roundId, seats[1]!.player.id, 5)).toThrow("banker_deciding");
  });

  it("parks in the same action that drained it, so the next seat is refused", () => {
    // The reported sequence, end to end: the win empties the bank, and the
    // seat AFTER it must never get a card. Before the fix this seat was dealt
    // a whole hand at $0 and the table only said anything once the round was
    // over.
    const { s, roomId, admin, p1, p2, roundId } = table();
    const live = s.getRound(roundId)!;
    const order = live.turns.filter((t) => t.player.type !== "admin").map((t) => t.player.id);
    const [firstId, secondId] = order as [string, string];
    // Give the seat on turn a 9 and put a 12 on the shoe: its own bet card
    // makes 21 and pays out the whole window on the spot.
    live.turns.find((t) => t.player.id === firstId)!.cards = [NINE];
    live.deck = [TWELVE, TWO, TWO, TWO];

    s.applyBet(roundId, firstId, 60, { bank: true });
    expect(s.getRoom(roomId)!.wallets[admin.id]).toBe(0);

    expect(() => s.applyHit(roundId, secondId)).toThrow("banker_deciding");
    expect(s.getRound(roundId)!.turns.find((t) => t.player.id === secondId)!.cards).toHaveLength(1);
    expect([p1.id, p2.id]).toContain(secondId);
  });

  it("does not park a round with nothing left outstanding", () => {
    // A finished round needs no decision prompt over it -- that would just be
    // one more thing to dismiss on the way to the next hand.
    const { s, roomId, admin, roundId } = table();
    const live = s.getRound(roundId)!;
    s.getRoom(roomId)!.wallets[admin.id] = 0;
    const seats = live.turns.filter((t) => t.player.type !== "admin");
    // Everyone already resolved and paid.
    live.turns = live.turns.map((t) =>
      t.player.type === "admin" ? t : { ...t, state: "lost" as const, settled: true }
    );
    expect(() => s.applyStand(roundId, seats[0]!.player.id)).toThrow();
    expect(s.getRound(roundId)!.bankLock).toBeUndefined();
  });

  it("never overwrites a showdown frame that is already locked", () => {
    const { s, roomId, admin, p1, roundId } = table();
    const live = s.getRound(roundId)!;
    live.turns.find((t) => t.player.id === p1.id)!.cards = [NINE];
    live.deck = [TWELVE, TWO, TWO, TWO];
    // A BANK! for the whole window that wins outright: settleBankOutcome's own
    // path sets the decision lock, and this must leave it exactly as found.
    const after = s.applyBet(roundId, p1.id, 60, { bank: true });
    expect(s.getRoom(roomId)!.wallets[admin.id]).toBe(0);
    expect(after.bankLock?.stage).toBe("decision");
    expect(after.bankLock?.playerId).toBe(p1.id);
  });

  it("is the state a bot walks straight into", () => {
    // Why the missing applyHit guard mattered so much on a practice table:
    // playBotTurn reads a 0 from decideBotBet as "no bet yet, so hit", so an
    // empty window did not stop a bot -- it routed it around wagering.
    expect(decideBotBet(100, 0, "seat", 100)).toBe(0);
  });
});
