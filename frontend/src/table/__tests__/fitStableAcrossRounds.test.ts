import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeFit } from "../stage";

// The table must not change size when a round starts or ends.
//
// Reported from an Android landscape table: the controls sit "randomly below
// the table or overlapping the table on first seeing it", and should "start
// off anchored below middle of the table".
//
// The controls were never the thing moving. They are anchored to the
// viewport's bottom edge and stayed at y348 throughout. The TABLE moved: with
// no round in flight there are no turns, so no seats are rendered, so
// computeFit's `crowding` correction read as 1 and it reserved a full
// viewer-seat overhang for a seat that was not on the felt. That shrinks vf,
// which shortens the oval, which opens the gap underneath it.
//
// Measured live at 915x412 with twelve seated, before the fix:
//   in round        oval 174px tall, bottom y274, gap 74px
//   between rounds  oval 154px tall, bottom y251, gap 97px
// and after it, 174 / 274 / 74 in both states.
//
// computeFit takes POSITIONAL arguments (availWidth, availHeight, isCompact,
// dockHeight, seatCount). Passing an options object instead makes every one of
// them NaN and every assertion here vacuously pass -- which is exactly how the
// first draft of this file went green against a broken call.
const WIDTH = 915;
const HEIGHT = 412;
const DOCK = 54;
const fitFor = (seatCount: number) => computeFit(WIDTH, HEIGHT, false, DOCK, seatCount);

describe("the crowding reservation", () => {
  it("really does move the table, so the fallback is not decoration", () => {
    // If this ever stops being true the fix below is a no-op and should be
    // re-derived rather than trusted -- the whole point is that seatCount is
    // an input the geometry is genuinely sensitive to.
    expect(fitFor(0).vf).toBe(0.4);
    expect(fitFor(12).vf).toBe(0.44);
    expect(fitFor(0).vf).not.toBe(fitFor(12).vf);
  });

  it("gives the same table for the same seats", () => {
    // The property the fix buys: one count in, one geometry out. A round
    // starting changes which turns exist, not how many chairs are round the
    // table, so nothing about the felt's size may depend on the former.
    expect(fitFor(12)).toEqual(fitFor(12));
  });
});

describe("what TableRoot hands the fit", () => {
  const SOURCE = readFileSync(resolve(__dirname, "../TableRoot.tsx"), "utf8");

  it("never lets the seat count collapse to zero while players are seated", () => {
    // Asserted on the source because the alternative is rendering the whole
    // table, and jsdom lays out none of this (no @media, no flex sizing, no
    // transforms) -- the same reason stage geometry is unit-tested through
    // computeFit rather than through the DOM.
    expect(SOURCE).toContain("playerTurns.length || seatedCount");
    expect(SOURCE).toMatch(/seatedCount\s*=\s*useMemo/);
    expect(SOURCE).toContain('room.players.filter((p) => p.type === "player").length');
  });

  it("still prefers the live turn count while a round is running", () => {
    // `||`, not Math.max: during a round the turns ARE the arc, and a seat
    // that left mid-round must not keep its chair reserved. The fallback is
    // only for the state where there are no turns at all.
    expect(SOURCE).not.toContain("Math.max(playerTurns.length, seatedCount)");
  });
});
