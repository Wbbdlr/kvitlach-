"""Stamps the Schlesinger maker's mark and the 9's underdot into the card art.

    python tools/card-mark.py            # proof sheets into --out (default: cwd)
    python tools/card-mark.py --write    # rewrite frontend/public/1..12.png

The card art is a flat raster, so the mark is composited in, not drawn at
runtime -- there is no environment variable that can change it. ALPHA below is
the knob; change it and re-run.

Only the plain N.png files are touched. N-<hash>.png are byte-identical
duplicates and N_thumb.png are unreferenced; nothing in the repo loads either.
See CLAUDE.md, "Card art".

Requires: pillow, fonttools.
"""
import argparse
import os
import sys
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, os.pardir, "frontend", "public")
# Renders from the UNMARKED originals, never from what is already in public/.
# The mark is composited in, so a generator that read its own output would
# stamp a second SCHLESINGER over the first on every re-run, and the second
# run's damage is not visible at thumbnail size. This is also the only copy of
# the art without the mark, so it is what an alpha change re-renders from.
SRC = os.path.join(HERE, "card-src")
# Cinzel, SIL OFL (tools/fonts/OFL.txt). Deliberately NOT in frontend/public:
# the mark is baked into the PNGs, so shipping the face itself would push
# 125KB at every visitor for nothing. The variable font's default instance is
# wght 400 = Regular, which is what we want, so no axis pinning is needed.
FACE = os.path.join(HERE, "fonts", "Cinzel[wght].ttf")

NAME = "SCHLESINGER"
ALPHA = 140              # ~55% ink
# A cool slate blue rather than black, so the mark reads as a second printing
# plate instead of a faded numeral. Over the #F6F0F0 paper at ALPHA 140 this
# lands around #8B98B2 -- present, clearly blue, nowhere near competing with
# the numerals. The numerals themselves stay pure black; only the mark and its
# frame take the tint.
MARK_INK = (51, 80, 127)
SIZE = 46
TRACKING = 7
SS = 4                   # supersample; PIL fills are hard-aliased

# Measured off the 946x1438 art: frame rule x24..923 / y27..1410.
#
# Two foot baselines, because cards 2 and 11 are not like the others. Those
# two carry an ornamental frame whose bottom flourish reaches y1333 (row-ink
# scan over x60..886); the plain ten are clear from y1180 down. Cinzel caps
# stand 34px at SIZE 46.
#
# The plain cards sit at 1352, which reads as a foot line rather than
# something crowding the rule. The ornate pair cannot: 1352 puts their cap
# tops at 1318, straight through the scrollwork. 1374 is the highest baseline
# that clears it (7px over the flourish, 36px under the rule), so they sit
# slightly lower than the rest by necessity. Re-check 2 and 11 specifically
# after changing SIZE -- a plain card will not show the collision.
FOOT_BASELINE = 1352
FOOT_BASELINE_ORNATE = 1374
ORNATE = {2, 11}
HEAD_TOP = 118           # card 1's cartouche: below the rule at y27, above
                         # the digit at y271, weighted toward the numeral

# The 9's underdot, which tells it from the 6 (the real deck's 6 is undotted,
# so this goes on the 9 alone). The font's own period, baseline-aligned.
# DOT_INK_EDGE is the numeral's ink edge measured across the dot's own
# vertical band -- NOT the digit bbox right edge at x767, which is the bowl's
# widest point far above the baseline and leaves the dot visibly adrift.
DOT_DIA, DOT_GAP, DOT_INK_EDGE, DIGIT_BASELINE = 84, 34, 634, 1165


class _Pen(BasePen):
    """Collects a glyph outline as flattened polygons in font units."""

    def __init__(self, glyphSet):
        super().__init__(glyphSet)
        self.paths, self._cur = [], []

    def _moveTo(self, p):
        self._flush()
        self._cur = [p]

    def _lineTo(self, p):
        self._cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self._cur[-1]
        for i in range(1, 17):
            t, u = i / 16, 1 - i / 16
            self._cur.append((
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))

    def _closePath(self):
        self._flush()

    def _flush(self):
        if len(self._cur) > 2:
            self.paths.append(self._cur)
        self._cur = []


def _period_outline():
    """The card font's own period, so the dot matches the numerals' ink."""
    f = TTFont(os.path.join(PUB, "DidoneRoomNumbers.otf"))
    gs = f.getGlyphSet()
    pen = _Pen(gs)
    gs["period"].draw(pen)
    pen._flush()
    return pen.paths


PERIOD = _period_outline()
PX0, PW, PH = 62.0, 138.98, 148.31   # period glyph bounds, font units


def draw_dot(img):
    """The 9's underdot, at full ink -- it is part of the numeral, not a mark."""
    r = DOT_DIA / 2
    cx, cy = DOT_INK_EDGE + DOT_GAP + r, DIGIT_BASELINE - r
    s = DOT_DIA / PW
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for path in PERIOD:
        d.polygon([(cx + (x - PX0 - PW / 2) * s, cy - (y - PH / 2) * s)
                   for x, y in path], fill=(0, 0, 0, 255))
    return Image.alpha_composite(img, layer)


def _tracked(d, f, cx, baseline, tracking, ink):
    widths = [d.textlength(c, font=f) for c in NAME]
    x = cx - (sum(widths) + tracking * (len(NAME) - 1)) / 2
    for c, w in zip(NAME, widths):
        d.text((x, baseline), c, font=f, fill=ink, anchor="ls")
        x += w + tracking
    return sum(widths) + tracking * (len(NAME) - 1)


def foot_mark(img, card):
    """Plain imprint at the foot -- cards 2..12."""
    baseline = FOOT_BASELINE_ORNATE if card in ORNATE else FOOT_BASELINE
    layer = Image.new("RGBA", (img.width * SS, img.height * SS), (0, 0, 0, 0))
    _tracked(ImageDraw.Draw(layer), ImageFont.truetype(FACE, SIZE * SS),
             img.width * SS / 2, baseline * SS, TRACKING * SS, (*MARK_INK, ALPHA))
    return Image.alpha_composite(img, layer.resize(img.size, Image.LANCZOS))


def head_cartouche(img, size=44, tracking=8, box_h=96, pad_x=44):
    """Double-rule frame around the name at the head -- card 1 only.

    No crown. Four crowns were drawn and every one read as pasted on: a
    stamped coronet is a solid silhouette sitting on a hairline frame, and the
    two do not belong to the same drawing. The frame alone carries it.
    """
    layer = Image.new("RGBA", (img.width * SS, img.height * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ink = (*MARK_INK, ALPHA)
    cx = img.width * SS / 2
    f = ImageFont.truetype(FACE, size * SS)
    top, bh = HEAD_TOP * SS, box_h * SS
    bot = top + bh
    tw = sum(d.textlength(c, font=f) for c in NAME) + tracking * SS * (len(NAME) - 1)
    half = tw / 2 + pad_x * SS
    d.rounded_rectangle([cx - half, top, cx + half, bot], radius=bh * 0.30,
                        outline=ink, width=int(2.6 * SS))
    ir = 10 * SS
    d.rounded_rectangle([cx - half + ir, top + ir, cx + half - ir, bot - ir],
                        radius=bh * 0.26, outline=ink, width=int(1.3 * SS))
    _tracked(d, f, cx, top + bh * 0.66, tracking * SS, ink)
    return Image.alpha_composite(img, layer.resize(img.size, Image.LANCZOS))


def render(card):
    img = Image.open(os.path.join(SRC, f"{card}.png")).convert("RGBA")
    if card == 9:
        img = draw_dot(img)
    return head_cartouche(img) if card == 1 else foot_mark(img, card)


def proof(cards, out_dir):
    pad, lab_h, scale = 24, 34, 3
    w, h = 946 // scale, 1438 // scale
    lf = ImageFont.load_default(24)
    sheet = Image.new("RGB", (6 * (w + pad) + pad, 2 * (h + lab_h + pad) + pad),
                      (240, 238, 233))
    dd = ImageDraw.Draw(sheet)
    for i, img in enumerate(cards):
        x = pad + (i % 6) * (w + pad)
        y = pad + (i // 6) * (h + lab_h + pad)
        sheet.paste(img.resize((w, h), Image.LANCZOS), (x, y), img.resize((w, h), Image.LANCZOS))
        dd.text((x + w / 2, y + h + 6), str(i + 1), font=lf, fill=(30, 30, 30), anchor="mt")
    sheet.save(os.path.join(out_dir, "cards-proof.png"))
    # the two that need looking at closely, at 1:1
    cards[0].crop((150, 26, 796, 300)).save(os.path.join(out_dir, "proof-1-head.png"))
    cards[10].crop((60, 1150, 890, 1425)).save(os.path.join(out_dir, "proof-11-foot.png"))
    print("wrote cards-proof.png, proof-1-head.png, proof-11-foot.png to", out_dir)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="rewrite frontend/public/1..12.png in place")
    ap.add_argument("--out", default=os.getcwd(), help="where proof sheets go")
    args = ap.parse_args()

    if not os.path.exists(FACE):
        sys.exit(f"missing {FACE} -- see tools/fonts/OFL.txt")

    cards = [render(n) for n in range(1, 13)]
    if args.write:
        for n, img in zip(range(1, 13), cards):
            img.save(os.path.join(PUB, f"{n}.png"))
        print(f"rewrote 12 cards in {os.path.normpath(PUB)}")
    else:
        proof(cards, args.out)


if __name__ == "__main__":
    main()
