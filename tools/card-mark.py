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
# wght 400; the mark pins the axis to WEIGHT below -- see the note there.
FACE = os.path.join(HERE, "fonts", "Cinzel[wght].ttf")

NAME = "SCHLESINGER"
# Sized and inked for 68px, not for 946px.
#
# The first version of this mark stood 34px tall at ALPHA 140. It looked right
# on a full-resolution proof sheet and was invisible in play: a card renders at
# 68 CSS px on the felt (measured on the live table; 36px in the lobby), which
# is a 14x reduction, so eleven letters landed on about two pixel rows and
# averaged out to paper colour. Ink contrast across the mark's band fell from
# 104 at full res to 38 at 68px -- not "faint", gone.
#
# These numbers are chosen by measuring contrast AFTER the downscale. 72/220
# holds 88, which is where the word becomes readable rather than a smudge.
# If you change either, re-measure at 68px; the full-res sheet will lie to you.
ALPHA = 220
# A cool slate blue rather than black, so the mark reads as a second printing
# plate instead of a faded numeral. The numerals stay pure black; only the mark
# and its frame take the tint.
#
# Do not reach for a deeper blue to make it read bluer on the felt: at ALPHA
# 220 this lands at #5E7398 (38% saturation) at full res but only ~10% at 68px,
# and pushing the ink to #16305F moves that to 12%. Alpha compositing toward
# the cream paper desaturates the ink BEFORE any downscaling does, and thin
# strokes then average with the paper. WEIGHT is the lever that works.
MARK_INK = (51, 80, 127)
SIZE = 72                # Cinzel caps stand 53px here
TRACKING = 11
# Cinzel's wght axis runs 400..900. Pinned to 600 because STROKE WEIGHT, not
# hue, is what carries colour through a 14x downscale: thin strokes get
# averaged with the cream paper, so the mark arrives grey no matter how blue
# the ink is. Measured on the mark's band at 68px, holding SIZE and ALPHA:
#
#   wght 400  #B9BDCC   9.7% saturation   contrast  89
#   wght 600  #8E9BB4  20.8% saturation   contrast 112
#   wght 700  #7888A6  27.8% saturation   contrast 133
#
# 600 is the point where it reads as blue on the felt and still looks like a
# printed maker's mark rather than a heading at full resolution. Deepening
# MARK_INK instead was tried and moves saturation by ~2 points -- the paper
# wins that argument, the stroke width does not.
#
# Applies to the mark alone. The 9's underdot comes from the card face's own
# DidoneRoomNumbers.otf and is untouched by this.
WEIGHT = 600
SS = 4                   # supersample; PIL fills are hard-aliased

# Measured off the 946x1438 art by row-ink scan (x120..826, alpha>40 and
# L<215). The frame rule sits at y1406..1410 on every card. Free bands:
#
#   plain ten     art ends y1172  ->  free y1173..1405  (232px)
#   cards 2, 11   scrollwork ends y1337  ->  free y1338..1405  (67px)
#
# ONE baseline for all twelve now, at 1397. Caps stand 53px at SIZE 72, so the
# cap tops land at 1344: 7px clear of the ornate scrollwork and 9px under the
# rule. That is the whole reason SIZE is 72 and not larger -- 90 would read
# better still on the felt (cap 67) but cannot fit cards 2 and 11 at all, and a
# mark that changes size between cards looks like a mistake rather than a
# maker's mark. ALPHA carries what SIZE cannot.
#
# This replaces the earlier split baselines (1352 plain / 1374 ornate). The
# collision that forced them is now cleared by geometry rather than by a
# special case -- but re-measure 2 and 11 specifically if SIZE ever grows,
# because a plain card cannot show that collision.
FOOT_BASELINE = 1397
ORNATE = {2, 11}         # kept for the post-render clearance check only
HEAD_TOP = 76            # card 1's cartouche: rule ends y31, digit starts
                         # y269, so the free head band is 236px. The taller
                         # box (144px) leaves 45px above and 49px below.

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


def mark_font(px):
    """Cinzel at WEIGHT. Falls back to the 400 default if the build of
    FreeType underneath PIL has no variable-font support -- the mark then
    renders lighter rather than the run failing outright."""
    f = ImageFont.truetype(FACE, px)
    try:
        f.set_variation_by_axes([WEIGHT])
    except Exception:
        print(f"  warning: could not pin Cinzel to wght {WEIGHT}; using 400")
    return f


def _tracked(d, f, cx, baseline, tracking, ink):
    widths = [d.textlength(c, font=f) for c in NAME]
    x = cx - (sum(widths) + tracking * (len(NAME) - 1)) / 2
    for c, w in zip(NAME, widths):
        d.text((x, baseline), c, font=f, fill=ink, anchor="ls")
        x += w + tracking
    return sum(widths) + tracking * (len(NAME) - 1)


def foot_mark(img, card):
    """Plain imprint at the foot -- cards 2..12."""
    baseline = FOOT_BASELINE
    layer = Image.new("RGBA", (img.width * SS, img.height * SS), (0, 0, 0, 0))
    _tracked(ImageDraw.Draw(layer), mark_font(SIZE * SS),
             img.width * SS / 2, baseline * SS, TRACKING * SS, (*MARK_INK, ALPHA))
    return Image.alpha_composite(img, layer.resize(img.size, Image.LANCZOS))


def head_cartouche(img, size=66, tracking=12, box_h=144, pad_x=52):
    """Double-rule frame around the name at the head -- card 1 only.

    No crown. Four crowns were drawn and every one read as pasted on: a
    stamped coronet is a solid silhouette sitting on a hairline frame, and the
    two do not belong to the same drawing. The frame alone carries it.
    """
    layer = Image.new("RGBA", (img.width * SS, img.height * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ink = (*MARK_INK, ALPHA)
    cx = img.width * SS / 2
    f = mark_font(size * SS)
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
