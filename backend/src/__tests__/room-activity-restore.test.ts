import { describe, expect, it, vi } from "vitest";
import { GameStore } from "../store.js";
import type { RoomState } from "../types.js";

// The admin table's Idle column read "just now" for every room on the board,
// however long ago anyone had really played. Reported from a live panel
// showing three rooms nobody had touched in days, all "just now".
//
// Three faults, stacked:
//   1. loadFromDB re-armed each restored room's reaper through bumpRoomTimer,
//      which stamps lastActivityAt = Date.now().
//   2. bumpRoomTimer also SAVES, so that fresh stamp was written back over
//      rooms.last_active_at -- the real value was not merely ignored on
//      restore, it was destroyed by it.
//   3. loadActiveRooms never selected last_active_at at all, so even without
//      (1) and (2) there was nothing to restore it from. The column had been
//      maintained since it was created and read by nobody.
//
// The reaper is the part that actually bites: a room abandoned days ago took a
// fresh 3-day lease on every restart, so on a box that deploys often, nothing
// ever expired.
function stubDb(rows: Array<{ roomId: string; roomState: RoomState; lastActiveAt: number }>) {
  return {
    loadActiveRooms: vi.fn(async () => rows.map((r) => ({ ...r, rounds: [] }))),
    saveRoom: vi.fn(async () => {}),
    saveRound: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    deleteRound: vi.fn(async () => {}),
  };
}

function roomState(roomId: string): RoomState {
  return {
    roomId,
    players: [{ id: "b1", firstName: "Banker", lastName: "", type: "admin", presence: "online" }],
    wallets: { b1: 500 },
    buyIn: 100,
    bankerBuyIn: 500,
    balances: [],
    completedRounds: 4,
    renameRequests: [],
    buyInRequests: [],
    waitingPlayerIds: [],
    renameBlockedIds: [],
    buyInBlockedIds: [],
  } as unknown as RoomState;
}

describe("a room's last-activity time across a restart", () => {
  it("comes back from the database instead of being restamped as now", async () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const db = stubDb([{ roomId: "OLDROOM", roomState: roomState("OLDROOM"), lastActiveAt: twoDaysAgo }]);
    const store = new GameStore(db as never);

    await store.loadFromDB();

    const [listed] = store.listRoomsForAdmin();
    expect(listed.roomId).toBe("OLDROOM");
    // Within a second of the stored value, not within a second of now.
    expect(Math.abs(listed.lastActivityAt - twoDaysAgo)).toBeLessThan(1000);
  });

  it("does not write the restored rooms straight back out, which would erase it", async () => {
    const db = stubDb([
      { roomId: "OLDROOM", roomState: roomState("OLDROOM"), lastActiveAt: Date.now() - 60 * 60 * 1000 },
    ]);
    const store = new GameStore(db as never);

    await store.loadFromDB();

    // saveRoom on restore is what overwrote rooms.last_active_at with now.
    expect(db.saveRoom).not.toHaveBeenCalled();
  });

  it("reaps a room whose idle window already elapsed while the process was down", async () => {
    vi.useFakeTimers();
    try {
      // Four days idle against a three-day window.
      const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
      const db = stubDb([{ roomId: "STALE", roomState: roomState("STALE"), lastActiveAt: fourDaysAgo }]);
      const store = new GameStore(db as never);

      await store.loadFromDB();
      expect(store.listRoomsForAdmin()).toHaveLength(1);

      // Previously this room got a full fresh 3 days on every boot and would
      // still be sitting here. It should go on the next tick instead.
      vi.advanceTimersByTime(10);
      expect(store.listRoomsForAdmin()).toHaveLength(0);
      expect(db.deleteRoom).toHaveBeenCalledWith("STALE");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a recently-active room, counting the window from its own activity", async () => {
    vi.useFakeTimers();
    try {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const db = stubDb([{ roomId: "LIVE", roomState: roomState("LIVE"), lastActiveAt: oneDayAgo }]);
      const store = new GameStore(db as never);

      await store.loadFromDB();

      // A day and a half further on: still inside the 3-day window measured
      // from the room's own activity, so it stays.
      vi.advanceTimersByTime(36 * 60 * 60 * 1000);
      expect(store.listRoomsForAdmin()).toHaveLength(1);

      // Past three days from the ORIGINAL activity, not from the restart.
      vi.advanceTimersByTime(36 * 60 * 60 * 1000);
      expect(store.listRoomsForAdmin()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
