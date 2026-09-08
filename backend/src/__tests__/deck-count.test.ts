import { describe, expect, it } from "vitest";
import { GameStore, MIN_DECK_COUNT, MAX_DECK_COUNT } from "../store.js";
import { recommendedDeckCount } from "../round.js";

// "Decks to use" existed only on the lobby's create form -- set once, before
// the table was made, unchangeable afterwards. A banker who sized a shoe for
// four people and then seated twelve had to close the table and open another.
function table(players = 2) {
  const store = new GameStore();
  const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 400 });
  const ids: string[] = [];
  for (let i = 0; i < players; i += 1) ids.push(store.joinRoom(room.roomId, { firstName: `P${i}` }).player.id);
  return { store, roomId: room.roomId, adminId: admin.id, ids };
}

// A Kvitlach deck is 24 cards (docs/GAME_RULES.md), so the shoe size is
// directly observable in what a fresh round was built with: what is still in
// the deck plus what has already been dealt out of it.
//
// `deck`, not `deckRemaining` -- the store hands back the raw RoundContext,
// and deckRemaining only exists on the sanitized shape the wire sends.
const shoeCards = (store: GameStore, roundId: string) => {
  const round = store.getRound(roundId)! as unknown as { deck?: unknown[]; turns: { cards: unknown[] }[] };
  return (round.deck?.length ?? 0) + round.turns.reduce((n, t) => n + t.cards.length, 0);
};

describe("the banker's shoe size", () => {
  it("is unset until the banker chooses one", () => {
    const { store, roomId } = table();
    expect(store.getRoom(roomId)!.deckCount).toBeUndefined();
  });

  it("decides how big a shoe the next round is dealt from", () => {
    const { store, roomId, adminId } = table();
    store.setDeckCount(roomId, adminId, 6);
    const round = store.startRound(roomId, adminId);
    expect(shoeCards(store, round.roundId)).toBe(6 * 24);
  });

  // The setting would apply to nothing if it were not read here: an ordinary
  // "deal the next round" sends no deckCount at all.
  it("applies without the client asking for it each time", () => {
    const { store, roomId, adminId } = table();
    store.setDeckCount(roomId, adminId, 3);
    const round = store.startRound(roomId, adminId, undefined);
    expect(shoeCards(store, round.roundId)).toBe(3 * 24);
  });

  // A banker who changes the shoe size and then reshuffles wants the NEW
  // size -- that is the reason they reached for reshuffle.
  it("takes effect on a mid-round reshuffle", () => {
    const { store, roomId, adminId } = table();
    const round = store.startRound(roomId, adminId);
    store.setDeckCount(roomId, adminId, 8);
    const after = store.reshuffleDeck(roomId, adminId)!;
    expect(after.deckCount).toBe(8);
  });

  it("refuses a count outside the bounds rather than clamping", () => {
    const { store, roomId, adminId } = table();
    expect(() => store.setDeckCount(roomId, adminId, MIN_DECK_COUNT - 1)).toThrow("invalid_deck_count");
    expect(() => store.setDeckCount(roomId, adminId, MAX_DECK_COUNT + 1)).toThrow("invalid_deck_count");
    expect(() => store.setDeckCount(roomId, adminId, Number.NaN)).toThrow();
    expect(store.getRoom(roomId)!.deckCount).toBeUndefined();
  });

  it("is the banker's call and nobody else's", () => {
    const { store, roomId, ids } = table();
    expect(() => store.setDeckCount(roomId, ids[0], 4)).toThrow("forbidden");
  });

  // An explicit request still wins, so nothing that already passed a count
  // silently changes meaning.
  it("lets an explicit deck count override the standing choice", () => {
    const { store, roomId, adminId } = table();
    store.setDeckCount(roomId, adminId, 8);
    const round = store.startRound(roomId, adminId, 2);
    expect(shoeCards(store, round.roundId)).toBe(2 * 24);
  });
});

// The auto-size rule, pinned rather than left implied by whatever the shoe
// happened to come out as.
//
// The published guidance for the physical game is two decks (one pack) for
// four to six players. That is the ratio this follows: one deck per three
// people at the table, never fewer than two. It replaced a shoe-longevity
// model that worked out at about 1.33 decks per seat, which sized for eight
// rounds without a reshuffle rather than for what the game says to deal.
describe("auto-sizing the shoe when the banker has not chosen", () => {
  const decksFor = (playerCount: number) => recommendedDeckCount(playerCount);

  it("gives four to six people the two decks in a pack", () => {
    expect(decksFor(4)).toBe(2);
    expect(decksFor(5)).toBe(2);
    expect(decksFor(6)).toBe(2);
  });

  it("never goes below a pack, however small the table", () => {
    // A single deck is not something anyone buys or plays with, and one
    // 24-card deck is what a four-seat table used to exhaust in three rounds.
    expect(decksFor(1)).toBe(2);
    expect(decksFor(2)).toBe(2);
    expect(decksFor(3)).toBe(2);
  });

  it("scales at one deck per three people past that", () => {
    expect(decksFor(7)).toBe(3);
    expect(decksFor(9)).toBe(3);
    expect(decksFor(10)).toBe(4);
    expect(decksFor(12)).toBe(4);
  });

  it("stays inside the engine's own bounds", () => {
    // A round never deals more than MAX_SEATED_PLAYERS_PER_ROUND + 1 seats
    // (store.ts), so the ratio cannot reach MAX_DECK_COUNT from the seat count
    // alone -- but a caller passing a whole 500-person roster must still get a
    // number the engine accepts rather than one it silently clamps later.
    expect(decksFor(500)).toBeLessThanOrEqual(MAX_DECK_COUNT);
    expect(decksFor(0)).toBeGreaterThanOrEqual(MIN_DECK_COUNT);
  });
});
