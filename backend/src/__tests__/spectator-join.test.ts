import { GameStore } from "../store.js";

describe("spectators joining mid-round", () => {
  it("never queues a mid-round spectator in waitingPlayerIds", () => {
    const store = new GameStore();
    const { room, player: banker } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Player" });
    store.startRound(room.roomId, banker.id);

    const { player: spectator } = store.joinRoom(room.roomId, { firstName: "Watcher", spectator: true });

    const updatedRoom = store.getRoom(room.roomId)!;
    expect(updatedRoom.waitingPlayerIds).not.toContain(spectator.id);
    expect(updatedRoom.players.find((p) => p.id === spectator.id)?.type).toBe("spectator");
  });

  it("still queues a real player who joins mid-round", () => {
    const store = new GameStore();
    const { room, player: banker } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Player" });
    store.startRound(room.roomId, banker.id);

    const { player: lateJoiner } = store.joinRoom(room.roomId, { firstName: "Latecomer" });

    const updatedRoom = store.getRoom(room.roomId)!;
    expect(updatedRoom.waitingPlayerIds).toContain(lateJoiner.id);
  });
});
