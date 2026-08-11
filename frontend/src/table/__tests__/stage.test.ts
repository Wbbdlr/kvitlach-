import { describe, expect, it } from "vitest";
import { computeFit } from "../stage";
import { STAGE_WIDTH, bottomSeatCenterY } from "../layout";

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
      // 0.4, not 0.5 -- see stage.ts's MIN_VF comment: forcing vf UP to a
      // floor once the viewport is tight enough to engage one only pushes
      // the viewer's own seat closer to the dock, it doesn't buy legibility
      // for free the way it sounds like it should.
      expect(fit.vf).toBeGreaterThanOrEqual(0.4);
      expect(fit.vf).toBeLessThanOrEqual(1);
    }
    // A generous 16:10 desktop barely needs to flatten; a squat phone does.
    expect(computeFit(1280, 800, false).vf).toBeGreaterThan(computeFit(914, 412, true).vf);
  });

  it("keeps the viewer's own seat clear of the dock band, even in the dock's tallest state", () => {
    // Regression: a live landscape phone report ("controls covering the
    // player's results beneath his hand") traced to this exact gap. Modelled
    // directly off .k-controls's own CSS (index.css) and .k-seat's own
    // translate(-50%,-50%) (Seat.tsx) rather than off computeFit's internal
    // accounting, because that accounting is exactly what missed this: once
    // a tight viewport caps the felt to fill it (as every profile here does
    // with the dock's tallest known state, 79px -- see "reserves the tray's
    // real height" above), .k-controls sits at a real screen position fixed
    // by the viewport itself, NOT by how much stage-space vf/dockBand meant
    // to leave beneath the play area -- and the viewer's own seat, always
    // bottom-centre (layout.ts's bottomSeatCenterY), renders a fixed-size
    // box that doesn't shrink with vf, half of it (SEAT_HEIGHT / 2)
    // extending below its own centre point. Both real positions are derived
    // here the same way TableRoot.tsx's own JSX does (felt centred in
    // .k-fit via stageHeight*scale, dock bottom-anchored off what's left).
    const DOCK_HEIGHT = 79;
    const GUTTER = 10; // mirrors stage.ts's DOCK_GUTTER_PX
    const SEAT_OVERHANG = 100; // mirrors stage.ts's VIEWER_SEAT_OVERHANG_PX
    for (const p of PROFILES.filter((x) => x.compact)) {
      const fit = computeFit(p.w, p.h, p.compact, DOCK_HEIGHT);
      const feltRealY = (p.h - fit.stageHeight * fit.scale) / 2;
      const dockRealTop = p.h - feltRealY - GUTTER - DOCK_HEIGHT;
      const seatRealBottom = feltRealY + fit.scale * (bottomSeatCenterY(fit.vf, fit.playTop) + SEAT_OVERHANG);
      expect(dockRealTop - seatRealBottom, `${p.name}`).toBeGreaterThan(0);
    }
  });

  it("keeps the dealer's own plate clear of .k-chrome-top, on a crowded landscape table", () => {
    // Regression, the mirror image of the dock/viewer-seat one above: found
    // live on an 11-player table at 812x375 (2026-08-11), following up the
    // "possible top-of-table clipping" item this file used to carry as
    // unverified. Same mechanism, opposite end -- the dealer's own seat
    // (Dealer.tsx: `top: play-top + 160px*vf`, then translate(-50%,-50%))
    // overhangs ABOVE its center by roughly half its own height, and
    // TOP_CHROME_PX alone only ever cleared the center, not the plate
    // sitting above it. .k-chrome-top lives outside the scaled stage (real
    // top:8px, and its buttons are the compact breakpoint's 40px-tall
    // version on every profile here), so its own real bottom edge doesn't
    // move with playTop/vf the way the dealer's plate does.
    const CHROME_TOP_BOTTOM = 8 + 40; // .k-chrome-top's top:8px + its compact button height
    // The seat height actually measured live in the reproducing case (151px,
    // shorter than SEAT_HEIGHT's 200 -- the dealer's cards render at 72px,
    // not the viewer's 92px) -- not stage.ts's own (deliberately smaller,
    // see DEALER_SEAT_OVERHANG_PX's comment on why) reservation, so this
    // pins the real-world gap the fix has to cover, not just however much
    // of it the fix happens to claim.
    const DEALER_OVERHANG = 151 / 2;
    for (const p of PROFILES.filter((x) => x.compact)) {
      const fit = computeFit(p.w, p.h, p.compact);
      const feltRealY = (p.h - fit.stageHeight * fit.scale) / 2;
      const dealerCenterYDesign = fit.playTop + 160 * fit.vf;
      const dealerPlateRealTop = feltRealY + fit.scale * (dealerCenterYDesign - DEALER_OVERHANG);
      expect(dealerPlateRealTop - CHROME_TOP_BOTTOM, `${p.name}`).toBeGreaterThan(0);
    }
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
