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
  // Frontend-only display hint: never sent by the live round:state/round:ended
  // WS flow (real turns always carry `cards` and derive bust-ness from them).
  // Only set when a Turn is synthesized from the server's compact, card-free
  // RoundHistoryEntry to backfill history for a fresh device/cleared cache.
  busted?: boolean;
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
  // Set whenever a fresh shoe was just shuffled in server-side -- diffed
  // against the previous round's value to show a one-time notice.
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

export interface ServerEnvelope<T = unknown> {
  type: string;
  roomId?: string;
  playerId?: string;
  requestId?: string;
  payload?: T;
  error?: { message: string; code?: string; details?: unknown };
}
