import { useState } from "react";
import { Turn } from "../types";
import { Icon } from "./icons";

const DEFAULT_BET = 5;
const BET_STEP = 1;

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
  // Tracked as a string (not a number) so the field can sit empty mid-edit
  // while the player retypes it -- a number-backed value would fight any
  // attempt to clear the field before entering a new amount.
  const [betAmount, setBetAmount] = useState(String(DEFAULT_BET));
  const [bankSelected, setBankSelected] = useState(false);
  const [eleveroonSelected, setEleveroonSelected] = useState(false);
  const [betError, setBetError] = useState<string | undefined>(undefined);

  const hasBet = (turn.bet ?? 0) > 0;
  const drawLabel = hasBet ? "Hit" : "Blatt";

  const adjustBet = (delta: number) => {
    setBetAmount((prev) => String(Math.max(1, Math.floor(Number(prev) || 0) + delta)));
    if (bankSelected) setBankSelected(false);
    setBetError(undefined);
  };

  const handleAmountChange = (raw: string) => {
    // Digits only, and allow empty while the player is mid-retype.
    if (raw !== "" && !/^\d*$/.test(raw)) return;
    setBetAmount(raw);
    if (bankSelected) setBankSelected(false);
    setBetError(undefined);
  };

  const handleAmountBlur = () => {
    setBetAmount(String(Math.max(1, Math.floor(Number(betAmount) || 0))));
  };

  const toggleBank = (selected: boolean) => {
    if (!selected) {
      setBankSelected(false);
      setBetError(undefined);
      return;
    }
    if (!canBank) return;
    setBankSelected(true);
    setBetAmount(String(bankIncrement > 0 ? bankIncrement : 0));
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
    onBet(amount, { bank: bankSelected });
    setBankSelected(false);
    setBetError(undefined);
    setBetAmount(String(DEFAULT_BET));
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
        {/* Hidden at the compact mobile breakpoint alongside the Eleveroon
            label -- same reasoning, buys back row width so the dock is less
            likely to wrap to a second row on a short phone screen. */}
        {typeof bankAvailable === "number" && <span className="k-bankall-amt"> ${bankAvailable.toLocaleString()}</span>}
      </button>

      <label className="k-toggle" title="Eleveroon ignores a busting eleven when your total was 11 (only after you turn it on).">
        <input type="checkbox" checked={eleveroonSelected} onChange={(e) => setEleveroonSelected(e.target.checked)} />
        {/* Hidden at the compact mobile breakpoint (index.css) -- the
            checkbox and title tooltip stay, only the label text goes, to
            free up row width so the dock is less likely to wrap to a second
            row on a short phone screen. */}
        <span className="k-toggle-label">Eleveroon</span>
      </label>

      {betError && <span className="k-tag bust">{betError}</span>}
      {!canBank && bankDisabledReason && <span className="k-tag muted">{bankDisabledReason}</span>}
    </div>
  );
}
