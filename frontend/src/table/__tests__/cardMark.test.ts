import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MARK, markSvgBody } from "../cardMark";

// Reads the GENERATOR rather than a copy of the list, for the same reason
// errorCopy.test.ts reads the backend: a hand-maintained duplicate in two
// languages drifts silently, and this particular drift is invisible by
// inspection. The overlay's whole purpose is to reproduce the baked raster
// exactly, so if these two sets disagree the mark does not render WRONG --
// it appears on a card that has none baked in, or vanishes from one that
// does, the moment the overlay is switched on.
const GENERATOR = join(__dirname, "..", "..", "..", "..", "tools", "card-mark.py");

function generatorMarkedCards(): number[] {
  const text = readFileSync(GENERATOR, "utf8");
  const m = text.match(/^MARKED = frozenset\(\{([\d,\s]+)\}\)/m);
  if (!m) throw new Error("could not find MARKED in tools/card-mark.py");
  return m[1]
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

describe("card mark defaults", () => {
  it("marks the same cards the generator bakes", () => {
    expect([...DEFAULT_MARK.cards].sort((a, b) => a - b)).toEqual(generatorMarkedCards());
  });

  it("found a real set to compare against", () => {
    // Guards the guard: if the regex stops matching the Python (reformatted,
    // renamed, moved) the test above would compare against nothing and pass.
    expect(generatorMarkedCards().length).toBeGreaterThan(0);
  });

  it("draws nothing at all for an unmarked card", () => {
    // Not "draws something faint" -- markSvgBody returns "" so CardView can
    // skip the <svg> element entirely rather than stacking twelve empty
    // overlays on a felt that already re-renders every card each round.
    for (const card of [2, 3, 4, 5, 6, 7, 9, 10, 11]) {
      expect(markSvgBody(card, DEFAULT_MARK), `card ${card}`).toBe("");
    }
  });

  it("still draws the three that are marked, card 1 as a cartouche", () => {
    // 1 is the only head cartouche; 8 and 12 take the plain foot baseline.
    // Distinguished by the <rect> frame, which only the cartouche has.
    const head = markSvgBody(1, DEFAULT_MARK);
    expect(head).toContain("<rect");
    expect(head).toContain("SCHLESINGER");
    for (const card of [8, 12]) {
      const body = markSvgBody(card, DEFAULT_MARK);
      expect(body, `card ${card}`).toContain("SCHLESINGER");
      expect(body, `card ${card}`).not.toContain("<rect");
    }
  });

  it("keeps the ornate-frame baseline available for cards switched on later", () => {
    // 2 and 11 are out of the shipped default, so nothing exercises their
    // short 67px band any more -- but the admin editor can switch either on,
    // and that is the band the mark was once reported sitting on top of. This
    // keeps the branch honest rather than letting it rot unused.
    const ornate = markSvgBody(11, { ...DEFAULT_MARK, cards: [11] });
    const plain = markSvgBody(10, { ...DEFAULT_MARK, cards: [10] });
    expect(ornate).toContain('y="1393"');
    expect(plain).toContain('y="1350"');
  });
});

// The mark's markup is assembled as a STRING and injected with
// dangerouslySetInnerHTML, so every attribute has to survive an HTML parser --
// which is a different thing from being valid JavaScript.
//
// font-family did not. It was built with JSON.stringify(), which escapes an
// inner quote as \" -- correct JSON, meaningless to HTML. The parser closed
// the attribute at the first quote and read the remainder of the font stack as
// further attributes. What shipped live on kvitlach.us was:
//
//   font-family="\" cinzel\",="" georgia,="" \"times="" new="" roman\",=""
//
// one attribute shredded into seven, with font-family itself resolving to a
// single backslash, so the mark fell back to the browser's default serif on
// every platform. Nothing caught it because the fallback is metrically almost
// identical for this one string: "SCHLESINGER" measures 724px in Cinzel and
// 722.5px in the default serif at 100px/600, 0.2% apart. Nothing shifted, no
// frame misfit, no visual tell.
//
// So this parses the output rather than pattern-matching it. A string
// assertion would have passed on the broken markup too -- the bytes were all
// present, they were just in seven attributes instead of one.
describe("mark markup survives an HTML parser", () => {
  const parseMark = (card: number): Element => {
    const body = markSvgBody(card, DEFAULT_MARK);
    expect(body, `card ${card} should render a mark`).not.toBe("");
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const text = doc.querySelector("text");
    expect(text).not.toBeNull();
    return text!;
  };

  it.each(DEFAULT_MARK.cards)("card %i asks for the real font stack", (card) => {
    expect(parseMark(card).getAttribute("font-family")).toBe(DEFAULT_MARK.fontFamily);
  });

  it("does not shed the stack into extra attributes", () => {
    // The specific failure: the tail of the stack became attribute NAMES.
    const names = [...parseMark(DEFAULT_MARK.cards[0]).attributes].map((a) => a.name.toLowerCase());
    for (const junk of ["cinzel", "georgia,", "new", "roman", "serif"]) {
      expect(names, `"${junk}" parsed as an attribute name -- the stack was shredded`).not.toContain(junk);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the text itself intact", () => {
    expect(parseMark(DEFAULT_MARK.cards[0]).textContent).toBe(DEFAULT_MARK.text);
  });
});
