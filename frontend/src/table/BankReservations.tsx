import { SeatPosition } from "./layout";
import { SEAT_HEIGHT, STAGE_HEIGHT, STAGE_WIDTH, VIEWER_HAND_WIDTH } from "./layout";
import { Icon } from "./icons";

export interface Reservation {
  playerId: string;
  amount: number;
  position: SeatPosition;
}

export interface BankReservationsProps {
  reservations: Reservation[];
  // Whose seat is the bottom-centre one with no plate on the felt. Their badge
  // is placed by a different rule -- see viewerRestPoint().
  viewerId?: string;
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

// The old line-placement machinery -- SEAT_CLEARANCE, T_MIN, T_MAX,
// minViableDistance() and isPlaceable() -- is gone with it. Every one of those
// existed to answer "where on the bank-to-seat line does this chip fit", and
// once the chip is anchored to the seat itself there is no such question and
// no seat a chip cannot be placed at. isPlaceable in particular used to DROP a
// chip whose seat was too close to the bank, which is how the viewer -- the
// closest seat to the bank by construction -- ended up being the one player who
// could not see their own wager.

// Daylight between the top of a seat's own box and its chip, in stage px.
const CHIP_GAP = 16;

// A seat's chip sits directly ABOVE that seat, not somewhere along the line
// from the bank to it.
//
// Everything before this placed the chip at a FRACTION of the way down that
// line, which is a position derived from where the bank is -- so the chip
// tracked the geometry between two things rather than the player it belongs
// to, and on an ordinary four-seat desktop table it came to rest in open felt
// with the seat still 130px further on. That is the whole of "nowhere near the
// player's spot", and no choice of fraction or clearance fixes it, because a
// point on that line is only near the seat at one particular table shape.
//
// Anchored to the seat instead: same x, a fixed offset above its top edge.
// SEAT_HEIGHT is the reserved half-height (it carries a few px of slack over
// the real box on purpose), so this clears the seat's own topmost row -- which
// since the timer became a permanent row is the timer, not the plate. The chip
// therefore sits above the name card with the timer between them, and the two
// cannot collide because neither is placed relative to the other: one is a row
// in the seat's flex column, the other a fixed offset from the seat's centre.
function restPoint(position: SeatPosition, _pot: { x: number; y: number }, scale: number): { x: number; y: number } {
  return { x: position.x, y: position.y - (SEAT_HEIGHT / 2) * scale - CHIP_GAP };
}


// How far out from the viewer's own seat centre their badge sits, in nominal
// stage px. Half a full-width hand plus enough daylight for the badge itself.
// Deliberately NOT multiplied by `scale`: VIEWER_HAND_WIDTH is the hand's width
// at viewerHandScale 1, and the hand no longer shrinks with the seat (that is
// the whole point of viewerHandScale), so measuring the offset against the
// unshrunk width keeps the badge clear at every seat count. On a table where
// the hand IS smaller the badge simply sits a little further out, which costs
// nothing -- there is open felt either side of the bottom-centre seat.
const VIEWER_BADGE_OFFSET = VIEWER_HAND_WIDTH / 2 + 58;
// Keep the badge on the felt if the offset would push it off the stage edge.
const STAGE_EDGE_MARGIN = 40;

// The viewer's badge does not go on the bank->seat line at all.
//
// Every other seat has a plate on the felt, so "rest a fixed clearance back
// from the seat" puts the chip just outside their nameplate and the line reads
// as the bank pushing chips toward them. The viewer has no plate on the felt --
// it moved to the HUD in step 1 -- and their seat is the closest of all to the
// bank by construction, so that same rule had nowhere to put it: measured live,
// bank anchor to viewer seat is ~98px with the clearance alone eating ~65, so
// T_MIN clamped the badge to a third of the way and left it floating in open
// felt. Reported as the reserved chips being nowhere near the player's spot,
// and unfixable by any choice of constant -- the line is simply too short.
//
// Beside the cards instead, at the same height, where there is open felt on
// both sides of the bottom-centre seat. The connector line still runs from the
// bank to it, so it is still visibly the bank's money.
// LEFT by default, and that side is not arbitrary: a reaction bubble anchors
// to the RIGHT of its seat (.k-reaction.is-side), so the two things that both
// want "beside this seat" get opposite sides by rule rather than by luck. The
// overlap spec found them stacked when both went right -- k-reaction X k-resv
// at 63%, 52% and 40% across the three phone widths -- which is the same class
// of collision as the chip-vs-seat one, just one level in.
function viewerRestPoint(position: SeatPosition): { x: number; y: number } {
  const left = position.x - VIEWER_BADGE_OFFSET;
  const onLeft = left >= STAGE_EDGE_MARGIN;
  return { x: onLeft ? left : position.x + VIEWER_BADGE_OFFSET, y: position.y };
}

// How far the BADGE itself is allowed to shrink, as opposed to how far back
// from the seat it rests. Those are two different questions and `scale`
// answered both: at a full eleven-seat table the badge inherited seatScale's
// 0.449 and rendered 14x8 real px on a 854x384 phone -- a coin glyph and a
// dollar amount inside fourteen pixels. Reported by a tester as the chips and
// their connector lines having disappeared; they had not, they were too small
// to resolve as anything. Positioning still uses the true seat scale below,
// because THAT is genuinely a fact about the seat.
// Floored rather than pinned to 1: eleven badges at full size, all converging
// on the same pot, start colliding with each other instead.
const MIN_BADGE_SCALE = 0.8;

// Chips the bank has committed to wagers it hasn't settled yet, drawn on the
// line between the bank and the player each one is covering.
//
// The bank can only cover so much at once: every live wager ahead of you eats
// into what you're allowed to bet, which is why a BANK! window shrinks as the
// round goes round and why a table can stall on an empty bank. None of that
// was visible before -- players just found their limit had moved.
export function BankReservations({ reservations, viewerId, scale = 1, playTop = 0, vf = 1 }: BankReservationsProps) {
  const pot = potPoint(playTop, vf);
  const badgeScale = Math.max(scale, MIN_BADGE_SCALE);
  const at = (r: Reservation) => (r.playerId === viewerId ? viewerRestPoint(r.position) : restPoint(r.position, pot, scale));
  const placeable = reservations;
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
          const end = at(r);
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
        const point = at(r);
        return (
          <div
            key={r.playerId}
            className="k-resv"
            style={{
              left: `${point.x}px`,
              top: `${point.y}px`,
              transform: `translate(-50%, -50%) scale(${badgeScale})`,
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
