// Seat placement around the felt oval, in FIXED stage pixels.
//
// The stage is a 1280x760 design surface that gets uniformly scaled to fit
// the viewport (see stage.ts), exactly like the approved mockup -- so these
// are absolute pixel coordinates, not percentages. The composition is
// therefore identical at every screen size and simply scales.

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 760;

// Nominal seat footprint, used to work out when seats would collide.
export const SEAT_WIDTH = 168;
export const SEAT_HEIGHT = 165;

export interface SeatPosition {
  angleDeg: number; // degrees clockwise from 12 o'clock
  x: number; // stage px, seat CENTER (the seat translates -50%,-50%)
  y: number; // stage px, seat CENTER
}

// Ellipse the seat centers ride on. Sits just inside the oval's rail
// (oval is 1000x540 at top:100, i.e. centered on 640,370).
const CX = 640;
const CY = 372;
const RX = 400;
// RY is deliberately short of the oval's own 250px radius: the bottom seat
// is the viewer's, which renders the tallest hand (92px cards), and at 215
// its lower edge slid under the 84px dock. 198 clears the dock outright.
const RY = 198;

// Arc reserved at the top for the dealer, who is rendered separately.
const DEALER_GAP_DEG = 110;
const HALF_ARC_DEG = (360 - DEALER_GAP_DEG) / 2; // 125deg either side of bottom
const BOTTOM_DEG = 180;

function pointAt(angleDeg: number): SeatPosition {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    angleDeg,
    x: CX + RX * Math.sin(rad),
    y: CY - RY * Math.cos(rad),
  };
}

// Equal ANGLE steps bunch seats badly on an ellipse this eccentric (RX is
// twice RY), so seats near the 90/270 flanks collided -- 6 players had three
// overlapping pairs. Spacing by ARC LENGTH instead distributes them evenly
// along the actual curve. The angle<->arc mapping only depends on module
// constants, so it's tabulated once here and reused.
const ARC_STEP_DEG = 0.25;
const ARC_TABLE: number[] = (() => {
  const table = [0];
  let acc = 0;
  let prev = pointAt(BOTTOM_DEG);
  for (let offset = ARC_STEP_DEG; offset <= HALF_ARC_DEG + 1e-9; offset += ARC_STEP_DEG) {
    const cur = pointAt(BOTTOM_DEG + offset);
    acc += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    table.push(acc);
    prev = cur;
  }
  return table;
})();
const HALF_ARC_LEN = ARC_TABLE[ARC_TABLE.length - 1];

// Angle whose arc distance from bottom-centre is `arc`, walking in `dir`.
function angleAtArc(arc: number, dir: 1 | -1): number {
  const clamped = Math.min(Math.max(arc, 0), HALF_ARC_LEN);
  // ARC_TABLE is monotonically increasing -> binary search.
  let lo = 0;
  let hi = ARC_TABLE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ARC_TABLE[mid] < clamped) lo = mid + 1;
    else hi = mid;
  }
  return BOTTOM_DEG + dir * lo * ARC_STEP_DEG;
}

// Seats are laid out so one slot sits EXACTLY at bottom-center (180deg),
// which is where the viewer goes. Spacing the whole arc evenly instead
// would leave even player counts with no slot at the bottom (4 players put
// the viewer ~42deg off-centre, hard left of the dock), so the bottom slot
// is anchored first and the rest are stepped outward from it in both
// directions using one shared arc-length step.
export function seatPositions(count: number): SeatPosition[] {
  if (count <= 0) return [];
  if (count === 1) return [pointAt(BOTTOM_DEG)];

  const others = count - 1;
  const rightCount = Math.ceil(others / 2); // toward 55deg
  const leftCount = Math.floor(others / 2); // toward 305deg
  const step = HALF_ARC_LEN / Math.max(rightCount, leftCount, 1);

  const angles = [BOTTOM_DEG];
  for (let j = 1; j <= rightCount; j += 1) angles.push(angleAtArc(step * j, -1));
  for (let j = 1; j <= leftCount; j += 1) angles.push(angleAtArc(step * j, 1));
  angles.sort((a, b) => a - b); // render in table order, 55deg round to 305deg

  return angles.map(pointAt);
}

// How much to shrink each seat so neighbours don't collide. Past ~7 players
// the available arc simply cannot fit full-size seats (2x623px of arc over
// 8 seats leaves 156px each, under the 168px seat width), so rather than
// let nameplates overlap, seats scale down to fit. Derived from the actual
// positions, so it stays correct if the ellipse constants ever change.
export function seatScale(positions: SeatPosition[]): number {
  if (positions.length < 2) return 1;
  let scale = 1;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const dx = Math.abs(positions[i].x - positions[j].x);
      const dy = Math.abs(positions[i].y - positions[j].y);
      // Clear if separated on EITHER axis; the looser axis sets the bound.
      const needed = Math.max(dx / SEAT_WIDTH, dy / SEAT_HEIGHT);
      if (needed < scale) scale = needed;
    }
  }
  // Never shrink below legibility -- past this the table is simply too full.
  return Math.min(1, Math.max(0.55, scale));
}

// Index of the bottom-centre slot in seatPositions()'s output -- where the
// viewer belongs, per the card-game convention of "you sit at the near edge".
export function viewerSlotIndex(count: number): number {
  if (count <= 1) return 0;
  return Math.round((count - 1) / 2);
}

// Rotate a turn list so the viewer lands in the bottom-center slot while
// preserving the cyclic turn order (so reading clockwise still reflects who
// plays after whom). Returns the list unchanged if the viewer isn't seated.
export function orderSeatsForViewer<T>(items: T[], isViewer: (item: T) => boolean): T[] {
  const viewerIdx = items.findIndex(isViewer);
  if (viewerIdx < 0 || items.length < 2) return items;
  const target = viewerSlotIndex(items.length);
  const shift = (viewerIdx - target + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}
