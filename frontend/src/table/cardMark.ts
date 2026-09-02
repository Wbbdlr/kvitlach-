// The Schlesinger maker's mark, drawn live over the card face.
//
// It used to be composited into the PNGs by tools/card-mark.py. Everything
// here is authored in that generator's own coordinate space -- the 946x1438
// source art -- and handed to an SVG viewBox, so the numbers below are the
// SAME numbers the Python used and the browser does the scaling. That is the
// whole reason this is SVG rather than positioned HTML text: a card renders
// anywhere from ~12px wide (a far seat on a phone) to ~183px (own hand on a
// 4K desktop), and a viewBox tracks that range for free, at whatever the
// device's pixel density is.
//
// It also retires the problem that cost three releases. The baked mark had to
// survive an 8-14x downscale, where thin strokes averaged into cream paper
// and a dark blue bleached to grey. Drawn live, a mark on a 56px card is
// drawn at 56px. There is no resampling to design around.

export const ART_W = 946;
export const ART_H = 1438;

export interface MarkSettings {
  text: string;
  /** CSS font-family stack. The shipped face is a subset Cinzel (public/). */
  fontFamily: string;
  /** Cinzel's variable wght axis, 400..900. */
  weight: number;
  /** Cap height in ART units, matching the generator's SIZE. */
  size: number;
  /** Extra space between letters, in ART units. */
  tracking: number;
  color: string;
  opacity: number;
  /** Cards that show the mark at all. */
  cards: number[];
}

// Matched to the v8.9 raster, constant for constant, so switching to the
// overlay is not a redesign. See tools/card-mark.py for why each is what it
// is -- particularly MARK_INK (chroma, not darkness) and WEIGHT (stroke width
// is what carries colour, though that mattered more when it was resampled).
export const DEFAULT_MARK: MarkSettings = {
  text: "SCHLESINGER",
  fontFamily: '"Cinzel", Georgia, "Times New Roman", serif',
  weight: 600,
  size: 58,
  tracking: 9,
  color: "#2B5FB0",
  opacity: 230 / 255,
  // MUST equal card-mark.py's MARKED -- read that comment for why these three
  // (the ace, the eight nights, and the 12 that reads three ways) and not all
  // twelve. The overlay's job is to reproduce the shipped raster exactly, so a
  // disagreement here does not show as a mismatch: it silently adds or removes
  // a mark the instant the overlay is switched on. Pinned by cardMark.test.ts.
  cards: [1, 8, 12],
};

// Cards 2 and 11 carry an ornamental frame whose bottom flourish reaches
// y1337, leaving a 68px band against the other ten's 233px. 1393 centres the
// mark in it; 1350 is where the plain ten sit. One baseline for all twelve
// was tried and crowded the plain cards against the bottom rule.
const FOOT_BASELINE = 1350;
const FOOT_BASELINE_ORNATE = 1393;
const ORNATE = new Set([2, 11]);

// Card 1 gets a framed cartouche at the head instead of a foot imprint, in
// the 237px band between the top rule (y31) and the digit (y269).
const HEAD = { top: 96, boxH: 122, size: 56, tracking: 10, padX: 44 };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Cinzel's own advance widths at wght 600, in 1/1000 em, read out of the font
// with fontTools. Only card 1 needs these -- its cartouche frame is drawn
// AROUND the text, so something has to know how wide the text will be, and
// SVG cannot size a <rect> to a <text> without measuring in JS.
//
// This is a table rather than an average because an average is wrong by
// enough to see: "SCHLESINGER" measures 7.305em, and a 0.72em-per-character
// estimate made it 7.92em -- a frame 6.5% too wide, which a pixel-diff
// against the baked art caught immediately.
//
// Measuring at paint time with getBBox() would be exact for every weight and
// every custom string, but costs a second render pass and makes the frame
// jump once the webfont loads. The table is exact at the shipped weight and
// close at others; the frame is padding around text, not a fit.
const ADV: Record<string, number> = {
  " ": 250, "!": 256, '"': 347, "#": 562, $: 528, "%": 722, "&": 753, "'": 190,
  "(": 395, ")": 395, "*": 388, "+": 481, ",": 215, "-": 380, ".": 208, "/": 419,
  "0": 634, "1": 376, "2": 596, "3": 543, "4": 607, "5": 536, "6": 607, "7": 530,
  "8": 586, "9": 607, ":": 208, ";": 215, "<": 489, "=": 481, ">": 481, "?": 445,
  "@": 986, A: 715, B: 645, C: 773, D: 821, E: 613, F: 577, G: 824, H: 845,
  I: 370, J: 364, K: 724, L: 598, M: 946, N: 857, O: 865, P: 630, Q: 867,
  R: 724, S: 544, T: 650, U: 809, V: 732, W: 975, X: 707, Y: 689, Z: 658,
  "[": 389, "\\": 419, "]": 389, "^": 543, _: 500, "`": 504, a: 650, b: 593,
  c: 690, d: 752, e: 558, f: 531, g: 734, h: 749, i: 347, j: 330, k: 657,
  l: 545, m: 868, n: 779, o: 776, p: 575, q: 770, r: 648, s: 497, t: 592,
  u: 703, v: 646, w: 880, x: 642, y: 637, z: 607, "{": 365, "|": 253, "}": 365,
  "~": 493,
};
const FALLBACK_ADV = 664; // the alphabet's own mean, for anything not listed

/** Advance width of `text` in ART units, including tracking between letters. */
export function textWidth(text: string, size: number, tracking: number): number {
  let em = 0;
  for (const ch of text) em += (ADV[ch] ?? FALLBACK_ADV) / 1000;
  return em * size + Math.max(0, text.length - 1) * tracking;
}

/**
 * The mark for one card, as SVG markup inside a 946x1438 viewBox.
 *
 * Returns "" when this card shows no mark, so the caller renders nothing at
 * all rather than an empty <svg> over every card on the table.
 */
export function markSvgBody(card: number, s: MarkSettings): string {
  if (!s.cards.includes(card) || !s.text.trim()) return "";
  const cx = ART_W / 2;
  // text-anchor:middle centres on the advance width, and letter-spacing adds
  // its gap after the LAST glyph too -- so the run measures half a tracking
  // wider on the right. Nudging by half puts the ink back on centre.
  const x = cx + s.tracking / 2;
  const common =
    // esc(), not JSON.stringify(). JSON escapes an inner quote as \" and HTML
    // has no idea what that means, so the parser closed the attribute at the
    // first quote and read the REST of the stack as more attributes. What
    // actually shipped, live on kvitlach.us, was:
    //   font-family="\" cinzel\",="" georgia,="" \"times="" new="" ...
    // -- one attribute shredded into seven, with font-family itself resolving
    // to a single backslash. So the mark has never rendered in Cinzel on any
    // platform; the browser fell back to its default serif everywhere.
    //
    // It survived because the fallback is metrically almost identical for this
    // one string: measured, "SCHLESINGER" is 724px in Cinzel and 722.5px in
    // the default serif at 100px/600 -- 0.2% apart, so nothing moved and no
    // frame misfit gave it away. In lowercase the same comparison is 655 vs
    // 472, which is how it was finally cornered. The font itself was always
    // fine: /cinzel-subset.woff2 serves 200, 25,296 bytes, and an explicit
    // document.fonts.load() resolves it.
    `font-family="${esc(s.fontFamily)}" ` +
    `font-size="${card === 1 ? HEAD.size : s.size}" ` +
    `letter-spacing="${card === 1 ? HEAD.tracking : s.tracking}" ` +
    `style="font-variation-settings:'wght' ${s.weight}" ` +
    `fill="${esc(s.color)}" text-anchor="middle"`;

  if (card === 1) {
    const half = textWidth(s.text, HEAD.size, HEAD.tracking) / 2 + HEAD.padX;
    const top = HEAD.top;
    const bh = HEAD.boxH;
    const inset = 10;
    return (
      `<g opacity="${s.opacity}">` +
      `<rect x="${cx - half}" y="${top}" width="${half * 2}" height="${bh}" rx="${bh * 0.3}" ` +
      `fill="none" stroke="${esc(s.color)}" stroke-width="2.6"/>` +
      `<rect x="${cx - half + inset}" y="${top + inset}" width="${half * 2 - inset * 2}" ` +
      `height="${bh - inset * 2}" rx="${bh * 0.26}" fill="none" stroke="${esc(s.color)}" stroke-width="1.3"/>` +
      `<text x="${cx + HEAD.tracking / 2}" y="${top + bh * 0.66}" ${common}>${esc(s.text)}</text>` +
      `</g>`
    );
  }

  const y = ORNATE.has(card) ? FOOT_BASELINE_ORNATE : FOOT_BASELINE;
  return `<text x="${x}" y="${y}" opacity="${s.opacity}" ${common}>${esc(s.text)}</text>`;
}
