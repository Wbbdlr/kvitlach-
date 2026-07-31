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
// pot on an ellipse this eccentric (the bottom seat is ~230px away, the
// flanks nearly 400), so a single fraction either crowded the near seat or
// stranded the far ones by the pot. Measuring back from the seat gives every
// badge the same clearance -- seats paint over these (z-index 10 vs 9), so
// grazing one clips it.
const SEAT_CLEARANCE = 130;
// ...but never so far back that a badge lands on the pot itself, nor so far
// out that it drifts into the seat's own hand.
const T_MIN = 0.34;
const T_MAX = 0.7;

function restPoint(position: SeatPosition): { x: number; y: number } {
  const dx = position.x - POT_X;
  const dy = position.y - POT_Y;
  const distance = Math.hypot(dx, dy);
  const t = distance > 0 ? Math.min(T_MAX, Math.max(T_MIN, (distance - SEAT_CLEARANCE) / distance)) : T_MIN;
  return { x: POT_X + dx * t, y: POT_Y + dy * t };
}

// Chips the bank has committed to wagers it hasn't settled yet, drawn on the
// line between the bank and the player each one is covering.
//
// The bank can only cover so much at once: every live wager ahead of you eats
// into what you're allowed to bet, which is why a BANK! window shrinks as the
// round goes round and why a table can stall on an empty bank. None of that
// was visible before -- players just found their limit had moved.
export function BankReservations({ reservations, scale = 1 }: BankReservationsProps) {
  if (reservations.length === 0) return null;

  return (
    <>
      <svg
        className="k-resv-lines"
        viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        aria-hidden="true"
      >
        {reservations.map((r) => {
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

      {reservations.map((r) => {
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
