import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

// The product had no undo of any kind. The only correction mechanism was the
// raw wallet adjust, so a banker who fat-fingered one fixed it with ANOTHER
// adjust: two wrong entries in the record instead of one, and no way to say
// which was the mistake. For an unpaid volunteer running a table for
// relatives, every slip was permanent.
function table() {
  const store = new GameStore();
  const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 400 });
  const sara = store.joinRoom(room.roomId, { firstName: "Sara" });
  return { store, roomId: room.roomId, adminId: admin.id, saraId: sara.player.id };
}

describe("undoing the banker's last chip correction", () => {
  it("puts the wallet back exactly where it was", () => {
    const { store, roomId, adminId, saraId } = table();
    store.adjustPlayerWallet(roomId, adminId, saraId, 50, "oops");
    expect(store.getRoom(roomId)!.wallets[saraId]).toBe(150);

    store.undoLastCorrection(roomId, adminId);
    expect(store.getRoom(roomId)!.wallets[saraId]).toBe(100);
  });

  // The record of a mistake AND its correction is what lets a table settle up
  // without arguing about whether an entry ever existed.
  it("marks the original rather than deleting it, and records the undo", () => {
    const { store, roomId, adminId, saraId } = table();
    store.adjustPlayerWallet(roomId, adminId, saraId, 50);
    store.undoLastCorrection(roomId, adminId);

    const ledger = store.getRoom(roomId)!.ledger ?? [];
    const original = ledger.find((e) => e.kind === "adjust")!;
    expect(original).toBeTruthy();
    expect(original.undoneAt).toBeTruthy();
    expect(original.undoneBy).toBe(adminId);
    expect(ledger.some((e) => e.kind === "undo")).toBe(true);
  });

  it("only ever takes back one, and never the same one twice", () => {
    const { store, roomId, adminId, saraId } = table();
    store.adjustPlayerWallet(roomId, adminId, saraId, 50);
    store.adjustPlayerWallet(roomId, adminId, saraId, 25);
    expect(store.getRoom(roomId)!.wallets[saraId]).toBe(175);

    store.undoLastCorrection(roomId, adminId);
    expect(store.getRoom(roomId)!.wallets[saraId]).toBe(150);
    store.undoLastCorrection(roomId, adminId);
    expect(store.getRoom(roomId)!.wallets[saraId]).toBe(100);
    expect(() => store.undoLastCorrection(roomId, adminId)).toThrow("nothing_to_undo");
  });

  it("reverses a bank top-up against the bank's own wallet", () => {
    const { store, roomId, adminId } = table();
    const before = store.getRoom(roomId)!.wallets[adminId];
    store.topUpBanker(roomId, adminId, 200);
    expect(store.getRoom(roomId)!.wallets[adminId]).toBe(before + 200);
    store.undoLastCorrection(roomId, adminId);
    expect(store.getRoom(roomId)!.wallets[adminId]).toBe(before);
  });

  // A kick destroys the seat AND the stack on it. Undo has to bring both
  // back, and bring them back OFFLINE -- this restores the seat, not the
  // person, whose session died with the kick. Offline is also what makes it
  // claimable, so the ordinary "that is my seat" route carries them in.
  it("brings a kicked seat back with its chips, offline and claimable", () => {
    const { store, roomId, adminId, saraId } = table();
    store.getRoom(roomId)!.wallets[saraId] = 75;
    store.kickPlayer(roomId, adminId, saraId);
    expect(store.getRoom(roomId)!.players.find((p) => p.id === saraId)).toBeUndefined();

    store.undoLastCorrection(roomId, adminId);
    const room = store.getRoom(roomId)!;
    const back = room.players.find((p) => p.id === saraId)!;
    expect(back).toBeTruthy();
    expect(back.presence).toBe("offline");
    expect(room.wallets[saraId]).toBe(75);
    expect(store.findClaimableSeat(roomId, "Sara")?.id).toBe(saraId);
  });

  // A player choosing to leave is not the banker's to reverse, and they have
  // a route of their own now (requestSeatClaim).
  it("will not undo a player's own decision to leave", () => {
    const { store, roomId, adminId, saraId } = table();
    store.leaveRoom(roomId, saraId);
    expect(() => store.undoLastCorrection(roomId, adminId)).toThrow("nothing_to_undo");
  });

  // Server authority: this moves chips, so it is the banker's alone.
  it("refuses anyone who is not the banker", () => {
    const { store, roomId, adminId, saraId } = table();
    store.adjustPlayerWallet(roomId, adminId, saraId, 50);
    expect(() => store.undoLastCorrection(roomId, saraId)).toThrow("forbidden");
    expect(store.getRoom(roomId)!.wallets[saraId]).toBe(150);
  });

  it("says so plainly when there is nothing to undo", () => {
    const { store, roomId, adminId } = table();
    expect(() => store.undoLastCorrection(roomId, adminId)).toThrow("nothing_to_undo");
  });

  // The chips may have been played since. A wallet that goes negative is a
  // worse state than a correction that could not fully unwind.
  it("never drives a wallet below zero", () => {
    const { store, roomId, adminId, saraId } = table();
    store.adjustPlayerWallet(roomId, adminId, saraId, 50);
    store.getRoom(roomId)!.wallets[saraId] = 10;
    store.undoLastCorrection(roomId, adminId);
    expect(store.getRoom(roomId)!.wallets[saraId]).toBe(0);
  });
});
