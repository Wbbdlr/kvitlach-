import { GameStore } from "../store.js";

describe("startRound seat cap and waiting rotation", () => {
  it("seats at most 11 non-banker players per round, queuing the rest as waiting", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker" });
    const players = Array.from({ length: 14 }, (_, i) => store.joinRoom(room.roomId, { firstName: `P${i}` }).player);

    const round = store.startRound(room.roomId, admin.id);
    const seatedIds = round.turns.map((t) => t.player.id);

    // 11 players + the banker = 12 seated turns; the remaining 3 wait.
    expect(round.turns).toHaveLength(12);
    expect(seatedIds).toContain(admin.id);
    const seatedPlayerIds = seatedIds.filter((id) => id !== admin.id);
    expect(seatedPlayerIds).toHaveLength(11);

    const updatedRoom = store.getRoom(room.roomId)!;
    expect(updatedRoom.waitingPlayerIds).toHaveLength(3);
    // The 3 left out are exactly the ones not seated -- no one is dropped.
    const allPlayerIds = players.map((p) => p.id);
    const waitingSet = new Set(updatedRoom.waitingPlayerIds);
    const seatedSet = new Set(seatedPlayerIds);
    for (const id of allPlayerIds) {
      expect(waitingSet.has(id) !== seatedSet.has(id)).toBe(true); // in exactly one of the two
    }
  });

  it("rotates previously-waiting players into a seat on the next round", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker" });
    const players = Array.from({ length: 14 }, (_, i) => store.joinRoom(room.roomId, { firstName: `P${i}` }).player);

    store.startRound(room.roomId, admin.id);
    const firstWait = new Set(store.getRoom(room.roomId)!.waitingPlayerIds);
    expect(firstWait.size).toBe(3);

    store.startRound(room.roomId, admin.id);
    const secondRoom = store.getRoom(room.roomId)!;
    const secondWait = new Set(secondRoom.waitingPlayerIds);
    expect(secondWait.size).toBe(3);

    // The rotation advances by exactly one player per round, so the waiting
    // set for round 2 must differ from round 1 -- nobody is stuck forever.
    expect(secondWait).not.toEqual(firstWait);
  });

  it("seats every player at least once across a full rotation cycle", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker" });
    const players = Array.from({ length: 14 }, (_, i) => store.joinRoom(room.roomId, { firstName: `P${i}` }).player);

    const everSeated = new Set<string>();
    for (let i = 0; i < players.length; i += 1) {
      const round = store.startRound(room.roomId, admin.id);
      round.turns.forEach((t) => everSeated.add(t.player.id));
    }

    for (const p of players) {
      expect(everSeated.has(p.id)).toBe(true);
    }
  });

  it("does not queue anyone when the room has 11 or fewer players", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker" });
    Array.from({ length: 8 }, (_, i) => store.joinRoom(room.roomId, { firstName: `P${i}` }));

    const round = store.startRound(room.roomId, admin.id);
    expect(round.turns).toHaveLength(9); // 8 players + banker
    expect(store.getRoom(room.roomId)!.waitingPlayerIds).toHaveLength(0);
  });
});
