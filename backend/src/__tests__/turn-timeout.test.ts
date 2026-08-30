import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GameStore } from "../store.js";

// The 90-second turn timer is the safety net for a player who walks away
// mid-hand, drops their connection, or simply stalls -- without it, one
// unresponsive seat wedges the whole table forever, since the server holds
// strict turn order (nobody else can act out of turn -- see turn-order.test.ts).
// It had zero test coverage before this file: nothing anywhere exercised
// syncTurnTimer's setTimeout actually firing, forceTimeoutStand, or
// handleTurnTimeout. That is exactly the kind of path where a bug hides the
// longest, because it only ever runs 90 seconds after normal play already
// looked fine.
const TURN_TIMEOUT_MS = 90 * 1000;

describe("the 90s turn timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-stands a player who never acts, letting the round move on", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const { player: p2 } = store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);

    const activeId = round.turns.find((t) => t.state === "pending" && t.player.type !== "admin")!.player.id;
    expect([p1.id, p2.id]).toContain(activeId);

    vi.advanceTimersByTime(TURN_TIMEOUT_MS + 1000);

    const updated = store.getRound(round.roundId)!;
    const activeTurn = updated.turns.find((t) => t.player.id === activeId)!;
    // A stood-on-nothing hand (never bet) settles as a genuine $0 push at
    // round-terminate, same as settlement.test.ts's "still settles a genuine
    // $0 push" case -- state "won" with bet 0, not "standby"/"pending".
    expect(["standby", "won"]).toContain(activeTurn.state);
    expect(activeTurn.bet ?? 0).toBe(0);

    // The OTHER seat must still be free to act -- the timeout is supposed to
    // free the table, not just relabel the stuck seat.
    const nextActiveId = updated.turns.find((t) => t.state === "pending" && t.player.type !== "admin")?.player.id;
    if (nextActiveId) {
      expect(() => store.applyStand(updated.roundId, nextActiveId)).not.toThrow();
    }
  });

  it("stays on a mid-timeout player: a normal action before 90s resets the clock rather than firing early", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);
    const activeId = round.turns.find((t) => t.state === "pending" && t.player.type !== "admin")!.player.id;

    vi.advanceTimersByTime(TURN_TIMEOUT_MS - 5000);
    // Still well inside the window -- a real action here must not have been
    // auto-stood already.
    const stillPending = store.getRound(round.roundId)!.turns.find((t) => t.player.id === activeId)!;
    expect(stillPending.state).toBe("pending");

    store.applyStand(round.roundId, activeId);
    const afterStand = store.getRound(round.roundId)!.turns.find((t) => t.player.id === activeId)!;
    expect(afterStand.state).not.toBe("pending");

    // The now-stale first timer must not still be armed and fire late against
    // whichever seat is active next -- if syncTurnTimer didn't clear it on
    // every persistRound, a leftover timer from turn N could force-stand
    // turn N+1 partway through ITS OWN fresh 90s window.
    const nextId = store.getRound(round.roundId)!.turns.find((t) => t.state === "pending" && t.player.type !== "admin")?.player.id;
    if (nextId) {
      vi.advanceTimersByTime(6000); // total elapsed since round start: 91s, but only 6s into this seat's own window
      const stillTheirs = store.getRound(round.roundId)!.turns.find((t) => t.player.id === nextId)!;
      expect(stillTheirs.state).toBe("pending");
    }
  });

  it("resolves a whole round through nothing but timeouts, with no player ever sending an action", () => {
    // The end-to-end case: every seat, including the banker, is silent. Proves
    // the safety net actually gets a stuck table all the way to a finished
    // round rather than just advancing one seat and stopping.
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);

    // Bound the loop -- a real bug here should fail loudly with an assertion
    // below, not hang the test runner.
    for (let i = 0; i < 6; i += 1) {
      const current = store.getRound(round.roundId)!;
      if (current.state === "terminate") break;
      vi.advanceTimersByTime(TURN_TIMEOUT_MS + 1000);
    }

    const final = store.getRound(round.roundId)!;
    expect(final.state).toBe("terminate");
  });

  it("does not resurrect a turn timer for a round that has already ended", () => {
    // Regression shape: a timer scheduled just before the round's very last
    // action must not fire afterwards and mutate a round that finished
    // through a normal (non-timeout) path in the meantime.
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const round = store.startRound(room.roomId, admin.id);
    const p1Turn = round.turns.find((t) => t.player.id === p1.id)!;
    p1Turn.bet = 5;

    // p1 acts almost immediately -- a fresh timer is now armed for the
    // banker's own turn.
    vi.advanceTimersByTime(1000);
    let current = store.applyStand(round.roundId, p1.id);
    expect(current.state).toBe("final");

    const bankerTurn = current.turns.find((t) => t.player.type === "admin")!;
    bankerTurn.cards = [{ name: "20", attributes: { values: [20] } }];
    current = store.applyStand(current.roundId, admin.id);
    expect(current.state).toBe("terminate");

    // The banker's own turn timer (armed at the 1s mark above) would fire
    // around 91s -- advance well past that and confirm nothing throws and
    // the round stays exactly as it finished.
    expect(() => vi.advanceTimersByTime(TURN_TIMEOUT_MS + 5000)).not.toThrow();
    expect(store.getRound(round.roundId)!.state).toBe("terminate");
  });
});
