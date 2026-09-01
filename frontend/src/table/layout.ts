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
// Was 165, measured against a seat with the default 62px hand -- but the
// viewer's OWN seat is always in the mix (it's the one guaranteed slot,
// bottom-centre) and renders taller 92px cards, not 62px ones. Live
// getBoundingClientRect() on that seat (Seat.tsx's ".k-hand.is-me") measured
// 197px unscaled, 32px over the old constant. seatScale() has no per-seat
// notion of "this one's taller" -- it applies one nominal height to every
// pair -- so undercounting the tallest seat meant a 6-7 player table's
// tightest pair (always the viewer against a neighbour) computed scale=1
// while the real, taller box actually overlapped its neighbour by several
// px. 200 covers the measured 197px with a few px to spare for box-shadow/
// border spillover getBoundingClientRect includes.
export const SEAT_HEIGHT = 200;

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
// 0.4 was too much: at vf=0.54 it stretched the oval to 1184px of a 1280px
// stage, and combined with the flattening the table read as a ~4:1 letterbox
// rather than a card table. The felt itself still bleeds to every edge -- that
// is the .felt-table background, not this -- so narrowing the drawn rail costs
// no screen, it just stops the oval chasing the corners. Kept non-zero because
// the arc length it buys back is real; the seat-scale floor (see seatScale)
// now carries the rest of that load.
const MAX_SPREAD = 0.12;

export function spreadFactor(vf: number): number {
  return 1 + (1 - vf) * MAX_SPREAD;
}
// RY is deliberately short of the oval's own 250px radius: the bottom seat
// is the viewer's, which renders the tallest hand (92px cards), and at 215
// its lower edge slid under the 84px dock. 198 clears the dock outright --
// but only checked at vf=1. stage.ts's own dock-clearance reservation (see
// its VIEWER_SEAT_OVERHANG_PX) is what covers a flattened, low-vf table;
// bottomSeatCenterY below is what lets it do that math without duplicating
// CY/RY here.
const RY = 198;

// The bottom-centre slot's own Y (design px) -- exported so stage.ts can
// work out how much room THAT seat's content needs before the dock band can
// safely start, without either duplicating CY/RY or importing the whole
// seatPositions() machinery. BOTTOM_DEG=180 is always present regardless of
// seat count (seatPositions anchors it first, see that function's own
// comment), so this needs neither a count nor the arc-length table.
export function bottomSeatCenterY(vf: number, playTop: number): number {
  return CY * vf + playTop + RY * vf;
}

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
  return Math.min(1, Math.max(0.36, scale));
}

// The dealer's own seat box, in stage px. Smaller than SEAT_HEIGHT because
// that constant is calibrated to the VIEWER's seat, which renders 92px cards
// (see its comment); the dealer's renders 72px ones. Live-measured 2026-09-01
// at 1512x950, seatShrink 1: dealer 151 stage px against the viewer's 206.
// 160 keeps the same few px of slack SEAT_HEIGHT allows itself.
const DEALER_SEAT_HEIGHT = 160;
// The height this check has to reserve for a PLAYER seat, which is not
// SEAT_HEIGHT. That constant is a spacing reservation for seat-against-seat
// crowding, and it under-reserves the viewer's own seat, the one that
// actually meets the dealer: measured live at 854x384 the viewer's box ran
// 91 stage px above its centre and 92 below at seatShrink 0.84, i.e. 218
// unscaled against SEAT_HEIGHT's 200. Reserving 200 left a 7px overlap --
// small, but visible as the dealer's plate touching the viewer's name.
// 224 covers the measured 218 with the same few px of slack SEAT_HEIGHT
// allows itself for box-shadow spill.
const VIEWER_SEAT_HEIGHT = 224;

/**
 * How much to shrink the player seats so none of them collides with the
 * DEALER, who is not on the arc and never shrinks.
 *
 * seatScale() above only compares players against each other, so nothing in
 * the system watched this pair -- and it is the pair that fails first on a
 * phone. On a 854x384 landscape Galaxy the play band is 252px and has to hold
 * a 106px dealer seat above a 146px viewer seat; `vf` is already pinned at
 * MIN_VF, so the arc cannot flatten any further to help, and the viewer's
 * nameplate landed 17px inside the dealer's box. Reported as the table being
 * unplayable on a phone, which is where most of these games get played.
 *
 * Only the player's half of each pair shrinks, hence SEAT_HEIGHT * s against
 * the dealer's fixed half. Clearing on EITHER axis is enough, same rule as
 * seatScale -- a seat far enough to the side is fine however tall it is,
 * which is why this binds on the bottom-centre seat and almost nowhere else.
 *
 * `dealerY` is the dealer seat's centre in stage px: `playTop + 160 * vf`,
 * the same point TableRoot deals cards from. Verified against live rects at
 * two viewports (predicted 195.6 / 170.0, measured 195.6 / 170.0).
 */
export function dealerClearanceScale(positions: SeatPosition[], dealerY: number): number {
  let scale = 1;
  for (const p of positions) {
    const dy = Math.abs(p.y - dealerY);
    const dx = Math.abs(p.x - CX);
    const byHeight = (2 * dy - DEALER_SEAT_HEIGHT) / VIEWER_SEAT_HEIGHT;
    const byWidth = (2 * dx - SEAT_WIDTH) / SEAT_WIDTH;
    const needed = Math.max(byHeight, byWidth);
    if (needed < scale) scale = needed;
  }
  // Same backstop as seatScale, and for the same reason: clamping above what
  // the table actually needs does not keep seats readable, it just puts the
  // overlap back.
  return Math.min(1, Math.max(0.36, scale));
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

// How far the shoe/discard pile sit from center, mirrored either side of the
// dealer. Widened from 110 (2026-08-11): the dealer's own hand can grow past
// SEAT_WIDTH/2 (84) once it's carrying several cards -- .k-hand centers via
// flex (justify-content: center), so a long hand grows outward symmetrically
// in BOTH directions -- and a user report ("the discard pile overlaps with
// the dealer's cards") confirmed 110 wasn't clear of that. Moved both sides
// out together, not just the reported one: they're a deliberate mirror pair
// (see the two functions below, and their CSS counterparts) and the same
// hand-width risk is symmetric, even though only the discard side got
// reported.
const SIDE_OFFSET = 145;

// Where the shoe sits, in the same nominal stage-px used by seatPositions()
// -- mirrors .k-shoe's own CSS (index.css: `left: calc(50% + 145px)`,
// `top: calc(var(--play-top) + 116px * var(--vf))`). Seat.tsx/Dealer.tsx use
// this as the ORIGIN for the card-deal-in animation, so a card visibly
// travels from the shoe to its resting seat rather than just popping in
// place -- if the shoe's own CSS position ever changes, this needs to change
// with it, and vice versa.
export function shoePosition(playTop: number, vf: number): { x: number; y: number } {
  return { x: STAGE_WIDTH / 2 + SIDE_OFFSET, y: playTop + 116 * vf };
}

// Where the discard pile sits -- the shoe's mirror image on the dealer's
// OTHER side (index.css: `left: calc(50% - 145px)`, same top as the shoe).
// Seat.tsx/Dealer.tsx use this as the DESTINATION for a rejected card's
// fly-out (see CardView.tsx's cardDiscardFly), the reverse of the shoe's own
// role as the deal-in's origin.
export function discardPilePosition(playTop: number, vf: number): { x: number; y: number } {
  return { x: STAGE_WIDTH / 2 - SIDE_OFFSET, y: playTop + 116 * vf };
}
