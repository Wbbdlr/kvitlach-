import { Card, Player, Turn, TurnState } from "./types";

export function calcState(cards: Card[]): TurnState {
  const sums = getSums(cards);

  if (sums.includes(21)) return "won";
  if (rosier(cards)) return "won";
  if (sums.every((sum) => sum > 21)) return "lost";
  return "pending";
}

export function getSums(cards: Card[]): number[] {
  const values = cards.map((card) => card.attributes.values);
  return calcSums(values);
}

export function initializeTurns(players: Player[], deck: Card[]): { turns: Turn[]; deck: Card[] } {
  const remaining = [...deck];
  const turns: Turn[] = players.map((player) => {
    const card = remaining.shift();
    if (!card) throw new Error("Deck exhausted during initialization");
    return {
      player,
      state: "pending",
      cards: [card],
      bet: 0,
    };
  });
  return { turns, deck: remaining };
}

function rosier(cards: Card[]): boolean {
  return (
    cards.length === 2 &&
    cards.every((card) => Object.values(card.attributes).includes("rosier"))
  );
}

export function calcSums(values: number[][]): number[] {
  return values.reduce((acc, valueSet) => getCombinations(valueSet, acc).flat()) as number[];
}

export function getCombinations(sumsA: number[], sumsB: number[]): number[] {
  const combos: number[] = [];
  sumsA.forEach((a) => {
    sumsB.forEach((b) => combos.push(a + b));
  });
  return combos;
}
