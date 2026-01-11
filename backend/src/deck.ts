import { Card } from "./types.js";

const baseCards: Card[] = [
  { name: "1", attributes: { values: [1] } },
  { name: "2", attributes: { values: [2], type: "rosier" } },
  { name: "3", attributes: { values: [3] } },
  { name: "4", attributes: { values: [4] } },
  { name: "5", attributes: { values: [5] } },
  { name: "6", attributes: { values: [6] } },
  { name: "7", attributes: { values: [7] } },
  { name: "8", attributes: { values: [8] } },
  { name: "9", attributes: { values: [9] } },
  { name: "10", attributes: { values: [10] } },
  { name: "11", attributes: { values: [11], type: "rosier" } },
  { name: "12", attributes: { values: [12, 9, 10] } },
];

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newDeck(): Card[] {
  const expanded = baseCards.flatMap((card) => Array.from({ length: 4 }, () => card));
  return shuffle(expanded);
}
