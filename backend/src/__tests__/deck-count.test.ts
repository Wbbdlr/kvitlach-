import { describe, expect, it } from "vitest";
import { GameStore, MIN_DECK_COUNT, MAX_DECK_COUNT } from "../store.js";

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
