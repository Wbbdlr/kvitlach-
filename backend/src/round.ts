import { v4 as uuid } from "uuid";
import { newDeck, shuffle } from "./deck.js";
import { calcState, getSums, initializeTurns } from "./turn.js";
import { Balance, Card, Player, RoundHistoryEntry, RoundPhase, RoundState, Turn } from "./types.js";

const MAX_DECKS = 16;

export interface RoundContext extends RoundState {
  timer?: NodeJS.Timeout;
  turnTimer?: NodeJS.Timeout;
  turnTimerPlayerId?: string;
  turnTimerExpiresAt?: number;
  turnTimerDurationMs?: number;
  // Scheduled bot "thinking" delay -- only ever armed in a practice room,
  // where some seats are computer-driven (see GameStore.syncBotTurn).
  botTimer?: NodeJS.Timeout;
}

// Builds a fresh shuffled shoe of `deckCount` decks -- used both for a brand
// new room and for a reshuffle triggered by the shoe running out mid-play.
//
// Each newDeck() call is already its own fair Fisher-Yates shuffle, but
// concatenating deckCount of them and stopping there leaves rigid 24-card
// blocks: every deck-aligned window is guaranteed exactly 2-of-each-rank,
// which a genuinely mixed multi-deck shoe would NOT be (a real shoe's rank
// composition varies window to window, hypergeometrically). No single
// card's odds were biased by this -- each block's shuffle was still
// individually fair -- but it's a real structural deviation from "one
// shuffled shoe," and it's the common case: recommendedDeckCount() puts
// almost any table above 1 player onto a multi-deck shoe. One more
// shuffle() pass over the assembled shoe (itself still a uniform random
// permutation of whatever order it starts from) fixes it for free.
export function buildShoe(deckCount: number): Card[] {
  const decks: Card[][] = [];
  for (let i = 0; i < deckCount; i += 1) decks.push(newDeck());
  return shuffle(decks.flat());
}

// `existingDeck` carries the leftover shoe forward from the room's previous
// round (see GameStore.finalizeRound/startRound). At a real table, running
// low is something the DEALER notices and chooses to act on -- it never
// just happens to them mid-deal. So if there was a prior deck and it can't
// cover this round's seated players, this refuses to start rather than
// silently substitute a fresh shoe: the banker has to reshuffle first (see
// GameStore.reshuffleDeck), same action either way.
// A brand new room's very first round (existingDeck undefined -- nothing to
// have run low FROM) is exempt: there's no prior shoe for a dealer to have
// chosen to keep or replace, so this is just ordinary setup.
export function createRound(
  players: Player[],
  roomId: string,
  deckCountInput?: number,
  roundNumber = 1,
  existingDeck?: Card[],
  // One-shot signal from GameStore.reshuffleDeck's between-round path: the
  // deck it just built into existingDeck is one the banker deliberately
  // brought in, so THIS round gets the "fresh shoe!" notice -- not because
  // it happened to reshuffle, but because that's what the dealer just did.
  justReshuffled = false
): RoundContext {
  const deckCount = sanitizeDeckCount(deckCountInput ?? recommendedDeckCount(players.length));
  const hadPriorDeck = existingDeck !== undefined;
  let deck = existingDeck ?? [];
  if (deck.length < players.length) {
    if (hadPriorDeck) throw new Error("deck_low");
    deck = buildShoe(deckCount);
  }

  const { turns, deck: remaining } = initializeTurns(players, deck);

  return {
    roundId: uuid(),
    roomId,
    deck: remaining,
    turns,
    state: "playing",
    deckCount,
    roundNumber,
    deckReshuffledAt: justReshuffled ? Date.now() : undefined,
  };
}

// Draws one card. Does NOT reshuffle when the shoe has run out mid-round --
// that used to happen silently, swapping in a fresh shoe underneath a hand
// nobody agreed to reshuffle. The banker has to choose to do that (see
// GameStore.reshuffleDeck, which can now target a live round), so this just
// refuses the draw instead. Vanishingly rare in practice: the shoe is sized
// for a full session (see recommendedDeckCount), so reaching zero mid-hand
// means a table configured with an unusually small deck count, or an
// extraordinarily long hand.
function drawCard(state: RoundContext): { card: Card; deck: Card[] } {
  if (state.deck.length === 0) throw new Error("deck_empty");
  const [card, ...rest] = state.deck;
  return { card, deck: rest };
}

// Shared by handleBet and handleHit -- both draw a card into an existing
// hand, and the Eleveroon rule (docs/GAME_RULES.md) applies to either the
// same way: it doesn't matter which button drew the card. This used to live
// only in handleHit, which meant a player who bet more chips to draw
// (rather than plain-Hit) got zero Eleveroon protection even with the
// checkbox on -- the "Bet adds to the wager and deals a card" cumulative-bet
// mechanic (README) makes that the MORE common way to draw once a wager is
// already down, not an edge case. Factored out so the two draw paths can't
// drift apart on this again.
function applyEleveroonRule(existingCards: Card[], pickedCard: Card, eleveroonActive: boolean): Card {
  const isElevenCard = pickedCard.attributes.values?.includes(11);
  // Check every achievable total, not just the single best one -- a flexible
  // card (e.g. "12" has values [12,9,10]) can put 11 within reach even when
  // it isn't the highest-scoring reading of the hand (12+2 can be read as
  // 9+2=11, even though winningNumber(...) alone would report 12 or 14).
  const currentTotals = getSums(existingCards);
  const cardWouldBust = calcState([...existingCards, pickedCard]) === "lost";
  const shouldIgnoreEleven = Boolean(eleveroonActive && isElevenCard && cardWouldBust && currentTotals.includes(11));
  return shouldIgnoreEleven
    ? { ...pickedCard, attributes: { ...pickedCard.attributes, eleveroonIgnored: true } }
    : pickedCard;
}

export function handleBet(state: RoundContext, playerId: string, amount: number, options?: { eleveroon?: boolean }) {
  const turnIndex = state.turns.findIndex((t) => t.player.id === playerId);
  if (turnIndex < 0) throw new Error("turn_not_found");
  const turn = state.turns[turnIndex];
  if (state.state === "terminate") throw new Error("round_terminated");
  if (turn.state !== "pending") throw new Error("turn_not_pending");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid_bet");
  const { card: pickedCard, deck: remainingDeck } = drawCard(state);

  const eleveroonRequested = Boolean(options?.eleveroon);
  const eleveroonActive = eleveroonRequested || turn.player.type === "admin";
  const effectiveCard = applyEleveroonRule(turn.cards, pickedCard, eleveroonActive);

  const newBet = turn.bet + amount;

  const updatedTurn: Turn = {
    ...turn,
    bet: newBet,
    // Keep the first card as the leftmost and append new cards to the right
    cards: [...turn.cards, effectiveCard],
    state: calcState([...turn.cards, effectiveCard]),
    // Overwritten every action (see types.ts) -- the raw request, not
    // eleveroonActive, so the banker's always-on protection above never
    // shows up as something they "called".
    eleveroonCalled: eleveroonRequested,
  };

  const turns = state.turns.map((t, idx) => (idx === turnIndex ? updatedTurn : t));
  return advanceState({ ...state, turns, deck: remainingDeck });
}

export function handleHit(state: RoundContext, playerId: string, options?: { eleveroon?: boolean }) {
  const turnIndex = state.turns.findIndex((t) => t.player.id === playerId);
  if (turnIndex < 0) throw new Error("turn_not_found");
  const turn = state.turns[turnIndex];
  if (state.state === "terminate") throw new Error("round_terminated");
  if (turn.state !== "pending") throw new Error("turn_not_pending");
  const { card: pickedCard, deck: remainingDeck } = drawCard(state);

  const eleveroonRequested = Boolean(options?.eleveroon);
  const eleveroonActive = eleveroonRequested || turn.player.type === "admin";
  const effectiveCard = applyEleveroonRule(turn.cards, pickedCard, eleveroonActive);

  const cards = [...turn.cards, effectiveCard];
  let nextState = calcState(cards);

  // A blatt draw (no wager) risks nothing, so it can never cost the player
  // money -- but it also can't be played on past 21. Once the hand is that
  // high there's no move left: betting deals another card, which would futch
  // it. So the turn ends here rather than leaving a hand nobody can do
  // anything with still live, drawing wasted cards.
  let blattPush = false;
  if (turn.player.type !== "admin" && (turn.bet ?? 0) === 0) {
    const bestTotal = winningNumber(cards);
    if (bestTotal === undefined) {
      // Overshot 21 on a free card -- no harm done, but nothing left to play.
      blattPush = true;
      nextState = "won"; // resolved at $0, which reads as PUSH (see isPushTurn)
    } else if (nextState === "pending" && bestTotal >= 20) {
      nextState = "standby";
    }
  }

  const updatedTurn: Turn = {
    ...turn,
    // Preserve chronological order: earlier cards stay on the left
    cards,
    state: nextState,
    settledBet: blattPush ? 0 : turn.settledBet,
    // See handleBet's identical field -- overwritten every action.
    eleveroonCalled: eleveroonRequested,
  };

  const turns = state.turns.map((t, idx) => (idx === turnIndex ? updatedTurn : t));
  return advanceState({ ...state, turns, deck: remainingDeck });
}

export function handleStand(state: RoundContext, playerId: string) {
  const turnIndex = state.turns.findIndex((t) => t.player.id === playerId);
  if (turnIndex < 0) throw new Error("turn_not_found");
  const turn = state.turns[turnIndex];
  if (turn.state !== "pending") throw new Error("turn_not_pending");
  const isPush = turn.player.type !== "admin" && (turn.bet ?? 0) === 0;
  const updatedTurn: Turn = {
    ...turn,
    state: isPush ? "won" : "standby",
    settledBet: isPush ? 0 : turn.settledBet,
  };
  const turns = state.turns.map((t, idx) => (idx === turnIndex ? updatedTurn : t));
  return advanceState({ ...state, turns });
}

export function handleSkip(state: RoundContext, playerId: string) {
  const turnIndex = state.turns.findIndex((t) => t.player.id === playerId);
  if (turnIndex < 0) throw new Error("turn_not_found");
  const turn = state.turns[turnIndex];
  if (turn.state !== "pending") throw new Error("turn_not_pending");
  const updatedTurn: Turn = { ...turn, state: "skipped" };
  const turns = state.turns.map((t, idx) => (idx === turnIndex ? updatedTurn : t));
  return advanceState({ ...state, turns });
}

function advanceState(state: RoundContext): RoundContext {
  const gameState = getGameState(state.turns);

  if (gameState === "terminate") {
    const turns = calculateEndState(state.turns);
    return { ...state, state: "terminate", turns };
  }

  if (gameState === "final") {
    const playersAwaitingBanker = state.turns.some(
      (turn) => turn.player.type !== "admin" && turn.state === "standby"
    );
    if (!playersAwaitingBanker) {
      const turns = calculateEndState(state.turns);
      return { ...state, state: "terminate", turns };
    }
    return { ...state, state: "final" };
  }

  return { ...state, state: gameState };
}

function sanitizeDeckCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(1, Math.floor(count)), MAX_DECKS);
}

// How many rounds one shoe should comfortably cover before it needs a fresh
// shuffle. The shoe used to be sized for a SINGLE round, which was right when
// every round dealt itself a brand new deck -- but the deck now carries over
// between rounds, so that sizing meant a 7-player table burned through its
// one 24-card deck in well under a round and reshuffled constantly.
const TARGET_ROUNDS_PER_SHOE = 8;
// Measured, not guessed: simulating hands against the real deck puts the
// average at ~3.3 cards each, so 4 leaves headroom for a table full of long
// hands without making the shoe absurd.
const ASSUMED_CARDS_PER_HAND = 4;
// A real Kvitlach deck: identical pairs numbered 1-12, 2 copies of each (see
// deck.ts's newDeck) -- not a standard playing-card deck.
const CARDS_PER_DECK = 24;

export function recommendedDeckCount(playerCount: number): number {
  const seats = Math.max(1, playerCount); // includes the banker
  const assumedCards = seats * ASSUMED_CARDS_PER_HAND * TARGET_ROUNDS_PER_SHOE;
  return sanitizeDeckCount(Math.ceil(assumedCards / CARDS_PER_DECK));
}

export function getGameState(turns: Turn[]): RoundPhase {
  const pendingTurns = turns.filter((t) => t.state === "pending" && t.player.type !== "admin");
  const adminTurn = turns.find((t) => t.player.type === "admin");
  const standing = turns.filter((t) => t.state === "standby");
  const resolvedPlayers = turns.filter((t) => t.player.type !== "admin" && t.state !== "pending");

  if (!adminTurn) return "terminate";

  // If all non-admin turns are resolved (won/lost/standby/skipped) and banker is still pending, move to final.
  if (pendingTurns.length === 0 && resolvedPlayers.length > 0 && adminTurn.state === "pending") return "final";
  if (pendingTurns.length === 0) return "terminate";
  return "playing";
}

export function calculateEndState(turns: Turn[]): Turn[] {
  const adminTurn = turns.find((t) => t.player.type === "admin");
  const playerTurns = turns.filter((t) => t.player.type !== "admin");
  if (!adminTurn) return turns;

  let adminBalance = 0;
  // Counted separately from adminBalance: money and head-to-head results are
  // different questions. One big wager lost can leave the banker behind on
  // the round while they still beat most of the table.
  let beat = 0;
  let lostTo = 0;
  const resolvedPlayers = new Map<string, Turn>();

  playerTurns.forEach((turn) => {
    const actualState = calcState(turn.cards);
    // Nothing at stake means nothing to win or lose: a hand played entirely
    // as blatt draws settles as a push whatever the cards ended up saying,
    // so neither a busted total nor the banker comparison may relabel it.
    // (Both money branches below move $0 for these either way -- this is
    // about not telling a player they LOST a hand they never wagered on.)
    const noWager = (turn.bet ?? 0) === 0 && (turn.settledBet ?? 0) === 0;
    // A turn can arrive here already fully paid by an EARLIER settlement --
    // store.ts's settleBankOutcome resets `bet` to 0 the moment it pays a
    // seat out, but keeps `settledBet` so noWager (above) still reads this
    // as a real result instead of collapsing it into a push on the next
    // recompute (a later BANK! frame in the same round, or the round's own
    // final settlement, both run this function again over every turn, not
    // just the ones still live). That combination -- nothing left at stake
    // NOW, but something real paid out BEFORE -- means this turn's
    // beat/lostTo point was already counted the first time it settled, so
    // it must not add a second one here (2026-08-10 bug hunt: a second
    // BANK! lock was inflating the banker's BEAT/LOST TO tag by re-counting
    // every seat an earlier frame had already resolved).
    const alreadySettled = (turn.bet ?? 0) === 0 && (turn.settledBet ?? 0) !== 0;
    let resolvedState = noWager
      ? turn.state === "skipped"
        ? "skipped"
        : "won" // $0 win == push
      : turn.state === "standby"
        ? playerWon(adminTurn, turn)
          ? "won"
          : "lost"
        : turn.state;

    if (!noWager && actualState === "lost") resolvedState = "lost";
    if (!noWager && actualState === "won") resolvedState = "won";

    if (resolvedState === "won") adminBalance -= turn.bet;
    if (resolvedState === "lost") adminBalance += turn.bet;

    // Only hands with something at stake are a head-to-head result -- a blatt
    // pushes, it doesn't beat anyone -- and an already-settled turn (see
    // alreadySettled above) already contributed its point the first time.
    if (!noWager && !alreadySettled) {
      if (resolvedState === "won") lostTo += 1;
      else if (resolvedState === "lost") beat += 1;
    }

    resolvedPlayers.set(turn.player.id, { ...turn, state: resolvedState });
  });

  const adminActualState = calcState(adminTurn.cards);
  let adminState: Turn["state"];
  if (adminActualState === "lost") adminState = "lost";
  else if (adminActualState === "won") adminState = "won";
  else if (adminBalance < 0) adminState = "lost";
  else adminState = "standby";

  const adminResolved: Turn = {
    ...adminTurn,
    state: adminState,
    bet: adminBalance,
    // Note this is NOT the same question as `state === "lost"`: that branch
    // above also fires when the banker merely finishes the round down on
    // money. Clients need the real answer for the futch tag and its sound.
    busted: adminActualState === "lost",
    beat,
    lostTo,
  };

  return turns.map((turn) => {
    if (turn.player.type === "admin") return adminResolved;
    return resolvedPlayers.get(turn.player.id) ?? turn;
  });
}

export function calculateBalances(turns: Turn[]): Balance[] {
  const adminTurn = turns.find((t) => t.player.type === "admin");
  const playerTurns = turns.filter((t) => t.player.type !== "admin" && t.state !== "skipped" && !t.settled);
  if (!adminTurn) return [];

  return playerTurns.map((turn) => {
    if (turn.state === "lost") return { amount: turn.bet, payer: turn.player.id, payee: adminTurn.player.id };
    return { amount: turn.bet, payer: adminTurn.player.id, payee: turn.player.id };
  });
}

// Built from turns AFTER calculateEndState has resolved them (round.ts's
// finalizeRound calls this last) -- an admin turn's `bet` already holds its
// signed net balance at that point, so its `net` is just that value, not a
// won/lost branch like a player turn needs. Uses `settledBet` over `bet` for
// a player where available since that's the amount actually paid out live
// (mid-round bust/natural-21), not whatever `bet` grew to afterward.
export function buildRoundHistoryEntry(round: RoundContext): RoundHistoryEntry {
  const entries = round.turns.map((turn) => {
    const role: "admin" | "player" = turn.player.type === "admin" ? "admin" : "player";
    const amount = turn.settledBet ?? turn.bet;
    const net = role === "admin" ? amount : turn.state === "won" ? amount : turn.state === "lost" ? -amount : 0;
    const busted = turn.state === "lost" ? winningNumber(turn.cards) === undefined : undefined;
    return {
      playerId: turn.player.id,
      name: `${turn.player.firstName} ${turn.player.lastName}`.trim(),
      role,
      bet: turn.bet,
      net,
      outcome: turn.state,
      busted,
    };
  });
  return {
    roundId: round.roundId,
    roundNumber: round.roundNumber,
    completedAt: Date.now(),
    entries,
    ...(round.voided ? { voided: true } : {}),
  };
}

export function playerWon(adminTurn: Turn, playerTurn: Turn): boolean {
  const playerTotal = winningNumber(playerTurn.cards);
  const adminTotal = winningNumber(adminTurn.cards);
  if (playerTotal === undefined) return false;
  if (adminTotal === undefined) return true;
  // Higher total wins; ties go to the banker.
  return playerTotal > adminTotal;
}

function isRosierPair(cards: Card[]): boolean {
  return cards.length === 2 && cards.every((card) => card.attributes.type === "rosier");
}

export function winningNumber(cards: Card[]): number | undefined {
  if (isRosierPair(cards)) return 21;
  return getSums(cards)
    .filter((sum) => sum <= 21)
    .sort((a, b) => b - a)
    .at(0);
}
