import { SeatPosition } from "./layout";
import { STAGE_HEIGHT, STAGE_WIDTH, VIEWER_HAND_WIDTH } from "./layout";
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
// ...but never so far back that a badge lands on the pot itself.
const T_MIN = 0.34;
// There is deliberately no T_MAX any more.
//
// It was 0.7 -- "never more than seven tenths of the way to the seat" -- and it
// is what put the chips nowhere near the players they belong to. The two rules
// disagreed about what they were measuring: SEAT_CLEARANCE says "rest a fixed
// distance BACK from the seat", which is a statement about the seat end, while
// a fraction of the total is a statement about the pot end. They only agree at
// one distance. Past it the fraction wins and the badge stops tracking the
// seat at all -- at a 1300px diagonal the clearance rule asks for 130px short
// of the seat and T_MAX delivered 390px short, stranding it in open felt.
//
// Reported as the reserved chips being "nowhere near the player's spot", and
// measured on a live desktop table at 2560x1440: the badge sat at (1280, 638)
// with the viewer's own seat at (1112..1448, 797..999) -- 160px above the top
// of their own seat box, on empty felt, connected to nothing it was about.
//
// SEAT_CLEARANCE is the guard that was always doing the real work, and it
// scales with the seat, so it keeps a badge off the plate at every table size.
// T_MIN stays: the pot end still needs a floor, because the dealer's box is
// there and a badge must not land on it.

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
// into a collision.
//
// This used to be justified with "every seat's plate already prints
// $wallet · $bet, so the information survives". That stopped being true for the
// VIEWER in step 1, which moved their plate off the felt into the HUD -- and
// the viewer's own seat is precisely the one this threshold fires on. The
// information does still survive, but in the HUD readout (ViewerHud.tsx), not
// in a plate. Corrected rather than deleted: the behaviour is still right, the
// reason given for it had gone stale underneath it.
function minViableDistance(scale: number): number {
  return (SEAT_CLEARANCE * scale) / (1 - T_MIN);
}

function restPoint(position: SeatPosition, pot: { x: number; y: number }, scale: number): { x: number; y: number } {
  const dx = position.x - pot.x;
  const dy = position.y - pot.y;
  const distance = Math.hypot(dx, dy);
  const clearance = SEAT_CLEARANCE * scale;
  const t = distance > 0 ? Math.max(T_MIN, (distance - clearance) / distance) : T_MIN;
  return { x: pot.x + dx * t, y: pot.y + dy * t };
}

function isPlaceable(position: SeatPosition, pot: { x: number; y: number }, scale: number): boolean {
  return Math.hypot(position.x - pot.x, position.y - pot.y) >= minViableDistance(scale);
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
function viewerRestPoint(position: SeatPosition): { x: number; y: number } {
  const right = position.x + VIEWER_BADGE_OFFSET;
  const onRight = right <= STAGE_WIDTH - STAGE_EDGE_MARGIN;
  return { x: onRight ? right : position.x - VIEWER_BADGE_OFFSET, y: position.y };
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
  // The viewer is never filtered out. isPlaceable asks "is there room on the
  // line between the bank and this seat", and for the viewer the answer is
  // always no -- that is exactly why they get their own rule below, rather than
  // being dropped as unplaceable and leaving the one player who is looking for
  // their own wager with nothing to look at.
  const at = (r: Reservation) => (r.playerId === viewerId ? viewerRestPoint(r.position) : restPoint(r.position, pot, scale));
  const placeable = reservations.filter((r) => r.playerId === viewerId || isPlaceable(r.position, pot, scale));
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
