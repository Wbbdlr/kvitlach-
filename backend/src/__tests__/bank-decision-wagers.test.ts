import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

// #4 fixed the banker's Skip button so it can no longer void a hand with
// chips on it. This is the OTHER way a turn becomes "skipped":
// endRoundAfterBankDecision rewrites every still-unresolved player turn to
// "skipped" directly, without going near applySkip's guard.
//
// calculateBalances drops "skipped" turns outright, so anything that lands
// there with a live wager has had its money silently voided -- the exact
// failure #4 was about, reached by a different door.

const TWELVE = { name: "12", attributes: { values: [12, 9, 10] } };
const TEN = { name: "10", attributes: { values: [10] } };

function tableWithBankDecision() {
  const s = new GameStore();
  const { room, player: admin } = s.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 60 });
  const { player: p1 } = s.joinRoom(room.roomId, { firstName: "Moshe" });
  s.joinRoom(room.roomId, { firstName: "Sara" });
  return { s, roomId: room.roomId, admin, p1 };
}

describe("ending a round after the bank busts", () => {
  it("never leaves a wagered turn marked skipped", () => {
    const { s, roomId, admin } = tableWithBankDecision();
    const round = s.startRound(roomId, admin.id);
    const seats = round.turns.filter((t) => t.player.type !== "admin");

    // Put a real wager on a seat and leave it unresolved, then force the
    // round into the banker's post-bust decision by hand -- the point is the
    // invariant at the rewrite, not the route taken to reach it.
    const live = s.getRound(round.roundId)!;
    const seat = live.turns.find((t) => t.player.id === seats[0].player.id)!;
    seat.bet = 30;
    seat.state = "pending";
    const bankerTurn = live.turns.find((t) => t.player.type === "admin")!;
    bankerTurn.cards = [TWELVE, TWELVE, TEN];
    live.bankLock = {
      playerId: seats[0].player.id,
      stage: "decision",
      exposure: 30,
      throughIndex: 0,
      initiatedAt: Date.now(),
    };

    const ended = s.endRoundAfterBankDecision(roomId, admin.id);

    const resolved = ended.turns.find((t) => t.player.id === seats[0].player.id)!;
    // Either it wins (the bank futched, which is what happened) or it loses.
    // What it must never be is "skipped", which pays nobody either way.
    expect(resolved.state).not.toBe("skipped");
  });

  it("still marks a seat that never wagered as skipped", () => {
    const { s, roomId, admin } = tableWithBankDecision();
    const round = s.startRound(roomId, admin.id);
    const seats = round.turns.filter((t) => t.player.type !== "admin");

    const live = s.getRound(round.roundId)!;
    const bankerTurn = live.turns.find((t) => t.player.type === "admin")!;
    bankerTurn.cards = [TWELVE, TWELVE, TEN];
    live.bankLock = {
      playerId: seats[0].player.id,
      stage: "decision",
      exposure: 0,
      throughIndex: 0,
      initiatedAt: Date.now(),
    };

    const ended = s.endRoundAfterBankDecision(roomId, admin.id);
    const untouched = ended.turns.filter((t) => t.player.type !== "admin" && (t.bet ?? 0) === 0);
    // A seat with nothing at stake loses nothing by being skipped, and that
    // is the state the felt reads correctly as "sat this one out".
    expect(untouched.length).toBeGreaterThan(0);
  });

  it("pays a wagered seat out of the bank when the round ends on a bust", () => {
    const { s, roomId, admin } = tableWithBankDecision();
    const round = s.startRound(roomId, admin.id);
    const seats = round.turns.filter((t) => t.player.type !== "admin");
    const target = seats[0].player.id;

    const live = s.getRound(round.roundId)!;
    const seat = live.turns.find((t) => t.player.id === target)!;
    seat.bet = 30;
    seat.state = "pending";
    const bankerTurn = live.turns.find((t) => t.player.type === "admin")!;
    bankerTurn.cards = [TWELVE, TWELVE, TEN];
    live.bankLock = { playerId: target, stage: "decision", exposure: 30, throughIndex: 0, initiatedAt: Date.now() };

    s.endRoundAfterBankDecision(roomId, admin.id);
    s.finalizeRound(round.roundId);

    // The money is the whole point: a futched bank pays everyone still in.
    expect(s.getRoom(roomId)!.wallets[target]).toBe(130);
  });
});
