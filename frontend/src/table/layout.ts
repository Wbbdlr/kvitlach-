// Seat placement around the felt oval, in stage pixels.
//
// The stage is 1280 design px wide and gets uniformly scaled to fit the
// viewport (see stage.ts), so horizontal coordinates here are absolute.
// Vertically the play area BREATHES: stage.ts hands down a factor (vf, 0.6-1)
// that flattens the whole composition to match the viewport's aspect ratio.
// A fixed 1280x760 surface pillarboxed badly on a landscape phone (~2.2:1
// against the design's 1.68:1) -- the stage was height-bound at ~0.44x with
// a third of the screen left black, which is unreadable on a real phone.
// Flattening the oval instead lets width bind, which is the whole point:
// a wider, shallower table is still a table, and everything on it gets
// meaningfully bigger.

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
// (oval is 1000x540 at top:100, i.e. centered on 640,370). CY/RY are the
// vf=1 values; both scale with vf so the seats stay pinned to the oval as it
// flattens.
const CX = 640;
const CY = 372;
const RX = 400;

// Flattening costs arc length, and arc length is what keeps neighbouring
// seats apart -- at vf=0.5 the ellipse's perimeter shrinks enough that a full
// table's plates collided. Widening as it flattens buys most of it back, out
// of felt that is doing nothing: at vf=1 the seats span x=156..1124 on a
// 1280-wide stage, leaving ~156px dead on each side. A wide, short screen
// wants a wide, short table anyway, so this reads as intended rather than as
// a workaround. Capped so the widened oval (1000 * hf) still clears the
// stage edges.
const MAX_SPREAD = 0.4;

export function spreadFactor(vf: number): number {
  return 1 + (1 - vf) * MAX_SPREAD;
}
// RY is deliberately short of the oval's own 250px radius: the bottom seat
// is the viewer's, which renders the tallest hand (92px cards), and at 215
// its lower edge slid under the 84px dock. 198 clears the dock outright.
const RY = 198;

// Arc reserved at the top for the dealer, who is rendered separately.
const DEALER_GAP_DEG = 110;
const HALF_ARC_DEG = (360 - DEALER_GAP_DEG) / 2; // 125deg either side of bottom
const BOTTOM_DEG = 180;

function pointAt(angleDeg: number, cy: number, ry: number, rx: number): SeatPosition {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    angleDeg,
    x: CX + rx * Math.sin(rad),
    y: cy - ry * Math.cos(rad),
  };
}

// Equal ANGLE steps bunch seats badly on an ellipse this eccentric (RX is
// twice RY), so seats near the 90/270 flanks collided -- 6 players had three
// overlapping pairs. Spacing by ARC LENGTH instead distributes them evenly
// along the actual curve.
const ARC_STEP_DEG = 0.25;

interface ArcTable {
  offsets: number[];
  halfLen: number;
}

// One table per vertical factor. vf is quantized to 2dp by stage.ts, so this
// tops out at ~41 entries for the whole session; without that quantization a
// continuous resize would mint a new table per animation frame.
const arcTables = new Map<number, ArcTable>();

// Arc length only depends on the ellipse's shape, so playTop (a pure
// translation) never enters here -- vf alone keys the cache.
function arcTableFor(vf: number): ArcTable {
  const cached = arcTables.get(vf);
  if (cached) return cached;
  const cy = CY * vf;
  const ry = RY * vf;
  const rx = RX * spreadFactor(vf);
  const offsets = [0];
  let acc = 0;
  let prev = pointAt(BOTTOM_DEG, cy, ry, rx);
  for (let offset = ARC_STEP_DEG; offset <= HALF_ARC_DEG + 1e-9; offset += ARC_STEP_DEG) {
    const cur = pointAt(BOTTOM_DEG + offset, cy, ry, rx);
    acc += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    offsets.push(acc);
    prev = cur;
  }
  const built = { offsets, halfLen: acc };
  arcTables.set(vf, built);
  return built;
}

// Angle whose arc distance from bottom-centre is `arc`, walking in `dir`.
function angleAtArc(arc: number, dir: 1 | -1, table: ArcTable): number {
  const clamped = Math.min(Math.max(arc, 0), table.halfLen);
  // offsets is monotonically increasing -> binary search.
  let lo = 0;
  let hi = table.offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table.offsets[mid] < clamped) lo = mid + 1;
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
export function seatPositions(count: number, vf = 1, playTop = 0): SeatPosition[] {
  if (count <= 0) return [];
  const cy = CY * vf + playTop;
  const ry = RY * vf;
  const rx = RX * spreadFactor(vf);
  if (count === 1) return [pointAt(BOTTOM_DEG, cy, ry, rx)];

  const table = arcTableFor(vf);
  const others = count - 1;
  const rightCount = Math.ceil(others / 2); // toward 55deg
  const leftCount = Math.floor(others / 2); // toward 305deg
  const step = table.halfLen / Math.max(rightCount, leftCount, 1);

  const angles = [BOTTOM_DEG];
  for (let j = 1; j <= rightCount; j += 1) angles.push(angleAtArc(step * j, -1, table));
  for (let j = 1; j <= leftCount; j += 1) angles.push(angleAtArc(step * j, 1, table));
  angles.sort((a, b) => a - b); // render in table order, 55deg round to 305deg

  return angles.map((angle) => pointAt(angle, cy, ry, rx));
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
  // Backstop only -- it must sit BELOW what any reachable table actually
  // needs, because clamping above the required scale doesn't keep seats
  // readable, it just makes them overlap. This was 0.55, tuned when the stage
  // was a fixed 1280x760: nothing up to the backend's 11-player cap needed
  // less than 0.594 there, so it never bound. A flattened table (see
  // spreadFactor) packs the same seats into a shorter arc and a full table
  // genuinely needs ~0.49, so the old floor started forcing the exact
  // collisions it was meant to prevent.
  return Math.min(1, Math.max(0.45, scale));
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
