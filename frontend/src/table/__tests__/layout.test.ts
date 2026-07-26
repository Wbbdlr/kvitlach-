import { describe, expect, it } from "vitest";
import {
  orderSeatsForViewer,
  seatPositions,
  seatScale,
  viewerSlotIndex,
  SEAT_HEIGHT,
  SEAT_WIDTH,
  STAGE_WIDTH,
} from "../layout";

const CENTER_X = STAGE_WIDTH / 2;

describe("seat layout", () => {
  it("puts the viewer's slot exactly at bottom-centre for every table size", () => {
    // Regression: an earlier version spread seats evenly across the whole
    // arc, which leaves EVEN player counts with no slot at 180deg -- with 4
    // players the viewer rendered ~42deg round the table (x=374 instead of
    // 640), hard left of the dock instead of at the near edge.
    for (let count = 1; count <= 10; count += 1) {
      const positions = seatPositions(count);
      expect(positions).toHaveLength(count);
      const viewer = positions[viewerSlotIndex(count)];
      expect(viewer.x).toBeCloseTo(CENTER_X, 6);
      expect(viewer.angleDeg).toBeCloseTo(180, 6);
    }
  });

  it("never lets two seats overlap once the fitted seat scale is applied", () => {
    // Regression: equal-ANGLE spacing bunched seats on the flanks of this
    // eccentric ellipse -- 6 players produced three overlapping pairs, so
    // nameplates and card fans collided. Equal-ARC spacing fixes 6-7; past
    // that the arc genuinely cannot fit full-size seats, so seatScale()
    // shrinks them. Between them, nothing should ever overlap.
    for (let count = 2; count <= 10; count += 1) {
      const positions = seatPositions(count);
      const s = seatScale(positions);
      const w = SEAT_WIDTH * s;
      const h = SEAT_HEIGHT * s;
      for (let i = 0; i < positions.length; i += 1) {
        for (let j = i + 1; j < positions.length; j += 1) {
          const dx = Math.abs(positions[i].x - positions[j].x);
          const dy = Math.abs(positions[i].y - positions[j].y);
          const clear = dx >= w - 1e-6 || dy >= h - 1e-6;
          expect(clear, `seats ${i}/${j} overlap at count=${count} (dx=${dx}, dy=${dy}, scale=${s})`).toBe(true);
        }
      }
    }
  });

  it("keeps seats full size for realistic table sizes and only shrinks when crowded", () => {
    for (let count = 1; count <= 7; count += 1) {
      expect(seatScale(seatPositions(count))).toBe(1);
    }
    expect(seatScale(seatPositions(9))).toBeLessThan(1);
  });

  it("keeps every seat inside the stage bounds", () => {
    for (let count = 1; count <= 10; count += 1) {
      for (const p of seatPositions(count)) {
        // Seats are 168px wide and centred on their point.
        expect(p.x - 84).toBeGreaterThanOrEqual(0);
        expect(p.x + 84).toBeLessThanOrEqual(STAGE_WIDTH);
      }
    }
  });

  it("reserves the top of the oval for the dealer", () => {
    for (let count = 2; count <= 10; count += 1) {
      for (const p of seatPositions(count)) {
        // Nothing should sit within the 110deg dealer gap centred on 0deg.
        expect(p.angleDeg).toBeGreaterThanOrEqual(55 - 1e-6);
        expect(p.angleDeg).toBeLessThanOrEqual(305 + 1e-6);
      }
    }
  });

  it("rotates the turn list so the viewer lands in the bottom slot, preserving cyclic order", () => {
    const turns = ["a", "b", "c", "d"];
    const ordered = orderSeatsForViewer(turns, (t) => t === "d");
    expect(ordered[viewerSlotIndex(4)]).toBe("d");
    // Still the same cycle, just rotated -- b still follows a, etc.
    const cycleOf = (arr: string[]) => arr.map((v, i) => `${v}->${arr[(i + 1) % arr.length]}`).sort();
    expect(cycleOf(ordered)).toEqual(cycleOf(turns));
  });

  it("leaves the list alone when the viewer isn't seated", () => {
    const turns = ["a", "b", "c"];
    expect(orderSeatsForViewer(turns, (t) => t === "zz")).toBe(turns);
  });
});
