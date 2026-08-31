import { useState } from "react";
import { Turn } from "../types";
import { Icon } from "./icons";
import { useEscapeKey } from "../useEscapeKey";
import { useDialogFocus } from "../useDialogFocus";

const DEFAULT_BET = 5;
const BET_STEP = 1;

export interface PlayerDockProps {
  turn: Turn;
  wallet: number;
  bankAvailable?: number;
  bankIncrement: number;
  canBank: boolean;
  bankDisabledReason?: string;
  onBet: (amount: number, options: { bank: boolean; eleveroon: boolean }) => void;
  onHit: (options: { eleveroon: boolean }) => void;
  onStand: () => void;
}

// Control dock for the viewer's own active turn, styled as the mockup's
// dark gradient bar with a gold top hairline (not a white toolbar). Bet
// defaults to $5 with a +/- $5 stepper; Eleveroon defaults OFF for players
// (the banker's is always-on and handled by Dealer.tsx); the draw button
// relabels Blatt -> Hit the moment a real wager lands, driven off the
// server-authoritative turn.bet rather than a local flag.
export function PlayerDock({
  turn,
  wallet,
  bankAvailable,
  bankIncrement,
  canBank,
  bankDisabledReason,
  onBet,
  onHit,
  onStand,
}: PlayerDockProps) {
  // Tracked as a string (not a number) so the field can sit empty mid-edit
  // while the player retypes it -- a number-backed value would fight any
  // attempt to clear the field before entering a new amount.
  const [betAmount, setBetAmount] = useState(String(DEFAULT_BET));
  const [eleveroonSelected, setEleveroonSelected] = useState(false);
  const [betError, setBetError] = useState<string | undefined>(undefined);
  const [bankConfirmOpen, setBankConfirmOpen] = useState(false);
  useEscapeKey(() => setBankConfirmOpen(false), bankConfirmOpen);
  const dialogRef = useDialogFocus<HTMLDivElement>(bankConfirmOpen);

  const hasBet = (turn.bet ?? 0) > 0;
  const drawLabel = hasBet ? "Hit" : "Blatt";

  // The card that follows a confirmed BANK! is issued by state.ts off that
  // bet's own ack -- see its pendingBankAutoHit comment for why watching
  // turn.bet from here could not work (it fired inside the window where
  // pendingAction still blocks every action, and never fired at all for a
  // seat that had already bet).

  const adjustBet = (delta: number) => {
    setBetAmount((prev) => String(Math.max(1, Math.floor(Number(prev) || 0) + delta)));
    setBetError(undefined);
  };

  const handleAmountChange = (raw: string) => {
    // Digits only, and allow empty while the player is mid-retype.
    if (raw !== "" && !/^\d*$/.test(raw)) return;
    setBetAmount(raw);
    setBetError(undefined);
  };

  const handleAmountBlur = () => {
    setBetAmount(String(Math.max(1, Math.floor(Number(betAmount) || 0))));
  };

  // Fills in the most the player can bet right now -- their own chips, or
  // the bank's remaining window, whichever is smaller. Nudged $1 under the
  // bank's exact cap when that's the binding constraint: applyBet on the
  // server auto-treats a bet landing exactly on the bank's available amount
  // as a bank-lock (same rule BANK! itself relies on), and that all-in
  // moment deserves the confirm dialog below, not a same-as-any-other-bet
  // MAX tap.
  const rawMax = Math.max(0, Math.min(wallet - (turn.bet ?? 0), bankIncrement));
  const maxBettable = rawMax > 1 && rawMax === bankIncrement ? rawMax - 1 : rawMax;

  const handleMax = () => {
    if (maxBettable < 1) return;
    setBetAmount(String(maxBettable));
    setBetError(undefined);
  };

  const handleBet = () => {
    const amount = Math.floor(Number(betAmount) || 0);
    if (amount < 1) {
      setBetError("Enter a bet amount of at least $1.");
      return;
    }
    const existingBet = turn.bet ?? 0;
    if (existingBet + amount > wallet) {
      setBetError("Insufficient chips for this wager.");
      return;
    }
    onBet(amount, { bank: false, eleveroon: eleveroonSelected });
    setBetError(undefined);
    setBetAmount(String(DEFAULT_BET));
  };

  // BANK! wagers the bank's entire available window in one shot -- a real
  // moment at an in-person table, so it gets its own confirm-first flow
  // rather than just arming the regular bet field.
  const bankBetAmount = bankIncrement > 0 ? bankIncrement : 0;
  const bankShortfall = (turn.bet ?? 0) + bankBetAmount > wallet;

  const confirmBank = () => {
    onBet(bankBetAmount, { bank: true, eleveroon: eleveroonSelected });
    setBankConfirmOpen(false);
    setBetError(undefined);
  };

  return (
    <div className="k-dock">
      <div className="k-betbox">
        <span className="k-cur">$</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="k-amt"
          value={betAmount}
          onChange={(e) => handleAmountChange(e.target.value)}
          onBlur={handleAmountBlur}
          onFocus={(e) => e.target.select()}
          aria-label="Bet amount"
        />
        <span className="k-stepper">
          <button type="button" className="k-stepbtn" onClick={() => adjustBet(BET_STEP)} aria-label="Increase bet">
            <Icon name="chevron-up" size={10} />
          </button>
          <button type="button" className="k-stepbtn" onClick={() => adjustBet(-BET_STEP)} aria-label="Decrease bet">
            <Icon name="chevron-down" size={10} />
          </button>
        </span>
        <button
          type="button"
          className="k-maxbtn"
          disabled={maxBettable < 1}
          onClick={handleMax}
          title="Fill in the most you can bet right now (your chips vs. what the bank can cover)."
        >
          MAX
        </button>
      </div>

      <button type="button" className="k-btn bet" onClick={handleBet}>
        Bet
      </button>
      <button type="button" className="k-btn hit" onClick={() => onHit({ eleveroon: eleveroonSelected })}>
        {drawLabel}
      </button>
      <button type="button" className="k-btn stand" onClick={onStand}>
        Stand
      </button>

      <button
        type="button"
        className="k-btn bankall sm"
        disabled={!canBank}
        style={!canBank ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
        onClick={() => setBankConfirmOpen(true)}
        title="BANK! wagers the remaining available bank for your seat; the banker must resolve it immediately."
      >
        BANK!
        {/* Hidden at the compact mobile breakpoint alongside the Eleveroon
            label -- same reasoning, buys back row width so the dock is less
            likely to wrap to a second row on a short phone screen. */}
        {typeof bankAvailable === "number" && <span className="k-bankall-amt"> ${bankAvailable.toLocaleString()}</span>}
      </button>

      <label className="k-toggle" title="Eleveroon ignores a busting eleven when your total was 11 (only after you turn it on).">
        <input type="checkbox" checked={eleveroonSelected} onChange={(e) => setEleveroonSelected(e.target.checked)} />
        {/* Stays visible at the compact mobile breakpoint (index.css), unlike
            k-bankall-amt above -- an earlier pass hid it too to buy back row
            width, but that left a bare checkbox with nothing saying what it
            does on the one platform with no hover tooltip to fall back on.
            A rule people have to opt into can't be an unlabelled box, so
            this one keeps its row rather than disappearing into one. */}
        <span className="k-toggle-label">Eleveroon</span>
      </label>

      {betError && <span className="k-tag bust">{betError}</span>}
      {!canBank && bankDisabledReason && <span className="k-tag muted">{bankDisabledReason}</span>}

      {bankConfirmOpen && (
        <div
          className="k-modal-overlay"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          onClick={() => setBankConfirmOpen(false)}
        >
          <div className="k-bank-confirm" onClick={(e) => e.stopPropagation()}>
            {bankShortfall ? (
              <>
                <div className="k-bank-confirm-title">Not enough chips</div>
                <p className="k-bank-confirm-body">
                  BANK! wagers ${bankBetAmount.toLocaleString()} -- the bank's full available window -- but you only
                  have ${wallet.toLocaleString()} to cover it.
                </p>
                <div className="k-bank-confirm-actions">
                  <button type="button" className="k-btn stand" onClick={() => setBankConfirmOpen(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="k-bank-confirm-title">Bet BANK!?</div>
                <p className="k-bank-confirm-body">
                  You're about to wager <b>${bankBetAmount.toLocaleString()}</b> -- the bank's entire available
                  window for your seat. Everyone at the table will see it. Ready?
                </p>
                <div className="k-bank-confirm-actions">
                  <button type="button" className="k-btn stand" onClick={() => setBankConfirmOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="k-btn bankall" onClick={confirmBank}>
                    Yes, bet BANK!
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
