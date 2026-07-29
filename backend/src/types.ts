export type PlayerType = "admin" | "player" | "spectator";
export type Presence = "online" | "offline";
export type TurnState = "pending" | "lost" | "won" | "standby" | "skipped";
export type RoundPhase = "playing" | "final" | "terminate";

export interface Card {
  name: string;
  attributes: {
    values: number[];
    type?: "rosier";
    eleveroonIgnored?: boolean;
  };
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  type: PlayerType;
  presence: Presence;
  isBot?: boolean;
}

export interface RenameRequest {
  playerId: string;
  firstName: string;
  lastName: string;
  requestedAt: number;
}

export interface BuyInRequest {
  playerId: string;
  amount: number;
  requestedAt: number;
  note?: string;
}

export interface Turn {
  player: Player;
  state: TurnState;
  cards: Card[];
  bet: number;
  bankRequest?: boolean;
  settledBet?: number;
  settledNet?: number;
  settled?: boolean;
}

export interface BankLockState {
  playerId: string;
  stage: "player" | "banker" | "decision";
  exposure: number;
  throughIndex: number;
  initiatedAt: number;
}

export interface Balance {
  amount: number;
  payer: string;
  payee: string;
}

// Compact, durable per-round summary -- deliberately lighter than a full
// RoundState (no cards/deck), so it's cheap to keep capped and JSONB-stored
// on the room indefinitely. Practice rooms never produce these.
export interface RoundHistoryEntry {
  roundId: string;
  roundNumber: number;
  completedAt: number;
  entries: Array<{
    playerId: string;
    name: string;
    role: "admin" | "player";
    bet: number;
    net: number;
    outcome: TurnState;
    // Only meaningful when outcome === "lost": distinguishes an actual bust
    // from losing by comparison without busting (e.g. a standby hand beaten
    // by the banker's total) -- carried explicitly since this compact
    // summary drops the cards a client would otherwise derive it from.
    busted?: boolean;
  }>;
}

export interface RoundState {
  roundId: string;
  roomId: string;
  deck: Card[];
  turns: Turn[];
  state: RoundPhase;
  deckCount?: number;
  // Set whenever a fresh shoe was just shuffled in (either because the
  // carried-over deck ran out mid-round, or there wasn't enough left to
  // deal this round) -- clients diff this against the previous round's
  // value to show a one-time "fresh deck" notice, not a per-broadcast one.
  deckReshuffledAt?: number;
  roundNumber: number;
  bankLock?: BankLockState;
  turnTimerPlayerId?: string;
  turnTimerExpiresAt?: number;
  turnTimerDurationMs?: number;
}

export interface RoomState {
  roomId: string;
  name?: string;
  password?: string;
  buyIn: number;
  bankerBuyIn: number;
  wallets: Record<string, number>;
  players: Player[];
  roundId?: string;
  balances: Balance[];
  // Optional (not always present, unlike `balances`): rooms already persisted
  // in Postgres before this field existed come back from `loadFromDB()`
  // without it -- every read/write site defaults to `[]` rather than
  // assuming it's there.
  roundHistory?: RoundHistoryEntry[];
  completedRounds: number;
  renameRequests: RenameRequest[];
  buyInRequests: BuyInRequest[];
  waitingPlayerIds: string[];
  renameBlockedIds: string[];
  buyInBlockedIds: string[];
  feltWatermark?: string;
  practice?: boolean;
}

export interface ConnectionSummary {
  playerId: string;
  roomId: string;
  ip?: string;
  userAgent?: string;
  connectedAt?: number;
  lastSeenAt?: number;
}

export interface ReactionEvent {
  playerId: string;
  emoji: string;
  reactedAt: number;
}

export interface ClientEnvelope<T = unknown> {
  type: string;
  roomId?: string;
  playerId?: string;
  requestId?: string;
  payload?: T;
}

export interface ServerEnvelope<T = unknown> {
  type: string;
  roomId?: string;
  playerId?: string;
  requestId?: string;
  payload?: T;
  error?: { message: string; code?: string; details?: unknown };
}
