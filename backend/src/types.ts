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
  // When this player last went offline. Only the banker's actually matters:
  // the table cannot proceed without them and they have no turn timer (they
  // are the dealer, not a seat being waited on), so this is what tells the
  // remaining players how long they have been stranded -- see
  // GameStore.voidAbandonedRound.
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
  // The banker's `state` has to carry their MONEY result (they can finish
  // behind on the round holding a perfectly good hand), so it can't also say
  // whether they futched -- these three keep the two apart.
  //   busted: the hand itself went over 21.
  //   beat / lostTo: how many wagering players the banker beat and lost to.
  // A banker plays one hand against the whole table at once, so a single
  // WON/LOST tag is a category error: 18 beats a 17 and loses to a 20 in the
  // same breath, which read to players as "the bank lost to my 17".
  busted?: boolean;
  beat?: number;
  lostTo?: number;
  // Set by handleBet/handleHit from the RAW `options?.eleveroon` the client
  // sent for its most recent Bet/Hit -- true or false either way, overwritten
  // every action, regardless of whether the rule actually needed to save
  // anything that draw. This is the real-table "I'm calling Eleveroon!"
  // moment: a player announces it before seeing the card, the same as here.
  // Deliberately NOT the derived eleveroonActive the round logic itself uses
  // (that's also unconditionally true for the banker, who never toggles
  // anything -- see round.ts's applyEleveroonRule) -- this field is only
  // ever true when a PLAYER explicitly checked the box for that action, so
  // clients can flag it near their seat without falsely tagging the
  // banker's always-on protection as something they "called".
  eleveroonCalled?: boolean;
  // The index in `cards` where this player's first real wager landed --
  // i.e. `cards[betStartIndex]` is the first card drawn AFTER `bet` left
  // zero, not the free "blatt" draws before it. Set once, by handleBet, and
  // never touched again for the rest of the turn.
  //
  // Exists purely so ws-server.ts's redaction (concealedRoundFor) can tell a
  // still-visible blatt card from a hidden wagered one without re-deriving
  // it. The frontend used to infer the same boundary itself, client-side, by
  // watching for the moment `bet` first went positive (App.tsx's
  // firstBetCardIndex) -- which works for a client that was connected to see
  // the transition happen, and silently hides the whole hand for one that
  // joined or resumed after it (a real, pre-existing display quirk, left as
  // is). The server does not have that blind spot: it sees every mutation,
  // so recording the boundary here is exact regardless of when any given
  // viewer connected.
  betStartIndex?: number;
}

export interface BankLockState {
  playerId: string;
  stage: "player" | "banker" | "decision";
  exposure: number;
  throughIndex: number;
  initiatedAt: number;
}

// A BANK! wager that still leaves seats waiting forces the banker straight
// into a fresh hand -- store.ts's settleBankOutcome pays out the frame that
// just finished and OVERWRITES the banker's turn with the redeal in the same
// call, so no ordinary round:state broadcast ever carries the resolved
// hand/score on its own (2026-08-10 bug hunt -- see TASKS.md). This rides
// alongside that fresh hand specifically so a client can toast what the
// discarded frame actually did. `settledAt` is a timestamp, not a boolean,
// so it can be diffed the same way `deckReshuffledAt` is: fires once per
// actual frame, not once per later round:state broadcast that still carries
// the same value. Only ever set when a redeal happens -- a BANK! that
// terminates the round normally already reaches the client on its own turn
// object, nothing extra needed.
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
  // The round never finished: the banker dropped out and the table voided it
  // rather than wait. Every wager was returned, so every net here is 0 -- the
  // flag is what stops the history reading like a round where nobody bet.
  voided?: boolean;
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
  // Every chip this round has already moved, in the order it moved. Rounds
  // settle as they go (a bust or a natural 21 pays out the moment it happens,
  // and a BANK! wager settles the seats it covered), so by the time a round is
  // abandoned some money has usually changed hands already. Voiding has to put
  // ALL of it back, and reconstructing that from the turns afterwards is
  // guesswork -- their states get rewritten by the very settlements being
  // undone. Recording it as it happens is the only version that can't drift.
  ledger?: Balance[];
  // The table gave up on an absent banker and threw this round away. Every
  // wager was returned; no hand won or lost.
  voided?: boolean;
  // See BankFrameResult -- only present the instant a BANK! forces a redeal,
  // cleared again by the next actual frame's own value (never unset back to
  // undefined, so clients must diff `settledAt`, not presence, the same way
  // deckReshuffledAt works).
  lastBankFrame?: BankFrameResult;
}

// What a client is actually allowed to see of a round. `deck` is the live
// shoe IN DEALING ORDER, so shipping it would hand every player the next
// cards -- they only ever needed the count behind the shoe badge, so that's
// all that crosses the wire. See WsServer.sanitizeRound, the single choke
// point every round payload passes through.
export type PublicRoundState = Omit<RoundState, "deck"> & { deckRemaining: number };

export interface RoomState {
  roomId: string;
  name?: string;
  // scrypt hash (admin-auth.ts's hashPassword/verifyPassword -- same
  // format and same reasoning as the admin panel's own credential), never
  // the room password itself. Stored raw plaintext once, compared with a
  // bare `!==`; a Postgres backup of this room -- and every room:state
  // broadcast, since nothing here is redacted per recipient -- carried it
  // in the clear. Undefined means the room has no password, same as before.
  passwordHash?: string;
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
