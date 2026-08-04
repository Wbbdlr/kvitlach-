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
      // Anchored off the SAME 160px*vf the dealer's own seat uses (Dealer.tsx),
      // not an independent, bigger coefficient (used to be 300) -- a bigger
      // coefficient meant this pill's distance from the dealer GREW with vf,
      // so a normal (near-vf=1) desktop table left a wide, empty band of felt
      // between the dealer's total and "BANK $x" that a flattened phone table
      // never had room for. Sharing the coefficient makes the gap to the
      // dealer's total row a near-constant ~35px regardless of vf, which is
      // both the "closer to the banker" the pill was asked for and, on a
      // flattened phone, a bigger safety margin than the old formula's ~9px
      // worst case (measured live at vf 0.5, where the old pill nearly
      // touched the dealer's status tag).
      // +110 covers the dealer's own fixed (non-vf-scaled) plate+hand+total
      // content (measured ~75px tall below its anchor) PLUS the wider case
      // where the dealer is the human viewer mid-turn and Hit/Stand buttons
      // add another ~18px (measured live by mounting that exact button
      // markup) -- both clear this pill with room to spare.
      // BankReservations.tsx's potY() mirrors this exact formula (+22 more, to
      // sit just under it) so its connector lines start where this pill
      // actually renders -- change one, change both.
      style={{ top: "calc(var(--play-top, 0px) + 160px * var(--vf, 1) + 110px)" }}
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
