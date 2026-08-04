export interface BankPanelProps {
  bankerWallet: number;
  reserved?: number;
}

// The bank's total, centred on the felt where everyone can see it (the
// mockup's `.bank` cluster). Display-only and deliberately so: it lives
// inside the scaled stage, so any control here would shrink with the table.
// The banker's actual bank controls (top-up, table label) live in
// ManageDrawer, which renders at true viewport size.
export function BankPanel({ bankerWallet, reserved = 0 }: BankPanelProps) {
  // Deliberately the TABLE-wide split, so the three figures always add up for
  // everyone watching. A player's own betting limit is a different number --
  // it only counts wagers ahead of them in turn order, and it's shown where
  // they actually need it, on the dock's bet controls.
  const free = Math.max(bankerWallet - reserved, 0);

  return (
    // One row, not two. The reservation used to sit on its own line beneath
    // the total, and the panel is anchored by its TOP -- so that second line
    // grew downward, straight onto the bottom seat's name plate. Measured on a
    // landscape phone (vf 0.54): 21px over "Guest (you)", covering their own
    // name and wallet, on every round where anyone had a live wager. The felt's
    // centre is too tight at that flattening to grow upward instead (the
    // dealer's total is right above), so the fix is to stop growing at all.
    <div
      className="absolute left-1/2 -translate-x-1/2 z-[12] flex flex-row flex-wrap items-center justify-center gap-x-2.5 gap-y-1"
      // The +14 is deliberately NOT scaled by --vf. Everything above this in
      // the centre column -- the dealer's plate, cards and total row -- is
      // fixed-size content that does not shrink when the table flattens, so a
      // purely vf-scaled offset closes on it: at vf 0.54 this pill landed on
      // the dealer's status tag and painted over it. It stays small because
      // Dealer.tsx also puts that tag on the total's row rather than its own;
      // without that, the clearance needed to miss the dealer was big enough
      // to land the panel on the viewer's seat below instead.
      // BankReservations.tsx's potY() mirrors this exact formula (+22 more, to
      // sit just under it) so its connector lines start where this pill
      // actually renders -- change one, change both.
      style={{ top: "calc(var(--play-top, 0px) + 300px * var(--vf, 1) + 14px)" }}
    >
      <div className="k-banktotal">BANK ${bankerWallet.toLocaleString()}</div>
      {reserved > 0 && (
        <div className="k-readout k-bank-split">
          <span>
            reserved <b>${reserved.toLocaleString()}</b>
          </span>
          <span className="k-bank-split-sep" aria-hidden="true" />
          <span>
            free <b>${free.toLocaleString()}</b>
          </span>
        </div>
      )}
    </div>
  );
}
