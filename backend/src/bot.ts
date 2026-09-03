import { winningNumber } from "./round.js";
import { getSums } from "./turn.js";
import { Card } from "./types.js";

// Deliberately dumb and cheap -- no lookahead, no probability modeling, just
// a couple of comparisons per decision. Practice-mode bots exist to fill out
// a table for a solo player to learn against, not to play well.

/**
 * How boldly a given bot bets, derived from its player id and nothing else.
 *
 * The old rule was `1 + floor(random * min(5, wallet, available))` -- varied
 * on paper, identical in practice. A flat $5 ceiling against the default $100
 * buy-in meant every bot at the table bet $1-5 every round forever, drawn from
 * the same distribution, so five of them read as one timid player copied five
 * times and the numbers never moved as wallets did. Reported as bots needing
 * to vary their bet sizes, and the missing variety was BETWEEN bots at least
 * as much as between rounds.
 *
 * Temperament is per-BOT, not per-round, which is what actually makes a table
 * look populated: the same seat is recognisably the reckless one hand after
 * hand. Hashed off the id rather than stored, because it costs nothing, needs
 * no migration, and survives a server restart mid-game for free -- a bot that
 * changed personality every time the process bounced would be worse than one
 * with none.
 *
 * Percentages of the WALLET, not flat chips, so the spread keeps meaning
 * something at a $20 buy-in and at a $2,000 one. Capped at 20%: a bot that can
 * lose a third of its stack in a hand is broke in three, and a table of
 * bust-out bots playing $0 blatts is a worse table than a timid one.
 */
const TEMPERAMENTS = [
  { lo: 0.02, hi: 0.06 }, // timid
  { lo: 0.05, hi: 0.12 }, // steady
  { lo: 0.1, hi: 0.2 }, // bold
] as const;

// FNV-1a, 32-bit. Any stable string hash would do; this one is four lines and
// spreads short, similar ids ("bot-1".."bot-4") across buckets, which matters
// because those are exactly the ids this will see.
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Bets a bounded amount so a bot can never trigger insufficient_funds or
// bank_limit -- the caller passes the bank's currently available window, and
// everything below is clamped to it and to the bot's own wallet. That
// invariant predates the temperaments above and outranks them: a bot that
// wants 20% of its wallet and can only have $2 bets $2. Returns 0 (don't bet
// -- play it as a blatt/no-wager draw instead) when there's no room at all.
export function decideBotBet(wallet: number, available: number, playerId = ""): number {
  const ceiling = Math.min(wallet, available);
  if (ceiling < 1) return 0;
  const { lo, hi } = TEMPERAMENTS[hashId(playerId) % TEMPERAMENTS.length];
  const target = wallet * (lo + Math.random() * (hi - lo));
  // Whole chips only, same as every other money path (normalizeMoney in
  // store.ts). Rounding rather than flooring keeps a timid bot on a small
  // wallet off a permanent $1: 2% of $60 is $1.2, which floors to 1 every
  // single time and rebuilds the flat-bet problem at the bottom of the range.
  return Math.max(1, Math.min(ceiling, Math.round(target)));
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
