import { useState } from "react";
import { BuyInRequest, LedgerEntry, Player, RenameRequest, SeatClaim } from "../types";
import { Icon } from "./icons";
import { fullName } from "./selectors";
import { StandingRow } from "../playerRecord";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";
import { NumberField } from "../NumberField";
import { useDialogFocus } from "../useDialogFocus";

// One word each, so the list reads as a sentence about what happened rather
// than as the internal `kind` string.
const LEDGER_LABEL: Record<string, string> = {
  adjust: "banker adjusted",
  "buy-in": "buy-in approved",
  "bank-topup": "added to the bank",
  kick: "removed from the table",
  leave: "left the table",
  undo: "undone by the banker",
};

export interface ManageDrawerProps {
  open: boolean;
  onClose: () => void;
  players: Player[];
  wallets: Record<string, number>;
  renameRequests: RenameRequest[];
  // Optional, defaulted to [] at the destructure, for the same reason
  // room.roundHistory is: a room persisted before seat claims existed comes
  // back without the field at all.
  seatClaims?: SeatClaim[];
  onApproveSeatClaim?: (claimId: string) => void;
  onRejectSeatClaim?: (claimId: string) => void;
  buyInRequests: BuyInRequest[];
  roundHistoryCount: number;
  /**
   * Tonight, for everyone. The banker sees every column -- asked and
   * answered directly ("you can let the banker see everything"), so there is
   * no redaction and no per-viewer variant. This drawer is isAdmin-gated,
   * which is what keeps that decision to the banker's own screen.
   */
  standings?: StandingRow[];
  /** Chips moved without a hand being played -- see LedgerEntry. */
  ledger?: LedgerEntry[];
  bankerWallet: number;
  feltWatermark?: string;
  turnSeconds?: number;
  deckCount?: number;
  deckRemaining?: number;
  onSetDeckCount?: (decks: number) => void;
  onTopUp: (amount: number, note?: string) => void;
  onSetWatermark: (text: string) => void;
  onSetTurnSeconds: (seconds: number) => void;
  onUndoCorrection?: () => void;
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
// Bounded by MIN/MAX_TURN_SECONDS on the server, which is what actually
// enforces them -- these are the four a banker would plausibly want.
const TURN_SECOND_CHOICES = [30, 45, 60, 90];
// null is "auto" -- let the server size the shoe by player count
// (recommendedDeckCount). The rest are the sizes a banker would reach for; 16
// is the server's own ceiling.
const DECK_CHOICES: (number | null)[] = [null, 2, 4, 6, 8];

export function ManageDrawer({
  open,
  onClose,
  players,
  wallets,
  renameRequests,
  seatClaims = [],
  onApproveSeatClaim,
  onRejectSeatClaim,
  buyInRequests,
  roundHistoryCount,
  // Defaulted rather than required: a drawer opened before any round has
  // finished has nothing to stand, which is the same empty case as a table
  // that has played none.
  standings = [],
  ledger = [],
  bankerWallet,
  feltWatermark,
  turnSeconds,
  deckCount,
  deckRemaining,
  onSetDeckCount,
  onTopUp,
  onSetWatermark,
  onSetTurnSeconds,
  onUndoCorrection,
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
  // Empty, not "500". Nothing else in this drawer is pre-filled, and this one
  // field sits next to "+ Add" and "Apply to bank" -- two taps put $500 into
  // the bank that nobody decided to put there. A default that is also the
  // most damaging value is the wrong default; making the banker type the
  // number is the whole confirmation this action gets.
  const [topUpAmount, setTopUpAmount] = useState("");
  // Both of the drawer's money actions used to fail silently on an empty
  // amount. That was survivable while the bank field arrived pre-filled with
  // 500 (it could never BE empty) -- emptying it in 11.5 made the silent
  // return reachable, and a banker who taps Apply and sees nothing cannot
  // tell a no-op from a failure.
  const [moneyError, setMoneyError] = useState<string | undefined>(undefined);
  const [topUpNote, setTopUpNote] = useState("");
  const [watermarkInput, setWatermarkInput] = useState(feltWatermark ?? "");

  useEscapeKey(onClose, open);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);

  if (!open) return null;

  const nonAdminPlayers = players.filter((p) => p.type !== "admin");
  const pendingCount = renameRequests.length + buyInRequests.length + seatClaims.length;
  // Mirrors the server's UNDOABLE set (store.ts). A banker should not be
  // shown a button that is going to answer "nothing to undo".
  const undoableCount = ledger.filter(
    (entry) => !entry.undoneAt && entry.kind !== "leave" && entry.kind !== "undo"
  ).length;

  const applyAdjust = () => {
    if (!adjustTarget) return;
    const amount = Math.round(Number(adjustAmount));
    // 0 is refused as well as empty: "move zero chips" is never what anyone
    // meant, and it would write a meaningless ledger line.
    if (!Number.isFinite(amount) || amount === 0) {
      setMoneyError("Enter an amount - negative to remove chips.");
      return;
    }
    setMoneyError(undefined);
    onAdjustChips(adjustTarget, amount, adjustNote.trim() || undefined);
    setAdjustTarget(null);
    setAdjustAmount("");
    setAdjustNote("");
  };

  const applyTopUp = () => {
    const amount = Math.round(Number(topUpAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      setMoneyError("Enter an amount of at least $1.");
      return;
    }
    setMoneyError(undefined);
    onTopUp(amount * topUpSign, topUpNote.trim() || undefined);
    setTopUpAmount("");
    setTopUpNote("");
  };

  const nameOf = (playerId: string) => {
    const p = players.find((pl) => pl.id === playerId);
    return p ? fullName(p) : "Player";
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
            {/* Somebody rejoining who says an empty seat is theirs. The
                banker is the check because the room code is semi-public by
                design -- read aloud, put in a group chat -- and the seat has
                real chips on it. The wallet is shown because it is the whole
                stake of the decision: approving hands over that stack. */}
            {seatClaims.map((claim) => (
              <div key={`claim-${claim.id}`} className="flex items-center justify-between gap-2 rounded-lg border k-dialog-line k-dialog-inset px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {[claim.firstName, claim.lastName].filter(Boolean).join(" ")}
                  </div>
                  <div className="text-xs k-dialog-sub">
                    Asking for their seat back (${(wallets[claim.playerId] ?? 0).toLocaleString()})
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" className="rounded bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white" onClick={() => onApproveSeatClaim?.(claim.id)}>
                    It is them
                  </button>
                  <button type="button" className="rounded bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white" onClick={() => onRejectSeatClaim?.(claim.id)}>
                    No
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
          <NumberField
            value={topUpAmount}
            onChange={setTopUpAmount}
            label="Bank amount"
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
          {moneyError && <p className="text-xs font-semibold text-rose-400">{moneyError}</p>}
          <div className="flex justify-end">
            <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white" onClick={applyTopUp}>
              Apply to bank
            </button>
          </div>
          <div className="text-[11px] k-dialog-sub">Everyone at the table sees a notification when the bank total changes.</div>
        </div>

        {/* The one game rule a banker can change for their own night. Presets
            rather than a free field: this is set once, standing at the felt,
            usually because the last round felt rushed or slow -- four choices
            answer that in one tap, where a number pad asks the banker to
            invent a value and then defend it. 60 is the default and is marked
            as such so a banker who has fiddled can get back to it.
            The clock refills on every action (store.ts's syncTurnTimer), so
            these are seconds per DECISION, which is what the note says --
            without it 30 reads as brutal rather than brisk. */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">Turn clock</label>
          <div className="flex gap-1.5">
            {TURN_SECOND_CHOICES.map((choice) => {
              const active = (turnSeconds ?? 60) === choice;
              return (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={active}
                  className={`flex-1 rounded border px-2 py-1.5 text-xs font-semibold ${
                    active ? "border-emerald-400 bg-emerald-600/25 text-emerald-100" : "k-dialog-line k-dialog-inset k-dialog-strong"
                  }`}
                  onClick={() => onSetTurnSeconds(choice)}
                >
                  {choice}s{choice === 60 ? " *" : ""}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] k-dialog-sub">
            Time to make each decision, not the whole turn - the clock refills every time a player bets or hits.
            60s (*) is the default. Takes effect from the next turn, so nobody loses the clock they are already on.
          </div>
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
          {/* Cards left, first, because it is the number that tells the
              banker whether they need either control below. */}
          <div className="flex items-baseline justify-between text-xs">
            <span className="k-dialog-sub">Cards left in the shoe</span>
            <span className="font-semibold">{deckRemaining ?? 0}</span>
          </div>
          {/* Shoe size. This existed ONLY on the lobby's create form, set
              once before the table was made and unchangeable afterwards -- a
              banker who sized a shoe for four people and then seated twelve
              had to close the table and open another. Auto is the default and
              is marked, same shape as the turn clock above. */}
          <div className="flex gap-1.5">
            {DECK_CHOICES.map((choice) => {
              const active = (deckCount ?? 0) === (choice ?? 0);
              return (
                <button
                  key={choice ?? "auto"}
                  type="button"
                  aria-pressed={active}
                  className={`flex-1 rounded border px-2 py-1.5 text-xs font-semibold ${
                    active ? "border-emerald-400 bg-emerald-600/25 text-emerald-100" : "k-dialog-line k-dialog-inset k-dialog-strong"
                  }`}
                  onClick={() => onSetDeckCount?.(choice ?? 0)}
                >
                  {choice === null ? "Auto *" : `${choice}`}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] k-dialog-sub">
            Decks in the shoe. Auto (*) follows the game&apos;s own guidance - two decks (one pack) for up to six
            at the table, then one more per three people. Takes effect on the next shuffle or the next round - the
            hand on the table now is untouched.
          </div>
          {!confirmReshuffle ? (
            <button
              type="button"
              className="self-start rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => setConfirmReshuffle(true)}
            >
              Shuffle a fresh shoe
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs">
              <span className="text-amber-200">
                {roundActive
                  ? "A hand is in progress. Reshuffling now brings in a completely fresh shoe for any cards still to be dealt this round - everyone's cards already dealt stay exactly as they are. Continue?"
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
                    // Close the whole drawer, not just the confirm. Reported
                    // 2026-09-06: a player reshuffled mid-round and "that
                    // popup wouldn't go away even after the shuffle
                    // occurred". It had -- the confirm collapsed back to the
                    // plain "Reshuffle deck" link and the shoe really was
                    // fresh -- but the drawer itself stayed open looking
                    // exactly as it did before the tap, so the only visible
                    // evidence of success was a toast behind the drawer that
                    // is covering the felt. Dismissing puts the table (and
                    // the shuffle animation) back in front of the person who
                    // just asked for it.
                    onClose();
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
                  {fullName(p)}
                  <span className="font-normal k-dialog-sub">${wallets[p.id] ?? 0}</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="text-xs font-semibold text-sky-300 underline" onClick={() => {
                    // One shared error slot, so it must not follow the banker
                    // from one player's panel into the next one they open.
                    setMoneyError(undefined);
                    setAdjustTarget(p.id);
                  }}>
                    Adjust
                  </button>
                  <button type="button" className="text-xs font-semibold text-rose-300 underline" onClick={() => setKickTarget(p.id)}>
                    Kick
                  </button>
                </div>
              </div>
              {adjustTarget === p.id && (
                <div className="mt-2 flex flex-col gap-1.5 border-t k-dialog-line pt-2">
                  {/* allowNegative is load-bearing: "negative removes chips"
                      is the only way a banker takes chips back. This field
                      used to be type="text" + inputMode="numeric" precisely
                      because iOS Safari's number pad for type="number" does
                      not reliably expose a "-" key at all -- a workaround
                      that is moot now the pad is ours and carries its own
                      sign key. applyAdjust still parses with plain Number(),
                      so the value shape is unchanged. */}
                  <NumberField
                    value={adjustAmount}
                    onChange={setAdjustAmount}
                    label="Adjustment amount"
                    allowNegative
                    placeholder="Amount (negative removes chips)"
                    className="w-full rounded border px-2 py-1 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Note (optional)"
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    className="w-full rounded border px-2 py-1 text-sm"
                  />
                  {moneyError && <p className="text-xs font-semibold text-rose-400">{moneyError}</p>}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="px-2 py-1 text-xs k-dialog-sub"
                      onClick={() => {
                        setMoneyError(undefined);
                        setAdjustTarget(null);
                      }}
                    >
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
                    {/* Chips the banker moved by hand, shown NEXT TO the play
                        result rather than merged into it. Merging would give
                        one number nobody can check; two numbers are two things
                        a table full of relatives can argue with, which is the
                        actual job at the end of a night. */}
                    {row.adjustments !== 0 && (
                      <span className="k-dialog-sub" title="Chips the banker moved by hand">
                        {row.adjustments >= 0 ? "+" : "-"}${Math.abs(row.adjustments)} by hand
                      </span>
                    )}
                    <span
                      className={`w-16 text-right font-semibold ${row.settle >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {row.settle >= 0 ? "+" : "-"}${Math.abs(row.settle)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            {standings.some((row) => row.adjustments !== 0) && (
              <div className="text-[11px] k-dialog-sub mt-1.5 leading-snug">
                Totals include chips moved by hand. The cards alone would say{" "}
                {standings
                  .filter((row) => row.adjustments !== 0)
                  .map((row) => `${row.name} ${row.net >= 0 ? "+" : "-"}$${Math.abs(row.net)}`)
                  .join(", ")}
                .
              </div>
            )}
          </div>
        )}

        {/* What the banker did, as opposed to what the cards did.
            Until 2026-09-06 every one of these went to the server's stdout and
            nowhere else -- invisible during a game, unreadable after one, gone
            on restart. It is not an undo (see the review's costing of that),
            but "who did the banker give $50 to, and when" now has an answer
            an hour later. */}
        {ledger.length > 0 && (
          <div className="rounded-lg border k-dialog-line px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">Chips moved by hand</div>
            {/* The whole undo surface: one button, on the list it acts on.
                It reverses the most recent chip correction that has not
                already been taken back -- an adjust, an approved buy-in, a
                bank top-up, or a kick (which puts the seat and its stack
                back, offline, so the player's own "that is my seat" route
                carries them in from there).
                Deliberately not a per-row control. A banker mis-tapping in a
                list of twelve entries is the same class of mistake this
                exists to fix, and "take back the thing I just did" is what
                they actually want. */}
            {onUndoCorrection && undoableCount > 0 && (
              <button
                type="button"
                className="mt-1.5 self-start text-xs font-semibold text-sky-300 underline"
                onClick={onUndoCorrection}
              >
                Undo the last chip correction
              </button>
            )}
            <div className="mt-1.5 flex flex-col gap-1">
              {[...ledger]
                .reverse()
                .slice(0, 12)
                .map((entry) => (
                  <div key={entry.id} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="truncate">{entry.playerName}</span>
                      <span className="k-dialog-sub"> - {LEDGER_LABEL[entry.kind] ?? entry.kind}</span>
                      {/* Struck through rather than removed. The record of a
                          mistake AND its correction is what lets a table
                          settle up without arguing about whether an entry
                          ever existed; a line that simply vanished is how
                          that argument starts. */}
                      {entry.undoneAt && <span className="k-dialog-sub"> (undone)</span>}
                      {entry.note && <span className="k-dialog-sub"> “{entry.note}”</span>}
                    </span>
                    <span
                      className={`flex-none font-semibold ${entry.amount >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {entry.amount >= 0 ? "+" : "-"}${Math.abs(entry.amount).toLocaleString()}
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
              End the game for everyone
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-rose-400/30 bg-rose-500/12 px-3 py-2 text-xs">
              {/* No longer tells the banker to export FIRST: everyone,
                  including them, now gets the final standings and both
                  export buttons on the game-over screen this opens. */}
              <span className="text-rose-300">
                This ends the night for everyone at the table. They all see the final standings and can save a copy.
              </span>
              <div className="flex justify-end gap-2">
                <button type="button" className="k-dialog-sub" onClick={() => setConfirmClose(false)}>
                  Cancel
                </button>
                <button type="button" className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white" onClick={onCloseRoom}>
                  End the game
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
