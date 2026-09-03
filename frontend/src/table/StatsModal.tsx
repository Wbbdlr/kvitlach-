import { clsx } from "clsx";
import { StatsData } from "./useTableData";
import { Icon } from "./icons";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";
import { useDialogFocus } from "../useDialogFocus";

export interface StatsModalProps {
  data: StatsData;
  onClose: () => void;
}

// Per-player round history, reachable by tapping any seat's nameplate (see
// Seat.tsx/Dealer.tsx). Deliberately the same light card-modal style as
// ManageDrawer rather than a dark felt-themed one -- statusClass/betClass
// come straight from selectors.ts's statusDisplay/betDisplay, which are
// light-theme Tailwind colors already tuned for a white card.
export function StatsModal({ data, onClose }: StatsModalProps) {
  useEscapeKey(onClose);
  const dialogRef = useDialogFocus<HTMLDivElement>();
  return (
    <StageOverlay>
      <div
        className="k-dialog-scrim"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="k-dialog max-w-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide k-dialog-sub">{data.isBanker ? "Bank stats" : "Player stats"}</div>
              <div className="flex items-center gap-1.5 text-base font-semibold k-dialog-strong">
                <Icon name="chart" size={16} className="text-amber-300" />
                {data.name}
              </div>
            </div>
            <button type="button" className="k-dialog-sub hover:text-amber-200" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="flex items-center justify-around rounded-lg border k-dialog-line k-dialog-inset px-3 py-2 text-xs">
            <div>
              Wins: <span className="font-semibold text-emerald-300">{data.wins}</span>
            </div>
            <div>
              Losses: <span className="font-semibold text-rose-300">{data.losses}</span>
            </div>
            <div>
              Pushes: <span className="font-semibold k-dialog-sub">{data.pushes}</span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border k-dialog-line k-dialog-inset px-3 py-2 text-xs">
            <span>{data.isBanker ? "Bank net" : "Net won/lost"}</span>
            <span className={clsx("font-semibold", data.netTotal >= 0 ? "text-emerald-300" : "text-rose-300")}>
              {data.netTotal >= 0 ? "+" : "-"}${Math.abs(data.netTotal)}
            </span>
          </div>

          {/* Its own scroller, not the dialog's. .k-dialog already scrolls at
              85vh, but letting the whole thing scroll takes the W/L strip and
              the net with it -- and those are the numbers you opened this to
              read. A long night is a long list, so the list is what moves.
              divide-slate-200 was a light-surface leftover, the same class of
              miss as the form fields: a pale hairline on a dark dialog. */}
          <div className="border k-dialog-line rounded-lg overflow-hidden">
            <div className="k-scroll-list divide-y k-dialog-divide">
            {data.entries.length === 0 && <div className="p-3 text-xs k-dialog-sub">No completed rounds yet.</div>}
            {data.entries.map((entry) => (
              <div key={`stats-entry-${entry.roundNumber}`} className="p-3 flex items-center justify-between text-sm">
                <div className="k-dialog-sub">Round {entry.roundNumber}</div>
                <div className="flex items-center gap-3">
                  <span className={clsx("text-xs uppercase tracking-wide", entry.statusClass)}>{entry.status}</span>
                  <span className={clsx("text-xs", entry.betClass)}>Bet {entry.bet}</span>
                </div>
              </div>
            ))}
            </div>
          </div>
        </div>
      </div>
    </StageOverlay>
  );
}
