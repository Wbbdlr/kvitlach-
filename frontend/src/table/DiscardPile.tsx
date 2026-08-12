import { Turn, Card } from "../types";
import { fullName } from "./selectors";

// A card that's left play -- either Eleveroon rejected it mid-hand (see
// CardView.tsx for the fly-out that lands it here the moment that happens,
// independent of whether the rest of the hand has resolved yet), or it
// belonged to a hand that has now genuinely finished (won/lost). See
// TASKS.md's "real discard pile" entries for the three-stage history: this
// started Eleveroon-only, then widened to every resolved hand once it
// turned out "discard pile" read as "every card" to anyone not already
// steeped in that first, narrower design call, then widened again (2026-08-
// 11) from round-scoped to shoe-scoped -- see state.ts's advanceShoeDiscards
// for why this function itself stayed round-scoped rather than absorbing
// that: it's still the right shape for "what has THIS round resolved so
// far," which advanceShoeDiscards calls once per round, on its way out.
export interface DiscardEntry {
  key: string;
  playerName: string;
  isBanker: boolean;
  card: Card;
}

// Scoped to whichever turns list it's handed -- callers decide what that
// means. TableRoot passes the CURRENT round's turns (so this reflects that
// round's own hands as they resolve live); state.ts's advanceShoeDiscards
// calls it once more, on an OUTGOING round on its way into the running
// shoe-scoped tally that persists across rounds until the shoe reshuffles
// (see its own comment for why the pile itself is shoe-scoped, not
// round-scoped, as of 2026-08-11).
export function discardedEntries(turns: Turn[]): DiscardEntry[] {
  const out: DiscardEntry[] = [];
  turns.forEach((turn) => {
    const isBanker = turn.player.type === "admin";
    // Mirrors selectors.ts's totalDisplay/canRevealTotal exactly for a
    // PLAYER -- won/lost is the same threshold that already makes a hand's
    // total publicly readable. A player's "standby" (stood, but the banker
    // hasn't played yet) or "skipped" hand's cards stay OUT even though the
    // player is done acting: their total is deliberately still hidden from
    // everyone else at that point (see totalDisplay's own comment on why),
    // and logging every card here the instant a hand stops being "pending"
    // would leak exactly what that hiding is protecting. An
    // Eleveroon-rejected card is the one exception that's always in,
    // resolved or not -- that specific card was already made public the
    // moment it happened (the eleveroonNotification toast), well before
    // this list existed.
    //
    // The banker is a genuine exception to the won/lost threshold above:
    // calculateEndState (round.ts) resolves a banker who neither busts nor
    // hits a natural 21 to "standby", not won/lost, whenever the bank
    // finishes the round even or ahead -- the MOST common outcome, not an
    // edge case. That's not "still playing" the way a player's standby is;
    // it's the banker's own final state for the round (selectors.ts's
    // totalDisplay already treats it as fully resolved/revealed via its own
    // bankerResolved check). Excluding it here meant the banker's cards
    // silently never joined the discard pile most rounds.
    const resolved = isBanker
      ? turn.state === "won" || turn.state === "lost" || turn.state === "standby"
      : turn.state === "won" || turn.state === "lost";
    turn.cards.forEach((card, idx) => {
      if (!resolved && !card.attributes?.eleveroonIgnored) return;
      out.push({
        key: `${turn.player.id}-${idx}`,
        playerName: fullName(turn.player) || turn.player.firstName,
        isBanker,
        card,
      });
    });
  });
  return out;
}

// The clickable felt element itself -- deliberately absent (not just empty)
// until the shoe's first entry, same reasoning as the shoe never drawing
// before a round starts: a permanently-empty pile promising a tap that does
// nothing is worse than not drawing it yet. In practice this now appears
// early in most rounds (as soon as the first hand resolves), not just the
// rare Eleveroon-only rounds from before, and then stays put across
// rounds -- see DiscardEntry's own comment -- until the shoe reshuffles.
// Positioned via .k-discard in index.css, the shoe's mirror image on the
// dealer's other side. Takes the already-merged (shoe history + this
// round's own live entries) list rather than turns directly -- TableRoot is
// what does that merging, since it's the one place that has both halves.
export function DiscardPile({ entries, onOpen }: { entries: DiscardEntry[]; onOpen: () => void }) {
  const count = entries.length;
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="k-discard"
      onClick={onOpen}
      // "Discarded" read as if a player had thrown these away -- these are
      // just every card that's already come out of the shoe and resolved,
      // across every round played since the last actual reshuffle. "Used"
      // says that without the poker-jargon detour.
      title={`${count} card${count === 1 ? "" : "s"} used this shoe -- tap to see what's left`}
    >
      <span className="k-discard-stack">
        <span className="k-cardback" />
        <span className="k-cardback" />
      </span>
      <span className="k-discard-count">{count} out</span>
    </button>
  );
}
