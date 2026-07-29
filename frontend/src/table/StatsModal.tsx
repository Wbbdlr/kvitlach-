import { clsx } from "clsx";
import { StatsData } from "./useTableData";
import { Icon } from "./icons";
import { StageOverlay } from "./StageOverlay";

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
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">{data.isBanker ? "Bank stats" : "Player stats"}</div>
              <div className="flex items-center gap-1.5 text-base font-semibold text-slate-800">
                <Icon name="chart" size={16} className="text-amber-700" />
                {data.name}
              </div>
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="flex items-center justify-around rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div>
              Wins: <span className="font-semibold text-emerald-700">{data.wins}</span>
            </div>
            <div>
              Losses: <span className="font-semibold text-rose-700">{data.losses}</span>
            </div>
            <div>
              Pushes: <span className="font-semibold text-slate-600">{data.pushes}</span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span>{data.isBanker ? "Bank net" : "Net won/lost"}</span>
            <span className={clsx("font-semibold", data.netTotal >= 0 ? "text-emerald-700" : "text-rose-700")}>
              {data.netTotal >= 0 ? "+" : "-"}${Math.abs(data.netTotal)}
            </span>
          </div>

          <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
            {data.entries.length === 0 && <div className="p-3 text-xs text-slate-500">No completed rounds yet.</div>}
            {data.entries.map((entry) => (
              <div key={`stats-entry-${entry.roundNumber}`} className="p-3 flex items-center justify-between text-sm">
                <div className="text-slate-600">Round {entry.roundNumber}</div>
                <div className="flex items-center gap-3">
                  <span className={clsx("text-xs uppercase tracking-wide", entry.statusClass)}>{entry.status}</span>
                  <span className={clsx("text-xs", entry.betClass)}>Bet {entry.bet}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </StageOverlay>
  );
}
