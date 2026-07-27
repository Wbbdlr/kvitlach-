import { GameStore } from "../store.js";

describe("admin room management", () => {
  it("lists active rooms with player/round counts", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker", roomId: "TESTROOM" });
    store.joinRoom(room.roomId, { firstName: "Alice" });

    const listing = store.listRoomsForAdmin();
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({
      roomId: "TESTROOM",
      playerCount: 2,
      completedRounds: 0,
      hasActiveRound: false,
    });
    expect(listing[0].lastActivityAt).toBeLessThanOrEqual(Date.now());
  });

  it("force-deletes a room regardless of who's asking, freeing its custom Game ID", () => {
    const store = new GameStore();
    store.createRoom({ firstName: "Banker", roomId: "CHOLENT-613" });

    expect(() => store.createRoom({ firstName: "Someone Else", roomId: "CHOLENT-613" })).toThrow(
      "That Game ID is already taken."
    );

    const deleted = store.forceDeleteRoom("CHOLENT-613");
    expect(deleted).toBe(true);
    expect(store.listRoomsForAdmin()).toHaveLength(0);

    // The exact scenario this tool exists for: the ID is now free again.
    expect(() => store.createRoom({ firstName: "Someone Else", roomId: "CHOLENT-613" })).not.toThrow();
  });

  it("returns false when asked to delete a room that doesn't exist", () => {
    const store = new GameStore();
    expect(store.forceDeleteRoom("NOPE")).toBe(false);
  });
});
