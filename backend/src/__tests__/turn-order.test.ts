import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

const C = (n: number) => ({ name: String(n), attributes: { values: [n] } });

describe("acting out of turn", () => {
  // The bank limit is computed from the wagers in the seats AHEAD of you, and
  // a seat that has not acted yet carries a bet of 0. So a seat playing out of
  // order is measured against a bank nobody has claimed -- and the turn-state
  // guard could not catch it, because an out-of-turn player's own turn is
  // "pending" exactly like everyone else's.
  it("cannot commit the bank past what it holds by betting before the seats ahead", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 15 });
    store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);

    const [first, second] = round.turns.map((t) => t.player.id);
    expect(round.turns[0].player.type).not.toBe("admin");

    // Seat two jumps the queue. Its own turn is pending, its wallet covers the
    // wager, and the seat ahead has not staked anything yet -- every check the
    // wager itself faces passes.
    expect(() => store.applyBet(round.roundId, second, 10)).toThrow("not_your_turn");

    // Played in order, the bank's own limit does the work it was always
    // supposed to: 15 chips cannot back two 10-chip wagers.
    let r = store.applyBet(round.roundId, first, 10);
    if (r.turns.find((t) => t.player.id === first)!.state === "pending") {
      r = store.applyStand(r.roundId, first);
    }
    expect(() => store.applyBet(r.roundId, second, 10)).toThrow(/bank_limit|bank_empty/);
  });

  it("keeps the banker solvent through a round where a seat tried to jump the queue", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 15 });
    store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    let r = store.startRound(room.roomId, admin.id);
    const [first, second] = r.turns.map((t) => t.player.id);

    try {
      store.applyBet(r.roundId, second, 10);
    } catch {
      /* refused -- that is the point */
    }
    r = store.applyBet(r.roundId, first, 10);

    // Both players beat the banker outright.
    r.turns.filter((t) => t.player.type !== "admin").forEach((t) => (t.cards = [C(20)]));
    r.turns.find((t) => t.player.type === "admin")!.cards = [C(5)];
    r = store.applyStand(r.roundId, first);
    if (r.turns.find((t) => t.player.id === second)!.state === "pending") {
      r = store.applyStand(r.roundId, second);
    }
    if (r.state !== "terminate") r = store.applyStand(r.roundId, admin.id);
    store.finalizeRound(r.roundId);

    const wallets = store.getRoom(room.roomId)!.wallets;
    expect(wallets[admin.id]).toBeGreaterThanOrEqual(0);
    expect(Object.values(wallets).reduce((a, b) => a + b, 0)).toBe(15 + 200);
  });

  it("still lets the banker play their own hand once every seat has acted", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 200 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    let r = store.startRound(room.roomId, admin.id);

    r = store.applyBet(r.roundId, p1.id, 5);
    if (r.turns.find((t) => t.player.id === p1.id)!.state === "pending") {
      r = store.applyStand(r.roundId, p1.id);
    }
    expect(["final", "terminate"]).toContain(r.state);
    if (r.state === "final") {
      expect(() => store.applyStand(r.roundId, admin.id)).not.toThrow();
    }
  });
});

describe("a BANK! wager settled by the last seat at the table", () => {
  // The banker is re-dealt after a BANK! so the seats still to come have a
  // live bank to play against. When there are none, the round is already over
  // -- and the redeal used to land in it anyway, ending the round with the
  // banker apparently mid-hand and their own net for the round wiped.
  it("leaves the banker's finished hand alone instead of dealing into a closed round", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 20 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const round = store.startRound(room.roomId, admin.id);

    round.turns.find((t) => t.player.id === p1.id)!.cards = [C(5)];
    round.turns.find((t) => t.player.type === "admin")!.cards = [C(10)];
    round.deck = [C(6), C(9), C(3), C(4), C(5)];

    let r = store.applyBet(round.roundId, p1.id, 20, { bank: true });
    expect(r.bankLock?.stage).toBe("player");
    r = store.applyStand(r.roundId, p1.id);
    expect(r.bankLock?.stage).toBe("banker");
    r = store.applyHit(r.roundId, admin.id); // banker to 19, beating P1's 11
    r = store.applyStand(r.roundId, admin.id);

    const live = store.getRound(r.roundId)!;
    expect(live.state).toBe("terminate");

    const bankerTurn = live.turns.find((t) => t.player.type === "admin")!;
    expect(bankerTurn.state).not.toBe("pending");
    expect(bankerTurn.cards.map((c) => c.name)).toEqual(["10", "9"]); // no phantom third card
    expect(bankerTurn.settledNet).toBe(20); // the round's net survives to the results screen
    expect(live.turns.every((t) => t.state !== "pending")).toBe(true);

    // The money was always right -- this is about what the table shows.
    const wallets = store.getRoom(room.roomId)!.wallets;
    expect(wallets[admin.id]).toBe(40);
    expect(wallets[p1.id]).toBe(80);
  });

});

describe("a BANK! wager with seats still to come", () => {
  it("re-deals the banker so the remaining seats have a live bank", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 20 });
    store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);
    const [first] = round.turns.map((t) => t.player.id);

    round.turns.forEach((t) => (t.cards = [C(5)]));
    round.turns.find((t) => t.player.type === "admin")!.cards = [C(10)];
    round.deck = [C(6), C(9), C(3), C(4), C(5), C(6), C(7)];

    let r = store.applyBet(round.roundId, first, 20, { bank: true });
    r = store.applyStand(r.roundId, first);
    r = store.applyHit(r.roundId, admin.id); // banker to 19, beats the 11
    r = store.applyStand(r.roundId, admin.id);

    const live = store.getRound(r.roundId)!;
    const bankerTurn = live.turns.find((t) => t.player.type === "admin")!;
    // Seat two never acted, so the banker is dealt back in to face them.
    expect(bankerTurn.state).toBe("pending");
    expect(bankerTurn.cards).toHaveLength(1);
    expect(live.state).not.toBe("terminate");
    expect(live.bankLock).toBeUndefined();
  });
});
