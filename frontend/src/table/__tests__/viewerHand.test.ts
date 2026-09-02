import { describe, expect, it } from "vitest";
import {
  dealerClearanceScale,
  seatPositions,
  seatScale,
  viewerHandScale,
  viewerSlotIndex,
  SEAT_WIDTH,
  VIEWER_HAND_WIDTH,
} from "../layout";

// What this pins is a SEPARATION, not a number: seatScale answers "how far
// must a seat shrink so nameplates stop overlapping", and for one seat -- the
// viewer's, which has rendered no nameplate since its identity moved to the
// HUD -- the cards must not be made to pay for that answer.
//
// The failure this exists to catch is silent and gradual: someone reads
// `scale={seatShrink}` on the <Seat>, sees handScale next to it, and "tidies"
// the second away into the first. The table still renders, still passes every
// overlap assertion, and a full table's cards quietly go back to 17px.

// The phone case, because it is the one that was reported: MIN_VF flattens the
// arc, which packs the seats, which is what drives seatScale down.
const PHONE = { vf: 0.6, playTop: 60 };

function scalesAt(count: number, { vf, playTop } = PHONE) {
  const positions = seatPositions(count, vf, playTop);
  const seatShrink = Math.min(seatScale(positions), dealerClearanceScale(positions, playTop + 160 * vf));
  return { seatShrink, hand: viewerHandScale(positions, viewerSlotIndex(count), seatShrink) };
}

describe("viewerHandScale", () => {
  it("never shrinks the viewer's hand below the seat it sits in", () => {
    // The one hard guarantee. Whatever the geometry says, this may only ever
    // be an improvement on the status quo -- there is no table where opting
    // out of seatScale is allowed to make a player's own cards smaller.
    for (let n = 1; n <= 11; n += 1) {
      const { seatShrink, hand } = scalesAt(n);
      expect(hand).toBeGreaterThanOrEqual(seatShrink);
      expect(hand).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the viewer's cards full size at the counts a real table actually sees", () => {
    // Nine seated players is a big Chanukah table; eleven is the backend cap
    // and rare. Below the cap the arc has room for a full-size hand, and the
    // whole point is that it gets one.
    for (const n of [4, 7, 9]) {
      expect(scalesAt(n).hand).toBe(1);
    }
  });

  it("still meaningfully enlarges the hand at the eleven-seat cap", () => {
    const { seatShrink, hand } = scalesAt(11);
    // Not 1 -- at the cap the neighbours genuinely are close, and this must
    // stay a clearance calculation rather than an override that ignores them.
    expect(hand).toBeLessThan(1);
    // ...but the reported bug was a 17px card, so a token improvement is a
    // failure. 1.5x linear is 2.2x the area.
    expect(hand / seatShrink).toBeGreaterThan(1.5);
  });

  it("shrinks the hand when neighbours genuinely close in", () => {
    // Synthetic, not from seatPositions(): the guarantee has to hold for a
    // geometry the current ellipse cannot produce, or it is only a statement
    // about today's constants.
    const tight = [
      { angleDeg: 170, x: 540, y: 600 },
      { angleDeg: 180, x: 640, y: 600 },
      { angleDeg: 190, x: 740, y: 600 },
    ];
    const seatShrink = 0.5;
    const hand = viewerHandScale(tight, 1, seatShrink);
    // 100px to the neighbour, less its 42px plate half-width and 8px of gap,
    // is 50px of half-width for a 185px hand.
    expect(hand).toBeCloseTo((2 * (100 - (SEAT_WIDTH * seatShrink) / 2 - 8)) / VIEWER_HAND_WIDTH, 5);
    expect(hand).toBeLessThan(1);
  });

  it("does not exempt a hand that has no seat", () => {
    // Spectators and the banker are not on the arc. TableRoot passes -1 for
    // them; an out-of-range index must fall back to the seat scale rather
    // than throw or silently return 1.
    const positions = seatPositions(6, PHONE.vf, PHONE.playTop);
    expect(viewerHandScale(positions, -1, 0.62)).toBe(0.62);
    expect(viewerHandScale(positions, 99, 0.62)).toBe(0.62);
  });

  it("gives a lone player a full-size hand", () => {
    // One seat, no neighbours: nothing to clear, so nothing to shrink for.
    expect(viewerHandScale(seatPositions(1, PHONE.vf, PHONE.playTop), 0, 1)).toBe(1);
  });
});
