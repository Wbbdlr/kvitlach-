import { v4 as uuid } from "uuid";
import { newDeck } from "./deck.js";
import { calcState, getSums, initializeTurns } from "./turn.js";
import { Balance, Card, Player, RoundPhase, RoundState, Turn } from "./types.js";

const TERMINATE_DELAY_FINAL_MS = 20000;
const TERMINATE_DELAY_SKIP_MS = 5000;
const MAX_DECKS = 16;

export interface RoundContext extends RoundState {
  timer?: NodeJS.Timeout;
}

export function createRound(players: Player[], roomId: string, deckCountInput?: number, roundNumber = 1): RoundContext {
  const deckCount = sanitizeDeckCount(deckCountInput ?? recommendedDeckCount(players.length));
  const decks: Card[][] = [];
  for (let i = 0; i < deckCount; i += 1) decks.push(newDeck());
  const deck = decks.flat();

  const { turns, deck: remaining } = initializeTurns(players, deck);

  return {
    roundId: uuid(),
    roomId,
    deck: remaining,
    turns,
    state: "playing",
    deckCount,
    roundNumber,
  };
}

export function handleBet(state: RoundContext, playerId: string, amount: number) {
  const turnIndex = state.turns.findIndex((t) => t.player.id === playerId);
  if (turnIndex < 0) throw new Error("turn_not_found");
  const turn = state.turns[turnIndex];
  if (state.state === "terminate") throw new Error("round_terminated");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid_bet");
  const [pickedCard, ...remainingDeck] = state.deck;
  if (!pickedCard) throw new Error("deck_empty");

  const newBet = turn.bet + amount;

  const updatedTurn: Turn = {
    ...turn,
    bet: newBet,
    // Keep the first card as the leftmost and append new cards to the right
    cards: [...turn.cards, pickedCard],
    state: calcState([...turn.cards, pickedCard]),
  };

  const turns = state.turns.map((t, idx) => (idx === turnIndex ? updatedTurn : t));
  return advanceState({ ...state, turns, deck: remainingDeck });
}

export function handleHit(state: RoundContext, playerId: string, options?: { eleveroon?: boolean }) {
  const turnIndex = state.turns.findIndex((t) => t.player.id === playerId);
  if (turnIndex < 0) throw new Error("turn_not_found");
  const turn = state.turns[turnIndex];
  if (state.state === "terminate") throw new Error("round_terminated");
  const [pickedCard, ...remainingDeck] = state.deck;
  if (!pickedCard) throw new Error("deck_empty");

  const priorTotal = winningNumber(turn.cards);
  const eleveroonActive = options?.eleveroon || turn.player.type === "admin";
  const isElevenCard = pickedCard.attributes.values?.includes(11);
  const cardWouldBust = calcState([...turn.cards, pickedCard]) === "lost";
  const shouldIgnoreEleven = Boolean(eleveroonActive && isElevenCard && priorTotal === 11 && cardWouldBust);

  const effectiveCard = shouldIgnoreEleven
    ? { ...pickedCard, attributes: { ...pickedCard.attributes, eleveroonIgnored: true } }
    : pickedCard;

  const cards = [...turn.cards, effectiveCard];
  let nextState = calcState(cards);

  if (turn.player.type !== "admin" && (turn.bet ?? 0) === 0) {
    const bestTotal = winningNumber(cards);
    if (bestTotal === undefined) {
      // Blatt draws (no wager) should not bust the player; let them keep drawing or bet later.
      nextState = "pending";
    } else if (nextState === "pending" && bestTotal >= 20) {
      nextState = "standby";
    }
  }

  const updatedTurn: Turn = {
    ...turn,
    // Preserve chronological order: earlier cards stay on the left
    cards,
    state: nextState,
  };

  const turns = state.turns.map((t, idx) => (idx === turnIndex ? updatedTurn : t));
  return advanceState({ ...state, turns, deck: remainingDeck });
}

export function handleStand(state: RoundContext, playerId: string) {
  const turnIndex = state.turns.findIndex((t) => t.player.id === playerId);
  if (turnIndex < 0) throw new Error("turn_not_found");
  const turn = state.turns[turnIndex];
  const isPush = turn.player.type !== "admin" && (turn.bet ?? 0) === 0;
  const updatedTurn: Turn = {
    ...turn,
    state: isPush ? "won" : "standby",
    settledBet: isPush ? 0 : turn.settledBet,
  };
  const turns = state.turns.map((t, idx) => (idx === turnIndex ? updatedTurn : t));
  return advanceState({ ...state, turns }, TERMINATE_DELAY_FINAL_MS);
}

export function handleSkip(state: RoundContext, playerId: string) {
  const turnIndex = state.turns.findIndex((t) => t.player.id === playerId);
  if (turnIndex < 0) throw new Error("turn_not_found");
  const turn = state.turns[turnIndex];
  const updatedTurn: Turn = { ...turn, state: "skipped" };
  const turns = state.turns.map((t, idx) => (idx === turnIndex ? updatedTurn : t));
  return advanceState({ ...state, turns }, TERMINATE_DELAY_SKIP_MS);
}

function advanceState(state: RoundContext, terminateDelay?: number): RoundContext {
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

function recommendedDeckCount(playerCount: number): number {
  // Assume up to six cards per player (including banker) plus a small buffer to keep large tables playable.
  const assumedCards = Math.max(1, playerCount) * 6 + 6;
  const decksNeeded = Math.ceil(assumedCards / 48);
  return sanitizeDeckCount(decksNeeded);
}

function scheduleTerminate(state: RoundContext, delayMs: number): RoundContext {
  if (state.timer) clearTimeout(state.timer);
  const timer = setTimeout(() => {
    // noop here; caller should manage cleanup; timer kept for reference
  }, delayMs);
  return { ...state, timer };
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
  const resolvedPlayers = new Map<string, Turn>();

  playerTurns.forEach((turn) => {
    const actualState = calcState(turn.cards);
    let resolvedState = turn.state === "standby" ? (playerWon(adminTurn, turn) ? "won" : "lost") : turn.state;

    if (actualState === "lost") resolvedState = "lost";
    if (actualState === "won") resolvedState = "won";

    if (resolvedState === "won") adminBalance -= turn.bet;
    if (resolvedState === "lost") adminBalance += turn.bet;

    resolvedPlayers.set(turn.player.id, { ...turn, state: resolvedState });
  });

  const adminActualState = calcState(adminTurn.cards);
  let adminState: Turn["state"];
  if (adminActualState === "lost") adminState = "lost";
  else if (adminActualState === "won") adminState = "won";
  else if (adminBalance < 0) adminState = "lost";
  else adminState = "standby";

  const adminResolved: Turn = { ...adminTurn, state: adminState, bet: adminBalance };

  return turns.map((turn) => {
    if (turn.player.type === "admin") return adminResolved;
    return resolvedPlayers.get(turn.player.id) ?? turn;
  });
}

export function calculateBalances(turns: Turn[]): Balance[] {
  const adminTurn = turns.find((t) => t.player.type === "admin");
  const playerTurns = turns.filter((t) => t.player.type !== "admin" && t.state !== "skipped");
  if (!adminTurn) return [];

  return playerTurns.map((turn) => {
    if (turn.state === "lost") return { amount: turn.bet, payer: turn.player.id, payee: adminTurn.player.id };
    return { amount: turn.bet, payer: adminTurn.player.id, payee: turn.player.id };
  });
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
