export interface BankPanelProps {
  bankerWallet: number;
  reserved?: number;
  // Same two inputs BankReservations.tsx already takes, for the same reason
  // -- see bankPanelTop() below.
  playTop?: number;
  vf?: number;
}

// The dealer's own content clears roughly this far below its anchor (plate +
// hand + total row; ~75px in the common case) -- mirrors Dealer.tsx's own
// `top: calc(var(--play-top) + 160px * var(--vf))` anchor.
const DEALER_BOTTOM_COEF = 160;
const DEALER_BOTTOM_CONST = 75;
// How far below the dealer's own content this pill WANTS to sit, room
// permitting -- this is what "closer to the banker" actually means: not a
// fixed screen position, a fixed gap below whatever the dealer's box ends
// at. Reconstructs the exact `160px*vf + 110px` anchor tuned and verified
// live earlier (75 + 35 = 110) -- confirmed below (see bankPanelTop) that
// every vf this pill was checked at back then (0.7, 1) still lands on this
// exact value; only the flattened band nearer vf's floor (~0.5-0.58, not
// covered by that earlier check) is where the ceiling below now binds
// instead.
const DESIRED_GAP_FROM_DEALER = 35;

// The viewer's own bottom-centre seat is the OTHER wall this pill has to
// clear -- mirrors layout.ts's seatPositions() (seat centre at
// `(CY + RY) * vf + playTop` for the angle=180 seat, confirmed live via the
// seat wrapper's own rendered `top` style, which matches this exactly).
const VIEWER_PLATE_TOP_COEF = 372 + 198; // CY + RY, layout.ts
// NOT SEAT_HEIGHT/2 (layout.ts's 200 is a collision-spacing reservation, not
// the seat's true rendered size) -- this is half the seat wrapper's actual
// rendered content height, measured live via getBoundingClientRect at two
// very different vf values (0.5 and 1) that both came back with an
// identical 205.75px nominal height, confirming the seat's own content
// height doesn't scale with vf at all (only its *position* does) so one
// flat constant is correct here rather than something *vf needs.
const VIEWER_PLATE_TOP_CONST = 205.75 / 2;

// How tall this pill itself renders (nominal stage px), single-row, compact
// (mobile) styling -- measured live via getBoundingClientRect at the exact
// viewport the overlap bug was reported on (800x360 landscape). This is the
// piece the plain "closer to banker" formula never accounted for: it only
// ever anchored the pill's TOP edge, so even when that anchor looked clear
// of the viewer's plate, the pill's own BOTTOM edge -- extending down from
// that anchor -- could still land on it. Below, `ceiling` reserves this much
// room so the whole pill has to fit, not just its top-left corner.
//
// Known gap: at non-compact sizing (wider desktop windows, bigger font/
// padding -- this pill measures taller there, ~38.5) vf can *in theory* still
// sit near its 0.5 floor if the window is wide-but-short rather than a phone
// screen -- isCompact keys off real CSS width/height, not vf, so the two can
// diverge. Threading isCompact down here to pick between two constants would
// close that gap, but it's a desktop-window corner case, not the reported
// (mobile/landscape) bug, and every realistic phone-landscape viewport hits
// the compact breakpoint on height alone (real phones land well under the
// 440px cutoff) -- so it's left as a known limit rather than solved here.
const BANK_PILL_HEIGHT = 24;

// Where this pill actually renders: as close to the dealer as it wants to be
// (DESIRED_GAP_FROM_DEALER), UNLESS there isn't enough room -- the two walls
// are ~230px apart at vf=1, comfortably clear, but only ~27px apart at vf's
// floor (0.5, a flattened landscape phone), just barely more than the pill's
// own height. Measured live: the old dealer-only anchor landed this pill
// squarely on the viewer's own "Guest (you)" plate at that flattening,
// hiding their own name and wallet -- on exactly the viewport this whole
// flattening mechanism exists to serve. `ceiling` is the hard limit (the
// pill's own bottom edge must clear the plate, full stop); `midpoint` splits
// whatever room is left between the two walls evenly rather than the
// fixed-gap math pushing the pill's bottom past the far one; `desired` wins
// whenever there's room for it, which is every vf above ~0.58.
export function bankPanelTop(playTop: number, vf: number): number {
  const dealerBottom = playTop + DEALER_BOTTOM_COEF * vf + DEALER_BOTTOM_CONST;
  const viewerPlateTop = playTop + VIEWER_PLATE_TOP_COEF * vf - VIEWER_PLATE_TOP_CONST;
  const desired = dealerBottom + DESIRED_GAP_FROM_DEALER;
  const ceiling = viewerPlateTop - BANK_PILL_HEIGHT;
  const midpoint = (dealerBottom + ceiling) / 2;
  return Math.min(desired, midpoint, ceiling);
}

// The bank's total, centred on the felt where everyone can see it (the
// mockup's `.bank` cluster). Display-only and deliberately so: it lives
// inside the scaled stage, so any control here would shrink with the table.
// The banker's actual bank controls (top-up, table label) live in
// ManageDrawer, which renders at true viewport size.
export function BankPanel({ bankerWallet, reserved = 0, playTop = 0, vf = 1 }: BankPanelProps) {
  // Deliberately the TABLE-wide split, so the three figures always add up for
  // everyone watching. A player's own betting limit is a different number --
  // it only counts wagers ahead of them in turn order, and it's shown where
  // they actually need it, on the dock's bet controls.
  const free = Math.max(bankerWallet - reserved, 0);
  const top = bankPanelTop(playTop, vf);

  return (
    // One row, not two. The reservation used to sit on its own line beneath
    // the total, growing downward onto the bottom seat's name plate below --
    // see the fixed-row layout this became instead. Still one row: at the
    // tightest vf there's only a few px of clearance on either side (see
    // bankPanelTop above), which a second line would blow straight through
    // regardless of where exactly this pill sits.
    <div
      className="absolute left-1/2 -translate-x-1/2 z-[12] flex flex-row flex-wrap items-center justify-center gap-x-2.5 gap-y-1"
      // BankReservations.tsx's potY() mirrors bankPanelTop() (+ this pill's
      // own height, to sit just under it) so its connector lines start where
      // this pill actually renders -- change one, change both.
      style={{ top: `${top}px` }}
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
