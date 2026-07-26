// Seat placement around the felt oval, in FIXED stage pixels.
//
// The stage is a 1280x760 design surface that gets uniformly scaled to fit
// the viewport (see stage.ts), exactly like the approved mockup -- so these
// are absolute pixel coordinates, not percentages. The composition is
// therefore identical at every screen size and simply scales, which is what
// made the mockup read correctly on a phone held sideways.

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 760;

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
const ARC = 360 - DEALER_GAP_DEG;
const ARC_START = DEALER_GAP_DEG / 2; // 55deg, clockwise from top
const BOTTOM_DEG = 180;

function pointAt(angleDeg: number): SeatPosition {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    angleDeg,
    x: CX + RX * Math.sin(rad),
    y: CY - RY * Math.cos(rad),
  };
}

const HALF_ARC = ARC / 2; // 125deg either side of bottom-center

// Seats are laid out so one slot sits EXACTLY at bottom-center (180deg),
// which is where the viewer goes. Spacing the whole arc evenly instead
// would leave even player counts with no slot at the bottom (4 players put
// the viewer ~42deg off-centre, hard left of the dock), so the bottom slot
// is anchored first and the rest are stepped outward from it in both
// directions using one shared step, keeping the ring evenly spaced.
export function seatPositions(count: number): SeatPosition[] {
  if (count <= 0) return [];
  if (count === 1) return [pointAt(BOTTOM_DEG)];

  const others = count - 1;
  const rightCount = Math.ceil(others / 2); // toward ARC_START (55deg)
  const leftCount = Math.floor(others / 2); // toward ARC_END (305deg)
  const step = HALF_ARC / Math.max(rightCount, leftCount, 1);

  const angles = [BOTTOM_DEG];
  for (let j = 1; j <= rightCount; j += 1) angles.push(BOTTOM_DEG - step * j);
  for (let j = 1; j <= leftCount; j += 1) angles.push(BOTTOM_DEG + step * j);
  angles.sort((a, b) => a - b); // render in table order, 55deg round to 305deg

  return angles.map(pointAt);
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
