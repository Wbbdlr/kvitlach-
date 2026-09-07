import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read as source rather than rendered, the same way endGamePrompt and
// bankerControls are: the hint is three lines of state inside TableRoot,
// which needs a live round, a stage and a WS store to mount at all.
const SRC = readFileSync(resolve(__dirname, "../TableRoot.tsx"), "utf8");
// Strip JSX comments so the prose ABOUT the fix cannot satisfy a check that
// is supposed to be about the fix -- this has caught a false pass before.
const CODE = SRC.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*/g, "");

// "Tap for fullscreen -- best in landscape." rendered as a panel over the
// top-right quadrant of the felt, on seat space, and it stayed there until
// somebody pressed GOT IT. It also showed on a 1440x900 desktop, where there
// is nothing to tap and no landscape to rotate into.
describe("the one-time fullscreen nudge", () => {
  it("only offers itself where tapping and landscape mean something", () => {
    const init = CODE.slice(CODE.indexOf("showFullscreenHint"), CODE.indexOf("dismissFullscreenHint"));
    // isHandheld() is immersive.ts's own predicate for "this is a phone",
    // deliberately reused rather than a second opinion about screen size.
    expect(init).toContain("isHandheld()");
  });

  it("takes itself off the felt without needing to be dismissed", () => {
    // A nudge that sits on seat space for the whole night is not a nudge.
    expect(CODE).toContain("FULLSCREEN_HINT_MS");
    const armed = CODE.split(String.fromCharCode(10)).find(
      (line) => line.includes("setTimeout") && line.includes("FULLSCREEN_HINT_MS")
    );
    expect(armed).toBeDefined();
    expect(armed).toContain("dismissFullscreenHint");
  });

  it("counts an ignored nudge as seen, so it does not come back every load", () => {
    // dismissFullscreenHint is what writes the localStorage flag, and the
    // timeout above goes through it rather than just hiding the panel --
    // otherwise the thing they ignored greets them again next reload.
    const dismiss = CODE.slice(CODE.indexOf("const dismissFullscreenHint"));
    expect(dismiss.slice(0, 400)).toContain("FULLSCREEN_HINT_KEY");
  });

  it("clears its timer on unmount", () => {
    expect(CODE).toMatch(/clearTimeout/);
  });
});
