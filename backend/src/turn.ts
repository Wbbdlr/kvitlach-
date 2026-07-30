import { Card, Player, Turn, TurnState } from "./types.js";

export function calcState(cards: Card[]): TurnState {
  const sums = getSums(cards);

  if (sums.includes(21)) return "won";
  if (rosier(cards)) return "won";
  if (sums.every((sum) => sum > 21)) return "lost";
  return "pending";
}

export function getSums(cards: Card[]): number[] {
  const values = cards
    .filter((card) => !card.attributes.eleveroonIgnored)
    .map((card) => card.attributes.values);
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

// Every total a hand can be read as. A card carries every value it may count
// as (the "12" is [12, 9, 10]) and re-reads itself freely at every point in
// the round, so this is the full cartesian product across the hand -- callers
// then pick whichever reading serves them (winningNumber takes the highest
// that isn't over 21).
//
// Two prunings keep that product from growing without bound, both free given
// every card value is positive -- a partial sum past 21 can never come back
// under it:
//   * duplicate sums collapse (only membership and the max/min matter), and
//   * busted partial sums collapse to the single smallest of them, which is
//     all `calcState`'s all-over-21 check and a busted hand's displayed total
//     need.
// Without these, each 12 in a hand triples the array -- and a blatt hand,
// which by design never busts out and so can keep drawing, could push that
// past anything the process can hold.
export function calcSums(values: number[][]): number[] {
  let sums = [0];
  for (const valueSet of values) {
    const next = new Set<number>();
    let smallestBust: number | undefined;
    for (const sum of sums) {
      for (const value of valueSet) {
        const total = sum + value;
        if (total > 21) {
          if (smallestBust === undefined || total < smallestBust) smallestBust = total;
        } else {
          next.add(total);
        }
      }
    }
    if (smallestBust !== undefined) next.add(smallestBust);
    sums = [...next];
  }
  return sums;
}
