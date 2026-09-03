import { useState } from "react";
import { BuyInRequest, Player, RenameRequest } from "../types";
import { Icon } from "./icons";
import { StandingRow } from "../playerRecord";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";
import { useDialogFocus } from "../useDialogFocus";

export interface ManageDrawerProps {
  open: boolean;
  onClose: () => void;
  players: Player[];
  wallets: Record<string, number>;
  renameRequests: RenameRequest[];
  buyInRequests: BuyInRequest[];
  roundHistoryCount: number;
  /**
   * Tonight, for everyone. The banker sees every column -- asked and
   * answered directly ("you can let the banker see everything"), so there is
   * no redaction and no per-viewer variant. This drawer is isAdmin-gated,
   * which is what keeps that decision to the banker's own screen.
   */
  standings?: StandingRow[];
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
  // Defaulted rather than required: a drawer opened before any round has
  // finished has nothing to stand, which is the same empty case as a table
  // that has played none.
  standings = [],
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

  useEscapeKey(onClose, open);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);

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
          <div className="flex items-center gap-1.5 text-base font-semibold k-dialog-strong">
            <Icon name="bank" size={16} className="text-amber-300" />
            Manage table
          </div>
          <button type="button" className="k-dialog-sub hover:text-amber-200" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {pendingCount > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">
              Approvals needed ({pendingCount})
            </div>
            {buyInRequests.map((req) => (
              <div key={`buyin-${req.playerId}`} className="flex items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm">
                <div>
                  <div className="font-semibold">{nameOf(req.playerId)}</div>
                  <div className="text-xs text-amber-300">${req.amount}{req.note ? ` · "${req.note}"` : ""}</div>
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
              <div key={`rename-${req.playerId}`} className="flex items-center justify-between gap-2 rounded-lg border k-dialog-line k-dialog-inset px-3 py-2 text-sm">
                <div>
                  <div className="font-semibold">{nameOf(req.playerId)}</div>
                  <div className="text-xs k-dialog-sub">
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

        <div className="flex flex-col gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">Bank</span>
            <span className="text-sm font-semibold">${bankerWallet.toLocaleString()}</span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${topUpSign === 1 ? "bg-amber-400/20 text-amber-200 border border-amber-400/40" : "bg-white/5 k-dialog-sub border k-dialog-line"}`}
              onClick={() => setTopUpSign(1)}
            >
              + Add
            </button>
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${topUpSign === -1 ? "bg-amber-400/20 text-amber-200 border border-amber-400/40" : "bg-white/5 k-dialog-sub border k-dialog-line"}`}
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
          <div className="text-[11px] k-dialog-sub">Everyone at the table sees a notification when the bank total changes.</div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">Table label (faint, on the felt)</label>
          <div className="flex gap-2">
            {/* This app's own default watermark is Hebrew (see TableRoot.tsx's
                DEFAULT_WATERMARK) and most real values here are family
                surnames -- an English spellchecker has nothing useful to say
                about either, just a distracting red squiggle, so it's off. */}
            <input
              type="text"
              value={watermarkInput}
              onChange={(e) => setWatermarkInput(e.target.value)}
              placeholder="e.g. the Schlesinger family's table"
              className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
              maxLength={60}
              autoCapitalize="words"
              spellCheck={false}
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
          <label className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">Deck</label>
          {!confirmReshuffle ? (
            <button
              type="button"
              className="self-start text-xs font-semibold text-sky-300 underline"
              onClick={() => setConfirmReshuffle(true)}
            >
              Reshuffle deck
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs">
              <span className="text-amber-200">
                {roundActive
                  ? "A hand is in progress. Reshuffling now brings in a completely fresh shoe for any cards still to be dealt this round — everyone's cards already dealt stay exactly as they are. Continue?"
                  : "Shuffle a fresh shoe in before the next round?"}
              </span>
              <div className="flex justify-end gap-2">
                <button type="button" className="k-dialog-sub" onClick={() => setConfirmReshuffle(false)}>
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
          <div className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">Players</div>
          {nonAdminPlayers.length === 0 && <div className="text-sm k-dialog-sub">No players yet.</div>}
          {nonAdminPlayers.map((p) => (
            <div key={p.id} className="rounded-lg border k-dialog-line px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className={`h-2 w-2 rounded-full ${p.presence === "online" ? "bg-emerald-500/120" : "bg-slate-300"}`} />
                  {[p.firstName, p.lastName].filter(Boolean).join(" ")}
                  <span className="font-normal k-dialog-sub">${wallets[p.id] ?? 0}</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="text-xs font-semibold text-sky-300 underline" onClick={() => setAdjustTarget(p.id)}>
                    Adjust
                  </button>
                  <button type="button" className="text-xs font-semibold text-rose-300 underline" onClick={() => setKickTarget(p.id)}>
                    Kick
                  </button>
                </div>
              </div>
              {adjustTarget === p.id && (
                <div className="mt-2 flex flex-col gap-1.5 border-t k-dialog-line pt-2">
                  {/* type="text" + inputMode, not type="number": iOS Safari's
                      number-pad keyboard for type="number" doesn't reliably
                      expose a "-" key at all, which would make "negative
                      removes chips" untypable on an iPhone. Mirrors
                      PlayerDock.tsx's own bet-amount input, just with the
                      pattern loosened to allow a leading minus. applyAdjust
                      already parses this via plain Number(), so the value
                      shape is identical either way -- this only changes
                      which on-screen keyboard mobile shows. */}
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="-?[0-9]*"
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
                    <button type="button" className="px-2 py-1 text-xs k-dialog-sub" onClick={() => setAdjustTarget(null)}>
                      Cancel
                    </button>
                    <button type="button" className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white" onClick={applyAdjust}>
                      Apply
                    </button>
                  </div>
                </div>
              )}
              {kickTarget === p.id && (
                <div className="mt-2 flex items-center justify-between gap-2 border-t k-dialog-line pt-2 text-xs">
                  <span className="text-rose-300">Remove {p.firstName} from the table?</span>
                  <div className="flex gap-2">
                    <button type="button" className="k-dialog-sub" onClick={() => setKickTarget(null)}>
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

        {/* Tonight's standings, in the drawer rather than only in the export:
            the banker's usual question at the end of a night is "who owes
            what", and answering it should not require downloading a file and
            opening it. Every chip won came from somewhere, so these add up to
            zero across the table -- pinned by playerRecord.test.ts, because a
            settlement table that does not balance is worse than none. */}
        {standings.length > 0 && (
          <div className="rounded-lg border k-dialog-line px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">Tonight so far</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {standings.map((row) => (
                <div key={row.playerId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {row.isBanker && <Icon name="bank" size={12} className="flex-none text-amber-300" />}
                    <span className="truncate">{row.name}</span>
                  </span>
                  <span className="flex flex-none items-center gap-3 text-xs">
                    <span className="k-dialog-sub">
                      {row.wins}W / {row.losses}L
                    </span>
                    <span
                      className={`w-16 text-right font-semibold ${row.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {row.net >= 0 ? "+" : "-"}${Math.abs(row.net)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border k-dialog-line px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>Round history ({roundHistoryCount})</span>
            <button
              type="button"
              disabled={!roundHistoryCount}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-300 underline disabled:k-dialog-sub disabled:no-underline"
              onClick={onExportHistory}
            >
              <Icon name="download" size={13} />
              Export the night
            </button>
          </div>
          {/* Same reason as the player-facing pair in RoomInfoDrawer: the
              button named what it contained, not what it did. */}
          <div className="text-[11px] k-dialog-sub mt-1 leading-snug">
            Downloads one page with every round and the final standings, to keep or to share.
          </div>
        </div>

        <div className="border-t k-dialog-line pt-3">
          {!confirmClose ? (
            <button type="button" className="text-xs font-semibold text-rose-300 underline" onClick={() => setConfirmClose(true)}>
              Close this room for everyone
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-rose-400/30 bg-rose-500/12 px-3 py-2 text-xs">
              <span className="text-rose-300">This disconnects everyone. Export history first if you want a record.</span>
              <div className="flex justify-end gap-2">
                <button type="button" className="k-dialog-sub" onClick={() => setConfirmClose(false)}>
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
