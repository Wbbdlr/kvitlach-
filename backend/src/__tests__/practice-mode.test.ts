import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GameStore } from "../store";
import type { Database } from "../db";

function makeDbSpy() {
  return {
    saveRoom: vi.fn().mockResolvedValue(undefined),
    saveRound: vi.fn().mockResolvedValue(undefined),
    deleteRoom: vi.fn().mockResolvedValue(undefined),
    deleteRound: vi.fn().mockResolvedValue(undefined),
    logConnection: vi.fn().mockResolvedValue(1),
    logDisconnection: vi.fn().mockResolvedValue(undefined),
    getRoomConnectionSummaries: vi.fn().mockResolvedValue([]),
    loadActiveRooms: vi.fn().mockResolvedValue([]),
  } as unknown as Database;
}

describe("createPracticeRoom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("seats a bot banker plus two bot players alongside the human", () => {
    const store = new GameStore();
    const { room, player } = store.createPracticeRoom({ firstName: "Alice" });

    expect(room.practice).toBe(true);
    expect(room.players).toHaveLength(4);
    expect(player.type).toBe("player");
    expect(player.isBot).toBeUndefined();

    const banker = room.players.find((p) => p.type === "admin")!;
    expect(banker.isBot).toBe(true);

    const bots = room.players.filter((p) => p.type === "player" && p.isBot);
    expect(bots).toHaveLength(2);
    // The two bot players must be distinct personas, not the same name twice.
    expect(new Set(bots.map((b) => b.id)).size).toBe(2);

    // A round is already underway -- no human banker exists to click Start.
    expect(room.roundId).toBeDefined();
  });

  it("never touches Postgres for a practice room, even when a database is configured", () => {
    const db = makeDbSpy();
    const store = new GameStore(db);
    store.createPracticeRoom({ firstName: "Alice" });

    expect(db.saveRoom).not.toHaveBeenCalled();
    expect(db.saveRound).not.toHaveBeenCalled();
  });

  it("still persists a normal room to Postgres when a database is configured (contrast check)", () => {
    const db = makeDbSpy();
    const store = new GameStore(db);
    store.createRoom({ firstName: "Banker" });

    expect(db.saveRoom).toHaveBeenCalled();
  });

  it("plays a full round to completion with zero manual actions on the bot seats", () => {
    const store = new GameStore();
    const { room, player } = store.createPracticeRoom({ firstName: "Alice" });
    const roundId = room.roundId!;

    // The human is the only seat this test drives directly -- a $0 stand
    // (blatt push) is the simplest legitimate action to resolve their turn.
    store.applyStand(roundId, player.id);

    // Let every scheduled bot timer (banker + 2 players, cascading turn by
    // turn, possibly through a bank-lock "decision" stage) fire to completion.
    let round = store.getRound(roundId);
    let guard = 0;
    while (round && round.state !== "terminate" && guard < 50) {
      vi.advanceTimersByTime(1500);
      round = store.getRound(roundId);
      guard += 1;
    }

    expect(guard).toBeLessThan(50); // didn't hit the safety cap -- the round actually terminated
    const finalRoom = store.getRoom(room.roomId)!;
    // Practice rounds still settle real (practice) wallets -- conservation holds.
    const totalWallet = Object.values(finalRoom.wallets).reduce((a, b) => a + b, 0);
    const totalBuyIn = finalRoom.players.length * 100 + finalRoom.bankerBuyIn - 100; // banker's buy-in is 4x, see createPracticeRoom
    expect(totalWallet).toBe(totalBuyIn);
  });

  it("produces no round history entry for a practice room", () => {
    const store = new GameStore();
    const { room, player } = store.createPracticeRoom({ firstName: "Alice" });
    const roundId = room.roundId!;
    store.applyStand(roundId, player.id);

    let round = store.getRound(roundId);
    let guard = 0;
    while (round && round.state !== "terminate" && guard < 50) {
      vi.advanceTimersByTime(1500);
      round = store.getRound(roundId);
      guard += 1;
    }

    const finalRoom = store.getRoom(room.roomId)!;
    expect(finalRoom.roundHistory ?? []).toHaveLength(0);
  });

  it("plays 20 consecutive rounds unattended without ever stalling, including as the bank runs low", () => {
    // Repeated small bot bets trend the bank toward empty over many rounds --
    // this exercises decideBotBet's wallet<=0/available<=0 -> blatt fallback
    // for real, not just as an isolated unit case, and confirms the bank-lock
    // avoidance margin (never betting the exact full window) holds up across
    // many randomized bet sizes rather than just one lucky run.
    const store = new GameStore();
    const { room, player } = store.createPracticeRoom({ firstName: "Alice" });
    const roomId = room.roomId;

    for (let i = 0; i < 20; i += 1) {
      const currentRoom = store.getRoom(roomId)!;
      const roundId = currentRoom.roundId;
      if (!roundId) break; // bank ran dry enough that a new round couldn't be dealt -- acceptable end state
      store.applyStand(roundId, player.id);

      let round = store.getRound(roundId);
      let guard = 0;
      while (round && round.state !== "terminate" && guard < 50) {
        vi.advanceTimersByTime(1500);
        round = store.getRound(roundId);
        guard += 1;
      }
      expect(guard).toBeLessThan(50);

      const totalWallet = Object.values(store.getRoom(roomId)!.wallets).reduce((a, b) => a + b, 0);
      expect(totalWallet).toBe(400 + 300); // banker's 400 + 3 non-bankers' 100 each, conserved every round

      try {
        store.startRound(roomId);
      } catch {
        break; // e.g. not_enough_players if someone's wallet hit 0 and they can't be dealt in -- fine, not what this test is checking
      }
    }
  });
});

describe("selfTopUpWallet", () => {
  it("adds the fixed practice top-up to the caller's own wallet", () => {
    const store = new GameStore();
    const { room, player } = store.createPracticeRoom({ firstName: "Alice" });
    const before = room.wallets[player.id];

    const result = store.selfTopUpWallet(room.roomId, player.id);

    expect(result.amount).toBe(100);
    expect(result.total).toBe(before + 100);
    expect(store.getRoom(room.roomId)!.wallets[player.id]).toBe(before + 100);
  });

  it("refuses to top up in a real (non-practice) room", () => {
    const store = new GameStore();
    const { room, player } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Alice" });
    const joined = store.getRoom(room.roomId)!;
    const guestId = joined.players.find((p) => p.id !== player.id)!.id;

    expect(() => store.selfTopUpWallet(room.roomId, guestId)).toThrow("forbidden");
  });

  it("throws for an unknown player in a practice room", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice" });

    expect(() => store.selfTopUpWallet(room.roomId, "nonexistent")).toThrow("player_not_found");
  });
});
