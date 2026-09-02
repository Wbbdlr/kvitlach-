import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CardView } from "../CardView";
import { Icon } from "../icons";
import { Card } from "../../types";

const rejectedCard: Card = { name: "11", attributes: { values: [11], eleveroonIgnored: true } };
const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8").replace(/\r\n/g, "\n");

/** The `d` of every path the icon draws. */
function paths(name: Parameters<typeof Icon>[0]["name"]): string {
  const { container } = render(<Icon name={name} />);
  return [...container.querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "").join(" ");
}

// Asked for directly: the Eleveroon marks are a Magen David, not a five-point
// star, and the word is set in the same face the cards' own SCHLESINGER
// watermark uses. Both are the kind of thing that survives a refactor by
// accident and is reverted by one just as easily, so both are pinned.
describe("the Eleveroon mark", () => {
  it("draws two triangles, not a five-point star", () => {
    const magen = paths("magen");
    // Two subpaths, each closed with Z, is the shape; the old star is one.
    expect(magen.match(/[Zz]/g)?.length).toBe(2);
    expect(magen).not.toBe(paths("star"));
  });

  // Every other icon in the set is a stroked outline. This one is filled, and
  // that is deliberate -- it renders at 8px in a seat plate's corner, where
  // two overlapping outlined triangles at 1.8 stroke are a smudge.
  it("is filled rather than stroked, so it survives 8px", () => {
    const { container } = render(<Icon name="magen" size={8} />);
    const path = container.querySelector("path");
    expect(path?.getAttribute("fill")).toBe("currentColor");
    expect(path?.getAttribute("stroke")).toBe("none");
  });

  it("is the icon a rejected card actually shows", () => {
    const { container } = render(<CardView card={rejectedCard} pastFirstPaint />);
    const badgeIcon = container.querySelector(".k-elev-badge-icon path");
    expect(badgeIcon?.getAttribute("d")).toBe(paths("magen"));
  });

  it("sets the word in the card watermark's own face, not the UI sans", () => {
    const at = CSS.indexOf("\n.k-elev-badge-label {");
    const body = CSS.slice(at, CSS.indexOf("}", at));
    // cardMark.ts stamps SCHLESINGER in the same stack.
    expect(body).toContain("'Cinzel'");
  });

  // Cinzel is far wider than the sans it replaced: at the old 8px the word
  // sets 51px against a 41px card and crosses onto the neighbouring one. The
  // size is derived from the font's own advance widths, so a later nudge by
  // eye is exactly what this guards against.
  it("stays inside the card it is stamped on", () => {
    const at = CSS.indexOf("\n.k-elev-badge-label {");
    const body = CSS.slice(at, CSS.indexOf("}", at));
    const px = Number(body.match(/font-size:\s*([\d.]+)px/)?.[1]);
    const track = Number(body.match(/letter-spacing:\s*([\d.]+)px/)?.[1] ?? 0);
    // Cinzel's total advance for "Eleveroon" AT WEIGHT 700, read out of
    // public/cinzel-subset.woff2 with fontTools. The face is variable
    // (wght 400-900) and the file's default instance is 400, which advances
    // 5.822em -- 2% narrower. Measuring the default is the easy mistake here.
    const width = px * 5.937 + track * ("Eleveroon".length - 1);
    const cardWidth = Number(CSS.match(/--k-card-w:\s*(\d+)px/)?.[1]);
    expect(cardWidth).toBe(41);
    expect(width).toBeLessThan(cardWidth - 2);
  });
});
