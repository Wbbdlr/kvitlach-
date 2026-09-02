import { clsx } from "clsx";
import { CompletedRoundSummary } from "../state";
import { statusDisplay, betDisplay, fullName } from "./selectors";
import { Icon } from "./icons";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";
import { useDialogFocus } from "../useDialogFocus";

export interface BankSummaryModalProps {
  summary?: CompletedRoundSummary;
  onClose: () => void;
}

// Shown to the banker after they end a round because the bank ran dry (the
// server's round:banker-ended). That's the one round ending they may need a
// record of -- it stopped early rather than playing out -- so this keeps the
// print/save escape hatch the old list UI had.
export function BankSummaryModal({ summary, onClose }: BankSummaryModalProps) {
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
          className="k-dialog max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide k-dialog-sub">Round ended early</div>
              <div className="flex items-center gap-1.5 text-base font-semibold k-dialog-strong">
                <Icon name="bank" size={16} className="text-amber-300" />
                Bank showdown summary
              </div>
            </div>
            <button type="button" className="k-dialog-sub hover:text-amber-200 flex-none" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="text-xs k-dialog-sub">
            You ended the round after the bank was depleted. Review the results below, or save a copy for your records.
          </div>

          {summary ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs k-dialog-sub">
                <span>Round {summary.roundNumber}</span>
                <span>{new Date(summary.completedAt).toLocaleString()}</span>
              </div>
              <div className="border k-dialog-line rounded-lg divide-y divide-slate-200 overflow-hidden">
                {summary.turns.map((turn) => {
                  const statusInfo = statusDisplay(turn);
                  const betInfo = betDisplay(turn, true);
                  return (
                    <div
                      key={`${summary.roundId}-${turn.player.id}`}
                      className="flex items-start justify-between gap-3 px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold k-dialog-strong">
                          {fullName(turn.player) || "Unnamed"}
                        </span>
                        <span className="text-[11px] uppercase tracking-wide k-dialog-sub">
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
            <div className="text-sm k-dialog-sub">Preparing summary…</div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded border k-dialog-line bg-white/5 px-3 py-2 text-xs font-semibold k-dialog-sub transition-colors hover:bg-white/10"
              onClick={() => window.print()}
            >
              Print / Save PDF
            </button>
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500/120"
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
