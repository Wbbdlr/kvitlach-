import { clsx } from "clsx";
import { DiscardEntry } from "./DiscardPile";
import { cardImages } from "./selectors";
import { Icon } from "./icons";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";

export interface DiscardPileModalProps {
  entries: DiscardEntry[];
  onClose: () => void;
}

// Every face value a Kvitlach deck can show, in reading order -- see
// CLAUDE.md's "a Kvitlach deck is 24 cards, numbers 1-12, two copies each."
const CARD_VALUES = Array.from({ length: 12 }, (_, i) => String(i + 1));

// Tallied by face value rather than listed one row per instance. The pile
// widened (see DiscardPile.tsx's discardedEntries) from Eleveroon-only to
// every resolved hand's cards, and a busy round can log dozens of entries --
// a growing, scrolling list of individual cards stopped being "nicely
// viewable" well before that. Grouping by value also fits how a real player
// actually uses this: "how many 9s are left to come" reads off a count, not
// off a list of who held each one.
function countsByValue(entries: DiscardEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  entries.forEach((entry) => {
    counts[entry.card.name] = (counts[entry.card.name] ?? 0) + 1;
  });
  return counts;
}

// The pile's expandable review, reachable by tapping the pile itself (see
// DiscardPile.tsx). Fixed 1-12 grid, always -- every value renders whether
// or not it's been discarded yet, so the window is exactly the same size
// every round instead of resizing (or scrolling) as it fills. Which PLAYER
// discarded which card, and whether a specific one was an Eleveroon save,
// no longer show here -- that per-instance detail is what made the old list
// grow unbounded in the first place; the seat itself (still showing every
// resolved hand's cards in place, see DiscardPile.tsx) is where that detail
// still lives. `entries` is shoe-scoped, not round-scoped -- it spans every
// round played on the current shoe, not just the one in progress (see
// state.ts's advanceShoeDiscards), so the tally keeps growing hand after
// hand until the banker actually reshuffles.
export function DiscardPileModal({ entries, onClose }: DiscardPileModalProps) {
  useEscapeKey(onClose);
  const counts = countsByValue(entries);
  return (
    <StageOverlay>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-3"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          // max-h + overflow-y-auto matches RoomInfoDrawer's own modal --
          // this one was missing both, so on a short viewport (a landscape
          // phone, or portrait with the keyboard up) the fixed 12-card grid
          // had nowhere to shrink and rendered straight off the top/bottom
          // edges instead of scrolling. Confirmed live at 780x360: the panel
          // (397px tall, uncapped) sat from y-18 to y378 against a 360px-tall
          // viewport -- clipped on both ends, close button included.
          className="relative w-full max-w-xs max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-4 flex flex-col gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-base font-semibold text-slate-800">
              <Icon name="list" size={16} className="text-amber-700" />
              {/* "Discarded" reads like a player chose to fold these -- this
                  is just what's already come out of the shoe (every round
                  since the last reshuffle), so "used" is the honest word. */}
              Used this shoe
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="grid grid-cols-4 gap-x-2 gap-y-3">
            {CARD_VALUES.map((value) => {
              const count = counts[value] ?? 0;
              return (
                <div key={value} className="relative flex justify-center">
                  <img
                    src={cardImages[value]}
                    alt={`Card ${value}`}
                    // count === 0 stays visibly duller than a discarded one --
                    // the grid is fixed either way, this is the only signal
                    // left for "hasn't come up yet" vs. "has."
                    className={clsx("w-full h-auto object-contain", count === 0 ? "opacity-30 grayscale" : "opacity-90")}
                  />
                  {count > 0 && (
                    <span
                      className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-600 text-white text-[11px] font-semibold flex items-center justify-center leading-none"
                      aria-label={`${count} used`}
                    >
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </StageOverlay>
  );
}
