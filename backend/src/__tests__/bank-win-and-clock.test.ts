import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GameStore } from "../store.js";

// Two bugs reported from the felt in v11.6, both inside a BANK!.
//
// The first: "the countdown timer during BANK! made me stand at 16 when I
// was deciding whether or not to hit."
//
// The second: "a computer player bet BANK! then got 21. but the bank just
// played him out and stayed at 17 [...] the whole round was broken as a
// result."

const TURN_TIMEOUT_MS = 90 * 1000;
const card = (...values: number[]) => ({ name: String(values[0]), attributes: { values } });
const TWO = card(2);
const NINE = card(9);
const TWELVE = card(12, 9, 10);

function activeSeat(store: GameStore, roundId: string) {
  return store.getRound(roundId)!.turns.find((t) => t.state === "pending" && t.player.type !== "admin")!;
}

describe("the turn clock refills on every action, not once per turn", () => {
  // Block bodies, not expression bodies: `() => vi.useFakeTimers()` RETURNS
  // VitestUtils, and a Vitest hook's return type is Awaitable<void>. vitest
  // itself does not care and never type-checks, so the suite ran green here
  // and broke `tsc -p tsconfig.json` -- which is the backend image's own
  // build step, so it failed on the server rather than on this machine.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives a player who just acted a fresh 90s to decide on the next move", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);
    const activeId = activeSeat(store, round.roundId).player.id;

    // Low cards only, so betting can neither bust the hand nor make 21 --
    // the seat is still pending afterwards and the clock is what is on test.
    store.getRound(round.roundId)!.deck = [TWO, TWO, TWO, TWO, TWO, TWO];

    // Deep into the window, then a real action.
    vi.advanceTimersByTime(TURN_TIMEOUT_MS - 10_000);
    store.applyBet(round.roundId, activeId, 5);
    expect(store.getRound(round.roundId)!.turns.find((t) => t.player.id === activeId)!.state).toBe("pending");

    // Past the ORIGINAL 90s mark, well inside the refilled one. This is the
    // reported bug: a player thinking about their next card was force-stood
    // 10 seconds after taking one.
    vi.advanceTimersByTime(20_000);
    const after = store.getRound(round.roundId)!.turns.find((t) => t.player.id === activeId)!;
    expect(after.state).toBe("pending");
  });

  it("still force-stands a seat that takes no action at all", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);
    const activeId = activeSeat(store, round.roundId).player.id;

    vi.advanceTimersByTime(TURN_TIMEOUT_MS + 1000);
    expect(store.getRound(round.roundId)!.turns.find((t) => t.player.id === activeId)!.state).not.toBe("pending");
  });

  it("does not hand the active seat a free refill when somebody else's action writes the round", () => {
    // The refill has to key off THIS seat acting. Anything else that
    // persists the round -- a reshuffle, a room change, another seat -- must
    // leave the clock exactly where it was, or the safety net stops being
    // one at a busy table.
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);
    const activeId = activeSeat(store, round.roundId).player.id;

    vi.advanceTimersByTime(TURN_TIMEOUT_MS - 5000);
    store.reshuffleDeck(room.roomId, admin.id);
    vi.advanceTimersByTime(6000);

    expect(store.getRound(round.roundId)!.turns.find((t) => t.player.id === activeId)!.state).not.toBe("pending");
  });
});

describe("a BANK! that wins outright at the player's own turn", () => {
  // One seat, so the whole bank is available to it and the win empties the
  // bank exactly -- the case the report describes.
  function bankTable() {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 50 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "Moshe" });
    const round = store.startRound(room.roomId, admin.id);
    const live = store.getRound(round.roundId)!;
    // Hand the seat a 9 and put a 12 on top of the shoe: the bet's own card
    // makes 21 the instant it lands.
    live.turns.find((t) => t.player.id === p1.id)!.cards = [NINE];
    live.deck = [TWELVE, TWO, TWO, TWO];
    return { store, roomId: room.roomId, admin, p1, roundId: round.roundId };
  }

  it("does not send the banker in to play a hand that cannot change anything", () => {
    const { store, p1, roundId } = bankTable();
    const after = store.applyBet(roundId, p1.id, 50, { bank: true });

    expect(after.turns.find((t) => t.player.id === p1.id)!.state).toBe("won");
    expect(after.bankLock?.stage).not.toBe("banker");
    // The banker is still holding exactly what they were dealt.
    expect(after.turns.find((t) => t.player.type === "admin")!.cards).toHaveLength(1);
  });

  it("parks the round on the banker's decision once that win empties the bank", () => {
    const { store, roomId, admin, p1, roundId } = bankTable();
    const after = store.applyBet(roundId, p1.id, 50, { bank: true });

    expect(store.getRoom(roomId)!.wallets[admin.id]).toBe(0);
    // Without this the lock was simply dropped and play carried on against a
    // bank with nothing in it.
    expect(after.bankLock?.stage).toBe("decision");
    expect(store.getRoom(roomId)!.wallets[p1.id]).toBe(150);
  });
});
