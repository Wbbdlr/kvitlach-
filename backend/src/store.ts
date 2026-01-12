import { v4 as uuid } from "uuid";
import { customAlphabet } from "nanoid";
import { createRound, handleBet, handleSkip, handleStand, calculateBalances, calculateEndState } from "./round.js";
import { handleHit } from "./round.js";
import { Balance, Player, RenameRequest, RoomState, RoundState, BuyInRequest, BankLockState, Turn, ConnectionSummary } from "./types.js";
import type { RoundContext } from "./round.js";
import type { Database } from "./db.js";

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const TURN_TIMEOUT_MS = 90 * 1000;
const MAX_NAME_LEN = 40;
const MAX_ROOM_NAME_LEN = 80;
const MAX_NOTE_LEN = 160;
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

  private sanitizeNote(value: string | undefined) {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, MAX_NOTE_LEN);
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

  private persistRound(roundId: string, next: RoundContext, prev?: RoundContext): RoundContext {
    const previous = prev ?? this.rounds.get(roundId);
    const withTimer = this.syncTurnTimer(roundId, next, previous);
    this.rounds.set(roundId, withTimer);
    return withTimer;
  }

    createRoom(admin: { firstName: string; lastName?: string; roomName?: string; password?: string; buyIn?: number; roomId?: string; bankerBankroll?: number }) {
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

    joinRoom(roomId: string, info: { firstName: string; lastName?: string; password?: string }) {
      const normalizedId = roomId.trim().toUpperCase();
      const roomRec = this.rooms.get(normalizedId);
    if (!roomRec) throw new Error("room_not_found");
    if (roomRec.room.password && roomRec.room.password !== info.password) throw new Error("invalid_password");
    const player: Player = {
      id: uuid(),
      firstName: this.sanitizeName(info.firstName),
      lastName: this.sanitizeName(info.lastName),
      type: "player",
      presence: "online",
    };
    roomRec.room.players.push(player);
    roomRec.room.wallets[player.id] = roomRec.room.buyIn;
    if (roomRec.room.roundId && this.rounds.has(roomRec.room.roundId)) {
      roomRec.room.waitingPlayerIds = [...new Set([...roomRec.room.waitingPlayerIds, player.id])];
    }
      this.bumpRoomTimer(roomRec.room.roomId);
    const sessionToken = this.issueSession(roomRec.room.roomId, player.id);
    return { room: roomRec.room, player, sessionToken };
  }

  setPresence(roomId: string, playerId: string, presence: Player["presence"]) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) return;
    roomRec.room.players = roomRec.room.players.map((p) =>
      p.id === playerId ? { ...p, presence } : p
    );
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

  startRound(roomId: string, deckCount?: number) {
    const roomRec = this.rooms.get(roomId);
    if (!roomRec) throw new Error("room_not_found");
    const activePlayers = roomRec.room.players.filter((p) => p.presence === "online");
    const basePlayers = activePlayers.length > 0 ? activePlayers : roomRec.room.players;
    const admin = basePlayers.find((p) => p.type === "admin");
    const others = basePlayers.filter((p) => p.type !== "admin");

    const startIndex = roomRec.nextStart ?? 0;
    const normalizedStart = others.length ? startIndex % others.length : 0;
    const rotated = others.length
      ? others.slice(normalizedStart).concat(others.slice(0, normalizedStart))
      : [];
    const playersForRound = admin ? rotated.concat(admin) : rotated;

    if (others.length > 0) {
      roomRec.nextStart = (normalizedStart + 1) % others.length;
    }
    if (playersForRound.length < 1) throw new Error("not_enough_players");
    const roundNumber = (roomRec.room.completedRounds ?? 0) + 1;
    const round = createRound(playersForRound, roomId, deckCount, roundNumber);
    const stored = this.persistRound(round.roundId, round);
    roomRec.room.roundId = stored.roundId;
    roomRec.room.waitingPlayerIds = [];
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

  applyBet(roundId: string, playerId: string, amount: number, options?: { bank?: boolean }) {
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

    const wallet = roomRec.room.wallets[playerId] ?? 0;
    const newBet = playerTurn.bet + amount;
    if (newBet > wallet) throw new Error("insufficient_funds");

    const { available, playerIndex } = this.computeBankWindow(round, roomRec.room, playerId);
    if (available <= 0) throw new Error("bank_empty");
    if (newBet > available) throw new Error(`bank_limit:${available}`);

    const updated = handleBet(round, playerId, amount);

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
    const updated = handleHit(round, playerId, { eleveroon: options?.eleveroon });
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
    if (round.turnTimer) clearTimeout(round.turnTimer);
    if (round.timer) clearTimeout(round.timer);
    const balances = calculateBalances(round.turns);
    this.rounds.delete(roundId);
    const roomRec = this.rooms.get(round.roomId);
    if (roomRec) {
      roomRec.room.roundId = undefined;
      roomRec.room.balances = [...balances, ...roomRec.room.balances];
      roomRec.room.completedRounds = (roomRec.room.completedRounds ?? 0) + 1;
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
    roomRec.room.wallets[adminId] = nextWallet;
    roomRec.room.bankerBuyIn = nextWallet;
    this.bumpRoomTimer(roomId);
    const trimmedNote = this.sanitizeNote(note);
    const roundId = roomRec.room.roundId;
    if (roundId) {
      const roundCtx = this.rounds.get(roundId);
      if (roundCtx && roundCtx.bankLock?.stage === "decision") {
        const bankerIndex = roundCtx.turns.findIndex((turn) => turn.player.id === adminId);
        if (bankerIndex >= 0 && nextWallet > 0) {
          const nextCard = roundCtx.deck.shift();
          if (!nextCard) throw new Error("deck_empty");
          roundCtx.turns[bankerIndex] = {
            ...roundCtx.turns[bankerIndex],
            cards: [nextCard],
            state: "pending",
            bet: 0,
            bankRequest: false,
            settledNet: undefined,
          };
          roundCtx.bankLock = undefined;
          this.persistRound(roundId, roundCtx);
        }
      }
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
      .filter((turn) => turn.player.type !== "admin" && turn.state !== "lost" && turn.state !== "skipped")
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
    const involvedEntries = round.turns
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn, index }) => turn.player.type !== "admin" && index <= lock.throughIndex);

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
    balances.forEach(({ payer, payee, amount }) => {
      roomRec.room.wallets[payer] = (roomRec.room.wallets[payer] ?? 0) - amount;
      roomRec.room.wallets[payee] = (roomRec.room.wallets[payee] ?? 0) + amount;
    });
    roomRec.room.bankerBuyIn = roomRec.room.wallets[bankerId] ?? roomRec.room.bankerBuyIn;
    if (balances.length > 0) {
      roomRec.room.balances = [...balances, ...roomRec.room.balances];
    }

    const resolvedById = new Map(resolved.map((turn) => [turn.player.id, turn] as const));
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
      };
    });

    const bankerWallet = roomRec.room.wallets[bankerId] ?? 0;
    if (bankerWallet <= 0) {
      round.bankLock = { ...lock, stage: "decision" };
      return round;
    }

    const bankerIndex = round.turns.findIndex((turn) => turn.player.id === bankerId);
    if (bankerIndex < 0) {
      round.bankLock = undefined;
      return round;
    }
    const nextDeck = [...round.deck];
    const nextCard = nextDeck.shift();
    if (!nextCard) throw new Error("deck_empty");
    round.turns[bankerIndex] = {
      ...round.turns[bankerIndex],
      cards: [nextCard],
      state: "pending",
      bet: 0,
      bankRequest: false,
      settledNet: undefined,
    };
    round.deck = nextDeck;
    round.bankLock = undefined;
    return round;
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
    roomRec.timer = setTimeout(() => {
      this.rooms.delete(roomId);
    }, INACTIVITY_TIMEOUT_MS);
  }
}
