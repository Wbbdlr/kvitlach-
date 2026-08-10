import { DiscardEntry } from "./DiscardPile";
import { cardImages } from "./selectors";
import { Icon } from "./icons";
import { StageOverlay } from "./StageOverlay";

export interface DiscardPileModalProps {
  entries: DiscardEntry[];
  onClose: () => void;
}

// The pile's expandable review, reachable by tapping the pile itself (see
// DiscardPile.tsx). Same light card-modal shell as StatsModal -- deliberately
// NOT reusing CardView here: CardView's Eleveroon treatment is tuned for
// living inside a hand (it self-removes once its one-shot fly-out finishes,
// see CardView.tsx), which would just make every row in this list disappear
// a moment after it renders. This draws the same face/grayscale/ring
// language directly instead, with no hand-lifecycle attached to it.
export function DiscardPileModal({ entries, onClose }: DiscardPileModalProps) {
  return (
    <StageOverlay>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-3"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-4 flex flex-col gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-base font-semibold text-slate-800">
              <Icon name="list" size={16} className="text-amber-700" />
              Discarded this round
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
            {entries.length === 0 && <div className="p-3 text-xs text-slate-500">No cards discarded yet.</div>}
            {entries.map((entry) => (
              <div key={entry.key} className="p-3 flex items-center gap-3 text-sm">
                <span className="relative inline-flex w-10 h-14 flex-none">
                  <img
                    src={cardImages[entry.card.name] ?? cardImages.blank}
                    alt={`Card ${entry.card.name}`}
                    className="w-full h-full object-contain opacity-70 grayscale"
                  />
                </span>
                <div className="flex flex-col">
                  <span className="text-slate-700 font-medium">{entry.card.name}</span>
                  <span className="text-xs text-slate-500">
                    {entry.playerName}
                    {entry.isBanker ? " (bank)" : ""} -- saved by Eleveroon
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </StageOverlay>
  );
}
