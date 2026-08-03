import { describe, expect, it } from "vitest";
import { computeFit } from "../stage";
import { STAGE_WIDTH } from "../layout";

// Device profiles that actually matter, plus the two that drove this design.
const PROFILES: Array<{ name: string; w: number; h: number; compact: boolean }> = [
  { name: "Galaxy S21 landscape", w: 914, h: 412, compact: true },
  { name: "iPhone landscape", w: 844, h: 390, compact: true },
  { name: "1366x768 laptop", w: 1366, h: 768, compact: false },
  { name: "1920x1080 desktop", w: 1920, h: 1080, compact: false },
  { name: "1280x800", w: 1280, h: 800, compact: false },
];

describe("stage fit", () => {
  it("fills the viewport edge to edge on every landscape profile", () => {
    // The bug this exists to prevent: a fixed 1280x760 surface could only
    // letterbox, so a landscape phone (~2.2:1 against the design's 1.68:1)
    // rendered the table at 0.44x inside ~174px of black on each side.
    for (const p of PROFILES) {
      const fit = computeFit(p.w, p.h, p.compact);
      const renderedW = STAGE_WIDTH * fit.scale;
      const renderedH = fit.stageHeight * fit.scale;
      expect(Math.abs(renderedW - p.w), `${p.name} width`).toBeLessThanOrEqual(1);
      // Height carries a little slack that width doesn't: vf is quantized to
      // 2dp (so a drag-resize doesn't rebuild the seat-arc table every frame),
      // and rounding it down leaves up to ~0.01 * 760 stage px unclaimed.
      // Sub-2px on any real screen -- the point is that it's bounded, not that
      // it's exact.
      expect(Math.abs(renderedH - p.h), `${p.name} height`).toBeLessThanOrEqual(2);
    }
  });

  it("leaves room below the play area for the dock, and above it for the top chrome", () => {
    for (const p of PROFILES) {
      const fit = computeFit(p.w, p.h, p.compact);
      const bandsInStagePx = fit.stageHeight - fit.playTop - 760 * fit.vf;
      // The dock band is what keeps the tray off the viewer's own cards.
      expect(bandsInStagePx * fit.scale, `${p.name} dock band`).toBeGreaterThanOrEqual(60);
      expect(fit.playTop * fit.scale, `${p.name} top band`).toBeGreaterThanOrEqual(40);
    }
  });

  it("flattens the table only as far as the viewport demands, never past the floor", () => {
    for (const p of PROFILES) {
      const fit = computeFit(p.w, p.h, p.compact);
      expect(fit.vf).toBeGreaterThanOrEqual(0.5);
      expect(fit.vf).toBeLessThanOrEqual(1);
    }
    // A generous 16:10 desktop barely needs to flatten; a squat phone does.
    expect(computeFit(1280, 800, false).vf).toBeGreaterThan(computeFit(914, 412, true).vf);
  });

  it("never upscales past the cap, so a huge monitor doesn't bet on image resolution", () => {
    expect(computeFit(3840, 2160, false).scale).toBe(1.6);
  });

  it("keeps the play area on the stage when the viewport is too tall to fill", () => {
    // Portrait can't be filled by a 1280-wide design -- it letterboxes, which
    // is fine, but the stage must not claim more height than it can show.
    const fit = computeFit(390, 844, true);
    expect(fit.vf).toBe(1);
    expect(fit.stageHeight * fit.scale).toBeLessThanOrEqual(844);
  });

  it("degrades to the design size rather than dividing by zero before layout", () => {
    expect(computeFit(0, 0, false)).toEqual({ scale: 1, stageHeight: 760, vf: 1, playTop: 0 });
  });
});
