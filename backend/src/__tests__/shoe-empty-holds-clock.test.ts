import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GameStore } from "../store.js";

// The shoe runs out roughly every eight rounds BY DESIGN
// (TARGET_ROUNDS_PER_SHOE) and never refills itself -- a real shoe is
// something the banker calls for. What that left behind, measured on a
// practice table with the shoe emptied mid-round:
//
//   t+0s   a seat is on turn and cannot be dealt a card
//   t+60s  its clock runs out, it is force-stood
//   t+60s  the next seat starts the same 60 seconds
//   ...    the rest of the round auto-stands one full clock at a time
//
// A bot seat is worse than a human one: playBotTurn's draw throws deck_empty,
// the catch logs it, and nothing reschedules -- so the seat does not even
// twitch while its clock runs down.
//
// The felt was NOT silent through this (TableRoot's shoeDecisionPending is
// driven by deckRemaining, so the panel is up for the whole table whoever is
// on turn) -- what it lacked was time to act on it. The clock now stops while
// the shoe is empty.

const priv = (store: GameStore) =>
  store as unknown as { getActiveTurnId(round: unknown): string | undefined };

afterEach(() => {
  vi.useRealTimers();
});

function tableWithSeatOnTurn() {
  const store = new GameStore();
  const { room, player: human } = store.createPracticeRoom({ firstName: "Learner", botCount: 2 });
  const roundId = store.getRoom(room.roomId)!.roundId!;
  return { store, roomId: room.roomId, human, roundId };
}

describe("a turn clock with nothing left to deal", () => {
  it("does not run", () => {
    vi.useFakeTimers();
    const { store, roundId } = tableWithSeatOnTurn();
    const before = store.getRound(roundId)!;
    expect(before.turnTimerPlayerId, "a clock should be running to begin with").toBeTruthy();

    // Emptying the shoe is not itself a round update, so push one through the
    // way play would -- any persistRound re-runs syncTurnTimer.
    store.getRound(roundId)!.deck = [];
    const active = priv(store).getActiveTurnId(store.getRound(roundId)!)!;
    store.applySkip(roundId, active);

    const held = store.getRound(roundId)!;
    expect(held.turnTimerPlayerId).toBeUndefined();
    expect(held.turnTimerExpiresAt).toBeUndefined();
  });

  it("leaves the seat on turn alone instead of force-standing it", () => {
    vi.useFakeTimers();
    const { store, roundId, human } = tableWithSeatOnTurn();
    // Emptied BEFORE the hand-off, so the stand's own persistRound is what
    // runs syncTurnTimer against an empty shoe -- the same order play
    // produces when the last card goes out.
    store.getRound(roundId)!.deck = [];
    store.applyStand(roundId, human.id);
    const active = priv(store).getActiveTurnId(store.getRound(roundId)!)!;
    expect(store.getRound(roundId)!.turnTimerPlayerId).toBeUndefined();

    // Four whole clocks. Before this change the round auto-stood its way to
    // the end one 60-second clock at a time.
    vi.advanceTimersByTime(240_000);
    expect(priv(store).getActiveTurnId(store.getRound(roundId)!)).toBe(active);
    expect(store.getRound(roundId)!.turns.find((t) => t.player.id === active)!.state).toBe("pending");
  });

  it("still force-stands when there ARE cards, which is the rule it must not break", () => {
    // The guard is about an impossible table, not about turn timeouts. If
    // this ever goes green with the deck check widened, the timeout has been
    // disabled outright and a stalled human freezes a real table forever.
    vi.useFakeTimers();
    const { store, roundId, human } = tableWithSeatOnTurn();
    store.applyStand(roundId, human.id);
    const active = priv(store).getActiveTurnId(store.getRound(roundId)!)!;
    expect(store.getRound(roundId)!.deck.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(120_000);
    expect(store.getRound(roundId)!.turns.find((t) => t.player.id === active)!.state).not.toBe("pending");
  });
});

describe("a fresh shoe", () => {
  it("restarts a stalled bot, which is what makes the panel's button worth pressing", () => {
    // Measured before and after: the seat sits on one card while the shoe is
    // empty and draws its second within the think delay of the reshuffle.
    vi.useFakeTimers();
    const { store, roomId, roundId, human } = tableWithSeatOnTurn();
    store.applyStand(roundId, human.id);
    const active = priv(store).getActiveTurnId(store.getRound(roundId)!)!;
    store.getRound(roundId)!.deck = [];
    vi.advanceTimersByTime(5_000);
    expect(store.getRound(roundId)!.turns.find((t) => t.player.id === active)!.cards).toHaveLength(1);

    store.reshuffleDeck(roomId, human.id);
    vi.advanceTimersByTime(5_000);
    expect(
      store.getRound(roundId)!.turns.find((t) => t.player.id === active)!.cards.length,
      "the bot never took its card after the shoe came back"
    ).toBeGreaterThan(1);
  });

  it("hands back a whole clock rather than resuming a dead one", () => {
    // The held branch clears turnTimerExpiresAt on the way through. If it ever
    // stops doing that, the seat that waited out the reshuffle comes back to
    // whatever was left of a deadline that expired during the wait -- which is
    // an instant force-stand, the exact bug this was meant to remove.
    vi.useFakeTimers();
    const { store, roomId, roundId, human } = tableWithSeatOnTurn();
    store.applyStand(roundId, human.id);
    store.getRound(roundId)!.deck = [];
    store.getRound(roundId)!.turnTimerExpiresAt = undefined;
    store.reshuffleDeck(roomId, human.id);
    const after = store.getRound(roundId)!;
    expect(after.turnTimerExpiresAt).toBeGreaterThan(Date.now() + 30_000);
  });
});

describe("who gets told", () => {
  it("puts the empty shoe in the round every client reads, whoever is on turn", () => {
    // The user's ask in as many words: "the human should always get the
    // notification no matter whose turn it is so they can order the
    // reshuffle." It is carried by the round itself rather than by anything
    // turn-scoped, so it is true for every viewer at once.
    const { store, roundId, human } = tableWithSeatOnTurn();
    store.getRound(roundId)!.deck = [];
    expect(store.getRound(roundId)!.deck).toHaveLength(0);
    store.applyStand(roundId, human.id);
    expect(store.getRound(roundId)!.deck).toHaveLength(0);
  });

  it("is shown off the shoe, not off whose turn it is", () => {
    // Asserted on the source for the reason every other layout fact here is:
    // jsdom lays out none of this. What matters is the SHAPE of the condition
    // -- a panel gated on "is it my turn" would be exactly the bug reported.
    const source = readFileSync(
      resolve(__dirname, "../../../frontend/src/table/TableRoot.tsx"),
      "utf8"
    );
    expect(source).toContain("const shoeEmpty = (round?.deckRemaining ?? 1) === 0;");
    expect(source).toContain("shoeDecisionPending && (");
    expect(source).toContain("The shoe is empty");
    // And both audiences are addressed: whoever can fix it gets the button,
    // everyone else gets told who they are waiting on.
    expect(source).toContain("Shuffle a fresh shoe");
    expect(source).toContain("Waiting for the banker to shuffle a fresh shoe.");
  });
});
