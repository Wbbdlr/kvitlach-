import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { discardPilePosition, shoePosition, STAGE_WIDTH } from "../layout";

// The shoe and the discard pile are placed twice: by index.css, which actually
// draws them, and by layout.ts, which Seat/Dealer use as the ORIGIN of the
// card-deal-in animation and the DESTINATION of a rejected card's fly-out.
// Both files carry comments saying the four literals must move together.
//
// They did not. Moving the pair clear of the bank's row changed the CSS `top`
// and left layout.ts's at 116, which is exactly the failure the comments were
// written to prevent and exactly the kind a render test cannot see: cards keep
// animating, just to a spot the deck is no longer in.
//
// So the numbers are compared, not described.

const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

function cssOffsets(selector: string): { left: number; top: number } {
  const block = CSS.slice(CSS.indexOf(`${selector} {`));
  const body = block.slice(0, block.indexOf("}"));
  const left = body.match(/left:\s*calc\(50%\s*([+-])\s*(\d+)px\)/);
  const top = body.match(/top:\s*calc\(var\(--play-top,\s*0px\)\s*\+\s*(\d+)px\s*\*\s*var\(--vf,\s*1\)\)/);
  if (!left || !top) throw new Error(`could not read offsets out of ${selector}`);
  return { left: Number(`${left[1]}${left[2]}`), top: Number(top[1]) };
}

describe("the shoe and the discard pile", () => {
  // playTop 0 and vf 1 keep the arithmetic out of the comparison -- what is
  // being asserted is that the two files agree, not what either one says.
  const shoe = shoePosition(0, 1);
  const pile = discardPilePosition(0, 1);

  it("agrees with .k-shoe's own CSS", () => {
    const css = cssOffsets(".k-shoe");
    expect(shoe.x - STAGE_WIDTH / 2).toBe(css.left);
    expect(shoe.y).toBe(css.top);
  });

  it("agrees with .k-discard's own CSS", () => {
    const css = cssOffsets(".k-discard");
    expect(pile.x - STAGE_WIDTH / 2).toBe(css.left);
    expect(pile.y).toBe(css.top);
  });

  it("keeps them a mirrored pair", () => {
    // Nudging one side alone leaves the table visibly lopsided, and has been
    // the tempting fix twice now -- both times only one side was reported.
    expect(shoe.x - STAGE_WIDTH / 2).toBe(-(pile.x - STAGE_WIDTH / 2));
    expect(shoe.y).toBe(pile.y);
  });

  it("leaves the bank's row room to grow", () => {
    // .k-bank-hud is centred on the dealer and runs to two lines whenever a
    // wager is reserved. At 145 it was measured overlapping the shoe by 10px
    // at 640x360. This is the clearance that fixed it, stated as the number it
    // is so that shrinking it back is a deliberate act.
    expect(shoe.x - STAGE_WIDTH / 2).toBeGreaterThanOrEqual(175);
  });
});
