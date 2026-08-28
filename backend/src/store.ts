import { v4 as uuid } from "uuid";
import { customAlphabet } from "nanoid";
import { createRound, handleBet, handleSkip, handleStand, calculateBalances, calculateEndState, buildShoe, buildRoundHistoryEntry, recommendedDeckCount } from "./round.js";
import { handleHit } from "./round.js";
import { decideBotAction, decideBotBet } from "./bot.js";
import { Balance, Card, Player, RenameRequest, RoomState, RoundState, BuyInRequest, BankLockState, Turn, ConnectionSummary } from "./types.js";
import type { RoundContext } from "./round.js";
import type { Database } from "./db.js";
import { metrics } from "./metrics.js";

const INACTIVITY_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const PRACTICE_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes -- practice rooms are throwaway, single-human sessions
const BOT_THINK_DELAY_MIN_MS = 500;
const BOT_THINK_DELAY_MAX_MS = 1200;
// Small, warm, in-community pool -- 2 to 10 are drawn per practice room. "The
// Gabbai" (a shul's lay administrator, traditionally trusted with its funds)
// is the fixed banker persona, a deliberately apt pick for a card game's bank.
// Ten entries, not more: MAX_SEATED_PLAYERS_PER_ROUND below caps a round's
// non-banker seats at 11 (the felt's own collision math), and the human
// learner always occupies one of those -- 10 bots is the actual ceiling, not
// a round number picked on its own.
const PRACTICE_BANKER_NAME = "The Gabbai";
const PRACTICE_BOT_NAME_POOL = [
  "Sruly",
  "Shimmy",
  "Shmuely",
  "Nati",
  "Josh",
  "Binyomin",
  "Shlomo",
  "Moshe",
  "Chaim",
  "Meshulam",
];
// A practice room's "banker" is a bot with no session to approve a real
// buy-in request through -- self-serve top-ups are how a solo learner
// recovers from going broke instead. Fixed amount, no form: a button.
const PRACTICE_TOPUP_AMOUNT = 100;
// Sanity ceiling on the practice-only buy-in/bankroll sliders -- these come
// straight off a WS payload (see room:create-practice), so this exists to
// stop a crafted request from parking a silly number in a solo, throwaway
// room, not to model a real limit anyone would want in practice.
const PRACTICE_MAX_BUYIN = 100_000;
// Practice rooms are throwaway but not free -- each seats up to 11 bots (the
// fixed banker plus up to 10 players) that all run their own think-delay
// timers (syncBotTurn). Capped generously
// above any realistic number of people learning the rules at once on a
// family-night server, so it bounds the worst case without ever being the
// thing a real user runs into.
const MAX_CONCURRENT_PRACTICE_ROOMS = 25;
// Practice rooms have been capped since they existed; real ones were not, and
// on a public endpoint that was the bigger hole of the two. Nothing about
// room:create requires an existing room, a password, or any prior state, so a
// single IP could open sockets up to MAX_CONNS_PER_IP and create rooms at the
// message rate limit -- hundreds per second, each one holding an in-memory
// record, a three-DAY expiry timer, and a Postgres row. This box hosts more
// than Kvitlach, so "fills memory and disk slowly" is not a Kvitlach-only
// outage.
//
// Set far above any real use (the design target is ~50 people on ONE table)
// so a legitimate host never meets it. It is deliberately a ceiling on damage
// rather than a real defence: someone determined can still fill it and lock
// out new tables. That trade is taken knowingly -- a full table list recovers
// on its own as rooms expire, and the banker can clear one from /admin,
// whereas an out-of-memory box does not recover on its own. The narrower fix
// (a per-IP creation quota, which bounds one actor without letting them
// exhaust the shared ceiling) needs the client IP down here in the store and
// is worth doing if this ever gets abused in practice.
const MAX_CONCURRENT_ROOMS = 150;
const MAX_PLAYERS_PER_ROOM = 100;
// How many non-banker players get an active seat in a single round. The felt
// table's oval seating (frontend/src/table/layout.ts) can only fit players
// without overlapping seat plates up to this count -- numerically confirmed,
// and pinned by layout.test.ts, across the full range the table flattens
// through on wide-short screens; 12 seats is the first count that collides.
// Anyone beyond this per round rotates into waitingPlayerIds and
// is guaranteed a seat within the next `others.length` rounds, since
// startRound()'s rotation advances by exactly one player per round.
const MAX_SEATED_PLAYERS_PER_ROUND = 11;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TURN_TIMEOUT_MS = 90 * 1000;
// How long a banker must be gone before the seats they left behind may throw
// the round away. Long enough that a tunnel blip or a phone changing cells
// doesn't cost anyone a hand -- the client reconnects on its own well inside
// this -- and short enough that a table isn't held hostage by a dead battery.
const BANKER_ABANDON_MS = 2 * 60 * 1000;
const MAX_ROUND_HISTORY_ENTRIES = 200;
const MAX_NAME_LEN = 40;
const MAX_ROOM_NAME_LEN = 80;
const MAX_NOTE_LEN = 160;
const MAX_WATERMARK_LEN = 60;
const shortId = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 6);
const ROOM_NAME_POOL = [
  "Tish Time Tables",
  "The Rebbe's Card Table",
  "Farbrengen & Cards",
  "L'Chaim Lounge",
  "The Niggun Shuffle",
  "Tisch or Twist",
  "The Bekishe Bluff",
  "Shtreimel Stakes",
  "The Mikvah Break Room",
  "After Maariv Madness",
  "Cholent & Chips",
  "Kiddush Club",
  "The Kugel Corner",
  "Fleishig Only",
  "Pareve Players",
  "The Shabbos Is Coming Room",
  "One More Game Before Candle Lighting",
  "The Leftover Challah Table",
  "Washing First, Playing Later",
];

interface RoomRecord {
  room: RoomState;
  timer?: NodeJS.Timeout;
  nextStart?: number;
  // The leftover shoe from the room's last completed round (captured in
  // finalizeRound before the round record is deleted), and the deck count
  // it was built from -- startRound() carries these into the next round so
  // the deck only reshuffles when it actually runs out, not every round.
  deck?: Card[];
  lastDeckCount?: number;
  // Set by a between-round reshuffleDeck() call, consumed (and cleared) by
  // the very next startRound() -- one-shot signal that the shoe it's about
  // to deal from is a fresh one the banker just chose to bring in, so THIS
  // round (and no other) gets deckReshuffledAt stamped for the "fresh deck"
  // notice, instead of the reshuffle happening invisibly to everyone else.
  deckJustReshuffledAt?: number;
  // Set on every bumpRoomTimer call (i.e. any room activity) -- lets the
  // admin room list show how long a room has actually been idle, since the
  // pending setTimeout itself isn't inspectable.
  lastActivityAt?: number;
}

export interface AdminRoomSummary {
  roomId: string;
  name?: string;
  playerCount: number;
  completedRounds: number;
  hasActiveRound: boolean;
  lastActivityAt: number;
}

interface SessionRecord {
  token: string;
  roomId: string;
  expiresAt: number;
}

export class GameStore {
  private rooms = new Map<string, RoomRecord>();
  private rounds = new Map<string, RoundContext>();
  private sessions = new Map<string, SessionRecord>();
  private roundUpdateListener?: (round: RoundContext) => void;
  private db?: Database;

  constructor(db?: Database) {
    this.db = db;
  }

  private sanitizeName(value: string | undefined, max = MAX_NAME_LEN) {
    return (value ?? "").trim().slice(0, max);
  }

  private sanitizeNote(value: string | undefined, max = MAX_NOTE_LEN) {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, max);
  }

  private audit(action: string, roomId: string, actorId: string, details?: Record<string, unknown>) {
    const payload = { ts: new Date().toISOString(), roomId, actorId, action, ...(details ?? {}) };
    // Lightweight audit log; replace with structured logging sink if needed.
    console.info(JSON.stringify({ audit: payload }));
  }

  setRoundUpdateListener(listener: (round: RoundContext) => void) {
    this.roundUpdateListener = listener;
  }

  async recordConnection(roomId: string, playerId: string, ip?: string, userAgent?: string): Promise<number | undefined> {
    if (!this.db) return undefined;
    return this.db.logConnection({ roomId, playerId, ip, userAgent });
  }

  async recordDisconnection(connectionId?: number) {
    if (!this.db || !connectionId) return;
    await this.db.logDisconnection(connectionId);
  }

  async getConnectionSummaries(roomId: string): Promise<ConnectionSummary[]> {
    if (!this.db) return [];
    return this.db.getRoomConnectionSummaries(roomId);
  }

  private getActiveTurnId(round: RoundContext): string | undefined {
    if (round.state === "terminate") return undefined;
    if (round.bankLock?.stage === "decision") return undefined;
    const pendingTurns = round.turns.filter((turn) => turn.state === "pending");
    const bankerTurn = round.turns.find((turn) => turn.player.type === "admin");

    if ((round.state === "final" || round.bankLock?.stage === "banker") && bankerTurn) return bankerTurn.player.id;
    if (round.bankLock?.stage === "player") return round.bankLock.playerId;
    return pendingTurns[0]?.player.id;
  }

  // The turn-STATE guard (round.ts's own `turn.state !== "pending"` checks)
  // only ever asked "have you already acted?" -- never "is it your go?". That
  // is not a pedantic distinction here, because the bank limit is computed
  // from the wagers sitting in the seats AHEAD of you (see computeBankWindow):
  // seats that have not acted yet carry a bet of 0, so a seat playing out of
  // order is measured against a bank nobody has claimed. Two players wagering
  // 10 each into a 15-chip bank both pass their own check, and if both win the
  // banker pays 20 out of 15 and lands at -5. The UI never offers an
  // out-of-turn action, so this closes the gap under it rather than fixing
  // something players could reach -- but "the client wouldn't do that" is not
  // what should be keeping a real-money bank solvent.
  private ensureActiveTurn(round: RoundContext, playerId: string) {
    if (this.getActiveTurnId(round) !== playerId) throw new Error("not_your_turn");
  }

  private syncTurnTimer(roundId: string, next: RoundContext, prev?: RoundContext): RoundContext {
    const activeTurnId = this.getActiveTurnId(next);
    const activeTurn = activeTurnId ? next.turns.find((turn) => turn.player.id === activeTurnId) : undefined;
    const now = Date.now();

    const shouldSkipTimer =
      !activeTurnId ||
      !activeTurn ||
      activeTurn.player.type === "admin" ||
      activeTurn.state !== "pending";

    if (shouldSkipTimer) {
      if (prev?.turnTimer) clearTimeout(prev.turnTimer);
      return {
        ...next,
        turnTimer: undefined,
        turnTimerPlayerId: undefined,
        turnTimerExpiresAt: undefined,
        turnTimerDurationMs: undefined,
      };
    }

    const sameActive = prev?.turnTimerPlayerId === activeTurnId && typeof prev?.turnTimerExpiresAt === "number";
    const remainingMs = sameActive ? Math.max((prev?.turnTimerExpiresAt ?? 0) - now, 0) : TURN_TIMEOUT_MS;

    if (remainingMs <= 0) {
      return this.forceTimeoutStand(roundId, next, activeTurnId);
    }

    if (prev?.turnTimer) clearTimeout(prev.turnTimer);
    const timer = setTimeout(() => this.handleTurnTimeout(roundId, activeTurnId), remainingMs);

    return {
      ...next,
      turnTimer: timer,
      turnTimerPlayerId: activeTurnId,
      turnTimerExpiresAt: now + remainingMs,
      turnTimerDurationMs: TURN_TIMEOUT_MS,
    };
  }

  // Mirrors syncTurnTimer's shape exactly (same setTimeout-after-persistRound
  // pattern), but drives a computer-controlled seat's own turn instead of
  // forcing a stale human's stand. Only ever does anything in a practice
  // room, since only there does any player carry isBot -- a plain `.find()`
  // that never matches in a normal room, no different in cost from the
  // pendingTurns/bankerTurn lookups syncTurnTimer already does on every call.
  private syncBotTurn(roundId: string, next: RoundContext, prev?: RoundContext): RoundContext {
    const clearPrev = () => {
      if (prev?.botTimer) clearTimeout(prev.botTimer);
    };

    // Bank-lock "decision" stage has no active turn (getActiveTurnId returns
    // undefined for it) but still needs the banker to act if that's a bot.
    if (next.bankLock?.stage === "decision") {
      const bankerId = this.getBankerId(next);
      const banker = bankerId ? next.turns.find((t) => t.player.id === bankerId) : undefined;
      clearPrev();
      if (!banker?.player.isBot || !bankerId) return { ...next, botTimer: undefined };
      const timer = setTimeout(() => this.playBotBankDecision(roundId, bankerId), this.botThinkDelay());
      return { ...next, botTimer: timer };
    }

    const activeTurnId = this.getActiveTurnId(next);
    const activeTurn = activeTurnId ? next.turns.find((t) => t.player.id === activeTurnId) : undefined;
    clearPrev();
    if (!activeTurn?.player.isBot || activeTurn.state !== "pending" || !activeTurnId) {
      return { ...next, botTimer: undefined };
    }
    const timer = setTimeout(() => this.playBotTurn(roundId, activeTurnId), this.botThinkDelay());
    return { ...next, botTimer: timer };
  }

  private botThinkDelay(): number {
    return BOT_THINK_DELAY_MIN_MS + Math.random() * (BOT_THINK_DELAY_MAX_MS - BOT_THINK_DELAY_MIN_MS);
  }

  private playBotBankDecision(roundId: string, bankerId: string) {
    const round = this.rounds.get(roundId);
    if (!round || round.bankLock?.stage !== "decision") return; // stale -- already resolved
    try {
      const updated = this.endRoundAfterBankDecision(round.roomId, bankerId);
      if (this.roundUpdateListener) this.roundUpdateListener(updated);
    } catch (err) {
      console.error("bot bank-decision failure", err);
    }
  }

  // Deliberately routes through the exact same applyBet/applyHit/applyStand
  // a real player's WS message would call -- full reuse of bank-lock
  // handling, the turn-state guard, and settlement, zero duplicated rules.
  // Those methods return the updated round but (unlike a WS-driven call)
  // there's no caller waiting to broadcast it, so this fires
  // roundUpdateListener itself -- exactly what forceTimeoutStand does for
  // the same reason.
  private playBotTurn(roundId: string, playerId: string) {
    const round = this.rounds.get(roundId);
    if (!round) return;
    if (this.getActiveTurnId(round) !== playerId) return; // stale -- turn moved on already
    const roomRec = this.rooms.get(round.roomId);
    if (!roomRec) return;
    const turn = round.turns.find((t) => t.player.id === playerId);
    if (!turn || !turn.player.isBot || turn.state !== "pending") return;
    try {
      let updated: RoundContext;
      if ((turn.bet ?? 0) === 0) {
        const { available } = this.computeBankWindow(round, roomRec.room, playerId);
        const wallet = roomRec.room.wallets[playerId] ?? 0;
        const amount = decideBotBet(wallet, available);
        updated = amount > 0 ? this.applyBet(roundId, playerId, amount) : this.applyHit(roundId, playerId);
      } else {
        const action = decideBotAction(turn.cards);
        updated = action === "stand" ? this.applyStand(roundId, playerId) : this.applyHit(roundId, playerId);
      }
      if (this.roundUpdateListener) this.roundUpdateListener(updated);
    } catch (err) {
      console.error("bot turn failure", err);
    }
  }

  private forceTimeoutStand(roundId: string, round: RoundContext, playerId: string): RoundContext {
    const roomRec = this.rooms.get(round.roomId);
    if (!roomRec) return round;
    try {
      const updated = handleStand(round, playerId);
      const processed = this.processBankLock(updated, roomRec);
      this.audit("auto-stand", round.roomId, playerId, { reason: "turn_timeout" });
      const persisted = this.persistRound(roundId, processed, round);
      if (this.roundUpdateListener) this.roundUpdateListener(persisted);
      return persisted;
    } catch (err) {
      console.error("auto-stand failure", err);
      return round;
    }
  }

  private handleTurnTimeout = (roundId: string, playerId: string) => {
    const round = this.rounds.get(roundId);
    if (!round) return;
    const activeTurnId = this.getActiveTurnId(round);
    if (activeTurnId !== playerId) {
      this.persistRound(roundId, round, round);
      return;
    }
    this.forceTimeoutStand(roundId, round, playerId);
  };

  // Every DB write in this class used to be a bare `void this.db.save...()`.
  // Those run on a connection POOL, so two writes to the same row execute on
  // different connections and complete in whatever order the server gets to
  // them -- not the order they were issued. `ON CONFLICT DO UPDATE` then
  // happily lets an older snapshot land on top of a newer one.
  //
  // That is not theoretical: it is what the restart-recovery test caught. A
  // hand settled mid-round (wallets 90/510 in memory, asserted), yet Postgres
  // still held 100/100/500 afterwards -- an earlier save had overtaken the
  // settlement save. A restart at that point restores wallets that never
  // received the money, which is precisely the silent-loss class the
  // mid-round bumpRoomTimer fix was meant to close. Persisting on every action
  // is exactly what makes the race easy to hit: the more often we write, the
  // more overlapping writes there are.
  //
  // Chaining per key fixes the ordering and coalesces naturally, since
  // saveRoom re-reads the live room object when its turn comes and so always
  // writes the newest state rather than a stale snapshot.
  private pendingWrites = new Map<string, Promise<unknown>>();

  private serializeWrite(key: string, work: () => Promise<unknown>): void {
    const prev = this.pendingWrites.get(key) ?? Promise.resolve();
    // Same handler for both settle paths: one failed write must not wedge
    // every later write for that row behind a rejected promise.
    const next = prev.then(work, work).catch((e) => console.error("db write failed", key, e));
    this.pendingWrites.set(key, next);
    void next.finally(() => {
      // Only the tail clears the entry, so a burst keeps chaining and a quiet
      // row doesn't leak a promise per write.
      if (this.pendingWrites.get(key) === next) this.pendingWrites.delete(key);
    });
  }

  private persistRound(roundId: string, next: RoundContext, prev?: RoundContext): RoundContext {
    const previous = prev ?? this.rounds.get(roundId);
    const withTimer = this.syncTurnTimer(roundId, next, previous);
    const withBotTimer = this.syncBotTurn(roundId, withTimer, previous);
    this.rounds.set(roundId, withBotTimer);
    // Practice rounds never touch Postgres, same as their parent room.
    const isPractice = this.rooms.get(withBotTimer.roomId)?.room.practice === true;
    if (this.db && !isPractice) {
      const { timer, turnTimer, botTimer, ...serializable } = withBotTimer;
      const db = this.db;
      this.serializeWrite(`round:${roundId}`, () =>
        db.saveRound(roundId, withBotTimer.roomId, serializable as Record<string, unknown>)
      );
    }
    return withBotTimer;
  }

    createRoom(admin: { firstName: string; lastName?: string; roomName?: string; password?: string; buyIn?: number; roomId?: string; bankerBankroll?: number }) {
    // Checked before anything is allocated or any id is claimed, so a refusal
    // leaves no trace behind (mirrors createPracticeRoom's own capacity gate).
    if (this.rooms.size >= MAX_CONCURRENT_ROOMS) {
      throw new Error("room_capacity");
    }
    const player: Player = {
      id: uuid(),
      firstName: this.sanitizeName(admin.firstName),
      lastName: this.sanitizeName(admin.lastName),
      type: "admin",
      presence: "online",
    };

    const buyIn = admin.buyIn ?? 100;
    const bankerBuyIn = admin.bankerBankroll ?? buyIn;
    if (!Number.isFinite(bankerBuyIn) || bankerBuyIn <= 0) {
      throw new Error("invalid_bankroll");
    }
    const trimmedRoomName = this.sanitizeName(admin.roomName, MAX_ROOM_NAME_LEN);
    const autoName = ROOM_NAME_POOL[Math.floor(Math.random() * ROOM_NAME_POOL.length)];
    const resolvedRoomName = trimmedRoomName || autoName;
      const customId = admin.roomId?.trim().toUpperCase() ?? "";
      let roomId = customId;
      if (customId) {
        if (!/^[A-Z0-9-]{4,20}$/.test(customId)) {
          throw new Error("Game ID must be 4-20 characters using letters, numbers, or hyphen.");
        }
        if (this.rooms.has(customId)) {
          throw new Error("That Game ID is already taken.");
        }
      } else {
        roomId = shortId();
        while (this.rooms.has(roomId)) roomId = shortId();
      }
    const room: RoomState = {
      roomId,
      name: resolvedRoomName,
      password: admin.password,
      buyIn,
      bankerBuyIn,
      wallets: { [player.id]: bankerBuyIn },
      players: [player],
      balances: [],
      roundHistory: [],
      completedRounds: 0,
      renameRequests: [],
      buyInRequests: [],
      waitingPlayerIds: [],
      renameBlockedIds: [],
      buyInBlockedIds: [],
    };
    this.rooms.set(roomId, { room, nextStart: 0 });
    this.bumpRoomTimer(roomId);
    const sessionToken = this.issueSession(roomId, player.id);
    return { room, player, sessionToken };
  }

  // Solo practice table: a computer banker plus two-to-seven computer
  // players fill out the seats so a new player can learn the flow without
  // needing other humans online. A real room in every other respect -- same
  // GameStore, same round engine, same turn-state guard -- just with
  // `practice: true` (never persisted, short TTL, see bumpRoomTimer) and
  // some seats driven by syncBotTurn instead of a human's WS messages.
  createPracticeRoom(host: {
    firstName: string;
    botCount?: number;
    buyIn?: number;
    bankBuyIn?: number;
    deckCount?: number;
  }) {
    const activePracticeRooms = [...this.rooms.values()].filter((r) => r.room.practice === true).length;
    if (activePracticeRooms >= MAX_CONCURRENT_PRACTICE_ROOMS) {
      throw new Error("practice_capacity");
    }

    const humanName = this.sanitizeName(host.firstName) || "You";
    // Clamped to the name pool's own range (PRACTICE_BOT_NAME_POOL has
    // exactly 10 entries, one per seat at the cap) -- defaults to 2 to match
    // every pre-existing caller/test that never passed a count.
    const rawBotCount = Number(host.botCount);
    const botCount = Number.isFinite(rawBotCount) ? Math.min(10, Math.max(2, Math.floor(rawBotCount))) : 2;
    const bankerBot: Player = { id: uuid(), firstName: PRACTICE_BANKER_NAME, lastName: "", type: "admin", presence: "online", isBot: true };
    const human: Player = { id: uuid(), firstName: humanName, lastName: "", type: "player", presence: "online" };

    const pool = [...PRACTICE_BOT_NAME_POOL];
    const botNames: string[] = [];
    for (let i = 0; i < botCount && pool.length; i += 1) {
      botNames.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    const bots: Player[] = botNames.map((name) => ({
      id: uuid(),
      firstName: name,
      lastName: "",
      type: "player",
      presence: "online",
      isBot: true,
    }));

    // Same shape as the real Host form's buy-in/bankroll validation (see
    // createRoom): finite and positive, or fall back to the sane default --
    // this comes straight off a WS payload, so a crafted request must not be
    // able to zero out (or blow up) a solo learner's table.
    const rawBuyIn = Number(host.buyIn);
    const buyIn = Number.isFinite(rawBuyIn) && rawBuyIn > 0 ? Math.min(Math.floor(rawBuyIn), PRACTICE_MAX_BUYIN) : 100;
    const rawBankBuyIn = Number(host.bankBuyIn);
    // Defaults to 4x buy-in when not set explicitly -- gives the bot bank
    // room to absorb a losing streak without running dry.
    const bankBuyIn =
      Number.isFinite(rawBankBuyIn) && rawBankBuyIn > 0 ? Math.min(Math.floor(rawBankBuyIn), PRACTICE_MAX_BUYIN) : buyIn * 4;
    let roomId = shortId();
    while (this.rooms.has(roomId)) roomId = shortId();

    const room: RoomState = {
      roomId,
      name: "Practice Table",
      buyIn,
      bankerBuyIn: bankBuyIn,
      wallets: {
        [bankerBot.id]: bankBuyIn,
        [human.id]: buyIn,
        ...Object.fromEntries(bots.map((b) => [b.id, buyIn])),
      },
      players: [bankerBot, human, ...bots],
      balances: [],
      roundHistory: [],
      completedRounds: 0,
      renameRequests: [],
      buyInRequests: [],
      waitingPlayerIds: [],
      renameBlockedIds: [],
      buyInBlockedIds: [],
      practice: true,
    };
    this.rooms.set(roomId, { room, nextStart: 0 });
    this.bumpRoomTimer(roomId);
    const sessionToken = this.issueSession(roomId, human.id);
    // No human banker exists to click Start -- begin immediately, as the
    // human (the only actor startRound's own check would allow here anyway).
    // deckCount flows through startRound's own optional override -- same
    // sanitizeDeckCount() clamp the real Host "decks to use" field gets, so
    // an invalid value degrades to a safe default instead of throwing here.
    this.startRound(roomId, human.id, host.deckCount);
    return { room: this.rooms.get(roomId)!.room, player: human, sessionToken };
  }

    joinRoom(roomId: string, info: { firstName: string; lastName?: string; password?: string; spectator?: boolean }) {
      const normalizedId = roomId.trim().toUpperCase();
      const roomRec = this.rooms.get(normalizedId);
    if (!roomRec) throw new Error("room_not_found");
    if (roomRec.room.password && roomRec.room.password !== info.password) throw new Error("invalid_password");
    if (roomRec.room.players.length >= MAX_PLAYERS_PER_ROOM) throw new Error("room_full");
    const player: Player = {
      id: uuid(),
      firstName: this.sanitizeName(info.firstName),
      lastName: this.sanitizeName(info.lastName),
      type: info.spectator ? "spectator" : "player",
      presence: "online",
    };
    roomRec.room.players.push(player);
    if (!info.spectator) roomRec.room.wallets[player.id] = roomRec.room.buyIn;
    // Spectators are never dealt into a round (startRound's `others` filter
    // excludes them), so queuing one here would leave them permanently
    // showing as "queued for next round" with no round ever seating them.
    if (!info.spectator && roomRec.room.roundId && this.rounds.has(roomRec.room.roundId)) {
      roomRec.room.waitingPlayerIds = [...new Set([...roomRec.room.waitingPlayerIds, player.id])];
    }
      this.bumpRoomTimer(roomRec.room.roomId);
    const sessionToken = this.issueSession(roomRec.room.roomId, player.id);
    return { room: roomRec.room, player, sessionToken };
  }

  setPresence(roomId: string, playerId: string, presence: Player["presence"]) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) return;
    roomRec.room.players = roomRec.room.players.map((p) => {
      if (p.id !== playerId) return p;
      if (presence === "online") return { ...p, presence, offlineSince: undefined };
      // Don't restamp someone who was already offline -- a duplicate close
      // event would otherwise keep resetting how long they have been gone,
      // and voidAbandonedRound measures exactly that.
      return { ...p, presence, offlineSince: p.offlineSince ?? Date.now() };
    });
  }

  leaveRoom(roomId: string, playerId: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) return;
    roomRec.room.players = roomRec.room.players.filter((p) => p.id !== playerId);
    roomRec.room.waitingPlayerIds = roomRec.room.waitingPlayerIds.filter((id) => id !== playerId);
    this.bumpRoomTimer(roomId);
  }

  switchAdmin(roomId: string, actorId: string, targetPlayerId: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, actorId)) throw new Error("forbidden");
    if (actorId === targetPlayerId) throw new Error("invalid_target");
    const target = roomRec.room.players.find((p) => p.id === targetPlayerId);
    if (!target) throw new Error("player_not_found");
    if (target.type === "admin") throw new Error("invalid_target");

    roomRec.room.players = roomRec.room.players.map((p) => {
      if (p.id === targetPlayerId) return { ...p, type: "admin" };
      if (p.id === actorId) return { ...p, type: "player" };
      return p;
    });
    this.audit("switch-admin", roomId, actorId, { target: targetPlayerId });
    this.bumpRoomTimer(roomId);
    return roomRec.room;
  }

  // actorId is required, not optional-with-a-skip-the-check-if-omitted
  // default: an omittable check is a check nobody has to remember to pass,
  // which is exactly how this had no authorization at all before -- ANY
  // connected socket could deal a round in a room it didn't administer.
  // Every caller (ws-server.ts, GameStore.createPracticeRoom's own internal
  // call, every test) has a real actor in scope, so there's nothing a
  // required param costs here.
  startRound(roomId: string, actorId: string, deckCount?: number) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    const actor = roomRec.room.players.find((p) => p.id === actorId);
    if (!actor) throw new Error("forbidden");
    // Mirrors TableRoot's own isAdmin || room.practice gate: a live room's
    // banker, or -- since a practice room's banker IS a bot nobody can
    // authenticate as -- the one human player actually seated there. !isBot
    // gates BOTH branches, not just the practice one: a live room's admin is
    // always human by construction, but nothing stops a future caller from
    // passing a bot's own id here directly (bots never hold a WS session, so
    // the normal path can't do this -- but startRound is a public method,
    // and this guarantee shouldn't depend on "well nobody would call it that
    // way"). Without it, the practice banker BOT itself satisfied
    // `type === "admin"` and could deal its own room's rounds.
    const allowed = !actor.isBot && (actor.type === "admin" || (roomRec.room.practice === true && actor.type === "player"));
    if (!allowed) throw new Error("forbidden");
    const activePlayers = roomRec.room.players.filter((p) => p.presence === "online");
    const basePlayers = activePlayers.length > 0 ? activePlayers : roomRec.room.players;
    const admin = basePlayers.find((p) => p.type === "admin");
    const others = basePlayers.filter((p) => p.type === "player");

    const startIndex = roomRec.nextStart ?? 0;
    const normalizedStart = others.length ? startIndex % others.length : 0;
    const rotated = others.length
      ? others.slice(normalizedStart).concat(others.slice(0, normalizedStart))
      : [];
    // Cap active seats at what the table can actually render without
    // overlapping seats (MAX_SEATED_PLAYERS_PER_ROUND); the rest queue into
    // waitingPlayerIds exactly like a mid-round joiner, and rotate into a
    // seat automatically as nextStart advances in later rounds.
    const seated = rotated.slice(0, MAX_SEATED_PLAYERS_PER_ROUND);
    const overflow = rotated.slice(MAX_SEATED_PLAYERS_PER_ROUND);
    const playersForRound = admin ? seated.concat(admin) : seated;

    if (playersForRound.length < 1) throw new Error("not_enough_players");
    const roundNumber = (roomRec.room.completedRounds ?? 0) + 1;
    // Carry the previous round's leftover shoe forward instead of dealing a
    // brand new one every round -- createRound throws deck_low rather than
    // reshuffling on its own now (the dealer chooses when a new shoe comes
    // in, not the server). Deliberately nothing below mutates roomRec until
    // createRound has actually succeeded: if it throws, a retry after the
    // banker reshuffles must land on the exact rotation and round number it
    // would have gotten the first time, not skip a player or a round count
    // the way mutating nextStart up front (the old order) would have.
    const round = createRound(
      playersForRound,
      roomId,
      deckCount ?? roomRec.lastDeckCount,
      roundNumber,
      roomRec.deck,
      roomRec.deckJustReshuffledAt !== undefined
    );
    metrics.recordRoundStart(round.roundId);
    const stored = this.persistRound(round.roundId, round);

    if (others.length > 0) {
      roomRec.nextStart = (normalizedStart + 1) % others.length;
    }
    roomRec.room.roundId = stored.roundId;
    roomRec.room.waitingPlayerIds = overflow.map((p) => p.id);
    roomRec.deckJustReshuffledAt = undefined;
    this.bumpRoomTimer(roomId);
    return stored;
  }

  getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId)?.room;
  }

  getRound(roundId: string): RoundContext | undefined {
    return this.rounds.get(roundId);
  }

  isAdmin(roomId: string, playerId: string): boolean {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) return false;
     return roomRec.room.players.some((p) => p.id === playerId && p.type === "admin");
  }

  private ensureAdmin(roomId: string, playerId: string) {
    if (!this.isAdmin(roomId, playerId)) throw new Error("forbidden");
  }

  kickPlayer(roomId: string, adminId: string, targetPlayerId: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    if (adminId === targetPlayerId) throw new Error("invalid_target");
    const target = roomRec.room.players.find((p) => p.id === targetPlayerId);
    if (!target) throw new Error("player_not_found");
    if (target.type === "admin") throw new Error("invalid_target");

    // Remove from active round turns if present.
    const roundId = roomRec.room.roundId;
    if (roundId) {
      const round = this.rounds.get(roundId);
      if (round) {
        const turns = round.turns.filter((t) => t.player.id !== targetPlayerId);
        const bankLock = round.bankLock?.playerId === targetPlayerId ? undefined : round.bankLock;
          const updated: RoundContext = { ...round, turns, bankLock };
          this.persistRound(roundId, updated, round);
      }
    }

    // Remove from room state
    roomRec.room.players = roomRec.room.players.filter((p) => p.id !== targetPlayerId);
    delete roomRec.room.wallets[targetPlayerId];
    roomRec.room.waitingPlayerIds = roomRec.room.waitingPlayerIds.filter((id) => id !== targetPlayerId);
    roomRec.room.renameRequests = roomRec.room.renameRequests.filter((req) => req.playerId !== targetPlayerId);
    roomRec.room.buyInRequests = roomRec.room.buyInRequests.filter((req) => req.playerId !== targetPlayerId);
    roomRec.room.renameBlockedIds = roomRec.room.renameBlockedIds.filter((id) => id !== targetPlayerId);
    roomRec.room.buyInBlockedIds = roomRec.room.buyInBlockedIds.filter((id) => id !== targetPlayerId);
    this.audit("kick", roomId, adminId, { target: targetPlayerId });
    this.bumpRoomTimer(roomId);
    return roomRec.room;
  }

  closeRoom(roomId: string, adminId: string): void {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    if (roomRec.timer) clearTimeout(roomRec.timer);
    this.rooms.delete(roomId);
    void this.db?.deleteRoom(roomId).catch((e) => console.error("db delete room (close)", roomId, e));
  }

  adjustPlayerWallet(roomId: string, adminId: string, targetPlayerId: string, amount: number, note?: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    if (!Number.isFinite(amount) || amount === 0) throw new Error("invalid_bank_amount");
    const current = roomRec.room.wallets[targetPlayerId];
    if (current === undefined) throw new Error("player_not_found");
    const updatedTotal = current + amount;
    if (updatedTotal < 0) throw new Error("insufficient_bank");
    roomRec.room.wallets[targetPlayerId] = updatedTotal;
    const trimmedNote = this.sanitizeNote(note);
    this.audit("wallet-adjust", roomId, adminId, { target: targetPlayerId, amount, note: trimmedNote });
    this.bumpRoomTimer(roomId);
    return { amount, total: updatedTotal, note: trimmedNote };
  }

  // Practice-only self-serve top-up -- see PRACTICE_TOPUP_AMOUNT. Deliberately
  // NOT reachable for a real room: a human can only ever adjust their own
  // wallet here, and only when the room itself is flagged practice.
  selfTopUpWallet(roomId: string, playerId: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!roomRec.room.practice) throw new Error("forbidden");
    const current = roomRec.room.wallets[playerId];
    if (current === undefined) throw new Error("player_not_found");
    const updatedTotal = current + PRACTICE_TOPUP_AMOUNT;
    roomRec.room.wallets[playerId] = updatedTotal;
    this.bumpRoomTimer(roomId);
    return { amount: PRACTICE_TOPUP_AMOUNT, total: updatedTotal };
  }

  setFeltWatermark(roomId: string, adminId: string, text: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    const sanitized = this.sanitizeNote(text, MAX_WATERMARK_LEN);
    roomRec.room.feltWatermark = sanitized;
    this.audit("set-watermark", roomId, adminId, { text: sanitized });
    this.bumpRoomTimer(roomId);
    return { feltWatermark: sanitized };
  }

  // The dealer's own call, live or between rounds -- a real shoe never
  // reshuffles itself, so neither does this. Two branches:
  //   * a round is live: swap the ACTIVE round's own deck (RoundContext.deck)
  //     for a fresh shoe. Cards already dealt into hands are untouched --
  //     only what's still in the shoe changes -- and the round is returned
  //     so the caller can broadcast it (deckReshuffledAt tells every client
  //     the same "fresh shoe" notice a between-round one gets).
  //   * no round is live: build the fresh shoe into the room's carried-over
  //     deck NOW, rather than just clearing it -- so the very next
  //     startRound() has cards to deal from immediately instead of finding
  //     an empty deck and throwing deck_low right back at the banker who
  //     just fixed it. deckJustReshuffledAt is the one-shot signal that
  //     tells THAT next round to stamp its own deckReshuffledAt.
  reshuffleDeck(roomId: string, adminId: string): RoundContext | undefined {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    // Mirrors startRound's own isAdmin || (practice && player) allowance --
    // a practice room's banker is a bot with no session to authenticate as,
    // so its one human needs the same carve-out to bring in a fresh shoe
    // themselves instead of being stuck with whatever the bot dealt them.
    const actor = roomRec.room.players.find((p) => p.id === adminId);
    if (!actor) throw new Error("forbidden");
    const allowed = !actor.isBot && (actor.type === "admin" || (roomRec.room.practice === true && actor.type === "player"));
    if (!allowed) throw new Error("forbidden");

    if (roomRec.room.roundId) {
      const round = this.rounds.get(roomRec.room.roundId);
      if (!round) throw new Error("round_not_found");
      round.deck = buildShoe(round.deckCount ?? recommendedDeckCount(roomRec.room.players.length));
      round.deckReshuffledAt = Date.now();
      // persistRound rather than a bare rounds.set, because bringing cards
      // back is only half of what a stuck table needs. If the shoe ran dry on
      // a BOT's turn, playBotTurn caught the deck_empty and logged it -- no
      // round update was broadcast, so syncBotTurn never re-ran, and that
      // seat's one-shot botTimer was already spent. The bot sat pending
      // forever and nothing retried it: the fresh shoe arrived and the table
      // was still dead. Only syncBotTurn (via here) arms a new one.
      // syncTurnTimer carries the active player's own remaining time across
      // on turnTimerExpiresAt, so this doesn't hand a human a fresh clock.
      const persisted = this.persistRound(round.roundId, round);
      this.audit("reshuffle-deck-live", roomId, adminId, {});
      this.bumpRoomTimer(roomId);
      return persisted;
    }

    roomRec.deck = buildShoe(roomRec.lastDeckCount ?? recommendedDeckCount(roomRec.room.players.length));
    roomRec.deckJustReshuffledAt = Date.now();
    this.audit("reshuffle-deck", roomId, adminId, {});
    this.bumpRoomTimer(roomId);
    return undefined;
  }

  private settleImmediateTurn(round: RoundContext, roomRec: RoomRecord, turnIndex: number): void {
    const turn = round.turns[turnIndex];
    if (!turn || turn.player.type === "admin" || turn.settled) return;
    if (turn.state !== "won" && turn.state !== "lost") return;
    const bankerId = this.getBankerId(round);
    if (!bankerId) return;
    const amount = turn.bet ?? 0;
    const balance: Balance =
      turn.state === "lost"
        ? { amount, payer: turn.player.id, payee: bankerId }
        : { amount, payer: bankerId, payee: turn.player.id };
    roomRec.room.wallets[balance.payer] = (roomRec.room.wallets[balance.payer] ?? 0) - amount;
    roomRec.room.wallets[balance.payee] = (roomRec.room.wallets[balance.payee] ?? 0) + amount;
    if (amount > 0) {
      roomRec.room.balances = [balance, ...roomRec.room.balances];
      round.ledger = [...(round.ledger ?? []), balance];
      // Same mid-round persistence gap settleBankOutcome guards against: this
      // pays a turn out while the round plays on, so finalizeRound's own bump
      // (which only fires at "terminate") hasn't happened yet and nothing else
      // in a bet/hit/stand writes the room. Only when money actually moved --
      // an amount of 0 leaves the wallets exactly as they were.
      this.bumpRoomTimer(roomRec.room.roomId);
    }
    round.turns[turnIndex] = { ...turn, settled: true, settledBet: turn.bet };
  }

  applyBet(roundId: string, playerId: string, amount: number, options?: { bank?: boolean; eleveroon?: boolean }) {
    const round = this.rounds.get(roundId);
    if (!round) throw new Error("round_not_found");
    const roomRec = this.rooms.get(round.roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid_bet");
    const playerTurn = round.turns.find((t) => t.player.id === playerId);
    if (!playerTurn) throw new Error("turn_not_found");

    const lock = round.bankLock;
    if (lock) {
      if (lock.stage === "player" && lock.playerId !== playerId) throw new Error("bank_locked");
      if (lock.stage === "banker") throw new Error("bank_locked");
      if (lock.stage === "decision") throw new Error("banker_deciding");
    }
    this.ensureActiveTurn(round, playerId);

    const wallet = roomRec.room.wallets[playerId] ?? 0;
    const newBet = playerTurn.bet + amount;
    if (newBet > wallet) throw new Error("insufficient_funds");

    const { available, playerIndex } = this.computeBankWindow(round, roomRec.room, playerId);
    if (available <= 0) throw new Error("bank_empty");
    if (newBet > available) throw new Error(`bank_limit:${available}`);

    const updated = handleBet(round, playerId, amount, { eleveroon: options?.eleveroon });
    const settledIndex = updated.turns.findIndex((t) => t.player.id === playerId);
    if (settledIndex >= 0) this.settleImmediateTurn(updated, roomRec, settledIndex);

    const shouldBank = Boolean(options?.bank || newBet === available);

    if (shouldBank) {
      if (newBet !== available) throw new Error("invalid_bank_amount");
      const lockState: BankLockState = {
        playerId,
        stage: "player",
        exposure: available,
        throughIndex: playerIndex,
        initiatedAt: Date.now(),
      };
      updated.bankLock = lockState;
      updated.turns = updated.turns.map((turn) =>
        turn.player.id === playerId ? { ...turn, bankRequest: true } : turn
      );
    } else if (round.bankLock?.playerId === playerId) {
      updated.bankLock = round.bankLock;
    }

    const processed = this.processBankLock(updated, roomRec);
    return this.persistRound(roundId, processed, round);
  }

  applyHit(roundId: string, playerId: string, options?: { eleveroon?: boolean }) {
    const round = this.rounds.get(roundId);
    if (!round) throw new Error("round_not_found");
    const roomRec = this.rooms.get(round.roomId);
    if (!roomRec) throw new Error("room_not_found");
    const lock = round.bankLock;
    if (lock) {
      if (lock.stage === "player" && lock.playerId !== playerId) throw new Error("bank_locked");
      if (lock.stage === "banker") {
        const bankerId = this.getBankerId(round);
        if (bankerId && bankerId !== playerId) throw new Error("bank_locked");
      }
      if (lock.stage === "decision") throw new Error("banker_deciding");
    }
    this.ensureActiveTurn(round, playerId);
    const updated = handleHit(round, playerId, { eleveroon: options?.eleveroon });
    const settledIndex = updated.turns.findIndex((t) => t.player.id === playerId);
    if (settledIndex >= 0) this.settleImmediateTurn(updated, roomRec, settledIndex);
    const processed = this.processBankLock(updated, roomRec);
    return this.persistRound(roundId, processed, round);
  }

  applyStand(roundId: string, playerId: string) {
    const round = this.rounds.get(roundId);
    if (!round) throw new Error("round_not_found");
    const roomRec = this.rooms.get(round.roomId);
    if (!roomRec) throw new Error("room_not_found");
    const lock = round.bankLock;
    if (lock) {
      if (lock.stage === "player" && lock.playerId !== playerId) throw new Error("bank_locked");
      if (lock.stage === "banker") {
        const bankerId = this.getBankerId(round);
        if (bankerId && bankerId !== playerId) throw new Error("bank_locked");
      }
      if (lock.stage === "decision") throw new Error("banker_deciding");
    }
    this.ensureActiveTurn(round, playerId);
    const updated = handleStand(round, playerId);
    const processed = this.processBankLock(updated, roomRec);
    return this.persistRound(roundId, processed, round);
  }

  applySkip(roundId: string, playerId: string) {
    const round = this.rounds.get(roundId);
    if (!round) throw new Error("round_not_found");
    const roomRec = this.rooms.get(round.roomId);
    if (!roomRec) throw new Error("room_not_found");
    const lock = round.bankLock;
    if (lock) {
      const bankerId = this.getBankerId(round);
      if (lock.stage === "player") throw new Error("bank_locked");
      if (lock.stage === "banker" && bankerId && bankerId !== playerId) throw new Error("bank_locked");
      if (lock.stage === "decision") throw new Error("banker_deciding");
    }
    const updated = handleSkip(round, playerId);
    const processed = this.processBankLock(updated, roomRec);
    return this.persistRound(roundId, processed, round);
  }

  finalizeRound(roundId: string) {
    const round = this.rounds.get(roundId);
    if (!round) return { balances: [] as Balance[] };
    // The single chokepoint every round funnels through regardless of how
    // it ended (normal showdown, banker-end, or void-abandoned) -- see
    // ws-server.ts's handleRoundUpdate, which calls this exactly once per
    // round the instant its state reaches "terminate".
    metrics.recordRoundEnd(roundId);
    if (round.turnTimer) clearTimeout(round.turnTimer);
    if (round.timer) clearTimeout(round.timer);
    if (round.botTimer) clearTimeout(round.botTimer);
    const balances = calculateBalances(round.turns);
    this.rounds.delete(roundId);
    const roomRec = this.rooms.get(round.roomId);
    if (!roomRec?.room.practice) {
      void this.db?.deleteRound(roundId).catch((e) => console.error("db delete round", roundId, e));
    }
    if (roomRec) {
      // Carry the leftover shoe forward to the next round instead of
      // discarding it -- this is the only point where the round's deck is
      // still reachable before its record is deleted above.
      roomRec.deck = round.deck;
      roomRec.lastDeckCount = round.deckCount;
      roomRec.room.roundId = undefined;
      roomRec.room.balances = [...balances, ...roomRec.room.balances];
      roomRec.room.completedRounds = (roomRec.room.completedRounds ?? 0) + 1;
      // Practice rooms never touch Postgres and are throwaway sessions --
      // durable history has no value there, so skip building the entry at all.
      if (!roomRec.room.practice) {
        const entry = buildRoundHistoryEntry(round);
        roomRec.room.roundHistory = [entry, ...(roomRec.room.roundHistory ?? [])].slice(0, MAX_ROUND_HISTORY_ENTRIES);
      }
      balances.forEach((b) => {
        roomRec.room.wallets[b.payer] = (roomRec.room.wallets[b.payer] ?? 0) - b.amount;
        roomRec.room.wallets[b.payee] = (roomRec.room.wallets[b.payee] ?? 0) + b.amount;
      });
    }
    this.bumpRoomTimer(round.roomId);
    return { balances };
  }

  endRoundAfterBankDecision(roomId: string, bankerId: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, bankerId)) throw new Error("forbidden");
    const roundId = roomRec.room.roundId;
    if (!roundId) throw new Error("round_not_found");
    const round = this.rounds.get(roundId);
    if (!round) throw new Error("round_not_found");
    if (round.bankLock?.stage !== "decision") throw new Error("bank_not_in_decision");
    const resolved = calculateEndState(round.turns).map((turn) => {
      if (turn.player.type !== "admin" && (turn.state === "pending" || turn.state === "standby")) {
        return { ...turn, state: "skipped" as const };
      }
      return turn;
    });
    const updated: RoundContext = { ...round, turns: resolved, state: "terminate", bankLock: undefined };
    return this.persistRound(roundId, updated, round);
  }

  // Is the table stuck waiting on a banker who isn't coming back? Exported as
  // a read so clients can show the escape hatch only once it actually exists,
  // rather than offering a button that throws.
  //
  // "Stuck" is deliberately narrow. A banker being offline is not enough on
  // its own -- while it is still a player's turn the table can carry on
  // without them, and voiding then would let a seat wipe a round it simply
  // didn't like the look of. It has to be the banker's own go, with no timer
  // able to move it along, which is precisely the state that has no other exit.
  abandonedBankerInfo(roomId: string): { stuck: boolean; since?: number; eligibleAt?: number } {
    const roomRec = this.rooms.get(roomId);
    const roundId = roomRec?.room.roundId;
    const round = roundId ? this.rounds.get(roundId) : undefined;
    if (!roomRec || !round || round.state === "terminate") return { stuck: false };

    const bankerTurn = round.turns.find((turn) => turn.player.type === "admin");
    if (!bankerTurn) return { stuck: false };
    const banker = roomRec.room.players.find((p) => p.id === bankerTurn.player.id);
    if (!banker || banker.presence === "online" || banker.isBot) return { stuck: false };

    const waitingOnBanker =
      round.bankLock?.stage === "decision" ||
      round.bankLock?.stage === "banker" ||
      (round.state === "final" && bankerTurn.state === "pending") ||
      this.getActiveTurnId(round) === bankerTurn.player.id;
    if (!waitingOnBanker) return { stuck: false };

    const since = banker.offlineSince ?? Date.now();
    return { stuck: true, since, eligibleAt: since + BANKER_ABANDON_MS };
  }

  // The escape hatch a stranded table pulls itself out with. Any seated player
  // may call it, and the round is voided rather than settled: every chip this
  // round moved goes back where it came from, and no hand wins or loses. That
  // is the whole point -- a banker's phone dying is a technical failure, and a
  // technical failure must not decide who won money. Settling on the banker's
  // half-played hand would have done exactly that.
  voidAbandonedRound(roomId: string, actorId: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    const actor = roomRec.room.players.find((p) => p.id === actorId);
    if (!actor || actor.type === "spectator") throw new Error("forbidden");
    const roundId = roomRec.room.roundId;
    if (!roundId) throw new Error("round_not_found");
    const round = this.rounds.get(roundId);
    if (!round) throw new Error("round_not_found");

    const info = this.abandonedBankerInfo(roomId);
    if (!info.stuck) throw new Error("banker_not_absent");
    if (Date.now() < (info.eligibleAt ?? Infinity)) throw new Error("banker_not_absent_long_enough");

    // Put back everything this round already moved, newest first so a pair of
    // transfers between the same two seats unwinds in the order it was made.
    const refunded = [...(round.ledger ?? [])].reverse();
    for (const { payer, payee, amount } of refunded) {
      roomRec.room.wallets[payee] = (roomRec.room.wallets[payee] ?? 0) - amount;
      roomRec.room.wallets[payer] = (roomRec.room.wallets[payer] ?? 0) + amount;
    }
    // The room's own ledger keeps the reversals rather than deleting the
    // originals: what happened, and that it was undone, are both true.
    if (refunded.length > 0) {
      roomRec.room.balances = [
        ...refunded.map((b) => ({ amount: b.amount, payer: b.payee, payee: b.payer })),
        ...roomRec.room.balances,
      ];
    }
    const bankerId = this.getBankerId(round);
    if (bankerId) roomRec.room.bankerBuyIn = roomRec.room.wallets[bankerId] ?? roomRec.room.bankerBuyIn;

    // Every seat lands on "skipped", which is already the one state
    // calculateBalances refuses to pay out on -- so the ordinary finalize path
    // that follows settles nothing, with no special case threaded through it.
    const voidedTurns = round.turns.map((turn) => ({
      ...turn,
      state: "skipped" as const,
      bet: 0,
      settledBet: 0,
      settledNet: undefined,
      settled: false,
      bankRequest: false,
    }));
    const updated: RoundContext = {
      ...round,
      turns: voidedTurns,
      state: "terminate",
      bankLock: undefined,
      ledger: [],
      voided: true,
    };
    this.audit("void-abandoned-round", roomId, actorId, { roundId, refunded: refunded.length });
    return this.persistRound(roundId, updated, round);
  }

  requestRename(roomId: string, playerId: string, firstName: string, lastName?: string): RenameRequest {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    const player = roomRec.room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("player_not_found");
    if (player.type === "admin") throw new Error("forbidden");
    if (roomRec.room.renameBlockedIds.includes(playerId)) throw new Error("rename_blocked");
    const trimmedFirst = this.sanitizeName(firstName);
    if (!trimmedFirst) throw new Error("invalid_payload");
    const trimmedLast = this.sanitizeName(lastName);
    const request: RenameRequest = {
      playerId,
      firstName: trimmedFirst,
      lastName: trimmedLast,
      requestedAt: Date.now(),
    };
    const remaining = roomRec.room.renameRequests.filter((req) => req.playerId !== playerId);
    roomRec.room.renameRequests = [...remaining, request];
    this.bumpRoomTimer(roomId);
    return request;
  }

  approveRename(roomId: string, adminId: string, targetPlayerId: string): RoundContext | undefined {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    const request = roomRec.room.renameRequests.find((req) => req.playerId === targetPlayerId);
    if (!request) throw new Error("request_not_found");

    roomRec.room.players = roomRec.room.players.map((player) =>
        player.id === targetPlayerId
          ? { ...player, firstName: this.sanitizeName(request.firstName), lastName: this.sanitizeName(request.lastName) }
          : player
    );
    roomRec.room.renameRequests = roomRec.room.renameRequests.filter((req) => req.playerId !== targetPlayerId);

    const roundId = roomRec.room.roundId;
    let updatedRound: RoundContext | undefined;
    if (roundId) {
      const round = this.rounds.get(roundId);
      if (round) {
        const turns = round.turns.map((turn) =>
          turn.player.id === targetPlayerId
              ? {
                  ...turn,
                  player: { ...turn.player, firstName: this.sanitizeName(request.firstName), lastName: this.sanitizeName(request.lastName) },
                }
            : turn
        );
        updatedRound = this.persistRound(roundId, { ...round, turns }, round);
      }
    }
      this.audit("rename-approve", roomId, adminId, { target: targetPlayerId });
    this.bumpRoomTimer(roomId);
    return updatedRound;
  }

  rejectRename(roomId: string, adminId: string, targetPlayerId: string): void {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    const exists = roomRec.room.renameRequests.some((req) => req.playerId === targetPlayerId);
    if (!exists) throw new Error("request_not_found");
    roomRec.room.renameRequests = roomRec.room.renameRequests.filter((req) => req.playerId !== targetPlayerId);
      this.audit("rename-reject", roomId, adminId, { target: targetPlayerId });
    this.bumpRoomTimer(roomId);
  }

  cancelRename(roomId: string, playerId: string): void {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    const exists = roomRec.room.renameRequests.some((req) => req.playerId === playerId);
    if (!exists) throw new Error("request_not_found");
    roomRec.room.renameRequests = roomRec.room.renameRequests.filter((req) => req.playerId !== playerId);
    this.bumpRoomTimer(roomId);
  }

  setRenameBlock(roomId: string, adminId: string, targetPlayerId: string, block: boolean): void {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    if (!roomRec.room.players.some((p) => p.id === targetPlayerId)) throw new Error("player_not_found");
    const blocked = new Set(roomRec.room.renameBlockedIds);
    if (block) {
      blocked.add(targetPlayerId);
      roomRec.room.renameRequests = roomRec.room.renameRequests.filter((req) => req.playerId !== targetPlayerId);
    } else {
      blocked.delete(targetPlayerId);
    }
    roomRec.room.renameBlockedIds = Array.from(blocked);
    this.bumpRoomTimer(roomId);
  }

  requestBuyIn(roomId: string, playerId: string, amount: number, note?: string): BuyInRequest {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    const player = roomRec.room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("player_not_found");
    if (player.type === "admin") throw new Error("forbidden");
    if (roomRec.room.buyInBlockedIds.includes(playerId)) throw new Error("buyin_blocked");
    const normalizedAmount = Math.round(Number(amount));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) throw new Error("invalid_payload");
    const request: BuyInRequest = {
      playerId,
      amount: normalizedAmount,
      requestedAt: Date.now(),
      note: this.sanitizeNote(note),
    };
    const remaining = roomRec.room.buyInRequests.filter((req) => req.playerId !== playerId);
    roomRec.room.buyInRequests = [...remaining, request];
    this.bumpRoomTimer(roomId);
    return request;
  }

  approveBuyIn(roomId: string, adminId: string, targetPlayerId: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    const request = roomRec.room.buyInRequests.find((req) => req.playerId === targetPlayerId);
    if (!request) throw new Error("request_not_found");

    const currentWallet = roomRec.room.wallets[targetPlayerId] ?? 0;
    roomRec.room.wallets[targetPlayerId] = currentWallet + request.amount;
    roomRec.room.buyInRequests = roomRec.room.buyInRequests.filter((req) => req.playerId !== targetPlayerId);
    this.audit("buyin-approve", roomId, adminId, { target: targetPlayerId, amount: request.amount });
    this.bumpRoomTimer(roomId);
    return { playerId: targetPlayerId, amount: request.amount };
  }

  rejectBuyIn(roomId: string, adminId: string, targetPlayerId: string): void {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    const exists = roomRec.room.buyInRequests.some((req) => req.playerId === targetPlayerId);
    if (!exists) throw new Error("request_not_found");
    roomRec.room.buyInRequests = roomRec.room.buyInRequests.filter((req) => req.playerId !== targetPlayerId);
    this.audit("buyin-reject", roomId, adminId, { target: targetPlayerId });
    this.bumpRoomTimer(roomId);
  }

  cancelBuyIn(roomId: string, playerId: string): void {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    const exists = roomRec.room.buyInRequests.some((req) => req.playerId === playerId);
    if (!exists) throw new Error("request_not_found");
    roomRec.room.buyInRequests = roomRec.room.buyInRequests.filter((req) => req.playerId !== playerId);
    this.bumpRoomTimer(roomId);
  }

  setBuyInBlock(roomId: string, adminId: string, targetPlayerId: string, block: boolean): void {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    if (!roomRec.room.players.some((p) => p.id === targetPlayerId)) throw new Error("player_not_found");
    const blocked = new Set(roomRec.room.buyInBlockedIds);
    if (block) {
      blocked.add(targetPlayerId);
      roomRec.room.buyInRequests = roomRec.room.buyInRequests.filter((req) => req.playerId !== targetPlayerId);
    } else {
      blocked.delete(targetPlayerId);
    }
    roomRec.room.buyInBlockedIds = Array.from(blocked);
    this.bumpRoomTimer(roomId);
  }

  topUpBanker(roomId: string, adminId: string, amount: number, note?: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    if (!this.isAdmin(roomId, adminId)) throw new Error("forbidden");
    const normalized = Math.round(Number(amount));
    if (!Number.isFinite(normalized) || normalized === 0) throw new Error("invalid_payload");
    const wallet = roomRec.room.wallets[adminId] ?? 0;
    const nextWallet = wallet + normalized;
    if (nextWallet < 0) throw new Error("insufficient_bank");

    // If this top-up needs to draw a card to resume a stuck BANK! decision,
    // draw it BEFORE committing the wallet change -- deck_empty must fail
    // the whole top-up atomically (see round.ts's drawCard) rather than
    // applying the chips while leaving the decision stuck with no card
    // drawn, which the banker would have no clean way to retry into.
    const roundId = roomRec.room.roundId;
    const roundCtx = roundId ? this.rounds.get(roundId) : undefined;
    const bankerIndex = roundCtx?.turns.findIndex((turn) => turn.player.id === adminId) ?? -1;
    const needsResumeDraw = Boolean(roundCtx && roundCtx.bankLock?.stage === "decision" && bankerIndex >= 0 && nextWallet > 0);
    const nextCard = needsResumeDraw ? this.drawCard(roundCtx!) : undefined;

    roomRec.room.wallets[adminId] = nextWallet;
    roomRec.room.bankerBuyIn = nextWallet;
    this.bumpRoomTimer(roomId);
    const trimmedNote = this.sanitizeNote(note);

    if (needsResumeDraw && roundCtx) {
      roundCtx.turns[bankerIndex] = {
        ...roundCtx.turns[bankerIndex],
        cards: [nextCard!],
        state: "pending",
        bet: 0,
        bankRequest: false,
        settledNet: undefined,
      };
      roundCtx.bankLock = undefined;
      this.persistRound(roundId!, roundCtx);
    }
    this.audit("bank-topup", roomId, adminId, { amount: normalized, total: nextWallet, note: trimmedNote });
    return { amount: normalized, total: nextWallet, note: trimmedNote };
  }

  private computeBankWindow(round: RoundContext, room: RoomState, playerId: string) {
    const banker = round.turns.find((turn) => turn.player.type === "admin");
    if (!banker) throw new Error("banker_missing");
    const bankerId = banker.player.id;
    const bankerWallet = room.wallets[bankerId] ?? 0;
    const playerIndex = round.turns.findIndex((turn) => turn.player.id === playerId);
    if (playerIndex < 0) throw new Error("turn_not_found");
    const outstanding = round.turns
      .slice(0, playerIndex)
      .filter((turn) => turn.player.type !== "admin" && turn.state !== "lost" && turn.state !== "skipped" && !turn.settled)
      .reduce((sum, turn) => sum + (turn.bet ?? 0), 0);
    const available = Math.max(bankerWallet - outstanding, 0);
    return { available, outstanding, bankerId, playerIndex };
  }

  private getBankerId(round: RoundContext): string | undefined {
    return round.turns.find((turn) => turn.player.type === "admin")?.player.id;
  }

  private processBankLock(round: RoundContext, roomRec: RoomRecord): RoundContext {
    const lock = round.bankLock;
    if (!lock) return round;

    const playerTurn = round.turns[lock.throughIndex];
    if (!playerTurn || playerTurn.player.id !== lock.playerId) {
      round.bankLock = undefined;
      return round;
    }

    if (lock.stage === "player") {
      if (playerTurn.state === "lost") {
        round.bankLock = undefined;
        round.turns = round.turns.map((turn) =>
          turn.player.id === lock.playerId ? { ...turn, bankRequest: false } : turn
        );
        return round;
      }
      if (playerTurn.state !== "pending") {
        round.bankLock = { ...lock, stage: "banker" };
      }
      return round;
    }

    if (lock.stage === "banker") {
      const bankerId = this.getBankerId(round);
      if (!bankerId) {
        round.bankLock = undefined;
        return round;
      }
      const bankerTurn = round.turns.find((turn) => turn.player.id === bankerId);
      if (!bankerTurn) {
        round.bankLock = undefined;
        return round;
      }
      if (bankerTurn.state === "pending") return round;
      return this.settleBankOutcome(round, roomRec, lock, bankerTurn);
    }

    return round;
  }

  private settleBankOutcome(round: RoundContext, roomRec: RoomRecord, lock: BankLockState, bankerTurn: Turn): RoundContext {
    const bankerId = bankerTurn.player.id;
    // `!turn.settled` matters as much as the index bound: a table can run
    // through more than one BANK! lock in the same round, and without this
    // every seat an EARLIER frame already paid out gets swept back into
    // THIS frame's evaluation just because its index still sits at or below
    // the new throughIndex. That both double-counted the banker's
    // beat/lostTo tally (calculateEndState's own `alreadySettled` guard is
    // the other half of that fix) and, worse, would have overwritten their
    // real settledBet with 0 below -- see the turn-mapping's own comment.
    const involvedEntries = round.turns
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn, index }) => turn.player.type !== "admin" && index <= lock.throughIndex && !turn.settled);

    if (involvedEntries.length === 0) {
      round.bankLock = undefined;
      return round;
    }

    const evaluationInput = [...involvedEntries.map(({ turn }) => turn), bankerTurn];
    const resolved = calculateEndState(evaluationInput);
    const resolvedBanker = resolved.find((turn) => turn.player.type === "admin");
    if (!resolvedBanker) {
      round.bankLock = undefined;
      return round;
    }

    const balances = calculateBalances(resolved);
    const resolvedById = new Map(resolved.map((turn) => [turn.player.id, turn] as const));

    // A BANK! forces the banker to keep playing so the seats still to come
    // have a live bank to play against. When the wagering player was the LAST
    // one, there is nothing left to keep alive -- and dealing the banker a
    // fresh card anyway ended the round showing them mid-hand, holding a card
    // that settles nothing, with their own net wiped (settledNet is cleared
    // on the redeal). The round's state was already computed as "terminate"
    // by the action that got us here, and nothing below reopens it, so the
    // card was dealt straight into a finished round.
    // Seats at or below throughIndex are the ones this settlement just
    // resolved, so they're read from `resolved`, not from their pre-settlement
    // state.
    const seatsStillToPlay = round.turns.some((turn, index) => {
      if (turn.player.type === "admin") return false;
      const state = index <= lock.throughIndex ? resolvedById.get(turn.player.id)?.state ?? turn.state : turn.state;
      return state === "pending" || state === "standby";
    });

    // Work out whether this settlement leaves the banker able (and forced)
    // to keep auto-playing, and draw THAT card before committing anything
    // else. drawCard can now throw deck_empty (the banker chooses when to
    // reshuffle, not the server -- see round.ts's own drawCard), and if it
    // does, the whole settlement must stay a no-op: nobody paid, no turns
    // settled, bankLock untouched. Committing the payouts first and only
    // then discovering there's no card left would pay the wagering players
    // correctly but leave the round's own bankLock wedged in "banker" stage
    // with the banker's turn never advanced -- a real desync between the
    // room's wallets and the round's state, not just a failed action.
    const walletDelta = balances.reduce((sum, b) => {
      if (b.payer === bankerId) return sum - b.amount;
      if (b.payee === bankerId) return sum + b.amount;
      return sum;
    }, 0);
    const projectedBankerWallet = (roomRec.room.wallets[bankerId] ?? 0) + walletDelta;
    const bankerIndex = round.turns.findIndex((turn) => turn.player.id === bankerId);
    const willAutoRedeal = projectedBankerWallet > 0 && bankerIndex >= 0 && seatsStillToPlay;
    const nextCard = willAutoRedeal ? this.drawCard(round) : undefined;

    balances.forEach(({ payer, payee, amount }) => {
      roomRec.room.wallets[payer] = (roomRec.room.wallets[payer] ?? 0) - amount;
      roomRec.room.wallets[payee] = (roomRec.room.wallets[payee] ?? 0) + amount;
    });
    roomRec.room.bankerBuyIn = roomRec.room.wallets[bankerId] ?? roomRec.room.bankerBuyIn;
    if (balances.length > 0) {
      roomRec.room.balances = [...balances, ...roomRec.room.balances];
      round.ledger = [...(round.ledger ?? []), ...balances];
    }
    // Money just moved MID-round, which is the case finalizeRound's own
    // bumpRoomTimer doesn't cover: that only runs once a round reaches
    // "terminate", and this settlement leaves the round live. persistRound
    // (via the caller) writes the ROUND, but the room -- wallets, bankerBuyIn,
    // balances -- is only ever written by bumpRoomTimer. Without this, a
    // restart between here and the round's end restores a round whose turns
    // are already marked settled against a room whose wallets never got the
    // money, and calculateBalances deliberately skips settled turns, so the
    // payment is gone rather than merely late. Deliberately after the balances
    // append above, so the room object handed to saveRoom is already whole.
    this.bumpRoomTimer(roomRec.room.roomId);

    round.turns = round.turns.map((turn, index) => {
      if (turn.player.type === "admin") {
        if (turn.player.id !== bankerId) return turn;
        const outcome = resolvedById.get(bankerId);
        return {
          ...turn,
          state: outcome?.state ?? turn.state,
          bet: 0,
          settledNet: outcome?.bet,
        };
      }
      if (index > lock.throughIndex) return turn;
      const outcome = resolvedById.get(turn.player.id);
      if (!outcome) return turn;
      return {
        ...turn,
        state: outcome.state,
        settledBet: outcome.bet,
        bet: 0,
        bankRequest: outcome.player.id === lock.playerId ? true : turn.bankRequest,
        // Mirrors settleImmediateTurn's own marker (store.ts:787) -- without
        // it, a LATER BANK! lock's involvedEntries filter (above) has no way
        // to tell "already paid by an earlier frame" from "still live", and
        // would recompute this turn a second time: settledBet reset to 0
        // (this same outcome.bet, but outcome came from re-running
        // calculateEndState over a turn whose `bet` was already 0 by then)
        // and a second beat/lostTo point on the banker's tag.
        settled: true,
      };
    });

    if (!willAutoRedeal) {
      // Same two original outcomes, just distinguished after the fact:
      // wallet exhausted -> banker must decide; banker seat missing (should
      // not happen) -> nothing left to lock.
      round.bankLock = projectedBankerWallet <= 0 ? { ...lock, stage: "decision" } : undefined;
      return round;
    }

    // The redeal below overwrites the banker's turn before any broadcast
    // ever carries this frame's resolved hand -- stash it here so a client
    // can toast what just happened instead of only seeing the bank's wallet
    // total silently move (2026-08-10 bug hunt; see BankFrameResult in
    // types.ts). `resolvedBanker` already holds this frame's actual cards
    // (untouched by the redeal below) and the beat/lostTo this settlement
    // just computed for it.
    round.lastBankFrame = {
      bankerId,
      cards: resolvedBanker.cards,
      state: resolvedBanker.state,
      busted: resolvedBanker.busted,
      beat: resolvedBanker.beat,
      lostTo: resolvedBanker.lostTo,
      settledAt: Date.now(),
    };

    round.turns[bankerIndex] = {
      ...round.turns[bankerIndex],
      cards: [nextCard!],
      state: "pending",
      bet: 0,
      bankRequest: false,
      settledNet: undefined,
    };
    round.bankLock = undefined;
    return round;
  }

  // Draws one card from a round's live deck for the two banker-redeal paths
  // that live in this class (a BANK! wager's forced auto-play, and a
  // top-up mid-decision). Mirrors round.ts's own drawCard: does NOT
  // reshuffle on its own when the shoe is out -- see reshuffleDeck for the
  // banker's own mid-round path to bring in a fresh one.
  private drawCard(round: RoundContext): Card {
    if (round.deck.length === 0) throw new Error("deck_empty");
    const card = round.deck.shift();
    if (!card) throw new Error("deck_empty"); // unreachable given the length check above
    return card;
  }

  resumePlayer(roomId: string, playerId: string, token: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    const session = this.sessions.get(playerId);
    if (!session || session.roomId !== roomId || session.token !== token || session.expiresAt <= Date.now()) {
      this.sessions.delete(playerId);
      throw new Error("invalid_session");
    }
    const player = roomRec.room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("player_not_found");
    roomRec.room.players = roomRec.room.players.map((p) =>
      p.id === playerId ? { ...p, presence: "online" } : p
    );
    const updatedPlayer = roomRec.room.players.find((p) => p.id === playerId)!;
    const newToken = this.issueSession(roomId, playerId);
    this.bumpRoomTimer(roomId);
    return { player: updatedPlayer, sessionToken: newToken };
  }

  private issueSession(roomId: string, playerId: string) {
    const token = uuid();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(playerId, { token, roomId, expiresAt });
    return token;
  }

  private bumpRoomTimer(roomId: string) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) return;
    if (roomRec.timer) clearTimeout(roomRec.timer);
    roomRec.lastActivityAt = Date.now();
    // Practice rooms are throwaway, single-human sandboxes -- never worth a
    // Postgres write, and expire far sooner than a real game's 3 days.
    const isPractice = roomRec.room.practice === true;
    if (this.db && !isPractice) {
      const db = this.db;
      // Reads roomRec.room when its turn in the chain comes up, not now, so a
      // burst of writes collapses onto the newest state instead of replaying
      // stale snapshots over it.
      this.serializeWrite(`room:${roomId}`, () => db.saveRoom(roomId, roomRec.room));
    }
    roomRec.timer = setTimeout(() => {
      this.rooms.delete(roomId);
      void this.db?.deleteRoom(roomId).catch((e) => console.error("db delete room", roomId, e));
    }, isPractice ? PRACTICE_INACTIVITY_TIMEOUT_MS : INACTIVITY_TIMEOUT_MS);
  }

  // Admin tooling (backend/src/http-server.ts's token-gated /admin routes) --
  // deliberately bypasses the per-room isAdmin/banker check that closeRoom
  // enforces, since the HTTP layer's admin token is the actual gate here,
  // and the whole point is to free up a Game ID even when you're not (or no
  // longer) that room's own banker.
  listRoomsForAdmin(): AdminRoomSummary[] {
    return Array.from(this.rooms.entries()).map(([roomId, rec]) => ({
      roomId,
      name: rec.room.name,
      playerCount: rec.room.players.length,
      completedRounds: rec.room.completedRounds ?? 0,
      hasActiveRound: Boolean(rec.room.roundId),
      lastActivityAt: rec.lastActivityAt ?? Date.now(),
    }));
  }

  forceDeleteRoom(roomId: string): boolean {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) return false;
    if (roomRec.timer) clearTimeout(roomRec.timer);
    this.rooms.delete(roomId);
    this.audit("admin-force-delete", roomId, "admin", {});
    void this.db?.deleteRoom(roomId).catch((e) => console.error("db delete room (admin force)", roomId, e));
    return true;
  }

  async loadFromDB() {
    if (!this.db) return;
    try {
      const rows = await this.db.loadActiveRooms();
      for (const { roomId, roomState, rounds } of rows) {
        this.rooms.set(roomId, { room: roomState, nextStart: 0 });
        this.bumpRoomTimer(roomId);
        for (const { roundId, roundState } of rounds) {
          const ctx: RoundContext = {
            ...(roundState as any),
            timer: undefined,
            turnTimer: undefined,
          };
          this.persistRound(roundId, ctx);
        }
      }
      if (rows.length) console.log(`Restored ${rows.length} room(s) from database`);
    } catch (e) {
      console.error("Failed to load rooms from database", e);
    }
  }
}
