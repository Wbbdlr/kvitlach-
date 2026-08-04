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
}

// Where the bank's money sits on the felt -- just under the BANK total (see
// BankPanel, which is anchored at 300px), so a reservation reads as chips
// pushed out FROM the bank.
const POT_X = STAGE_WIDTH / 2;
const POT_Y = 336;

// Chips rest a fixed distance BACK from the seat rather than at a fixed
// fraction of the way there: seats sit at very different distances from the
// pot on an ellipse this eccentric (the flanks are ~350px out, the viewer's
// own bottom-centre seat as little as ~140px at a flattened vf), so a single
// fraction either crowded the near seat or stranded the far ones by the pot.
// Measuring back from the seat gives every badge the same clearance -- seats
// paint over these (z-index 10 vs 9), so grazing one clips it.
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
// binding), and loosening T_MIN would drop it onto the "BANK $x" pill
// instead. So below this threshold the badge is skipped rather than forced
// into a collision -- every seat's plate already prints "$wallet · $bet" (see
// Seat.tsx), so the information survives, just without this particular
// seat's dashed line to the pot.
const MIN_VIABLE_DISTANCE = SEAT_CLEARANCE / (1 - T_MIN);

function restPoint(position: SeatPosition): { x: number; y: number } {
  const dx = position.x - POT_X;
  const dy = position.y - POT_Y;
  const distance = Math.hypot(dx, dy);
  const t = distance > 0 ? Math.min(T_MAX, Math.max(T_MIN, (distance - SEAT_CLEARANCE) / distance)) : T_MIN;
  return { x: POT_X + dx * t, y: POT_Y + dy * t };
}

function isPlaceable(position: SeatPosition): boolean {
  return Math.hypot(position.x - POT_X, position.y - POT_Y) >= MIN_VIABLE_DISTANCE;
}

// Chips the bank has committed to wagers it hasn't settled yet, drawn on the
// line between the bank and the player each one is covering.
//
// The bank can only cover so much at once: every live wager ahead of you eats
// into what you're allowed to bet, which is why a BANK! window shrinks as the
// round goes round and why a table can stall on an empty bank. None of that
// was visible before -- players just found their limit had moved.
export function BankReservations({ reservations, scale = 1 }: BankReservationsProps) {
  const placeable = reservations.filter((r) => isPlaceable(r.position));
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
          const end = restPoint(r.position);
          return (
            <line
              key={r.playerId}
              x1={POT_X}
              y1={POT_Y}
              x2={end.x}
              y2={end.y}
              className="k-resv-line"
            />
          );
        })}
      </svg>

      {placeable.map((r) => {
        const at = restPoint(r.position);
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
