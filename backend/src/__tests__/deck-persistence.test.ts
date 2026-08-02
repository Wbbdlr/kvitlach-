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

    // Alice's stand is a $0 push (no wager), which resolves her instantly and,
    // since she's the only non-banker seated, auto-terminates the round right
    // there -- the banker's own turn gets force-resolved by calculateEndState
    // and never reaches "pending" for a separate stand action.
    const afterAliceStand = store.applyStand(round1.roundId, round1.turns.find((t) => t.player.type === "player")!.player.id);
    expect(afterAliceStand.state).toBe("terminate");
    store.finalizeRound(afterAliceStand.roundId);

    const round2 = store.startRound(room.roomId);
    // Round 2 dealt 2 more cards (1 per seated player) out of what round 1 left behind --
    // it should NOT be a full fresh shoe's worth of remaining cards.
    expect(round2.deck.length).toBe(deckAfterRound1Deal - 2);
    expect(round2.deckReshuffledAt).toBeUndefined();
  });

  // The dealer chooses when a new shoe comes in -- the server used to decide
  // this FOR them, silently substituting a fresh shoe the moment the carried-
  // over one ran low. That's the opposite of a real table, where running low
  // is something the banker notices and acts on. See GameStore.reshuffleDeck.
  it("refuses to start the round when the carried-over deck can't cover the players, until the banker reshuffles", () => {
    const store = new GameStore();
    const { room, player: bankerPlayer } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Alice" });

    const round1 = store.startRound(room.roomId);
    const roundId = round1.roundId;
    // Simulate the shoe having almost run out by the time the round ends.
    const roundCtx = (store as any).rounds.get(roundId);
    roundCtx.deck = [];
    const alicePlayerId = round1.turns.find((t) => t.player.type === "player")!.player.id;
    const afterAliceStand = store.applyStand(roundId, alicePlayerId);
    expect(afterAliceStand.state).toBe("terminate");
    store.finalizeRound(afterAliceStand.roundId);

    // The banker tries to deal the next round -- refused, not silently fixed.
    expect(() => store.startRound(room.roomId)).toThrow("deck_low");
    // Nothing about the room changed as a result of the failed attempt --
    // no round got created, and (see the rotation test below) the turn
    // order didn't advance either.
    expect(store.getRoom(room.roomId)!.roundId).toBeUndefined();

    // The banker chooses to reshuffle -- NOW starting the round works, and
    // everyone gets told a fresh shoe just came in.
    store.reshuffleDeck(room.roomId, bankerPlayer.id);
    const round2 = store.startRound(room.roomId);
    expect(round2.deckReshuffledAt).toBeDefined();
    expect(round2.deck.length).toBeGreaterThan(0);
  });

  it("refuses the draw when the shoe runs out mid-round, instead of silently reshuffling underneath the hand", () => {
    const players = [admin, p1];
    // A full shoe for the opening deal -- this test is about drawCard's own
    // mid-round behavior, not createRound's (see the deck_low tests for that).
    const round = createRound(players, "room-1", 1, 1, buildShoe(1));
    // Force the deck empty right after the initial deal.
    round.deck = [];
    const cardsBefore = round.turns.find((t) => t.player.id === p1.id)!.cards;

    expect(() => handleHit(round, p1.id)).toThrow("deck_empty");
    // The failed draw must be a clean no-op -- nothing about the hand it
    // couldn't complete should change.
    expect(round.turns.find((t) => t.player.id === p1.id)!.cards).toBe(cardsBefore);
    expect(round.deck).toEqual([]);
  });

  it("createRound throws deck_low when a carried-over deck can't cover every seated player, but still deals a brand new room's very first shoe", () => {
    const players = [admin, p1];
    const plentyOfCards = buildShoe(1);
    const round = createRound(players, "room-1", 1, 1, plentyOfCards);
    expect(round.deckReshuffledAt).toBeUndefined();
    expect(round.deck.length).toBe(plentyOfCards.length - players.length);

    // A carried-over deck that's run too low refuses rather than reshuffles.
    const tooFewCards = [plentyOfCards[0]];
    expect(() => createRound(players, "room-1", 1, 1, tooFewCards)).toThrow("deck_low");

    // But a room with NO prior deck at all (existingDeck undefined -- there's
    // nothing to have run low FROM, so no dealer choice is being bypassed)
    // still deals its first shoe automatically, same as always.
    const firstEver = createRound(players, "room-1", 1, 1, undefined);
    expect(firstEver.deckReshuffledAt).toBeUndefined();
    expect(firstEver.deck.length).toBeGreaterThan(0);
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

  it("does not advance the turn rotation or set roundId when startRound fails", () => {
    // Before this fix, nextStart advanced (and, separately, "not_enough_players"
    // could throw AFTER it advanced too) regardless of whether the round it
    // was rotating FOR actually got created -- a retry after fixing the
    // problem would then skip a player who never got a turn. Asserted
    // directly on the room record rather than by re-deriving it from two
    // full rounds of play, which is what the underlying bug actually breaks.
    const store = new GameStore();
    const { room, player: bankerPlayer } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Alice" });
    store.joinRoom(room.roomId, { firstName: "Bruch" });

    const roomRec = (store as any).rooms.get(room.roomId);
    const nextStartBefore = roomRec.nextStart;
    // A defined-but-empty carried-over deck (not undefined) simulates a room
    // that's played before and is now down to nothing.
    roomRec.deck = [];

    expect(() => store.startRound(room.roomId)).toThrow("deck_low");
    expect(roomRec.nextStart).toBe(nextStartBefore);
    expect(roomRec.room.roundId).toBeUndefined();

    // Retrying without fixing anything fails identically -- nothing was left
    // half-mutated for a second attempt to trip over.
    expect(() => store.startRound(room.roomId)).toThrow("deck_low");
    expect(roomRec.nextStart).toBe(nextStartBefore);

    store.reshuffleDeck(room.roomId, bankerPlayer.id);
    const round = store.startRound(room.roomId);
    expect(round.state).toBe("playing");
    expect(roomRec.nextStart).not.toBe(nextStartBefore); // only advances on an actual success
  });
});

describe("GameStore.reshuffleDeck -- the dealer's own choice, live or between rounds", () => {
  it("is banker-only, both between rounds and mid-round", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker" });
    const { player: alice } = store.joinRoom(room.roomId, { firstName: "Alice" });

    expect(() => store.reshuffleDeck(room.roomId, alice.id)).toThrow("forbidden");

    store.startRound(room.roomId);
    expect(() => store.reshuffleDeck(room.roomId, alice.id)).toThrow("forbidden");
  });

  it("between rounds, builds the fresh shoe immediately -- the very next round doesn't need a second attempt", () => {
    const store = new GameStore();
    const { room, player: bankerPlayer } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Alice" });

    const returned = store.reshuffleDeck(room.roomId, bankerPlayer.id);
    // No active round -- nothing to broadcast yet.
    expect(returned).toBeUndefined();

    const round = store.startRound(room.roomId);
    expect(round.deckReshuffledAt).toBeDefined();
    expect(round.deck.length).toBeGreaterThan(0);
  });

  it("mid-round, replaces only the live round's remaining shoe -- cards already dealt into hands are untouched", () => {
    const store = new GameStore();
    const { room, player: bankerPlayer } = store.createRoom({ firstName: "Banker" });
    const { player: alice } = store.joinRoom(room.roomId, { firstName: "Alice" });

    const round = store.startRound(room.roomId);
    const aliceHandBefore = round.turns.find((t) => t.player.id === alice.id)!.cards;

    const updated = store.reshuffleDeck(room.roomId, bankerPlayer.id);
    expect(updated).toBeDefined();
    expect(updated!.deckReshuffledAt).toBeDefined();
    expect(updated!.deck.length).toBeGreaterThan(0);

    const roundAfter = store.getRound(round.roundId)!;
    expect(roundAfter.turns.find((t) => t.player.id === alice.id)!.cards).toEqual(aliceHandBefore);

    // And play continues normally on the fresh shoe -- proves this isn't just
    // a cosmetic swap, the round is actually still live and playable.
    expect(() => store.applyStand(round.roundId, alice.id)).not.toThrow();
  });
});
