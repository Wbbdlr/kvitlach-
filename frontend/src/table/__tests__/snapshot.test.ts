import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { snapshotFilename } from "../snapshot";

const SOURCE = readFileSync(resolve(__dirname, "../snapshot.ts"), "utf8");

describe("snapshotFilename", () => {
  const at = new Date(2026, 0, 5);

  it("names the file after the table, the round and the date", () => {
    expect(snapshotFilename("Chanukah night 3", 7, at)).toBe("Kvitlach - Chanukah night 3 - round 7 - 2026-01-05.png");
  });

  it("drops the round when there isn't one", () => {
    expect(snapshotFilename("Chanukah night 3", undefined, at)).toBe("Kvitlach - Chanukah night 3 - 2026-01-05.png");
  });

  it("strips characters Windows will not save", () => {
    // A download that silently fails to save is worse than an ugly filename,
    // and room names are player-authored.
    const name = snapshotFilename('Zaidy: "the big one" <night 4/5>', 2, at);
    expect(name).not.toMatch(/[\/:*?"<>|]/);
    expect(name).toContain("Zaidy");
  });

  it("survives an empty room name rather than producing a nameless file", () => {
    expect(snapshotFilename("", undefined, at)).toBe("Kvitlach - Kvitlach - 2026-01-05.png");
  });
});

describe("how the snapshot is produced", () => {
  // The first version DREW the table -- canvas, seat positions out of
  // layout.ts, plates and pills painted by hand. It was faithful to the data
  // and nothing like the game, because a second renderer only ever reproduces
  // what someone remembered to reimplement. It now rasterizes the real DOM.
  //
  // jsdom cannot rasterize anything, so there is no output to inspect here.
  // What these hold are the decisions that make the picture faithful -- each
  // one is something that reverts silently to a plausible-looking wrong
  // result rather than to an error.

  it("captures the DOM rather than redrawing the table", () => {
    expect(SOURCE).toContain("foreignObject");
    // The tell-tales of the drawn version. Any of these coming back means
    // someone has started reimplementing the felt again.
    expect(SOURCE).not.toContain("seatPositions");
    expect(SOURCE).not.toContain("getContext(\"2d\")\n  if (!ctx) return null;\n  ctx.scale");
    expect(SOURCE).not.toContain("arcTo");
  });

  it("inlines every same-origin resource it needs", () => {
    // An external reference taints the canvas and makes toBlob throw -- so the
    // failure mode for missing this is not "the font looks wrong", it is "the
    // button does nothing".
    expect(SOURCE).toContain("readAsDataURL");
    expect(SOURCE).toContain("inlineCssUrls");
    expect(SOURCE).toContain('querySelectorAll("img")');
  });

  it("copies form state that lives in properties, not attributes", () => {
    // cloneNode copies attributes. The bet field would serialize empty and the
    // Eleveroon box unchecked, in a picture that otherwise looks entirely
    // correct -- the worst kind of wrong.
    expect(SOURCE).toContain("field.checked");
    expect(SOURCE).toContain('target.setAttribute("value", field.value)');
  });

  it("serializes as XML, not innerHTML", () => {
    // The foreignObject payload has to be well-formed XML. innerHTML happily
    // emits HTML that is not, and the SVG then fails to load as an image --
    // silently, through the onerror path.
    expect(SOURCE).toContain("XMLSerializer");
  });

  it("paints a background behind the capture", () => {
    // The page's ground colour is on <body>, outside the captured element.
    // Without this the PNG is transparent and looks washed out anywhere it is
    // viewed on a light background -- i.e. in most chat apps.
    expect(SOURCE).toContain("fillRect(0, 0, width, height)");
  });
});
