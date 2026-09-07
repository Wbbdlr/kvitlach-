import { useState } from "react";
import { Icon } from "./icons";
import { NumberField } from "../NumberField";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";
import { useDialogFocus } from "../useDialogFocus";

export interface PracticeBankDialogProps {
  open: boolean;
  /** The table's buy-in, only used to suggest an opening amount. */
  buyIn: number;
  bankerName: string;
  onClose: () => void;
  onRefill: (amount: number) => void;
}

// Refilling a practice table's bot bank.
//
// A real table's banker fixes an empty bank from Manage -> BANK. A practice
// table's banker IS the bot, so that route reaches nobody and one BANK! wager
// that drains the bank used to end the table for good: every wager after it
// is refused with bank_empty and the felt offers no way through.
//
// The amount is the player's own. The first cut put chips in for them at a
// fixed 4x the buy-in and was corrected straight away - "Practice bank they
// should just be able to select refill amount." 4x is still what the field
// opens on, because it is the same default the practice lobby offers for a
// new table ("Bank's starting money ... Defaults to 4x your starting money"),
// but it is a starting point rather than the answer.
//
// The three presets are the only place in the app that scales an offered
// amount off the table's own buy-in, and it is worth it here: a practice
// table can be created with $10 or $500 starting money, so a fixed set of
// chips would be either pointless or absurd depending on which.
export function PracticeBankDialog({ open, buyIn, bankerName, onClose, onRefill }: PracticeBankDialogProps) {
  const suggested = Math.max(1, Math.round(buyIn * 4));
  const [amount, setAmount] = useState(String(suggested));
  const [error, setError] = useState<string | undefined>(undefined);
  useEscapeKey(onClose, open);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);

  if (!open) return null;

  const presets = [buyIn * 2, buyIn * 4, buyIn * 10].map((n) => Math.max(1, Math.round(n)));

  const submit = () => {
    const parsed = Math.floor(Number(amount));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter an amount of at least $1.");
      return;
    }
    setError(undefined);
    onRefill(parsed);
    onClose();
  };

  return (
    <StageOverlay>
      <div className="k-dialog-scrim" ref={dialogRef} role="dialog" aria-modal="true" onClick={onClose}>
        <div className="k-dialog max-w-xs" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-base font-semibold k-dialog-strong min-w-0">
              <Icon name="bank" size={16} className="text-amber-300 flex-none" />
              <span className="truncate">Refill the bank</span>
            </div>
            <button
              type="button"
              className="k-dialog-sub hover:text-amber-200 flex-none"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="close" size={15} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs k-dialog-sub">
              {bankerName} has no chips left, so nobody can wager. Practice chips only - nothing here touches a
              real table.
            </p>
            <div className="flex gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="flex-1 rounded border k-dialog-line k-dialog-inset k-dialog-strong px-2 py-2 text-xs font-semibold"
                  onClick={() => {
                    setAmount(String(preset));
                    setError(undefined);
                  }}
                >
                  ${preset.toLocaleString()}
                </button>
              ))}
            </div>
            <label className="text-xs">
              Amount
              <NumberField
                className="mt-1 w-full rounded border px-3 py-2"
                // Deliberately no `min`. With one, the pad clamps a cleared
                // field silently up to 1 and the guard below becomes
                // unreachable - so a player who wiped the field and tapped
                // Add would have 1 chip put into the bank without being told.
                // Saying "enter an amount" is the better answer, and it is the
                // same shape ChipRequestForm settled on for the same reason.
                value={amount}
                onChange={(next) => {
                  setAmount(next);
                  setError(undefined);
                }}
                label="Bank refill amount"
              />
            </label>
            {error && <p className="text-xs font-semibold text-rose-400">{error}</p>}
            <button
              type="button"
              className="bg-accent text-white rounded px-3 py-2 text-sm font-semibold"
              onClick={submit}
            >
              Add to the bank
            </button>
          </div>
        </div>
      </div>
    </StageOverlay>
  );
}
