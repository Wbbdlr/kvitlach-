import { useState } from "react";
import { Turn } from "../types";
import { Icon } from "./icons";

const DEFAULT_BET = 5;
const BET_STEP = 5;

export interface PlayerDockProps {
  turn: Turn;
  wallet: number;
  bankAvailable?: number;
  bankIncrement: number;
  canBank: boolean;
  bankDisabledReason?: string;
  onBet: (amount: number, options: { bank: boolean }) => void;
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
  const [betAmount, setBetAmount] = useState(DEFAULT_BET);
  const [bankSelected, setBankSelected] = useState(false);
  const [eleveroonSelected, setEleveroonSelected] = useState(false);
  const [betError, setBetError] = useState<string | undefined>(undefined);

  const hasBet = (turn.bet ?? 0) > 0;
  const drawLabel = hasBet ? "Hit" : "Blatt";

  const adjustBet = (delta: number) => {
    setBetAmount((prev) => Math.max(1, prev + delta));
    if (bankSelected) setBankSelected(false);
    setBetError(undefined);
  };

  const toggleBank = (selected: boolean) => {
    if (!selected) {
      setBankSelected(false);
      setBetError(undefined);
      return;
    }
    if (!canBank) return;
    setBankSelected(true);
    setBetAmount(bankIncrement > 0 ? bankIncrement : 0);
    setBetError(undefined);
  };

  const handleBet = () => {
    const existingBet = turn.bet ?? 0;
    if (existingBet + betAmount > wallet) {
      setBetError("Insufficient chips for this wager.");
      return;
    }
    onBet(betAmount, { bank: bankSelected });
    setBankSelected(false);
    setBetError(undefined);
    setBetAmount(DEFAULT_BET);
  };

  return (
    <div className="k-dock">
      <div className="k-betbox">
        <span className="k-cur">$</span>
        <span className="k-amt">{betAmount}</span>
        <span className="k-stepper">
          <button type="button" className="k-stepbtn" onClick={() => adjustBet(BET_STEP)} aria-label="Increase bet">
            <Icon name="chevron-up" size={10} />
          </button>
          <button type="button" className="k-stepbtn" onClick={() => adjustBet(-BET_STEP)} aria-label="Decrease bet">
            <Icon name="chevron-down" size={10} />
          </button>
        </span>
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
        // This wagers the entire remaining bank, so its armed state has to be
        // exposed programmatically, not just via the label text (it was a
        // real checkbox before this became a button).
        aria-pressed={bankSelected}
        style={!canBank ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
        onClick={() => toggleBank(!bankSelected)}
        title="BANK! wagers the remaining available bank for your seat; the banker must resolve it immediately."
      >
        {bankSelected ? "BANK! armed" : "BANK!"}
        {typeof bankAvailable === "number" && ` $${bankAvailable.toLocaleString()}`}
      </button>

      <label className="k-toggle" title="Eleveroon ignores a busting eleven when your total was 11 (only after you turn it on).">
        <input type="checkbox" checked={eleveroonSelected} onChange={(e) => setEleveroonSelected(e.target.checked)} />
        Eleveroon
      </label>

      {betError && <span className="k-tag bust">{betError}</span>}
      {!canBank && bankDisabledReason && <span className="k-tag muted">{bankDisabledReason}</span>}
    </div>
  );
}
