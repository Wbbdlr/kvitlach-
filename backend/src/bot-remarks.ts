/**
 * What the computer players say during a hand.
 *
 * Rides the EXISTING reaction channel (`reaction:new`, ReactionEvent) rather
 * than inventing a second one: the felt already renders a bubble over a seat
 * for ten seconds, already prunes them, and already caps the list at twenty.
 * A parallel "bot says" pipeline would have needed all three again, plus its
 * own placement maths against the same crowded seats.
 *
 * Two constraints that are not obvious from the outside:
 *
 *   * NO EMOJI. Player reactions are user content and are the one deliberate
 *     exception to this project's no-emoji rule (CLAUDE.md); a bot remark is
 *     copy WE wrote, so it is text only. That is also why these do not reuse
 *     REACTION_EMOJIS.
 *   * The server never validates these against ws-server's reaction allowlist,
 *     because they do not pass through the `player:react` handler -- they are
 *     emitted straight from the store. So the list here is the only thing
 *     deciding what a bot can say, and it must stay short enough to read at a
 *     glance on a phone.
 */

/** The points in a hand worth saying something at. */
export type BotMoment = "futched" | "won" | "stood" | "bigBet" | "bankFutched";

/**
 * Two registers, picked per BOT off its id, for the same reason bot.ts's
 * betting temperaments are per-bot: what makes a table read as populated is
 * the same seat sounding like itself hand after hand. A table where every
 * remark is drawn from one pool reads as one person talking in five chairs.
 */
const VOICES = [
  {
    futched: ["Oy vey", "אוי וויי", "Futched!", "Gevald"],
    won: ["מזל טוב", "Baruch Hashem", "Nice hand!"],
    stood: ["Genug", "I'm good", "Stay"],
    bigBet: ["Nu?", "Let's go", "Big one"],
    bankFutched: ["The bank futched!", "אוי וויי, the bank"],
  },
  {
    futched: ["Too much", "Over I go", "That's me done"],
    won: ["That'll do", "Twenty-one", "Good card"],
    stood: ["I'll hold", "No more", "Enough for me"],
    bigBet: ["Deal it", "Why not", "Feeling lucky"],
    bankFutched: ["Bank's over", "Bank went bust"],
  },
] as const satisfies readonly Record<BotMoment, readonly string[]>[];

// FNV-1a, same hash and the same reason as bot.ts's: stable across a restart,
// no storage, and it spreads "bot-1".."bot-4" across buckets rather than
// handing four consecutive ids the same voice.
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * What this bot says at this moment, or undefined for "say nothing".
 *
 * `roll` is injected rather than read from Math.random here so a test can pin
 * it. Callers pass Math.random().
 */
export function botRemark(moment: BotMoment, playerId: string, roll: number): string | undefined {
  const voice = VOICES[hashId(playerId) % VOICES.length]!;
  const lines = voice[moment];
  if (!lines.length) return undefined;
  const index = Math.min(Math.floor(roll * lines.length), lines.length - 1);
  return lines[index];
}

/**
 * How often a bot speaks at all.
 *
 * Every eligible moment is a coin-toss weighted well against talking: five
 * bots each remarking on every hand is not a populated table, it is a wall of
 * bubbles over the cards you are trying to read. Paired with a table-wide
 * cooldown in the store, which is the half that actually stops a pile-up --
 * probability alone still lets three bots speak in the same second.
 */
export const REMARK_CHANCE = 0.28;
/** Table-wide, not per-bot: the cards have to stay readable. */
export const REMARK_COOLDOWN_MS = 6_000;
