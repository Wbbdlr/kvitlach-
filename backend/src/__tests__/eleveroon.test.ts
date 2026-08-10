import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

const C = (n: number) => ({ name: String(n), attributes: { values: [n] } });

// Regression for a live-reported bug (2026-08-10): a player turned Eleveroon
// on, had a hand reading exactly 11 (no flexible cards), and drew an 11 via
// the *Bet* button -- and busted anyway, with no Eleveroon save and no
// eleveroonIgnored flag on the card. Root cause: handleHit implemented the
// rule; handleBet (used for the initial wager AND every later "add to the
// bet" draw -- see README's "Bet adds to the wager and deals a card") never
// did. Since a wagered hand draws through Bet far more often than through a
// bare Hit, this wasn't an edge case.
describe("Eleveroon", () => {
  it("saves a busting eleven drawn via a plain Bet, not just Hit", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 200 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    let r = store.startRound(room.roomId, admin.id);

    const turnIndex = r.turns.findIndex((t) => t.player.id === p1.id);
    r.turns[turnIndex].cards = [C(5), C(6)]; // exactly 11, no flexible (e.g. 12) cards
    r.deck = [C(11), ...r.deck]; // next draw is the busting eleven

    r = store.applyBet(r.roundId, p1.id, 5, { eleveroon: true });

    const turn = r.turns.find((t) => t.player.id === p1.id)!;
    expect(turn.state).toBe("pending"); // NOT "lost" -- this is what the report broke
    expect(turn.cards).toHaveLength(3);
    expect(turn.cards[2].attributes.eleveroonIgnored).toBe(true);
  });

  it("still busts on a plain Bet when Eleveroon is off", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 200 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    let r = store.startRound(room.roomId, admin.id);

    const turnIndex = r.turns.findIndex((t) => t.player.id === p1.id);
    r.turns[turnIndex].cards = [C(5), C(6)];
    r.deck = [C(11), ...r.deck];

    r = store.applyBet(r.roundId, p1.id, 5); // no eleveroon option at all

    const turn = r.turns.find((t) => t.player.id === p1.id)!;
    expect(turn.state).toBe("lost");
    expect(turn.cards[2].attributes.eleveroonIgnored).toBeFalsy();
  });

  it("still saves via Hit (the path that already worked -- kept as a baseline)", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 200 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    let r = store.startRound(room.roomId, admin.id);

    const turnIndex = r.turns.findIndex((t) => t.player.id === p1.id);
    r.turns[turnIndex].cards = [C(5), C(6)];
    r.deck = [C(11), ...r.deck];

    r = store.applyHit(r.roundId, p1.id, { eleveroon: true });

    const turn = r.turns.find((t) => t.player.id === p1.id)!;
    expect(turn.state).toBe("pending");
    expect(turn.cards[2].attributes.eleveroonIgnored).toBe(true);
  });

  it("permanently removes a rejected card from the deck -- it cannot be drawn again", () => {
    // "Ignored" only ever means excluded from the hand's own sum (turn.ts's
    // getSums filters eleveroonIgnored cards) -- it was already drawn off
    // the live deck via drawCard (round.ts) the same as any other card, and
    // nothing anywhere puts it back. Confirmed explicitly here since a
    // player can't see the deck to check for themselves.
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 200 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    let r = store.startRound(room.roomId, admin.id);

    const turnIndex = r.turns.findIndex((t) => t.player.id === p1.id);
    r.turns[turnIndex].cards = [C(5), C(6)];
    const rejectedCard = C(11);
    const deckSizeBefore = r.deck.length;
    r.deck = [rejectedCard, ...r.deck];

    r = store.applyBet(r.roundId, p1.id, 5, { eleveroon: true });

    expect(r.deck).toHaveLength(deckSizeBefore); // +1 stacked on, -1 drawn off -> net unchanged
    expect(r.deck.some((c) => c === rejectedCard)).toBe(false);
  });

  it("protects the banker's own Hit with no option needed -- Eleveroon is always on for the banker", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 200 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    let r = store.startRound(room.roomId, admin.id);

    // Get the round to the banker's own turn first -- P1 needs a real wager
    // on the table (a $0 stand is just a push, resolved with nothing left
    // for the banker to show down against, and the round would terminate
    // without ever giving the banker a turn).
    const p1Index = r.turns.findIndex((t) => t.player.id === p1.id);
    r.turns[p1Index].cards = [C(5)];
    r = store.applyBet(r.roundId, p1.id, 5);
    if (r.turns.find((t) => t.player.id === p1.id)!.state === "pending") {
      r = store.applyStand(r.roundId, p1.id);
    }
    expect(r.state).toBe("final");

    const bankerIndex = r.turns.findIndex((t) => t.player.type === "admin");
    r.turns[bankerIndex].cards = [C(5), C(6)];
    r.deck = [C(11), ...r.deck];

    r = store.applyHit(r.roundId, admin.id); // no eleveroon option passed at all

    const bankerTurn = r.turns.find((t) => t.player.type === "admin")!;
    expect(bankerTurn.state).toBe("pending");
    expect(bankerTurn.cards[2].attributes.eleveroonIgnored).toBe(true);
  });
});
