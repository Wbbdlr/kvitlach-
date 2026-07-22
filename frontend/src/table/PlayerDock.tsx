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
    <div className="fixed bottom-0 left-0 right-0 z-30 flex flex-col items-center gap-1 px-2 pb-2 pt-1">
      <div className="flex flex-wrap items-center justify-center gap-1">
        <div className="flex items-center gap-0.5 rounded-full border border-slate-300 bg-white/95 px-0.5 py-0.5 shadow">
          <button
            type="button"
            className="h-5 w-5 rounded-full text-xs text-slate-600 hover:bg-slate-100"
            onClick={() => adjustBet(-BET_STEP)}
            aria-label="Decrease bet"
          >
            &minus;
          </button>
          <span className="w-9 text-center text-xs font-semibold">${betAmount}</span>
          <button
            type="button"
            className="h-5 w-5 rounded-full text-xs text-slate-600 hover:bg-slate-100"
            onClick={() => adjustBet(BET_STEP)}
            aria-label="Increase bet"
          >
            +
          </button>
        </div>

        <label
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-1.5 py-1 text-[10px] font-semibold text-slate-600 shadow"
          title="BANK! bets the remaining available bank for your seat; the banker must resolve this wager immediately."
        >
          <input
            type="checkbox"
            className="h-3 w-3"
            checked={bankSelected}
            disabled={!canBank}
            onChange={(e) => toggleBank(e.target.checked)}
          />
          <Icon name="bank" size={10} />
          BANK!
          {typeof bankAvailable === "number" && <span className="text-slate-400">${bankAvailable.toLocaleString()}</span>}
        </label>

        <label
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-1.5 py-1 text-[10px] font-semibold text-slate-600 shadow"
          title="Eleveroon ignores a busting eleven when your total was 11 (only after you turn it on)."
        >
          <input type="checkbox" className="h-3 w-3" checked={eleveroonSelected} onChange={(e) => setEleveroonSelected(e.target.checked)} />
          Eleveroon
        </label>
      </div>

      {betError && <span className="rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-rose-600 shadow">{betError}</span>}
      {!canBank && bankDisabledReason && <span className="rounded-full bg-white/80 px-2 py-0.5 text-[9px] text-slate-500">{bankDisabledReason}</span>}

      <div className="flex items-center justify-center gap-1.5">
        <button
          type="button"
          className="rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow"
          style={{ background: "var(--btn-bet)" }}
          onClick={handleBet}
        >
          Bet
        </button>
        <button
          type="button"
          className="rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow"
          style={{ background: "var(--btn-hit)" }}
          onClick={() => onHit({ eleveroon: eleveroonSelected })}
        >
          {drawLabel}
        </button>
        <button
          type="button"
          className="rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow"
          style={{ background: "var(--btn-stand)" }}
          onClick={onStand}
        >
          Stand
        </button>
      </div>
    </div>
  );
}
