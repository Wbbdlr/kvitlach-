import { winningNumber } from "./round.js";
import { Card } from "./types.js";

// Deliberately dumb and cheap -- no lookahead, no probability modeling, just
// a couple of comparisons per decision. Practice-mode bots exist to fill out
// a table for a solo player to learn against, not to play well.

// Bets a modest, bounded amount so a bot can never trigger insufficient_funds
// or bank_limit -- the caller passes the smaller of the bot's own wallet and
// the bank's currently available window. Returns 0 (don't bet -- play it as
// a blatt/no-wager draw instead) when there's no room to bet at all.
export function decideBotBet(wallet: number, available: number): number {
  const ceiling = Math.min(5, wallet, available);
  if (ceiling < 1) return 0;
  return 1 + Math.floor(Math.random() * ceiling);
}

export function decideBotAction(cards: Card[]): "hit" | "stand" {
  const total = winningNumber(cards);
  if (total === undefined) return "stand"; // no valid total left to improve on
  return total >= 17 ? "stand" : "hit";
}
