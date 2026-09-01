import { SeatPosition } from "./layout";
import { STAGE_HEIGHT, STAGE_WIDTH } from "./layout";
import { Icon } from "./icons";

export interface Reservation {
  playerId: string;
  amount: number;
  position: SeatPosition;
}

export interface BankReservationsProps {
  reservations: Reservation[];
  scale?: number;
  // Same two inputs TableRoot already threads through seatPositions() for
  // this exact reason -- see potPoint() below.
  playTop?: number;
  vf?: number;
}

// Mirrors Dealer.tsx's own anchor: `left: 640px; top: calc(var(--play-top) +
// 160px * var(--vf))`. A shared STAGE COORDINATE, not a measurement of anything
// the dealer renders -- its box can grow and shrink freely without moving this
// point, which is the distinction docs/mobile-ui.md Part 2 rule 2 draws. If
// that anchor moves in Dealer.tsx, move it here.
const DEALER_ANCHOR_Y_COEF = 160;

// Where the lines start: the dealer, because the dealer IS the bank.
//
// These used to originate at the BANK pill's own floating position, tracking it
// through bankPanelPlacement() so the lines followed it when it slid out to the
// rail. The pill has now left the felt entirely for the HUD frame (see
// BankPanel.tsx), and connector lines cannot follow it there -- an SVG line
// drawn to a point outside the stage would leave the felt and point at chrome.
//
// Anchoring to the dealer is not a fallback, it is what this always meant: a
// reservation is money the BANK is holding, and the bank sits at the top of the
// oval. Lines now emerge from behind the dealer's own box (.k-resv-lines is a
// lower tier than .k-seat, so the dealer paints over the origin), which reads
// as chips pushed out from the bank rather than trailing a floating badge.
function potPoint(playTop: number, vf: number): { x: number; y: number } {
  return { x: STAGE_WIDTH / 2, y: playTop + DEALER_ANCHOR_Y_COEF * vf };
}

// Chips rest a fixed distance BACK from the seat rather than at a fixed
// fraction of the way there: seats sit at very different distances from the
// pot on an ellipse this eccentric (the flanks are ~350px out, the viewer's
// own bottom-centre seat as little as ~140px at a flattened vf), so a single
// fraction either crowded the near seat or stranded the far ones by the pot.
// Measuring back from the seat gives every badge the same clearance -- seats
// paint over these (z-index 10 vs 9), so grazing one clips it.
//
// This constant is in NOMINAL (unscaled) stage-px, matching seatPositions()'s
// own output -- but the SEAT ITSELF shrinks at higher player counts
// (TableRoot's seatShrink, passed in here as `scale`), while this number
// didn't. Reported live: at 6-7 players the real seat measured ~60px half-
// extent on screen, but the clearance stayed a flat 130, so every badge
// floated a measured ~70px past the seat's own edge -- reading as "not near
// their names" because, proportionally, it wasn't. restPoint/isPlaceable
// now take `scale` and apply it to this constant, so the gap shrinks in step
// with the seat instead of growing relatively bigger as the table fills up.
const SEAT_CLEARANCE = 130;
// ...but never so far back that a badge lands on the pot itself, nor so far
// out that it drifts into the seat's own hand.
const T_MIN = 0.34;
const T_MAX = 0.7;

// Below this, there is no straight-line point that clears both ends at once:
// the pot-side floor (T_MIN) and the seat-side clearance (SEAT_CLEARANCE)
// overlap. Measured on a live table: the viewer's own bottom-centre seat is
// the one this actually happens to (it is closest to the pot by construction,
// and gets closer still as the table flattens) -- at a distance of 142px, the
// T_MIN-clamped point landed 20-30px INSIDE the viewer's own plate, hidden
// behind it (seats paint over badges), on exactly the seat a player looks at
// first to check the bank is showing their bet at all. There is no constant
// that fixes this without breaking something else: more SEAT_CLEARANCE just
// pushes the badge further past T_MIN with no effect (T_MIN is already what's
// binding), and loosening T_MIN would drop it onto the pot end instead --
// which is now the dealer's own box, since the BANK pill it used to be has
// left the felt. So below this threshold the badge is skipped rather than forced
// into a collision -- every seat's plate already prints "$wallet · $bet" (see
// Seat.tsx), so the information survives, just without this particular
// seat's dashed line to the pot.
function minViableDistance(scale: number): number {
  return (SEAT_CLEARANCE * scale) / (1 - T_MIN);
}

function restPoint(position: SeatPosition, pot: { x: number; y: number }, scale: number): { x: number; y: number } {
  const dx = position.x - pot.x;
  const dy = position.y - pot.y;
  const distance = Math.hypot(dx, dy);
  const clearance = SEAT_CLEARANCE * scale;
  const t = distance > 0 ? Math.min(T_MAX, Math.max(T_MIN, (distance - clearance) / distance)) : T_MIN;
  return { x: pot.x + dx * t, y: pot.y + dy * t };
}

function isPlaceable(position: SeatPosition, pot: { x: number; y: number }, scale: number): boolean {
  return Math.hypot(position.x - pot.x, position.y - pot.y) >= minViableDistance(scale);
}

// Chips the bank has committed to wagers it hasn't settled yet, drawn on the
// line between the bank and the player each one is covering.
//
// The bank can only cover so much at once: every live wager ahead of you eats
// into what you're allowed to bet, which is why a BANK! window shrinks as the
// round goes round and why a table can stall on an empty bank. None of that
// was visible before -- players just found their limit had moved.
export function BankReservations({ reservations, scale = 1, playTop = 0, vf = 1 }: BankReservationsProps) {
  const pot = potPoint(playTop, vf);
  const placeable = reservations.filter((r) => isPlaceable(r.position, pot, scale));
  if (placeable.length === 0) return null;

  return (
    <>
      <svg
        className="k-resv-lines"
        viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        aria-hidden="true"
      >
        {placeable.map((r) => {
          const end = restPoint(r.position, pot, scale);
          return (
            <line
              key={r.playerId}
              x1={pot.x}
              y1={pot.y}
              x2={end.x}
              y2={end.y}
              className="k-resv-line"
            />
          );
        })}
      </svg>

      {placeable.map((r) => {
        const at = restPoint(r.position, pot, scale);
        return (
          <div
            key={r.playerId}
            className="k-resv"
            style={{
              left: `${at.x}px`,
              top: `${at.y}px`,
              transform: `translate(-50%, -50%) scale(${scale})`,
            }}
            title={`The bank is holding $${r.amount.toLocaleString()} to cover this wager.`}
          >
            <Icon name="coins" size={11} />
            <span className="k-resv-amt">${r.amount.toLocaleString()}</span>
          </div>
        );
      })}
    </>
  );
}
