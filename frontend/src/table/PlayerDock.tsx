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

// Fixed bottom control bar for the viewer's own active turn. Bet defaults to
// $5 with a +/- $5 stepper; Eleveroon defaults OFF for players (the banker's
// Eleveroon is always-on and handled separately by Dealer.tsx); the draw
// button relabels Blatt -> Hit the moment a real wager is on the table,
// driven directly off the server-authoritative turn.bet (no local flag).
export function PlayerDock({ turn, wallet, bankAvailable, bankIncrement, canBank, bankDisabledReason, onBet, onHit, onStand }: PlayerDockProps) {
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
    <div className="fixed bottom-0 left-0 right-0 z-30 flex flex-wrap items-center justify-center gap-2 bg-white/95 px-3 py-2 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-1 rounded-full border border-slate-300 bg-white px-1 py-1">
        <button
          type="button"
          className="h-7 w-7 rounded-full text-slate-600 hover:bg-slate-100"
          onClick={() => adjustBet(-BET_STEP)}
          aria-label="Decrease bet"
        >
          &minus;
        </button>
        <span className="w-12 text-center text-sm font-semibold">${betAmount}</span>
        <button
          type="button"
          className="h-7 w-7 rounded-full text-slate-600 hover:bg-slate-100"
          onClick={() => adjustBet(BET_STEP)}
          aria-label="Increase bet"
        >
          +
        </button>
      </div>

      {betError && <span className="text-xs text-rose-600">{betError}</span>}

      <label
        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600"
        title="BANK! bets the remaining available bank for your seat; the banker must resolve this wager immediately."
      >
        <input
          type="checkbox"
          checked={bankSelected}
          disabled={!canBank}
          onChange={(e) => toggleBank(e.target.checked)}
        />
        <Icon name="bank" size={12} />
        BANK!
        {typeof bankAvailable === "number" && <span className="text-slate-400">${bankAvailable.toLocaleString()}</span>}
      </label>
      {!canBank && bankDisabledReason && <span className="text-[10px] text-slate-400">{bankDisabledReason}</span>}

      <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600" title="Eleveroon ignores a busting eleven when your total was 11 (only after you turn it on).">
        <input type="checkbox" checked={eleveroonSelected} onChange={(e) => setEleveroonSelected(e.target.checked)} />
        Eleveroon
      </label>

      <button
        type="button"
        className="rounded px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "var(--btn-bet)" }}
        onClick={handleBet}
      >
        Bet
      </button>
      <button
        type="button"
        className="rounded px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "var(--btn-hit)" }}
        onClick={() => onHit({ eleveroon: eleveroonSelected })}
      >
        {drawLabel}
      </button>
      <button
        type="button"
        className="rounded px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "var(--btn-stand)" }}
        onClick={onStand}
      >
        Stand
      </button>
    </div>
  );
}
