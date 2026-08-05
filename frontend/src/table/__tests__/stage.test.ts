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
    // 3840 (4K) is exactly the cap's own break-even width (3840/1280 = 3.0),
    // not past it -- 7680 (8K) actually exceeds it, so this is the one that
    // pins the ceiling itself rather than a coincidence of the fixture.
    expect(computeFit(7680, 2160, false).scale).toBe(3.0);
  });

  it("keeps the play area on the stage when the viewport is too tall to fill", () => {
    // A 1280-wide design can't make a portrait phone's aspect ratio without
    // flattening past the floor -- vf ceilings at 1 instead, and the stage
    // fills the rest of the available height (see the next test) rather
    // than claiming more than it can show.
    const fit = computeFit(390, 844, true);
    expect(fit.vf).toBe(1);
    expect(fit.stageHeight * fit.scale).toBeLessThanOrEqual(844);
  });

  it("fills a portrait phone's leftover height instead of letterboxing it away", () => {
    // Regression: vf ceilings at 1 well before a portrait phone's height
    // runs out (width bound the scale first), and the leftover used to just
    // vanish -- stageHeight capped at playTop + play area + dockBand, and
    // .k-fit's centering turned the rest into dead bars above and below the
    // WHOLE stage. Measured on a 360x800 Android: the felt rendered at only
    // 434.75 of the 800px viewport (54%), and the dock -- bottom-anchored to
    // the felt's own edge -- floated with a ~183px dead gap under it that
    // mirrored the one above the logo.
    const fit = computeFit(360, 800, true);
    // Within a rounding quantum of the full viewport, not most of it.
    expect(fit.stageHeight * fit.scale).toBeGreaterThan(800 - 3);
    // The leftover went into playTop (more headroom above the play area)
    // and the dock band (more felt showing below the last seat) rather than
    // being clawed back from either -- both are strictly larger than their
    // un-grown minimums for this profile.
    expect(fit.playTop * fit.scale).toBeGreaterThan(40);
    const dockBandPx = (fit.stageHeight - fit.playTop - 760 * fit.vf) * fit.scale;
    expect(dockBandPx).toBeGreaterThan(60);
  });

  it("reserves the tray's real height when it grows past the nominal dock", () => {
    // Regression, caught on production: the dock's tallest state ("Round
    // complete / Waiting for the banker to start the next round") wraps to
    // two lines and measures 79px against a 60px nominal reserve, so the
    // viewer's own seat was overlapped by 11px on a landscape phone.
    for (const p of PROFILES) {
      const nominal = computeFit(p.w, p.h, p.compact);
      const measured = computeFit(p.w, p.h, p.compact, 79);
      const bandOf = (f: ReturnType<typeof computeFit>) =>
        (f.stageHeight - f.playTop - 760 * f.vf) * f.scale;
      expect(bandOf(measured), `${p.name}`).toBeGreaterThanOrEqual(79);
      // Only ever gives the tray more room, never takes the felt's width.
      expect(measured.scale).toBe(nominal.scale);
      expect(measured.vf).toBeLessThanOrEqual(nominal.vf);
    }
  });

  it("ignores a measured tray shorter than the nominal dock", () => {
    // A tray mid-mount (height 0) must not collapse the band to nothing.
    for (const p of PROFILES) {
      expect(computeFit(p.w, p.h, p.compact, 0)).toEqual(computeFit(p.w, p.h, p.compact));
      expect(computeFit(p.w, p.h, p.compact, 12)).toEqual(computeFit(p.w, p.h, p.compact));
    }
  });

  it("degrades to the design size rather than dividing by zero before layout", () => {
    expect(computeFit(0, 0, false)).toEqual({ scale: 1, stageHeight: 760, vf: 1, playTop: 0 });
  });
});
