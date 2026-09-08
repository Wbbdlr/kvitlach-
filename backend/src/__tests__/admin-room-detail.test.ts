import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

// getRoomForAdmin is the read behind the panel's room detail page. It is
// read-only over data gameplay already maintains, so what these prove is that
// it reports what the room actually holds -- and, in the passwordHash case,
// that it does not report what it must not.

describe("room detail for the admin panel", () => {
  it("reports seats, chips and presence as the room holds them", () => {
    const store = new GameStore();
    const { room, player: banker } = store.createRoom({ firstName: "Reb", lastName: "Boruch", roomId: "DETAIL1", buyIn: 100 });
    const { player: alice } = store.joinRoom(room.roomId, { firstName: "Alice" });
    store.setPresence(room.roomId, alice.id, "offline");

    const detail = store.getRoomForAdmin("DETAIL1")!;
    expect(detail.playerCount).toBe(2);
    expect(detail.seats).toHaveLength(2);

    const bankerSeat = detail.seats.find((s) => s.id === banker.id)!;
    expect(bankerSeat.role).toBe("admin");
    expect(bankerSeat.presence).toBe("online");

    const aliceSeat = detail.seats.find((s) => s.id === alice.id)!;
    expect(aliceSeat.name).toBe("Alice");
    expect(aliceSeat.presence).toBe("offline");
    expect(aliceSeat.wallet).toBe(100);
  });

  it("never carries the room password hash", () => {
    const store = new GameStore();
    store.createRoom({ firstName: "Banker", roomId: "SECRET1", password: "hunter2" });

    const detail = store.getRoomForAdmin("SECRET1")!;
    expect(detail.hasPassword).toBe(true);
    // The whole reason this is a DTO rather than the live RoomState: there is
    // no field here to leak, so a template cannot print one by accident.
    expect(JSON.stringify(detail)).not.toContain("passwordHash");
    expect(JSON.stringify(detail)).not.toContain("hunter2");
  });

  it("shows the chip ledger newest first without reversing the room's own copy", () => {
    const store = new GameStore();
    const { room, player: banker } = store.createRoom({ firstName: "Banker", roomId: "LEDGER1" });
    const { player: alice } = store.joinRoom(room.roomId, { firstName: "Alice" });
    store.adjustPlayerWallet(room.roomId, banker.id, alice.id, 50, "first");
    store.adjustPlayerWallet(room.roomId, banker.id, alice.id, 25, "second");

    const detail = store.getRoomForAdmin("LEDGER1")!;
    expect(detail.ledger.map((e) => e.note)).toEqual(["second", "first"]);
    // The banker's own drawer reads this list in append order; reversing a
    // copy is the point, reversing the room's would change what players see.
    const roomLedger = store.getRoom("LEDGER1")!.ledger!;
    expect(roomLedger.map((e) => e.note)).toEqual(["first", "second"]);
  });

  it("surfaces a wallet left behind with no seat", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker", roomId: "ORPHAN1" });
    expect(store.getRoomForAdmin("ORPHAN1")!.orphanWallets).toEqual([]);

    // Reaching into the room the way an accounting bug would: a wallet key
    // with nobody behind it. The panel is the only place this becomes
    // visible, which is the reason the field exists.
    store.getRoom(room.roomId)!.wallets["ghost-player"] = 400;
    expect(store.getRoomForAdmin("ORPHAN1")!.orphanWallets).toEqual([{ playerId: "ghost-player", amount: 400 }]);
  });

  it("returns undefined for a room that is gone", () => {
    const store = new GameStore();
    expect(store.getRoomForAdmin("NEVEREXISTED")).toBeUndefined();
  });
});
