import { describe, expect, it, vi, afterEach } from "vitest";
import { GameStore } from "../store.js";

const C = (n: number) => ({ name: String(n), attributes: { values: [n] } });
const TWELVE = { name: "12", attributes: { values: [12, 9, 10] } };
const TEN = { name: "10", attributes: { values: [10] } };
const GRACE_MS = 2 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

// The banker is the dealer, not a seat being waited on, so no turn timer ever
// covers them (syncTurnTimer skips admin turns deliberately). When they drop
// while the table is waiting on them, nothing moves the round along and no
// other player can act -- measured before this existed: a stranded player got
// not_your_turn / turn_not_pending / forbidden from every single action, for
// as long as the room lived. This is the way out.
function tableWaitingOnBanker(bankroll = 200) {
  const store = new GameStore();
  const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: bankroll });
  const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
  // Captured before the deal: betting draws a card, which can settle the seat
  // on the spot (a bust or an exact 21 pays out immediately), so wallets taken
  // after the bet are already mid-round. "Back where everyone started" only
  // means anything measured from here.
  const walletsAtStart = { ...store.getRoom(room.roomId)!.wallets };
  let r = store.startRound(room.roomId, admin.id);
  r.turns.find((t) => t.player.id === p1.id)!.cards = [C(10)];
  r.turns.find((t) => t.player.type === "admin")!.cards = [C(9)];
  // Stack the bet card. Left to the shuffle, it occasionally landed on an
  // exact 21 -- which resolves the seat outright, leaves nobody in "standby"
  // waiting on the bank, and so terminates the round before the banker ever
  // plays. A perfectly correct ending, and the exact opposite of the state
  // these tests need.
  r.deck = [C(3), ...r.deck];
  r = store.applyBet(r.roundId, p1.id, 5);
  r = store.applyStand(r.roundId, p1.id);
  return { store, roomId: room.roomId, admin, p1, round: r, walletsAtStart };
}

describe("a banker who drops mid-round", () => {
  it("is not treated as absent while they are still connected", () => {
    const { store, roomId } = tableWaitingOnBanker();
    expect(store.abandonedBankerInfo(roomId).stuck).toBe(false);
  });

  it("gets a grace period before the table may give up on them", () => {
    vi.useFakeTimers();
    const { store, roomId, admin, p1 } = tableWaitingOnBanker();
    store.setPresence(roomId, admin.id, "offline");

    const info = store.abandonedBankerInfo(roomId);
    expect(info.stuck).toBe(true);
    expect(() => store.voidAbandonedRound(roomId, p1.id)).toThrow("banker_not_absent_long_enough");

    vi.advanceTimersByTime(GRACE_MS - 1000);
    expect(() => store.voidAbandonedRound(roomId, p1.id)).toThrow("banker_not_absent_long_enough");

    vi.advanceTimersByTime(2000);
    expect(() => store.voidAbandonedRound(roomId, p1.id)).not.toThrow();
  });

  it("stops being absent the moment they reconnect, and the clock restarts if they drop again", () => {
    vi.useFakeTimers();
    const { store, roomId, admin, p1 } = tableWaitingOnBanker();
    store.setPresence(roomId, admin.id, "offline");
    vi.advanceTimersByTime(GRACE_MS + 1000);
    expect(store.abandonedBankerInfo(roomId).stuck).toBe(true);

    store.setPresence(roomId, admin.id, "online");
    expect(store.abandonedBankerInfo(roomId).stuck).toBe(false);
    expect(() => store.voidAbandonedRound(roomId, p1.id)).toThrow("banker_not_absent");

    // Dropping again starts a fresh grace period rather than reusing the old one.
    store.setPresence(roomId, admin.id, "offline");
    expect(() => store.voidAbandonedRound(roomId, p1.id)).toThrow("banker_not_absent_long_enough");
  });

  it("does not let a seat void a round the table can still play without the banker", () => {
    // Banker offline, but it is still a PLAYER's turn -- the round can carry
    // on. Voiding here would let someone bin a hand they didn't like the look
    // of, which is a very different thing from rescuing a stuck table.
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 200 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    store.startRound(room.roomId, admin.id);
    store.setPresence(room.roomId, admin.id, "offline");

    expect(store.abandonedBankerInfo(room.roomId).stuck).toBe(false);
    expect(() => store.voidAbandonedRound(room.roomId, p1.id)).toThrow("banker_not_absent");
  });

  it("refunds every chip the round already moved, including a live-settled bust", () => {
    vi.useFakeTimers();
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 200 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const { player: p2 } = store.joinRoom(room.roomId, { firstName: "P2" });
    const walletsAtStart = { ...store.getRoom(room.roomId)!.wallets };
    let r = store.startRound(room.roomId, admin.id);

    // Whoever is dealt first busts a REAL wager -- a no-wager blatt draw can
    // never cost anything, so it would prove nothing about refunding.
    const firstId = r.turns[0].player.id;
    r.turns[0].cards = [TWELVE, TWELVE];
    r.turns[0].bet = 10;
    r.deck = [TEN, ...r.deck];
    r = store.applyHit(r.roundId, firstId);
    expect(r.turns.find((t) => t.player.id === firstId)!.settled).toBe(true);
    expect(store.getRoom(room.roomId)!.wallets[firstId]).toBeLessThan(walletsAtStart[firstId]);

    // The other seat wagers and stands, leaving the table on the banker.
    const secondId = r.turns[1].player.id;
    r.turns.find((t) => t.player.id === secondId)!.cards = [C(10)];
    r = store.applyBet(r.roundId, secondId, 7);
    if (r.turns.find((t) => t.player.id === secondId)!.state === "pending") {
      r = store.applyStand(r.roundId, secondId);
    }

    store.setPresence(room.roomId, admin.id, "offline");
    vi.advanceTimersByTime(GRACE_MS + 1000);
    const voided = store.voidAbandonedRound(room.roomId, p1.id);
    store.finalizeRound(voided.roundId);

    // Everyone is exactly where they started -- the bust included. A hand that
    // never finished must not cost anyone anything.
    expect(store.getRoom(room.roomId)!.wallets).toEqual(walletsAtStart);
    void p2;
  });

  it("ends the round with no winners or losers, and no payouts on finalize", () => {
    vi.useFakeTimers();
    const { store, roomId, admin, p1, walletsAtStart } = tableWaitingOnBanker();
    store.setPresence(roomId, admin.id, "offline");
    vi.advanceTimersByTime(GRACE_MS + 1000);

    const voided = store.voidAbandonedRound(roomId, p1.id);
    expect(voided.state).toBe("terminate");
    expect(voided.bankLock).toBeUndefined();
    expect(voided.turns.every((t) => t.state === "skipped")).toBe(true);
    expect(voided.turns.every((t) => t.bet === 0)).toBe(true);

    const { balances } = store.finalizeRound(voided.roundId);
    expect(balances).toEqual([]);
    expect(store.getRoom(roomId)!.wallets).toEqual(walletsAtStart);
  });

  it("records the round in history as voided, so it doesn't read like a round nobody bet on", () => {
    vi.useFakeTimers();
    const { store, roomId, admin, p1 } = tableWaitingOnBanker();
    store.setPresence(roomId, admin.id, "offline");
    vi.advanceTimersByTime(GRACE_MS + 1000);
    const voided = store.voidAbandonedRound(roomId, p1.id);
    store.finalizeRound(voided.roundId);

    const entry = store.getRoom(roomId)!.roundHistory![0];
    expect(entry.voided).toBe(true);
    expect(entry.entries.every((e) => e.net === 0)).toBe(true);
  });

  it("frees the table to deal again once the banker returns", () => {
    vi.useFakeTimers();
    const { store, roomId, admin, p1 } = tableWaitingOnBanker();
    store.setPresence(roomId, admin.id, "offline");
    vi.advanceTimersByTime(GRACE_MS + 1000);
    const voided = store.voidAbandonedRound(roomId, p1.id);
    store.finalizeRound(voided.roundId);

    store.setPresence(roomId, admin.id, "online");
    expect(() => store.startRound(roomId, admin.id)).not.toThrow();
  });

  it("refuses a spectator, and anyone who isn't at the table at all", () => {
    vi.useFakeTimers();
    const { store, roomId, admin } = tableWaitingOnBanker();
    const { player: watcher } = store.joinRoom(roomId, { firstName: "Watcher", spectator: true });
    store.setPresence(roomId, admin.id, "offline");
    vi.advanceTimersByTime(GRACE_MS + 1000);

    expect(() => store.voidAbandonedRound(roomId, watcher.id)).toThrow("forbidden");
    expect(() => store.voidAbandonedRound(roomId, "nobody-at-all")).toThrow("forbidden");
  });

  it("never fires for a practice table, whose banker is a bot that cannot go offline", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Solo" });
    expect(store.abandonedBankerInfo(room.roomId).stuck).toBe(false);
  });
});
