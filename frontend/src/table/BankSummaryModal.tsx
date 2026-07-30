import { clsx } from "clsx";
import { CompletedRoundSummary } from "../state";
import { statusDisplay, betDisplay, fullName } from "./selectors";
import { Icon } from "./icons";
import { StageOverlay } from "./StageOverlay";

export interface BankSummaryModalProps {
  summary?: CompletedRoundSummary;
  onClose: () => void;
}

// Shown to the banker after they end a round because the bank ran dry (the
// server's round:banker-ended). That's the one round ending they may need a
// record of -- it stopped early rather than playing out -- so this keeps the
// print/save escape hatch the old list UI had.
export function BankSummaryModal({ summary, onClose }: BankSummaryModalProps) {
  return (
    <StageOverlay>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-3"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-4 flex flex-col gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Round ended early</div>
              <div className="flex items-center gap-1.5 text-base font-semibold text-slate-800">
                <Icon name="bank" size={16} className="text-amber-700" />
                Bank showdown summary
              </div>
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600 flex-none" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="text-xs text-slate-500">
            You ended the round after the bank was depleted. Review the results below, or save a copy for your records.
          </div>

          {summary ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Round {summary.roundNumber}</span>
                <span>{new Date(summary.completedAt).toLocaleString()}</span>
              </div>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
                {summary.turns.map((turn) => {
                  const statusInfo = statusDisplay(turn);
                  const betInfo = betDisplay(turn, true);
                  return (
                    <div
                      key={`${summary.roundId}-${turn.player.id}`}
                      className="flex items-start justify-between gap-3 px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-slate-800">
                          {fullName(turn.player) || "Unnamed"}
                        </span>
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">
                          {turn.player.type === "admin" ? "Banker" : "Player"}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={clsx("text-xs uppercase tracking-wide", statusInfo.className)}>
                          {statusInfo.label}
                        </span>
                        <span className={clsx("text-xs", betInfo.className)}>{betInfo.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-600">Preparing summary…</div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-700"
              onClick={() => window.print()}
            >
              Print / Save PDF
            </button>
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </StageOverlay>
  );
}
