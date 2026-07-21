import { useRef, useState } from "react";
import { Icon } from "./icons";
import { useClickOutside } from "./clickOutside";

export interface BankPanelProps {
  bankerName: string;
  bankerWallet: number;
  isBanker: boolean;
  feltWatermark?: string;
  onTopUp: (amount: number, note?: string) => void;
  onSetWatermark: (text: string) => void;
}

// Bank total display, visible to everyone. The banker gets an "Adjust"
// control that opens a popup to add or subtract a chosen amount (with an
// optional note) rather than a single fixed top-up button, plus a watermark
// editor for the table's felt label.
export function BankPanel({ bankerName, bankerWallet, isBanker, feltWatermark, onTopUp, onSetWatermark }: BankPanelProps) {
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
    <div className="absolute top-2 right-2 flex flex-col items-end gap-1 z-20">
      <div className="rounded-lg bg-white/95 px-3 py-1.5 shadow flex items-center gap-2 text-xs font-semibold text-slate-800">
        <Icon name="bank" size={13} className="text-amber-700" />
        <span>{bankerName}</span>
        <span>${bankerWallet.toLocaleString()}</span>
        {isBanker && (
          <button type="button" className="text-blue-600 underline" onClick={() => setShowTopUp((v) => !v)}>
            Adjust
          </button>
        )}
        {isBanker && (
          <button type="button" className="text-slate-500 underline" onClick={() => setShowWatermark((v) => !v)}>
            <Icon name="pencil" size={11} />
          </button>
        )}
      </div>

      {showTopUp && (
        <div ref={topUpRef} className="rounded-lg bg-white shadow-lg border border-slate-200 p-3 w-64 text-sm">
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
        <div ref={watermarkRef} className="rounded-lg bg-white shadow-lg border border-slate-200 p-3 w-64 text-sm">
          <label className="block text-xs text-slate-500 mb-1">Table watermark</label>
          <input
            type="text"
            value={watermarkInput}
            onChange={(e) => setWatermarkInput(e.target.value)}
            placeholder="e.g. the Smith family's table"
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
