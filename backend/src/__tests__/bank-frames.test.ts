import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

const C = (n: number) => ({ name: String(n), attributes: { values: [n] } });

// Regression for two confirmed bugs found in a 2026-08-10 bug-hunting pass
// (see TASKS.md), both in the BANK! "two frames" redeal (store.ts's
// settleBankOutcome): a wager that covers the banker's whole remaining
// wallet forces them to keep dealing so the seats still to come have a live
// bank to play against, which means MORE than one banker hand can resolve
// within a single round.
//
// Frame 1: P1 stands on 15, P2 goes BANK! for the rest of the banker's
// wallet and stands on 12. The banker draws to 18 (beats both -- no bust,
// no natural 21), so the bank wallet grows and P3 is still pending -- a
// forced redeal. Frame 2: P3 goes BANK! against the now-larger wallet and
// the banker busts, so P3 wins outright.
describe("BANK! two-frames redeal", () => {
  function setUpFrame1() {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 300, bankerBankroll: 100 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const { player: p2 } = store.joinRoom(room.roomId, { firstName: "P2" });
    const { player: p3 } = store.joinRoom(room.roomId, { firstName: "P3" });
    let r = store.startRound(room.roomId, admin.id);

    const p1Index = r.turns.findIndex((t) => t.player.id === p1.id);
    r.turns[p1Index].cards = [C(9)];
    r.deck = [C(6), ...r.deck]; // P1's bet draw -> [9,6] = 15
    r = store.applyBet(r.roundId, p1.id, 10);
    r = store.applyStand(r.roundId, p1.id); // standby, bet 10, nothing settled yet

    const p2Index = r.turns.findIndex((t) => t.player.id === p2.id);
    r.turns[p2Index].cards = [C(8)];
    r.deck = [C(4), ...r.deck]; // P2's bet draw -> [8,4] = 12
    // Available = banker's $100 wallet minus P1's still-live $10 bet = $90.
    r = store.applyBet(r.roundId, p2.id, 90);
    r = store.applyStand(r.roundId, p2.id); // standby -> bank lock advances to "banker"
    expect(r.bankLock?.stage).toBe("banker");

    const bankerIndex = r.turns.findIndex((t) => t.player.type === "admin");
    r.turns[bankerIndex].cards = [C(9), C(9)]; // 18 -- beats both P1 (15) and P2 (12)
    r.deck = [C(2), ...r.deck]; // frame 2's redealt single card, drawn inside this same call
    r = store.applyStand(r.roundId, admin.id); // locks in 18, triggers settleBankOutcome

    return { store, room, admin, p1, p2, p3, roundAfterFrame1: r };
  }

  it("stashes frame 1's discarded hand/score on lastBankFrame instead of losing it to the redeal", () => {
    const { roundAfterFrame1: r, admin } = setUpFrame1();

    // The redeal itself: banker's live turn is already the fresh one-card
    // frame-2 hand, exactly the "everything but the wallet number is
    // invisible" bug this field exists to fix.
    const bankerTurn = r.turns.find((t) => t.player.id === admin.id)!;
    expect(bankerTurn.cards).toEqual([C(2)]);
    expect(bankerTurn.state).toBe("pending");
    expect(r.bankLock).toBeUndefined();

    expect(r.lastBankFrame).toBeDefined();
    expect(r.lastBankFrame!.bankerId).toBe(admin.id);
    expect(r.lastBankFrame!.cards).toEqual([C(9), C(9)]); // the actual frame-1 hand, 18
    expect(r.lastBankFrame!.state).toBe("standby"); // 18 is neither a bust nor a natural 21
    expect(r.lastBankFrame!.busted).toBe(false);
    expect(r.lastBankFrame!.beat).toBe(2); // beat both P1 and P2
    expect(r.lastBankFrame!.lostTo).toBe(0);
    expect(r.lastBankFrame!.settledAt).toBeGreaterThan(0);
  });

  it("never sets lastBankFrame for an ordinary BANK! that terminates the round (nothing to redeal)", () => {
    // A single-seat BANK! with no one left pending afterward -- the banker's
    // outcome reaches the client through the turn's own state/cards as
    // normal, no redeal, so this transient field has no reason to exist yet.
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 100 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    let r = store.startRound(room.roomId, admin.id);

    const p1Index = r.turns.findIndex((t) => t.player.id === p1.id);
    r.turns[p1Index].cards = [C(9)];
    r.deck = [C(6), ...r.deck]; // -> [9,6] = 15
    r = store.applyBet(r.roundId, p1.id, 100); // BANK! for the whole $100 wallet, only seat at the table
    r = store.applyStand(r.roundId, p1.id);
    expect(r.bankLock?.stage).toBe("banker");

    const bankerIndex = r.turns.findIndex((t) => t.player.type === "admin");
    r.turns[bankerIndex].cards = [C(10), C(9)]; // 19, pending
    r.deck = [C(5), ...r.deck]; // busts: 10+9+5 = 24
    r = store.applyHit(r.roundId, admin.id); // last seat -> no redeal, round ends here

    expect(r.state).toBe("terminate");
    expect(r.lastBankFrame).toBeUndefined();
  });

  it("does not double-count frame 1's already-settled seats into frame 2's beat/lostTo tally", () => {
    const { store, admin, p3, roundAfterFrame1 } = setUpFrame1();
    let r = roundAfterFrame1;

    const p3Index = r.turns.findIndex((t) => t.player.id === p3.id);
    r.turns[p3Index].cards = [C(7)];
    r.deck = [C(2), ...r.deck]; // P3's bet draw -> [7,2] = 9
    r = store.applyBet(r.roundId, p3.id, 200); // BANK! against the post-frame-1 $200 wallet
    r = store.applyStand(r.roundId, p3.id);
    expect(r.bankLock?.stage).toBe("banker");

    const bankerIndex = r.turns.findIndex((t) => t.player.type === "admin");
    r.turns[bankerIndex].cards = [C(10), C(9)]; // 19, pending
    r.deck = [C(5), ...r.deck]; // busts the banker: 10+9+5 = 24
    r = store.applyHit(r.roundId, admin.id); // banker busts -> settleBankOutcome runs immediately

    expect(r.state).toBe("terminate");
    const bankerTurn = r.turns.find((t) => t.player.id === admin.id)!;
    expect(bankerTurn.busted).toBe(true);
    // The only real result of frame 2: P3 beat a busted banker. Without the
    // fix this reported beat: 2 (P1 and P2, re-counted from frame 1).
    expect(bankerTurn.beat).toBe(0);
    expect(bankerTurn.lostTo).toBe(1);

    // Frame 1's own payouts must survive untouched -- the bug this guards
    // against would have zeroed their settledBet on this second pass too.
    const p1Turn = r.turns.find((t) => t.player.firstName === "P1")!;
    const p2Turn = r.turns.find((t) => t.player.firstName === "P2")!;
    expect(p1Turn.state).toBe("lost");
    expect(p1Turn.settledBet).toBe(10);
    expect(p2Turn.state).toBe("lost");
    expect(p2Turn.settledBet).toBe(90);
  });
});
