import { useRef, useState } from "react";
import { Icon } from "./icons";
import { useClickOutside } from "./clickOutside";

export interface BankPanelProps {
  bankerWallet: number;
  bankAvailable?: number;
  isBanker: boolean;
  feltWatermark?: string;
  onTopUp: (amount: number, note?: string) => void;
  onSetWatermark: (text: string) => void;
}

// The bank's total, centered on the felt where everyone can see it (the
// mockup's `.bank` cluster). The banker additionally gets an add/subtract
// popup and the felt-watermark editor.
export function BankPanel({
  bankerWallet,
  bankAvailable,
  isBanker,
  feltWatermark,
  onTopUp,
  onSetWatermark,
}: BankPanelProps) {
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpSign, setTopUpSign] = useState<1 | -1>(1);
  const [topUpAmount, setTopUpAmount] = useState("500");
  const [topUpNote, setTopUpNote] = useState("");

  const [showWatermark, setShowWatermark] = useState(false);
  const [watermarkInput, setWatermarkInput] = useState(feltWatermark ?? "");

  const topUpRef = useRef<HTMLDivElement>(null);
  const watermarkRef = useRef<HTMLDivElement>(null);
  useClickOutside([topUpRef], () => setShowTopUp(false), showTopUp);
  useClickOutside([watermarkRef], () => setShowWatermark(false), showWatermark);

  const applyTopUp = () => {
    const amount = Math.round(Number(topUpAmount));
    if (!Number.isFinite(amount) || amount <= 0) return;
    onTopUp(amount * topUpSign, topUpNote.trim() || undefined);
    setShowTopUp(false);
    setTopUpAmount("500");
    setTopUpNote("");
  };

  const applyWatermark = () => {
    onSetWatermark(watermarkInput.trim());
    setShowWatermark(false);
  };

  return (
    <div className="absolute left-1/2 -translate-x-1/2 z-[8] flex flex-col items-center gap-1.5" style={{ top: "300px" }}>
      <div className="k-banktotal">BANK ${bankerWallet.toLocaleString()}</div>
      {typeof bankAvailable === "number" && bankAvailable !== bankerWallet && (
        <div className="k-readout">
          available <b>${bankAvailable.toLocaleString()}</b>
        </div>
      )}

      {isBanker && (
        <div className="flex gap-1.5">
          <button type="button" className="k-chip-btn" onClick={() => setShowTopUp((v) => !v)}>
            <Icon name="coins" size={11} />
            Adjust
          </button>
          <button type="button" className="k-chip-btn" onClick={() => setShowWatermark((v) => !v)} title="Table label">
            <Icon name="pencil" size={11} />
          </button>
        </div>
      )}

      {showTopUp && (
        <div ref={topUpRef} className="rounded-lg bg-white shadow-lg border border-slate-200 p-3 w-64 text-sm text-slate-800">
          <div className="flex gap-1 mb-2">
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${topUpSign === 1 ? "bg-amber-100 text-amber-800 border border-amber-300" : "bg-slate-50 text-slate-500 border border-slate-200"}`}
              onClick={() => setTopUpSign(1)}
            >
              + Add
            </button>
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${topUpSign === -1 ? "bg-amber-100 text-amber-800 border border-amber-300" : "bg-slate-50 text-slate-500 border border-slate-200"}`}
              onClick={() => setTopUpSign(-1)}
            >
              &minus; Subtract
            </button>
          </div>
          <label className="block text-xs text-slate-500 mb-1">Amount</label>
          <input
            type="number"
            min={1}
            value={topUpAmount}
            onChange={(e) => setTopUpAmount(e.target.value)}
            className="w-full border rounded px-2 py-1 mb-2"
          />
          <label className="block text-xs text-slate-500 mb-1">Note (optional)</label>
          <input
            type="text"
            value={topUpNote}
            onChange={(e) => setTopUpNote(e.target.value)}
            placeholder="e.g. replenishing after payout"
            className="w-full border rounded px-2 py-1 mb-2"
          />
          <div className="text-[11px] text-slate-400 mb-2">Everyone at the table sees a notification when the bank total changes.</div>
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-1 text-xs text-slate-500" onClick={() => setShowTopUp(false)}>
              Cancel
            </button>
            <button type="button" className="px-3 py-1 text-xs font-semibold rounded bg-emerald-600 text-white" onClick={applyTopUp}>
              Apply
            </button>
          </div>
        </div>
      )}

      {showWatermark && (
        <div ref={watermarkRef} className="rounded-lg bg-white shadow-lg border border-slate-200 p-3 w-64 text-sm text-slate-800">
          <label className="block text-xs text-slate-500 mb-1">Table label (shown faintly on the felt)</label>
          <input
            type="text"
            value={watermarkInput}
            onChange={(e) => setWatermarkInput(e.target.value)}
            placeholder="e.g. the Schlesinger family's table"
            className="w-full border rounded px-2 py-1 mb-2"
            maxLength={60}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-1 text-xs text-slate-500" onClick={() => setShowWatermark(false)}>
              Cancel
            </button>
            <button type="button" className="px-3 py-1 text-xs font-semibold rounded bg-emerald-600 text-white" onClick={applyWatermark}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
