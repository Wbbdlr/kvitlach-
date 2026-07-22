import { useState } from "react";
import { BuyInRequest, Player, RenameRequest } from "../types";
import { Icon } from "./icons";

export interface ManageDrawerProps {
  open: boolean;
  onClose: () => void;
  players: Player[];
  wallets: Record<string, number>;
  renameRequests: RenameRequest[];
  buyInRequests: BuyInRequest[];
  roundHistoryCount: number;
  onApproveRename: (playerId: string) => void;
  onRejectRename: (playerId: string) => void;
  onApproveBuyIn: (playerId: string) => void;
  onRejectBuyIn: (playerId: string) => void;
  onAdjustChips: (playerId: string, amount: number, note?: string) => void;
  onKick: (playerId: string) => void;
  onExportHistory: () => void;
  onCloseRoom: () => void;
}

// Full banker "Manage table" surface for the new table UI. Deliberately
// reuses the same store actions the old list UI already wires up (kick,
// rename/buy-in approvals, chip adjustment, close room, history export) --
// this is a themed rebuild of that functionality, not a new feature set.
// switch-admin is intentionally NOT here: it exists as a backend WS action
// but was never exposed in the old UI either, so leaving it out isn't a
// regression.
export function ManageDrawer({
  open,
  onClose,
  players,
  wallets,
  renameRequests,
  buyInRequests,
  roundHistoryCount,
  onApproveRename,
  onRejectRename,
  onApproveBuyIn,
  onRejectBuyIn,
  onAdjustChips,
  onKick,
  onExportHistory,
  onCloseRoom,
}: ManageDrawerProps) {
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [kickTarget, setKickTarget] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  if (!open) return null;

  const nonAdminPlayers = players.filter((p) => p.type !== "admin");
  const pendingCount = renameRequests.length + buyInRequests.length;

  const applyAdjust = () => {
    if (!adjustTarget) return;
    const amount = Math.round(Number(adjustAmount));
    if (!Number.isFinite(amount) || amount === 0) return;
    onAdjustChips(adjustTarget, amount, adjustNote.trim() || undefined);
    setAdjustTarget(null);
    setAdjustAmount("");
    setAdjustNote("");
  };

  const nameOf = (playerId: string) => {
    const p = players.find((pl) => pl.id === playerId);
    return p ? [p.firstName, p.lastName].filter(Boolean).join(" ") : "Player";
  };

  return (
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
            <Icon name="bank" size={16} className="text-amber-700" />
            Manage table
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {pendingCount > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Approvals needed ({pendingCount})
            </div>
            {buyInRequests.map((req) => (
              <div key={`buyin-${req.playerId}`} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <div>
                  <div className="font-semibold">{nameOf(req.playerId)}</div>
                  <div className="text-xs text-amber-700">${req.amount}{req.note ? ` · "${req.note}"` : ""}</div>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" className="rounded bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white" onClick={() => onApproveBuyIn(req.playerId)}>
                    Approve
                  </button>
                  <button type="button" className="rounded bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white" onClick={() => onRejectBuyIn(req.playerId)}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
            {renameRequests.map((req) => (
              <div key={`rename-${req.playerId}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <div>
                  <div className="font-semibold">{nameOf(req.playerId)}</div>
                  <div className="text-xs text-slate-500">
                    &rarr; {req.firstName}{req.lastName ? ` ${req.lastName}` : ""}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" className="rounded bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white" onClick={() => onApproveRename(req.playerId)}>
                    Approve
                  </button>
                  <button type="button" className="rounded bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white" onClick={() => onRejectRename(req.playerId)}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Players</div>
          {nonAdminPlayers.length === 0 && <div className="text-sm text-slate-400">No players yet.</div>}
          {nonAdminPlayers.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className={`h-2 w-2 rounded-full ${p.presence === "online" ? "bg-emerald-500" : "bg-slate-300"}`} />
                  {[p.firstName, p.lastName].filter(Boolean).join(" ")}
                  <span className="font-normal text-slate-500">${wallets[p.id] ?? 0}</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="text-xs font-semibold text-blue-600 underline" onClick={() => setAdjustTarget(p.id)}>
                    Adjust
                  </button>
                  <button type="button" className="text-xs font-semibold text-rose-600 underline" onClick={() => setKickTarget(p.id)}>
                    Kick
                  </button>
                </div>
              </div>
              {adjustTarget === p.id && (
                <div className="mt-2 flex flex-col gap-1.5 border-t border-slate-100 pt-2">
                  <input
                    type="number"
                    autoFocus
                    placeholder="Amount (negative removes chips)"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    className="w-full rounded border px-2 py-1 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Note (optional)"
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    className="w-full rounded border px-2 py-1 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="px-2 py-1 text-xs text-slate-500" onClick={() => setAdjustTarget(null)}>
                      Cancel
                    </button>
                    <button type="button" className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white" onClick={applyAdjust}>
                      Apply
                    </button>
                  </div>
                </div>
              )}
              {kickTarget === p.id && (
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
                  <span className="text-rose-700">Remove {p.firstName} from the table?</span>
                  <div className="flex gap-2">
                    <button type="button" className="text-slate-500" onClick={() => setKickTarget(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white"
                      onClick={() => {
                        onKick(p.id);
                        setKickTarget(null);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <span>Round history ({roundHistoryCount})</span>
          <button
            type="button"
            disabled={!roundHistoryCount}
            className="text-xs font-semibold text-blue-600 underline disabled:text-slate-300 disabled:no-underline"
            onClick={onExportHistory}
          >
            Export .txt
          </button>
        </div>

        <div className="border-t border-slate-200 pt-3">
          {!confirmClose ? (
            <button type="button" className="text-xs font-semibold text-rose-600 underline" onClick={() => setConfirmClose(true)}>
              Close this room for everyone
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs">
              <span className="text-rose-800">This disconnects everyone. Export history first if you want a record.</span>
              <div className="flex justify-end gap-2">
                <button type="button" className="text-slate-500" onClick={() => setConfirmClose(false)}>
                  Cancel
                </button>
                <button type="button" className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white" onClick={onCloseRoom}>
                  Close room
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
