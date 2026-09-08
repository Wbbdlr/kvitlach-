import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The zoom ceiling is arithmetic, not a constant, and getting it wrong is
// invisible until somebody is on a phone: this gesture MULTIPLIES stage.ts's
// fit-to-viewport scale, and that scale is ~0.5 on a landscape phone against
// the 1280-wide stage. A flat ceiling therefore gave the smallest screens the
// LEAST zoom, which is backwards -- reported as not being able to zoom in far
// enough on mobile.
//
// Read out of the source rather than exercised through the hook: the hook
// needs real TouchEvents and a laid-out element, neither of which jsdom has,
// and the thing worth pinning here is the relationship between the numbers.
const SRC = readFileSync(resolve(__dirname, "../pinchZoom.ts"), "utf8");

function constant(name: string): number {
  const m = SRC.match(new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?)`));
  if (!m) throw new Error(`${name} is gone from pinchZoom.ts`);
  return Number(m[1]);
}

const MAX_EFFECTIVE_SCALE = constant("MAX_EFFECTIVE_SCALE");
const ABSOLUTE_MAX_ZOOM = constant("ABSOLUTE_MAX_ZOOM");
const MIN_ZOOM = constant("MIN_ZOOM");

// Mirrors maxZoomFor's own body. If that changes shape this test is the thing
// that should be updated with it, deliberately.
const maxZoomFor = (stageScale: number) =>
  Math.min(ABSOLUTE_MAX_ZOOM, Math.max(MIN_ZOOM, MAX_EFFECTIVE_SCALE / stageScale));

describe("the pinch-zoom ceiling", () => {
  it("gives a landscape phone the same effective size a desktop gets", () => {
    // stage.ts: scale = availWidth / 1280, capped at 3.
    const phone = 640 / 1280;
    const desktop = 1;
    expect(maxZoomFor(phone) * phone).toBeCloseTo(maxZoomFor(desktop) * desktop, 5);
  });

  it("lets a phone past the flat 3x that used to be the whole limit", () => {
    // The regression this exists for: at 0.5 stage scale the old ceiling
    // topped out at 1.5x the design size.
    expect(maxZoomFor(640 / 1280)).toBeGreaterThan(3);
  });

  it("never lets a very narrow viewport divide out to an unnavigable zoom", () => {
    expect(maxZoomFor(0.05)).toBe(ABSOLUTE_MAX_ZOOM);
  });

  it("never returns a ceiling below the resting size", () => {
    // A desktop wide enough that stageScale is already past MAX_EFFECTIVE_SCALE
    // would otherwise compute a ceiling under 1 and make zoom impossible.
    expect(maxZoomFor(99)).toBe(MIN_ZOOM);
  });
});
