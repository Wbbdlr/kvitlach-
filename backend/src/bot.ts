import { winningNumber } from "./round.js";
import { getSums } from "./turn.js";
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

/**
 * Whether a bot claims Eleveroon on the draw it is about to make.
 *
 * Eleveroon (docs/GAME_RULES.md) is opt-in, and nothing here ever opted in --
 * so every bot busted on an 11 drawn onto a hand sitting at exactly 11, every
 * time, in a spot where a human at the table would always call it. Reported by
 * a tester watching bots futch on hands they should have survived: the rule
 * looked broken from the outside, because the only players it visibly applied
 * to were the human ones.
 *
 * Cheap and always-on, matching the rest of this file's "deliberately dumb"
 * bar: the protection only ever fires when the drawn card is an 11 that would
 * otherwise bust a hand currently readable as exactly 11 (applyEleveroonRule
 * in round.ts is what actually decides), so there is no hand where claiming it
 * costs a bot anything. That makes "am I at 11?" the whole decision -- no
 * lookahead, no probability, one comparison.
 *
 * getSums, not winningNumber: a flexible card can put 11 within reach without
 * 11 being the best reading of the hand (12+2 reads as 9+2=11), and the rule
 * checks every achievable total. Asking the wrong one here would silently
 * decline protection on exactly the hands the rule was written for.
 */
export function decideBotEleveroon(cards: Card[]): boolean {
  return getSums(cards).includes(11);
}
