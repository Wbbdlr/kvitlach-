import { ReactNode } from "react";

export interface BankPanelProps {
  bankerWallet: number;
  reserved?: number;
  /**
   * The banker's own HAND total ("Total: 17"), the same .k-readout pill every
   * player seat renders below its cards. It rides this row for the same reason
   * the status tag does -- the row already exists, so carrying it costs the
   * dealer's column no height, and it sits BELOW the hand where a growing hand
   * cannot overrun it (which is exactly how the old `is-flanking` attempt
   * died; see index.css).
   */
  total?: ReactNode;
  /**
   * The banker's own turn status tag, rendered beside the total. Passed in
   * rather than derived here because it is the DEALER's state, not the bank's
   * -- this component only knows about money. It shares this row because the
   * row already exists, which is what let Dealer.tsx delete its status row
   * outright instead of relocating it for a third time.
   */
  status?: ReactNode;
}

// The bank's total, and what of it is spoken for.
//
// This used to FLOAT in the felt's centre column, positioned by arithmetic that
// measured the dealer's box above it and the viewer's plate below it
// (DEALER_BOTTOM_CONST, VIEWER_PLATE_TOP_CONST, BANK_PILL_HEIGHT,
// DEALER_STATUS_ROW_H) and tried to find a gap between them. There was no gap.
// At 844x390 the play area is ~280px tall and the dealer plus the viewer's own
// seat need 207-280px of it: the two walls the formula measured were already
// touching, so bankPanelTop() was solving a problem with no solution and
// bankPanelPlacement() eventually exiled the pill to the left rail, which read
// -- correctly -- as "nowhere near the centre of the table".
//
// It now renders as the first child of the DEALER's own .k-seat column
// (Dealer.tsx), which is a flex column with a gap: position by FLOW, nothing
// measured, overlap with its neighbours structurally impossible. It briefly
// lived in the top chrome row instead -- that fixed the collision but put the
// bank's money in a corner of the screen, which was reported as making no
// sense, and it was right. The bank IS the banker; its money belongs on its
// plate. See docs/mobile-ui.md Part 2 rule 3.
//
// Deliberately the TABLE-wide split, so the three figures always add up for
// everyone watching. A player's own betting limit is a different number -- it
// only counts wagers ahead of them in turn order, and it's shown where they
// actually need it, on the dock's bet controls.
export function BankPanel({ bankerWallet, reserved = 0, total, status }: BankPanelProps) {
  const free = Math.max(bankerWallet - reserved, 0);

  return (
    <div className="k-bank-hud">
      <div className="k-bank-hud-row">
        <div className="k-banktotal">BANK ${bankerWallet.toLocaleString()}</div>
        {total}
        {status}
      </div>
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
