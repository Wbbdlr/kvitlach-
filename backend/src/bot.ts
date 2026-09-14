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
  { lo: 0.04, hi: 0.09 }, // careful
  { lo: 0.05, hi: 0.12 }, // steady
  { lo: 0.08, hi: 0.15 }, // game
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
export function decideBotBet(wallet: number, available: number, playerId = "", buyIn = 0): number {
  const ceiling = Math.min(wallet, available);
  if (ceiling < 1) return 0;
  const { lo, hi } = TEMPERAMENTS[hashId(playerId) % TEMPERAMENTS.length];
  // The percentage is of the wallet, and a wallet only ever shrinks -- so a
  // bot that has been losing bets less and less, and a table an hour into a
  // session settles into everybody pushing $1. Measured on the $100 default:
  // five bots down to $15 each all bet $1-$3, which is the "practice tables
  // feel inert and the bank barely moves" report, arriving late rather than
  // at the start.
  //
  // A real player who is down does not shrink to a nervous dollar; they keep
  // betting something that looks like a bet for the table they are at. So the
  // stake is struck from the larger of the wallet and a floor set by the
  // TABLE (a third of the buy-in), which is a number that does not decay --
  // and then clamped to the wallet below like everything else, so a short
  // stack still cannot bet money it does not have. It only ever raises a
  // wallet that has fallen below that floor; a healthy stack is untouched.
  //
  // The floor is capped at 40% of the real stack, because lifting it without
  // one just trades the inert table for the opposite failure this file
  // already warns about two comments up: an $8 bot on a $100 table would
  // stake $5, be broke in two hands, and spend the rest of the night playing
  // $0 blatts -- which looks exactly like the problem the floor was added to
  // solve.
  const basis = Math.max(wallet, buyIn / 3);
  const raw = basis * (lo + Math.random() * (hi - lo));
  const target = Math.min(raw, Math.max(1, wallet * 0.4));
  // Whole chips only, same as every other money path (normalizeMoney in
  // store.ts). Rounding rather than flooring keeps a timid bot on a small
  // wallet off a permanent $1: 2% of $60 is $1.2, which floors to 1 every
  // single time and rebuilds the flat-bet problem at the bottom of the range.
  return Math.max(1, Math.min(ceiling, Math.round(target)));
}

/**
 * How well the computer plays, per table. Practice only in practice, but it is
 * a room setting rather than a practice-only one so nothing has to special-case
 * it (`room.botSkill`, default "normal" = exactly what shipped before this).
 */
export type BotSkill = "easy" | "normal" | "hard";
export const BOT_SKILLS = ["easy", "normal", "hard"] as const;
export function isBotSkill(value: unknown): value is BotSkill {
  return typeof value === "string" && (BOT_SKILLS as readonly string[]).includes(value);
}

// Every number below is measured, not chosen, over 400,000 simulated rounds
// against the real rule primitives (one seat, one banker, ties to the banker).
// Two results shaped the whole design and neither was the expected one:
//
//   A seat's stand threshold is FLAT at the top and steep at the bottom.
//   Win rate by threshold: 14 -> 42.7%, 15 -> 43.6%, 16 -> 44.4%,
//   17 -> 44.5%, 18 -> 44.5%, 19 -> 41.5%, 20 -> 36.1%. So 17 (what shipped)
//   was already optimal to within noise, and there is no fixed threshold that
//   makes a seat meaningfully sharper -- only ones that make it worse.
//
//   The BANKER is the dial that matters. In practice mode the human's opponent
//   IS the banker bot; the other bots are table dressing. Player win rate by
//   what the banker stands on: 14 -> 52.3%, 15 -> 49.7%, 16 -> 47.2%,
//   17 -> 44.5%, 18 -> 44.1%, 19 -> 46.3%, 20 -> 50.8%. An easy banker is
//   worth nearly EIGHT points to the player; a hard one is worth 0.4, because
//   18 is the banker's ceiling and 17 is almost exactly as good.
//
// So "hard" is honest about being a small edge, and the width of this dial is
// almost entirely in "easy".
const STAND_ON: Record<BotSkill, number> = { easy: 14, normal: 17, hard: 18 };

// A hard SEAT does not use a threshold at all -- it reads the shoe. Hitting
// while the chance the next card futches it stays under 50% measured 45.3%
// against 44.5% for standing on 17, the only thing tried that beat a fixed
// threshold at all. Counting was measured for the banker too and was WORSE
// there (player 47.4% vs 44.5%): it keeps the bank off a futch at the cost of
// standing low, and a low bank total loses to a tie it would otherwise win.
const HARD_SEAT_FUTCH_CUTOFF = 0.5;

/**
 * The chance the next card off the shoe futches this hand.
 *
 * Fair information, not a peek: the shoe's COMPOSITION (never its order) is
 * derivable by anyone at the table from the cards on the felt and the discard
 * pile, both of which are rendered. Reading `round.deck` is the cheap way to
 * the same number, not a look at what is coming.
 */
function futchChance(cards: Card[], shoe: Card[]): number {
  if (!shoe.length) return 1;
  const holdingEleven = getSums(cards).includes(11);
  let futching = 0;
  for (const card of shoe) {
    // An 11 onto a hand readable as exactly 11 is ignored, not a futch
    // (decideBotEleveroon below always claims it), so counting it as one would
    // have a hard bot stand on hands it cannot lose.
    if (holdingEleven && card.name === "11") continue;
    if (getSums([...cards, card]).every((sum) => sum > 21)) futching += 1;
  }
  return futching / shoe.length;
}

export function decideBotAction(
  cards: Card[],
  options?: { skill?: BotSkill; isBanker?: boolean; shoe?: Card[] }
): "hit" | "stand" {
  const total = winningNumber(cards);
  if (total === undefined) return "stand"; // no valid total left to improve on
  const skill = options?.skill ?? "normal";
  if (skill === "hard" && !options?.isBanker && options?.shoe?.length) {
    return futchChance(cards, options.shoe) <= HARD_SEAT_FUTCH_CUTOFF ? "hit" : "stand";
  }
  return total >= STAND_ON[skill] ? "stand" : "hit";
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
