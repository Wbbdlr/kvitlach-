import { describe, expect, it, vi } from "vitest";
import { GameStore } from "../store.js";
import type { Database } from "../db.js";

const TWELVE = { name: "12", attributes: { values: [12, 9, 10] } };
const TEN = { name: "10", attributes: { values: [10] } };
const ROSIER_2 = { name: "2", attributes: { values: [2], type: "rosier" as const } };
const ROSIER_11 = { name: "11", attributes: { values: [11], type: "rosier" as const } };

describe("live per-turn wallet settlement", () => {
  it("settles a bust immediately, before other players have acted", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);

    const p1Turn = round.turns.find((t) => t.player.id === p1.id)!;
    p1Turn.cards = [TWELVE, TWELVE];
    p1Turn.bet = 10;
    round.deck = [TEN, ...round.deck];

    const updated = store.applyHit(round.roundId, p1.id);
    const p1After = updated.turns.find((t) => t.player.id === p1.id)!;

    expect(p1After.state).toBe("lost");
    expect(p1After.settled).toBe(true);
    expect(updated.state).not.toBe("terminate");

    const wallets = store.getRoom(room.roomId)!.wallets;
    expect(wallets[p1.id]).toBe(90);
    expect(wallets[admin.id]).toBe(510);
  });

  it("writes the room to Postgres as it settles, not only when the round ends", async () => {
    // The round and the room are persisted by two different mechanisms:
    // persistRound writes the ROUND on every action, but the room -- which is
    // where wallets actually live -- is only ever written by bumpRoomTimer,
    // and nothing in applyBet/applyHit/applyStand called it. A restart in the
    // gap restored a round whose turns were already marked settled against a
    // room that never got the money, and calculateBalances skips settled
    // turns, so it was never paid at all.
    const saveRoom = vi.fn().mockResolvedValue(undefined);
    const db = {
      saveRoom,
      saveRound: vi.fn().mockResolvedValue(undefined),
      deleteRoom: vi.fn().mockResolvedValue(undefined),
      deleteRound: vi.fn().mockResolvedValue(undefined),
      logConnection: vi.fn().mockResolvedValue(1),
      logDisconnection: vi.fn().mockResolvedValue(undefined),
      getRoomConnectionSummaries: vi.fn().mockResolvedValue([]),
      loadActiveRooms: vi.fn().mockResolvedValue([]),
    } as unknown as Database;

    const store = new GameStore(db);
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    // A second seat keeps the round live past p1's bust, so this exercises the
    // mid-round path rather than falling through to finalizeRound (which does
    // bump, and is why the ordinary end-of-round payout was never affected).
    store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);

    const p1Turn = round.turns.find((t) => t.player.id === p1.id)!;
    p1Turn.cards = [TWELVE, TWELVE];
    p1Turn.bet = 10;
    round.deck = [TEN, ...round.deck];

    saveRoom.mockClear();
    const updated = store.applyHit(round.roundId, p1.id);

    expect(updated.state).not.toBe("terminate");
    expect(store.getRoom(room.roomId)!.wallets[p1.id]).toBe(90);

    // Room writes are chained per room (store.ts's serializeWrite) so an older
    // snapshot can never overwrite a newer one, which means the write starts on
    // the next microtask rather than synchronously.
    await Promise.resolve();
    await Promise.resolve();
    expect(saveRoom).toHaveBeenCalled();
  });

  it("settles a natural-21 (rosier pair) immediately on the completing bet", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const round = store.startRound(room.roomId, admin.id);

    const p1Turn = round.turns.find((t) => t.player.id === p1.id)!;
    p1Turn.cards = [ROSIER_2];
    round.deck = [ROSIER_11, ...round.deck];

    const updated = store.applyBet(round.roundId, p1.id, 10);
    const p1After = updated.turns.find((t) => t.player.id === p1.id)!;

    expect(p1After.state).toBe("won");
    expect(p1After.settled).toBe(true);

    const wallets = store.getRoom(room.roomId)!.wallets;
    expect(wallets[p1.id]).toBe(110);
    expect(wallets[admin.id]).toBe(490);
  });

  it("frees up the bank window as soon as a win is settled, without waiting for round-terminate", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 20 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const { player: p2 } = store.joinRoom(room.roomId, { firstName: "P2" });
    const round = store.startRound(room.roomId, admin.id);

    const p1Turn = round.turns.find((t) => t.player.id === p1.id)!;
    p1Turn.cards = [ROSIER_2];
    round.deck = [ROSIER_11, ...round.deck];

    // p1's win uses up the whole 20-chip bank, then gets paid out immediately.
    const updated = store.applyBet(round.roundId, p1.id, 10);
    expect(updated.turns.find((t) => t.player.id === p1.id)?.settled).toBe(true);
    expect(store.getRoom(room.roomId)!.wallets[admin.id]).toBe(10);

    // Without the `settled` exclusion in computeBankWindow, this bet would incorrectly
    // throw bank_empty/bank_limit:0 because p1's already-paid bet would still count as outstanding.
    expect(() => store.applyBet(updated.roundId, p2.id, 10)).not.toThrow();
  });

  it("only settles a live turn once, even after finalizeRound runs at round-terminate", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const { player: p2 } = store.joinRoom(room.roomId, { firstName: "P2" });
    const round1 = store.startRound(room.roomId, admin.id);

    const p1Turn = round1.turns.find((t) => t.player.id === p1.id)!;
    p1Turn.cards = [TWELVE, TWELVE];
    p1Turn.bet = 10;
    round1.deck = [TEN, ...round1.deck];

    const round2 = store.applyHit(round1.roundId, p1.id);
    expect(round2.turns.find((t) => t.player.id === p1.id)?.settled).toBe(true);
    expect(store.getRoom(room.roomId)!.wallets[p1.id]).toBe(90);
    expect(store.getRoom(room.roomId)!.wallets[admin.id]).toBe(510);

    const p2Turn = round2.turns.find((t) => t.player.id === p2.id)!;
    p2Turn.cards = [{ name: "15", attributes: { values: [15] } }];
    p2Turn.bet = 20;
    const round3 = store.applyStand(round2.roundId, p2.id);

    const adminTurn = round3.turns.find((t) => t.player.type === "admin")!;
    adminTurn.cards = [{ name: "20", attributes: { values: [20] } }];
    const round4 = store.applyStand(round3.roundId, admin.id);
    expect(round4.state).toBe("terminate");

    const { balances } = store.finalizeRound(round4.roundId);

    // Exactly one settlement for p2 (who lost 20 to the banker) — no spurious
    // second row for p1, whose bust was already paid out live.
    expect(balances).toHaveLength(1);
    expect(balances[0]).toEqual({ amount: 20, payer: p2.id, payee: admin.id });

    const finalWallets = store.getRoom(room.roomId)!.wallets;
    expect(finalWallets[p1.id]).toBe(90);
    expect(finalWallets[p2.id]).toBe(80);
    expect(finalWallets[admin.id]).toBe(530);
  });

  it("still settles a genuine $0 push via handleStand normally at round-terminate", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const round = store.startRound(room.roomId, admin.id);

    const p1Turn = round.turns.find((t) => t.player.id === p1.id)!;
    p1Turn.cards = [
      { name: "5", attributes: { values: [5] } },
      { name: "7", attributes: { values: [7] } },
    ];

    const afterStand = store.applyStand(round.roundId, p1.id);
    const p1After = afterStand.turns.find((t) => t.player.id === p1.id)!;
    expect(p1After.state).toBe("won");
    expect(p1After.bet).toBe(0);
    expect(p1After.settled).toBeFalsy();
    expect(afterStand.state).toBe("terminate");

    const { balances } = store.finalizeRound(afterStand.roundId);
    expect(balances).toHaveLength(1);
    expect(balances[0]).toEqual({ amount: 0, payer: admin.id, payee: p1.id });
  });

  it("never live-settles the admin's own immediate resolution", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const round = store.startRound(room.roomId, admin.id);

    // The banker plays last, and the server holds them to that -- so the seat
    // ahead has to finish before the banker's own hand is reachable. A real
    // wager, so the seat goes to standby and leaves the round waiting on the
    // bank rather than ending outright.
    const p1Turn = round.turns.find((t) => t.player.id === p1.id)!;
    p1Turn.bet = 5;
    const afterPlayer = store.applyStand(round.roundId, p1.id);
    expect(afterPlayer.state).toBe("final");

    const adminTurn = afterPlayer.turns.find((t) => t.player.type === "admin")!;
    adminTurn.cards = [TWELVE, TWELVE];
    afterPlayer.deck = [TEN, ...afterPlayer.deck];

    const walletsBefore = { ...store.getRoom(room.roomId)!.wallets };
    const updated = store.applyHit(round.roundId, admin.id);
    const adminAfter = updated.turns.find((t) => t.player.type === "admin")!;

    expect(adminAfter.state).toBe("lost");
    expect(adminAfter.settled).toBeFalsy();
    expect(store.getRoom(room.roomId)!.wallets).toEqual(walletsBefore);
  });
});
