import { Turn, Card } from "../types";
import { fullName } from "./selectors";

// A card a player or the banker drew, that Eleveroon then rejected -- see
// CardView.tsx for the fly-out that lands it here, and TASKS.md's "real
// discard pile" entry for why this replaced the old permanent in-hand ring
// (see the DiscardPileModal comment for the fuller record).
export interface DiscardEntry {
  key: string;
  playerName: string;
  isBanker: boolean;
  card: Card;
}

// Flat, round-scoped: nothing here survives past the round it happened in
// (turn.cards itself is round-scoped -- a fresh round starts every hand
// clean), matching the felt's own "this round only" framing rather than a
// running game-night total.
export function discardedEntries(turns: Turn[]): DiscardEntry[] {
  const out: DiscardEntry[] = [];
  turns.forEach((turn) => {
    turn.cards.forEach((card, idx) => {
      if (!card.attributes?.eleveroonIgnored) return;
      out.push({
        key: `${turn.player.id}-${idx}`,
        playerName: fullName(turn.player) || turn.player.firstName,
        isBanker: turn.player.type === "admin",
        card,
      });
    });
  });
  return out;
}

// The clickable felt element itself -- deliberately absent (not just empty)
// until the round's first reject: Eleveroon is opt-in, so most rounds never
// touch this at all, and a permanently-empty pile promising a tap that does
// nothing is worse than not drawing it yet. Positioned via .k-discard in
// index.css, the shoe's mirror image on the dealer's other side.
export function DiscardPile({ turns, onOpen }: { turns: Turn[]; onOpen: () => void }) {
  const count = discardedEntries(turns).length;
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="k-discard"
      onClick={onOpen}
      title={`${count} card${count === 1 ? "" : "s"} discarded this round -- tap to review`}
    >
      <span className="k-discard-stack">
        <span className="k-cardback" />
        <span className="k-cardback" />
      </span>
      <span className="k-discard-count">{count} out</span>
    </button>
  );
}
