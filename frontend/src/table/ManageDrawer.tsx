import { useState } from "react";
import { BuyInRequest, Player, RenameRequest } from "../types";
import { Icon } from "./icons";
import { StageOverlay } from "./StageOverlay";

export interface ManageDrawerProps {
  open: boolean;
  onClose: () => void;
  players: Player[];
  wallets: Record<string, number>;
  renameRequests: RenameRequest[];
  buyInRequests: BuyInRequest[];
  roundHistoryCount: number;
  bankerWallet: number;
  feltWatermark?: string;
  onTopUp: (amount: number, note?: string) => void;
  onSetWatermark: (text: string) => void;
  onApproveRename: (playerId: string) => void;
  onRejectRename: (playerId: string) => void;
  onApproveBuyIn: (playerId: string) => void;
  onRejectBuyIn: (playerId: string) => void;
  onAdjustChips: (playerId: string, amount: number, note?: string) => void;
  onKick: (playerId: string) => void;
  onExportHistory: () => void;
  onCloseRoom: () => void;
  // Whether a hand is currently in progress -- doesn't gate the control
  // (the banker can choose to reshuffle either way, see onReshuffleDeck),
  // only which confirmation copy warns them what they're about to do.
  roundActive: boolean;
  onReshuffleDeck: () => void;
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
  bankerWallet,
  feltWatermark,
  onTopUp,
  onSetWatermark,
  onApproveRename,
  onRejectRename,
  onApproveBuyIn,
  onRejectBuyIn,
  onAdjustChips,
  onKick,
  onExportHistory,
  onCloseRoom,
  roundActive,
  onReshuffleDeck,
}: ManageDrawerProps) {
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [kickTarget, setKickTarget] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReshuffle, setConfirmReshuffle] = useState(false);
  const [topUpSign, setTopUpSign] = useState<1 | -1>(1);
  const [topUpAmount, setTopUpAmount] = useState("500");
  const [topUpNote, setTopUpNote] = useState("");
  const [watermarkInput, setWatermarkInput] = useState(feltWatermark ?? "");

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

  const applyTopUp = () => {
    const amount = Math.round(Number(topUpAmount));
    if (!Number.isFinite(amount) || amount <= 0) return;
    onTopUp(amount * topUpSign, topUpNote.trim() || undefined);
    setTopUpAmount("500");
    setTopUpNote("");
  };

  const nameOf = (playerId: string) => {
    const p = players.find((pl) => pl.id === playerId);
    return p ? [p.firstName, p.lastName].filter(Boolean).join(" ") : "Player";
  };

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

        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bank</span>
            <span className="text-sm font-semibold">${bankerWallet.toLocaleString()}</span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${topUpSign === 1 ? "bg-amber-100 text-amber-800 border border-amber-300" : "bg-white text-slate-500 border border-slate-200"}`}
              onClick={() => setTopUpSign(1)}
            >
              + Add
            </button>
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${topUpSign === -1 ? "bg-amber-100 text-amber-800 border border-amber-300" : "bg-white text-slate-500 border border-slate-200"}`}
              onClick={() => setTopUpSign(-1)}
            >
              &minus; Subtract
            </button>
          </div>
          <input
            type="number"
            min={1}
            value={topUpAmount}
            onChange={(e) => setTopUpAmount(e.target.value)}
            placeholder="Amount"
            className="w-full rounded border px-2 py-1 text-sm"
          />
          <input
            type="text"
            value={topUpNote}
            onChange={(e) => setTopUpNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded border px-2 py-1 text-sm"
          />
          <div className="flex justify-end">
            <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white" onClick={applyTopUp}>
              Apply to bank
            </button>
          </div>
          <div className="text-[11px] text-slate-400">Everyone at the table sees a notification when the bank total changes.</div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Table label (faint, on the felt)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={watermarkInput}
              onChange={(e) => setWatermarkInput(e.target.value)}
              placeholder="e.g. the Schlesinger family's table"
              className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
              maxLength={60}
            />
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
              onClick={() => onSetWatermark(watermarkInput.trim())}
            >
              Save
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deck</label>
          {!confirmReshuffle ? (
            <button
              type="button"
              className="self-start text-xs font-semibold text-blue-600 underline"
              onClick={() => setConfirmReshuffle(true)}
            >
              Reshuffle deck
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
              <span className="text-amber-800">
                {roundActive
                  ? "A hand is in progress. Reshuffling now brings in a completely fresh shoe for any cards still to be dealt this round — everyone's cards already dealt stay exactly as they are. Continue?"
                  : "Shuffle a fresh shoe in before the next round?"}
              </span>
              <div className="flex justify-end gap-2">
                <button type="button" className="text-slate-500" onClick={() => setConfirmReshuffle(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded bg-amber-600 px-2.5 py-1 font-semibold text-white"
                  onClick={() => {
                    onReshuffleDeck();
                    setConfirmReshuffle(false);
                  }}
                >
                  Reshuffle
                </button>
              </div>
            </div>
          )}
        </div>

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
    </StageOverlay>
  );
}
