import { GameStore } from "../store.js";

describe("GameStore banker approvals", () => {
  it("stores buy-in requests and applies funds when approved", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker" });
    const { player } = store.joinRoom(room.roomId, { firstName: "Player" });

    store.requestBuyIn(room.roomId, player.id, 50, "Need more chips");
    let updatedRoom = store.getRoom(room.roomId);
    expect(updatedRoom?.buyInRequests).toHaveLength(1);

    store.approveBuyIn(room.roomId, admin.id, player.id);
    updatedRoom = store.getRoom(room.roomId);
    expect(updatedRoom?.buyInRequests).toHaveLength(0);
    expect(updatedRoom?.wallets[player.id]).toBe((room.buyIn ?? 100) + 50);
  });

  it("allows banker to reject buy-in requests", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker" });
    const { player } = store.joinRoom(room.roomId, { firstName: "Player" });

    store.requestBuyIn(room.roomId, player.id, 25);
    store.rejectBuyIn(room.roomId, admin.id, player.id);

    const updatedRoom = store.getRoom(room.roomId);
    expect(updatedRoom?.buyInRequests).toHaveLength(0);
    expect(updatedRoom?.wallets[player.id]).toBe(room.buyIn);
  });

  it("supports multiple pending buy-in requests from different players", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker" });
    const { player: first } = store.joinRoom(room.roomId, { firstName: "Player One" });
    const { player: second } = store.joinRoom(room.roomId, { firstName: "Player Two" });

    store.requestBuyIn(room.roomId, first.id, 40);
    store.requestBuyIn(room.roomId, second.id, 60);

    const updatedRoom = store.getRoom(room.roomId);
    expect(updatedRoom?.buyInRequests).toHaveLength(2);
    const amounts = updatedRoom?.buyInRequests.map((req) => req.amount).sort();
    expect(amounts).toEqual([40, 60]);
  });

  it("reissues a session token when a player resumes", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker" });
    const { player, sessionToken } = store.joinRoom(room.roomId, { firstName: "Player" });

    store.setPresence(room.roomId, player.id, "offline");
    const { sessionToken: resumedToken } = store.resumePlayer(room.roomId, player.id, sessionToken);

    expect(resumedToken).not.toBe(sessionToken);
    const resumedPlayer = store.getRoom(room.roomId)?.players.find((p) => p.id === player.id);
    expect(resumedPlayer?.presence).toBe("online");
  });

  it("rejects resume attempts with an invalid token", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker" });
    const { player } = store.joinRoom(room.roomId, { firstName: "Player" });

    expect(() => store.resumePlayer(room.roomId, player.id, "not-valid")).toThrow("invalid_session");
  });
});
