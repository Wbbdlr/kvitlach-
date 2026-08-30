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

  it("still persists a normal room to Postgres when a database is configured (contrast check)", async () => {
    const db = makeDbSpy();
    const store = new GameStore(db);
    store.createRoom({ firstName: "Banker" });

    // Writes are chained per room now (store.ts's serializeWrite) so they can
    // never land out of order, which means they start on the next microtask
    // rather than synchronously. Two awaits, not a timer: the chain is built
    // from promises, and this describe runs on fake timers.
    await Promise.resolve();
    await Promise.resolve();

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

describe("reshuffleDeck (practice carve-out)", () => {
  it("lets the human player reshuffle in a practice room -- its banker is a bot with no session", () => {
    const store = new GameStore();
    const { room, player } = store.createPracticeRoom({ firstName: "Alice" });

    // createPracticeRoom already dealt the opening round -- reshuffleDeck's
    // live branch (swap the active round's own deck) is the one this exercises.
    const updated = store.reshuffleDeck(room.roomId, player.id);

    expect(updated).toBeDefined();
    expect(updated!.deckReshuffledAt).toBeDefined();
  });

  it("still refuses a bot's own id, even in practice -- only the human gets the carve-out", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice" });
    const bankerBot = room.players.find((p) => p.type === "admin")!;

    expect(() => store.reshuffleDeck(room.roomId, bankerBot.id)).toThrow("forbidden");
  });

  it("re-arms the active bot's turn, so a table frozen by an empty shoe actually restarts", () => {
    const store = new GameStore();
    const { room, player } = store.createPracticeRoom({ firstName: "Alice" });
    const roundId = store.getRoom(room.roomId)!.roundId!;

    // The human is seated first (players: [bankerBot, human, ...bots]), so
    // standing hands the turn to a bot and puts it on its one-shot botTimer.
    store.applyStand(roundId, player.id);
    const frozenTimer = store.getRound(roundId)!.botTimer;
    expect(frozenTimer).toBeDefined();

    const updated = store.reshuffleDeck(room.roomId, player.id);

    // The real sequence this stands in for: the shoe runs dry on that bot's
    // turn, playBotTurn catches the deck_empty and only logs it, so nothing
    // re-broadcasts and syncBotTurn never re-runs -- the seat stays pending
    // with a timer that has already fired. Reshuffling used to write the deck
    // straight into the map, which brought cards back to a table that was
    // still frozen. It has to go through persistRound to arm a fresh timer.
    expect(updated!.botTimer).toBeDefined();
    expect(updated!.botTimer).not.toBe(frozenTimer);
    expect(store.getRound(roundId)!.botTimer).toBe(updated!.botTimer);
  });

  it("does not extend to a real (non-practice) room -- a regular player still can't reshuffle", () => {
    const store = new GameStore();
    const { room, player: bankerPlayer } = store.createRoom({ firstName: "Banker" });
    const { player: alice } = store.joinRoom(room.roomId, { firstName: "Alice" });

    expect(() => store.reshuffleDeck(room.roomId, alice.id)).toThrow("forbidden");
    // The real banker is unaffected by this change.
    expect(() => store.reshuffleDeck(room.roomId, bankerPlayer.id)).not.toThrow();
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

  it("clamps a request above 10 down to the 10-bot ceiling (the name pool's own limit)", () => {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({ firstName: "Alice", botCount: 99 });
    expect(room.players.filter((p) => p.type === "player" && p.isBot)).toHaveLength(10);
    // Ten distinct personas, not the pool wrapping around / repeating.
    const names = room.players.filter((p) => p.type === "player" && p.isBot).map((b) => b.firstName);
    expect(new Set(names).size).toBe(10);
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

describe("bot banker deciding after the bank goes broke", () => {
  // playBotBankDecision (store.ts) had zero coverage before this: nothing
  // exercised the practice bank actually going broke. That is not a rare
  // corner -- it is the ONLY way a practice round with a bot banker can end
  // once the bank hits $0, since there is no human banker to click anything.
  // If this path were broken, the round -- and the whole 30-minute practice
  // room behind it -- would simply sit stuck until the inactivity reaper
  // eventually cleared it, which is exactly the shape of bug this session
  // already found and fixed once in the real-room equivalent.
  //
  // Own beforeEach/afterEach: this describe is a SIBLING of the top-level
  // "createPracticeRoom" block above, not nested inside it, so its fake-timer
  // setup does not reach here -- vitest scopes beforeEach to a describe and
  // its children only.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const C = (n: number) => ({ name: String(n), attributes: { values: [n] } });

  // Shared by both tests below: bets the bank's entire remaining wallet
  // (which is what makes a bet a BANK! wager -- computeBankWindow / applyBet,
  // store.ts, no explicit flag needed) and drives the banker to a guaranteed
  // bust, landing the round in bankLock stage "decision" with the bank at $0.
  //
  // The active seat's cards are pinned rather than left to the random deal,
  // and deliberately land mid-range -- neither a bust nor a natural, either
  // of which would settle the hand immediately inside applyBet itself
  // (settleImmediateTurn) and skip the explicit stand below. That would
  // (non-deterministically, depending on what the unseeded deck happened to
  // deal that run) walk straight to "banker" stage without ever passing
  // through "player" stage -- exactly the flake this had on its first draft.
  // Mirrors bank-frames.test.ts's own setup for the same reason.
  function setUpBrokenBank() {
    const store = new GameStore();
    const { room } = store.createPracticeRoom({
      firstName: "Alice",
      botCount: 2,
      buyIn: 300,
      bankBuyIn: 10, // small enough that one BANK! wager exhausts it in one frame
    });
    const banker = room.players.find((p) => p.type === "admin")!;
    expect(banker.isBot).toBe(true);

    let round = store.getRound(room.roundId!)!;
    const activeIndex = round.turns.findIndex((t) => t.state === "pending" && t.player.type !== "admin");
    const activeId = round.turns[activeIndex].player.id;
    round.turns[activeIndex].cards = [C(5)];
    round.deck = [C(4), ...round.deck]; // bet's own draw -> [5,4] = 9, no auto-settle

    round = store.applyBet(round.roundId, activeId, 10);
    expect(round.bankLock?.stage).toBe("player");
    round = store.applyStand(round.roundId, activeId);
    expect(round.bankLock?.stage).toBe("banker");

    // applyStand does not draw an extra card for the banker here -- their
    // hand IS whatever cards are already on the turn, exactly like
    // bank-frames.test.ts's own banker setup. [10,10] would have been 20 (a
    // WIN against the player's 9, not a bust) -- three cards for a definite
    // bust instead.
    const bankerIndex = round.turns.findIndex((t) => t.player.type === "admin");
    round.turns[bankerIndex].cards = [C(10), C(10), C(3)]; // 23, a bust
    round = store.applyStand(round.roundId, banker.id);

    // Confirms the setup actually reached the state under test before
    // trusting anything downstream of it.
    expect(round.bankLock?.stage).toBe("decision");
    expect(store.getRoom(room.roomId)!.wallets[banker.id]).toBe(0);

    return { store, room, banker, round };
  }

  it("resolves the round on its own once the bank is broke, rather than staying stuck forever", () => {
    const { store, room, banker, round } = setUpBrokenBank();

    const listener = vi.fn();
    store.setRoundUpdateListener(listener);

    // botThinkDelay is 500-1200ms (BOT_THINK_DELAY_MIN/MAX_MS) -- past the
    // top of that range with room to spare.
    vi.advanceTimersByTime(1500);

    const resolved = store.getRound(round.roundId)!;
    expect(resolved.state).toBe("terminate");
    expect(resolved.bankLock).toBeUndefined();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: "terminate" }));
  });

  it("does nothing if the decision was already resolved before the timer fires", () => {
    // Guards the staleness check at the top of playBotBankDecision: if the
    // round already moved on by the time the timer fires -- resolved some
    // other way -- it must not blindly re-run endRoundAfterBankDecision
    // against state that no longer matches.
    const { store, room, banker, round } = setUpBrokenBank();

    // Resolve it by hand before the scheduled timer ever fires -- the same
    // call the bot's own timer would have made.
    store.endRoundAfterBankDecision(room.roomId, banker.id);
    expect(store.getRound(round.roundId)!.state).toBe("terminate");

    // The pending timer firing now must be a no-op, not a throw and not a
    // second (incorrect) resolution of an already-terminated round.
    expect(() => vi.advanceTimersByTime(1500)).not.toThrow();
    expect(store.getRound(round.roundId)!.state).toBe("terminate");
  });
});
