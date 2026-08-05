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

  // A practice room's banker is a bot, so the round.state === "terminate"
  // WS handler used to schedule a fixed-delay setTimeout to deal the next
  // round on the human's behalf -- which cut into the time they had to
  // actually read what the round they just played did. That timer lived at
  // the WS layer (WSServer.handleRoundUpdate, right alongside its call to
  // finalizeRound), so this mirrors that exact call sequence rather than
  // stopping at applyStand -- finalizeRound is what clears room.roundId,
  // and calling it directly is how this test reaches the layer the removed
  // timer actually lived at without spinning up a real WSServer (that's
  // practice-ws.test.ts's job, over a real socket). The felt now shows the
  // human a "Deal the next round" button instead (TableRoot, gated on
  // isAdmin || room.practice), same control a real banker already had.
  it("does not deal itself a next round when one terminates -- the human has to choose to deal again", () => {
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
    expect(guard).toBeLessThan(50);
    store.finalizeRound(roundId);
    expect(store.getRoom(room.roomId)!.roundId).toBeUndefined();

    // Well past where the old fixed-delay auto-restart would have fired.
    vi.advanceTimersByTime(60_000);
    expect(store.getRoom(room.roomId)!.roundId).toBeUndefined();

    // The human's own explicit choice still works exactly as before.
    const nextRound = store.startRound(room.roomId, player.id);
    expect(nextRound.state).toBe("playing");
    expect(nextRound.roundNumber).toBe(2);
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

      let round = store.getRound(roundId);
      let guard = 0;
      while (round && round.state !== "terminate" && guard < 50) {
        // The seat rotation moves the human around the table between rounds,
        // so "stand first, then let the bots run" only worked while they
        // happened to be dealt first. Take the turn when it comes instead --
        // the same wait a real player's dock imposes on them.
        try {
          store.applyStand(roundId, player.id);
        } catch {
          vi.advanceTimersByTime(1500);
        }
        round = store.getRound(roundId);
        guard += 1;
      }
      expect(guard).toBeLessThan(50);

      const totalWallet = Object.values(store.getRoom(roomId)!.wallets).reduce((a, b) => a + b, 0);
      expect(totalWallet).toBe(400 + 300); // banker's 400 + 3 non-bankers' 100 each, conserved every round

      try {
        store.startRound(roomId, player.id);
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

describe("createPracticeRoom bot count selection", () => {
  it("defaults to 2 bots when no count is given (pre-existing behavior)", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice" });
    expect(room.players.filter((p) => p.isBot)).toHaveLength(3); // banker + 2
  });

  it("seats the requested number of bot players within range, plus the fixed bot banker", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice", botCount: 4 });
    const bankerBots = room.players.filter((p) => p.type === "admin" && p.isBot);
    const playerBots = room.players.filter((p) => p.type === "player" && p.isBot);
    expect(bankerBots).toHaveLength(1);
    expect(playerBots).toHaveLength(4);
    expect(new Set(playerBots.map((b) => b.id)).size).toBe(4); // distinct personas
  });

  it("clamps a request below 2 up to the 2-bot floor", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice", botCount: 0 });
    expect(room.players.filter((p) => p.type === "player" && p.isBot)).toHaveLength(2);
  });

  it("clamps a request above 7 down to the 7-bot ceiling (the name pool's own limit)", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice", botCount: 99 });
    expect(room.players.filter((p) => p.type === "player" && p.isBot)).toHaveLength(7);
    // Seven distinct personas, not the pool wrapping around / repeating.
    const names = room.players.filter((p) => p.type === "player" && p.isBot).map((b) => b.firstName);
    expect(new Set(names).size).toBe(7);
  });

  it("ignores a non-finite count and falls back to the default of 2", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice", botCount: NaN });
    expect(room.players.filter((p) => p.type === "player" && p.isBot)).toHaveLength(2);
  });
});

describe("createPracticeRoom buy-in, bankroll and deck overrides", () => {
  it("defaults to a $100 buy-in and 4x bankroll when none are given (pre-existing behavior)", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice" });
    expect(room.buyIn).toBe(100);
    expect(room.bankerBuyIn).toBe(400);
  });

  it("honors an explicit buy-in and bank bankroll", () => {
    const store = new GameStore();
    const { room, player } = store.createPracticeRoom({ firstName: "Alice", buyIn: 250, bankBuyIn: 900 });
    expect(room.buyIn).toBe(250);
    expect(room.bankerBuyIn).toBe(900);
    expect(room.wallets[player.id]).toBe(250);
  });

  it("still defaults the bankroll to 4x buy-in when only buy-in is overridden", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice", buyIn: 50 });
    expect(room.bankerBuyIn).toBe(200);
  });

  it("falls back to defaults for non-finite or non-positive money values", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice", buyIn: -5, bankBuyIn: NaN });
    expect(room.buyIn).toBe(100);
    expect(room.bankerBuyIn).toBe(400);
  });

  it("caps an absurd money value rather than trusting a crafted payload", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice", buyIn: 999_999_999 });
    expect(room.buyIn).toBeLessThanOrEqual(100_000);
  });

  it("passes an explicit deck count through to the opening round", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice", deckCount: 3 });
    const round = store.getRound(room.roundId!)!;
    // getRound returns the internal RoundState (deck: Card[]), not the
    // sanitized client view (deckRemaining) -- deck.length plus every
    // already-dealt card should account for the whole 3-deck shoe. A real
    // Kvitlach deck is 24 cards -- 2 copies of each of 1-12 (round.ts's
    // CARDS_PER_DECK), not a standard playing-card deck.
    expect(round.deck.length + round.turns.reduce((sum, t) => sum + t.cards.length, 0)).toBe(3 * 24);
  });
});

describe("createPracticeRoom concurrency cap", () => {
  it("rejects a new practice room once the concurrent-practice-room cap is hit", () => {
    const store = new GameStore();
    // The cap only counts practice rooms -- a wall of ordinary rooms must
    // never trip it.
    for (let i = 0; i < 5; i += 1) store.createRoom({ firstName: `Banker${i}` });
    for (let i = 0; i < 25; i += 1) store.createPracticeRoom({ firstName: `Learner${i}` });
    expect(() => store.createPracticeRoom({ firstName: "OneTooMany" })).toThrow("practice_capacity");
  });
});
