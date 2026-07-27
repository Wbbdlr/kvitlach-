import { GameStore } from "../store.js";
import { createRound, handleHit, buildShoe } from "../round.js";
import { Player } from "../types.js";

const admin: Player = { id: "admin-1", firstName: "Bank", lastName: "", type: "admin", presence: "online" };
const p1: Player = { id: "p1", firstName: "P1", lastName: "", type: "player", presence: "online" };

describe("deck persistence across rounds", () => {
  it("carries the leftover shoe into the next round instead of dealing a fresh one", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Alice" });

    const round1 = store.startRound(room.roomId);
    const deckAfterRound1Deal = round1.deck.length;

    // Finish round 1 without drawing any more cards (both stand immediately).
    const afterAliceStand = store.applyStand(round1.roundId, round1.turns.find((t) => t.player.type === "player")!.player.id);
    store.applyStand(afterAliceStand.roundId, admin.id === afterAliceStand.turns[0].player.id ? admin.id : afterAliceStand.turns.find((t) => t.player.type === "admin")!.player.id);
    store.finalizeRound(afterAliceStand.roundId);

    const round2 = store.startRound(room.roomId);
    // Round 2 dealt 2 more cards (1 per seated player) out of what round 1 left behind --
    // it should NOT be a full fresh shoe's worth of remaining cards.
    expect(round2.deck.length).toBe(deckAfterRound1Deal - 2);
    expect(round2.deckReshuffledAt).toBeUndefined();
  });

  it("reshuffles a fresh shoe when the carried-over deck can't cover the next round's players", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Alice" });

    const round1 = store.startRound(room.roomId);
    const roundId = round1.roundId;
    // Simulate the shoe having almost run out by the time the round ends.
    const roundCtx = (store as any).rounds.get(roundId);
    roundCtx.deck = [];
    const alicePlayerId = round1.turns.find((t) => t.player.type === "player")!.player.id;
    const afterAliceStand = store.applyStand(roundId, alicePlayerId);
    const bankerId = afterAliceStand.turns.find((t) => t.player.type === "admin")!.player.id;
    store.applyStand(afterAliceStand.roundId, bankerId);
    store.finalizeRound(afterAliceStand.roundId);

    const round2 = store.startRound(room.roomId);
    expect(round2.deckReshuffledAt).toBeDefined();
    expect(round2.deck.length).toBeGreaterThan(0);
  });

  it("reshuffles mid-round (via handleHit) instead of throwing deck_empty when the shoe runs out", () => {
    const players = [admin, p1];
    const round = createRound(players, "room-1", 1, 1, []);
    // Force the deck empty right after the initial deal.
    round.deck = [];

    const updated = handleHit(round, p1.id);
    expect(updated.deckReshuffledAt).toBeDefined();
    expect(updated.deck.length).toBeGreaterThan(0);
    expect(updated.turns.find((t) => t.player.id === p1.id)?.cards).toHaveLength(2);
  });

  it("createRound only reshuffles when the existing deck can't cover every seated player", () => {
    const players = [admin, p1];
    const plentyOfCards = buildShoe(1);
    const round = createRound(players, "room-1", 1, 1, plentyOfCards);
    expect(round.deckReshuffledAt).toBeUndefined();
    expect(round.deck.length).toBe(plentyOfCards.length - players.length);

    const tooFewCards = [plentyOfCards[0]]; // fewer cards than players
    const reshuffled = createRound(players, "room-1", 1, 1, tooFewCards);
    expect(reshuffled.deckReshuffledAt).toBeDefined();
  });

  it("does not flag deckReshuffledAt on a brand new room's very first round", () => {
    // No existingDeck at all (undefined, not just empty) -- dealing the very
    // first shoe is ordinary setup, not "the shoe ran low", so players
    // shouldn't get a reshuffle notice the moment they start their first round.
    const round = createRound([admin, p1], "room-1", 1, 1, undefined);
    expect(round.deckReshuffledAt).toBeUndefined();
  });

  it("does not show a reshuffle notice on a live room's actual very first startRound()", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Alice" });

    const round1 = store.startRound(room.roomId);
    expect(round1.deckReshuffledAt).toBeUndefined();
  });
});
