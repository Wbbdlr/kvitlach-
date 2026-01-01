export type PlayerType = "admin" | "player";
export type Presence = "online" | "offline";
export type TurnState = "pending" | "lost" | "won" | "standby" | "skipped";
export type RoundPhase = "playing" | "final" | "terminate";

export interface Card {
  name: string;
  attributes: {
    values: number[];
    type?: "rosier";
  };
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  type: PlayerType;
  presence: Presence;
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

export interface RoundState {
  roundId: string;
  roomId: string;
  deck: Card[];
  turns: Turn[];
  state: RoundPhase;
  deckCount?: number;
  roundNumber: number;
  bankLock?: BankLockState;
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
  completedRounds: number;
  renameRequests: RenameRequest[];
  buyInRequests: BuyInRequest[];
  waitingPlayerIds: string[];
  renameBlockedIds: string[];
  buyInBlockedIds: string[];
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
