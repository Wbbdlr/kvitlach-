// Radial seat placement around the felt oval for the live player count.
// The dealer sits fixed at the top (rendered separately by Dealer.tsx); this
// distributes the remaining players evenly across the rest of the oval.

export interface SeatPosition {
  angleDeg: number; // degrees clockwise from the top (12 o'clock)
  xPercent: number; // left offset, 0-100, relative to the table container
  yPercent: number; // top offset, 0-100, relative to the table container
}

const RX = 46; // ellipse horizontal radius, % of container width
const RY = 40; // ellipse vertical radius, % of container height
const DEALER_GAP_DEG = 100; // arc reserved for the dealer at the top

export function seatPositions(count: number): SeatPosition[] {
  if (count <= 0) return [];
  if (count === 1) {
    return [{ angleDeg: 180, xPercent: 50, yPercent: 50 + RY }];
  }

  const arc = 360 - DEALER_GAP_DEG;
  const start = DEALER_GAP_DEG / 2;
  const step = arc / (count - 1);

  return Array.from({ length: count }, (_, i) => {
    const angleDeg = start + step * i;
    const rad = (angleDeg * Math.PI) / 180;
    return {
      angleDeg,
      xPercent: 50 + RX * Math.sin(rad),
      yPercent: 50 - RY * Math.cos(rad),
    };
  });
}
