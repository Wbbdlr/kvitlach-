export interface BankPanelProps {
  bankerWallet: number;
  bankAvailable?: number;
}

// The bank's total, centred on the felt where everyone can see it (the
// mockup's `.bank` cluster). Display-only and deliberately so: it lives
// inside the scaled stage, so any control here would shrink with the table.
// The banker's actual bank controls (top-up, table label) live in
// ManageDrawer, which renders at true viewport size.
export function BankPanel({ bankerWallet, bankAvailable }: BankPanelProps) {
  return (
    <div className="absolute left-1/2 -translate-x-1/2 z-[12] flex flex-col items-center gap-1.5" style={{ top: "300px" }}>
      <div className="k-banktotal">BANK ${bankerWallet.toLocaleString()}</div>
      {typeof bankAvailable === "number" && bankAvailable !== bankerWallet && (
        <div className="k-readout">
          available <b>${bankAvailable.toLocaleString()}</b>
        </div>
      )}
    </div>
  );
}
