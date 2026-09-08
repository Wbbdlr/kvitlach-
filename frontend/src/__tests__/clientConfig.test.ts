import { beforeEach, describe, expect, it } from "vitest";
import { applyCardEffects, hexToTriplet } from "../clientConfig";

// The receiving end of GET /api/config. What matters here is not that a value
// arrives -- it is what happens to the ones that should not. These strings are
// written into CSS custom properties, which are not parsed until they are
// substituted, so anything that gets through can author CSS on the felt.

const read = (prop: string) => document.documentElement.style.getPropertyValue(prop);

beforeEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("hexToTriplet", () => {
  it("gives the keyframes the r, g, b form they need", () => {
    // The colours are triplets rather than hex precisely because the win
    // animation uses three different alphas of the same colour.
    expect(hexToTriplet("#e6a44b")).toBe("230, 164, 75");
    expect(hexToTriplet("#FFFFFF")).toBe("255, 255, 255");
  });

  it("returns null for anything that is not one", () => {
    for (const junk of ["red", "rgb(1,2,3)", "var(--x)", "#fff", "#e6a44b;x", "", 12, null, undefined]) {
      expect(hexToTriplet(junk)).toBeNull();
    }
  });
});

describe("applying the card effects", () => {
  it("writes every field onto the root element", () => {
    applyCardEffects({
      winColor: "#33ff99",
      winScalePeak: 1.15,
      winScaleRest: 1.05,
      futchColor: "#4400aa",
      futchScale: 0.9,
      futchSaturate: 0.2,
    });
    expect(read("--k-win-rgb")).toBe("51, 255, 153");
    expect(read("--k-win-scale-peak")).toBe("1.15");
    expect(read("--k-futch-rgb")).toBe("68, 0, 170");
    expect(read("--k-futch-saturate")).toBe("0.2");
  });

  it("leaves a bad field alone rather than writing it", () => {
    // Nothing is set, so the stylesheet's own :root value stands -- which is
    // the shipped look, and the correct outcome for a payload we cannot use.
    applyCardEffects({ winColor: "#fff; background: url(http://evil)", futchColor: "#4400aa" });
    expect(read("--k-win-rgb")).toBe("");
    expect(read("--k-futch-rgb")).toBe("68, 0, 170");
  });

  it("clamps a number the server should already have clamped", () => {
    // Belt and braces on purpose: the server bounds these too, and neither
    // side is trusted to be the only one that did.
    applyCardEffects({ winScalePeak: 40, futchScale: 0.01, futchSaturate: 1 });
    expect(read("--k-win-scale-peak")).toBe("1.2");
    expect(read("--k-futch-scale")).toBe("0.8");
    expect(read("--k-futch-saturate")).toBe("0.9");
  });

  it("does nothing at all with a missing or malformed document", () => {
    applyCardEffects(undefined);
    applyCardEffects(null);
    applyCardEffects("not an object" as never);
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });
});
