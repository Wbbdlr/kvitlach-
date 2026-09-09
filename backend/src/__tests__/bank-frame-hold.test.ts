import { afterEach, describe, expect, it, vi } from "vitest";
import { GameStore } from "../store.js";

const C = (n: number) => ({ name: String(n), attributes: { values: [n] } });

// A BANK! wager that leaves seats waiting forces the banker into a fresh hand,
// and settleBankOutcome overwrites their turn with it in the same call. The
// hand that just won every one of those wagers is never broadcast at all --
// only stashed on lastBankFrame for a toast.
//
// Reported from a real table: "he beat the players he was playing out, then
// got a new card and continued playing, but it all happened so fast his first
// hand disappeared so we don't even know how he beat the first few players."
//
// The felt now holds that frame up to be read. At a LIVE table that costs
// nothing to enforce -- the banker's own fresh hand is the active turn, so
// everyone is waiting on a human anyway. At a COMPUTER table the bot would
// play its new hand out from under the panel, so the server holds it.

afterEach(() => {
  // Braces, not a concise arrow: useRealTimers RETURNS VitestUtils and the
  // hook is typed void, so this passes vitest and fails tsc -- which is the
  // backend image's own build step. Second time this session.
  vi.useRealTimers();
});

/** A live table: human banker, three seats, P2 goes BANK! and the bank wins. */
function liveFrame() {
  const store = new GameStore();
  const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 300, bankerBankroll: 100 });
  const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
  const { player: p2 } = store.joinRoom(room.roomId, { firstName: "P2" });
  store.joinRoom(room.roomId, { firstName: "P3" });
  let r = store.startRound(room.roomId, admin.id);

  const p1Index = r.turns.findIndex((t) => t.player.id === p1.id);
  r.turns[p1Index].cards = [C(9)];
  r.deck = [C(6), ...r.deck];
  r = store.applyBet(r.roundId, p1.id, 10);
  r = store.applyStand(r.roundId, p1.id);

  const p2Index = r.turns.findIndex((t) => t.player.id === p2.id);
  r.turns[p2Index].cards = [C(8)];
  r.deck = [C(4), ...r.deck];
  r = store.applyBet(r.roundId, p2.id, 90);
  r = store.applyStand(r.roundId, p2.id);

  const bankerIndex = r.turns.findIndex((t) => t.player.type === "admin");
  r.turns[bankerIndex].cards = [C(9), C(9)]; // 18, beats both
  r.deck = [C(2), ...r.deck]; // the redealt card
  r = store.applyStand(r.roundId, admin.id);
  return { store, room, admin, round: r };
}

describe("a live table is not held", () => {
  it("redeals without waiting, because the table already waits on a human", () => {
    const { round } = liveFrame();
    expect(round.lastBankFrame, "the frame should still be stashed").toBeDefined();
    expect(round.bankFrameHoldAt).toBeUndefined();
  });

  it("has nothing for an acknowledgement to release", () => {
    const { store, room, admin } = liveFrame();
    expect(store.acknowledgeBankFrame(room.roomId, admin.id)).toBeUndefined();
  });
});

/**
 * A computer table mid-BANK!.
 *
 * The BANK! comes from a BOT, and that is not an arbitrary choice: a practice
 * table seats the bots first, then the human, then the bot banker, so a human
 * BANK! is always the last seat and can never force a redeal. The reported
 * scenario -- the bank beating several players and dealing on -- can only come
 * from a bot wagering with seats still behind it.
 */
function practiceFrame() {
  vi.useFakeTimers();
  const store = new GameStore();
  const { room, player: human } = store.createPracticeRoom({ firstName: "Solo", botCount: 2, buyIn: 100, bankBuyIn: 100 });
  const state = store.getRoom(room.roomId)!;
  const banker = state.players.find((p) => p.type === "admin")!;
  let r = store.startRound(room.roomId, human.id);

  const first = r.turns[0].player.id; // a bot, seated ahead of the human
  r.turns[0].cards = [C(8)];
  r.deck = [C(4), ...r.deck]; // -> 12
  r = store.applyBet(r.roundId, first, 100); // the bank's whole wallet: BANK!
  r = store.applyStand(r.roundId, first);
  expect(r.bankLock?.stage, "a full-wallet wager should send the banker in").toBe("banker");

  const bankerIndex = r.turns.findIndex((t) => t.player.type === "admin");
  r.turns[bankerIndex].cards = [C(9), C(9)]; // 18, beats the 12
  r.deck = [C(2), ...r.deck]; // the redealt card
  r = store.applyStand(r.roundId, banker.id);
  return { store, room, human, banker, round: r };
}

describe("a computer table waits to be read", () => {
  it("holds the frame it just won", () => {
    const { round } = practiceFrame();
    expect(round.lastBankFrame).toBeDefined();
    expect(round.bankFrameHoldAt).toBe(round.lastBankFrame!.settledAt);
  });

  it("arms no bot while it is holding", () => {
    // The whole point: the bot has been dealt its next card (moving the draw
    // would break settleBankOutcome's deck_empty guard) but must not PLAY it.
    const { round } = practiceFrame();
    expect(round.botTimer, "a bot timer here is the bot playing under the panel").toBeUndefined();
  });

  it("releases on acknowledgement, and only then arms the bot", () => {
    const { store, room, human, round } = practiceFrame();
    const released = store.acknowledgeBankFrame(room.roomId, human.id, round.bankFrameHoldAt);
    expect(released).toBeDefined();
    expect(released!.bankFrameHoldAt).toBeUndefined();
    expect(released!.botTimer, "the bot should be scheduled once the frame is read").toBeDefined();
  });

  it("ignores an acknowledgement for a frame it is not holding", () => {
    // Two BANK! frames can land in one round; a click already in flight when
    // the second arrives must not skip it.
    const { store, room, human } = practiceFrame();
    expect(store.acknowledgeBankFrame(room.roomId, human.id, 1)).toBeUndefined();
  });

  it("takes a bare acknowledgement, for a client that sends no timestamp", () => {
    const { store, room, human } = practiceFrame();
    expect(store.acknowledgeBankFrame(room.roomId, human.id)).toBeDefined();
  });

  it("refuses a second release, so a double click is not an extra turn", () => {
    const { store, room, human, round } = practiceFrame();
    store.acknowledgeBankFrame(room.roomId, human.id, round.bankFrameHoldAt);
    expect(store.acknowledgeBankFrame(room.roomId, human.id, round.bankFrameHoldAt)).toBeUndefined();
  });

  it("refuses somebody who is not at the table", () => {
    const { store, room } = practiceFrame();
    expect(() => store.acknowledgeBankFrame(room.roomId, "nobody")).toThrow("forbidden");
  });

  it("refuses a bot acting for itself", () => {
    // Same rule as reshuffleDeck: a bot has no session and never acts as one.
    const { store, room, banker } = practiceFrame();
    expect(() => store.acknowledgeBankFrame(room.roomId, banker.id)).toThrow("forbidden");
  });
});
