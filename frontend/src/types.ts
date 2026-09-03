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
  // When this player went offline. Only the banker's is acted on: they have no
  // turn timer, so this is what tells the table how long it has been stranded.
  offlineSince?: number;
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
  // Set by the server on the BANKER's turn at settlement, and also used as a
  // display hint when a Turn is synthesized from the server's compact,
  // card-free RoundHistoryEntry (backfilling history on a fresh device).
  // A player's own bust is still derived from their cards.
  busted?: boolean;
  // Banker only: how many wagering players they beat and lost to. The banker
  // plays one hand against everyone, so their `state` alone can't say -- an 18
  // beats a 17 and loses to a 20 at the same time.
  beat?: number;
  lostTo?: number;
  // True/false (never the banker's automatic protection -- see backend
  // types.ts) reflecting whether THIS player had the Eleveroon checkbox on
  // for their most recent Bet/Hit. The real-table "calling it out" moment --
  // Seat.tsx flags it near their name while turn.state is still "pending".
  eleveroonCalled?: boolean;
}

export interface BankLockState {
  playerId: string;
  stage: "player" | "banker" | "decision";
  exposure: number;
  throughIndex: number;
  initiatedAt: number;
}

// A BANK! wager that leaves seats still waiting forces the banker straight
// into a fresh hand -- the server overwrites their turn with the redeal in
// the same update that computes the frame that just finished, so this rides
// alongside it (only ever present on a redeal) so the table can be told what
// the discarded frame actually did instead of just seeing the bank's wallet
// total move. `settledAt` is a timestamp, not a boolean, so it can be diffed
// the same way `deckReshuffledAt` is (state.ts's bankFrameNotification):
// fires once per actual frame, not once per later round:state broadcast
// that still carries the same value.
export interface BankFrameResult {
  bankerId: string;
  cards: Card[];
  state: TurnState;
  busted?: boolean;
  beat?: number;
  lostTo?: number;
  settledAt: number;
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
  // The round never finished -- the banker dropped and the table threw it
  // away. Every wager was returned, so every net is 0.
  voided?: boolean;
}

export interface RoundState {
  roundId: string;
  roomId: string;
  // How many cards are left in the shoe -- NOT the cards themselves. The
  // server deliberately never sends the deck (see its sanitizeRound): it's
  // held in dealing order, so shipping it would let any player read the next
  // cards out of devtools.
  deckRemaining?: number;
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
  // The table gave up on an absent banker and voided this round.
  voided?: boolean;
  // See BankFrameResult -- only present the instant a BANK! forces a redeal;
  // never cleared back to undefined afterward, so diff `settledAt`, not
  // presence, the same way deckReshuffledAt works.
  lastBankFrame?: BankFrameResult;
}

export interface RoomState {
  roomId: string;
  name?: string;
  // A scrypt hash, never the room's actual password -- see backend/src/types.ts's
  // identical field for why. Not human-readable; only ever used here to
  // derive a hasPassword boolean (RoomInfoDrawer), never displayed.
  passwordHash?: string;
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
