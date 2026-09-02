import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Newlines normalised: the selector lists below are matched literally, and on
// a Windows checkout the file's own line endings would otherwise decide
// whether this suite passes.
const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8").replace(/\r\n/g, "\n");

/** The declarations inside the first rule whose selector list matches. */
function ruleBody(selectorList: string): string {
  const at = CSS.indexOf(`\n${selectorList} {`);
  expect(at, `no rule found for "${selectorList}"`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open, CSS.indexOf("}", open));
}

// Reported on desktop: clicking around the felt left a large blinking text
// caret on the table. The felt's own font size runs with --stage-scale, so the
// caret is drawn several times the height of anything in the chrome.
//
// Asserted against the stylesheet rather than a render, for the same reason
// cssOverrideOrder.test.ts is: no component test selects text, and jsdom has
// no selection model to observe if one did.
describe("nothing on the game board is selectable text", () => {
  it("makes the felt and the chrome band unselectable", () => {
    const body = ruleBody(".felt-table,\n.k-bottom-band");
    expect(body).toContain("user-select: none");
    expect(body).toContain("-webkit-user-select: none");
  });

  it("leaves real fields inside the band typable", () => {
    const body = ruleBody(".k-bottom-band input,\n.k-bottom-band textarea,\n.k-bottom-band [contenteditable]");
    expect(body).toContain("user-select: text");
  });

  // The room ID, invite link and password live in drawers inside .k-fit, and
  // RoomInfoDrawer's clipboard fallback tells the player to select the ID and
  // copy it by hand. A blanket rule on .k-fit would make that instruction a
  // lie, silently, with no failing test anywhere -- so the absence of that
  // rule is the thing worth pinning.
  it("does not blanket the whole table view, which would break copy-by-hand", () => {
    expect(CSS).not.toMatch(/^\.k-fit \{[^}]*user-select: none/m);
  });
});
