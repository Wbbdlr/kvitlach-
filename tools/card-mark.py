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

# WHICH cards carry the mark. Not all twelve: a mark on every card reads as a
# watermark -- the thing a printer stamps to deter copying -- while a mark on a
# few reads as a signature, which is what real decks have always done by
# signing the ace and leaving the pips alone. Reported as "gaudy" on all twelve.
#
#   1  -- the ace, and the only head cartouche (HEAD_TOP); the traditional
#         place for a maker's mark.
#   8  -- the eight nights. This is a Chanukah game and 8 is its number.
#   12 -- the game's own signature card: it reads as 12, 9 OR 10, re-evaluated
#         every time (see CLAUDE.md's rules section). Nothing else in the deck
#         is distinctive that way.
#
# Two copies of each in a 24-card deck, so the mark lands on 6 of 24 -- often
# enough to be seen most rounds, never twice in one hand's fan.
#
# Side effect worth keeping: 2 and 11, the only ornamental-frame cards, are NOT
# in this set. Their 67px band is what caps SIZE and is where the mark was
# reported sitting on the frame. The clearance code below stays -- the planned
# admin editor can switch any card on, and then it matters again -- but no
# shipped default depends on it any more.
#
# frontend/src/table/cardMark.ts mirrors this set for the live overlay. The
# overlay exists to reproduce these rasters exactly; if the two disagree, a
# card gains or loses its mark the moment the overlay is switched on.
MARKED = frozenset({1, 8, 12})

# Sized and inked for 68px, not for 946px.
#
# The first version of this mark stood 34px tall at ALPHA 140. It looked right
# on a full-resolution proof sheet and was invisible in play: a card renders at
# 68 CSS px on the felt (measured on the live table; 36px in the lobby), which
# is a 14x reduction, so eleven letters landed on about two pixel rows and
# averaged out to paper colour. Ink contrast across the mark's band fell from
# 104 at full res to 38 at 68px -- not "faint", gone.
#
# These numbers are chosen by measuring contrast AFTER the downscale. The
# current 58/230 holds 74; 38 is the value that was invisible and ~70 is where
# the word stops being a word. WEIGHT is what buys headroom if SIZE has to drop
# further -- at 58/230, wght 700 restores 87. If you change any of the three,
# re-measure at 68px; the full-res sheet will lie to you.
#
# Nearly solid. "Faded" is delivered mostly by the reduction itself -- eleven
# letters at 43px cap arrive at the felt covering only part of each pixel, so
# the mark lands around luminance 162 against 236 paper however solid the
# source is. Transparency on top of that bleeds chroma toward the paper, so it
# is a small trim, not the main lever: 230 costs ~6 points of contrast at 68px
# and 2 points of saturation. 140 was tried once and erased the mark.
ALPHA = 230
# A blue rather than black, so the mark reads as a second printing plate
# instead of a faded numeral. The numerals stay pure black; only the mark and
# its frame take the tint.
#
# CHROMA, not darkness. This was a slate navy (#33507F) for three releases and
# every one of them looked grey on the felt. Mixing a dark, low-chroma ink with
# cream paper yields grey; a brighter, more saturated blue stays blue through
# the same mix. Measured at 68px, holding SIZE/WEIGHT and alpha 255:
#
#   #33507F navy   -> #8C99B3   22% saturation   luminance 152
#   #2B5FB0 royal  -> #87A1CE   34% saturation   luminance 159
#   #1E63C8 true   -> #80A3DB   41% saturation   luminance 159
#
# Royal is the pick: as light as the navy at the felt size, so it stays clearly
# subordinate to the numerals, but visibly blue instead of grey. Going darker
# to "strengthen" it makes it greyer, not bluer -- that is the trap.
MARK_INK = (43, 95, 176)
# 58 is 72 less 19%. The mark at 72 fit the ornate pair by 8px above and 9px
# below -- geometrically clear, but at a 14x reduction that is half a pixel
# each way, so on the felt the word sat *on* the frame. Reported from a live
# table. 58 doubles both clearances (14px / 13px) and reads as an imprint
# rather than a caption. Cost: contrast at 68px falls 100 -> 74. That is well
# clear of the 38 that made the mark vanish in v7.9-8.5, but it is the floor --
# do not take SIZE lower without raising WEIGHT to pay for it.
SIZE = 58                # Cinzel caps stand 43px here
TRACKING = 9             # kept proportional to SIZE; 11 at this size crowds
                         # the ornate pair's frame horizontally
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
# Two baselines, because the ornate pair genuinely cannot take the plain one.
#
# The plain ten sit at 1350: cap tops at 1307 (far clear of art ending 1172)
# and 56px of paper under the word before the rule. A single baseline for all
# twelve was tried, to clear cards 2 and 11 with one number and delete this
# special case -- it worked geometrically and looked wrong, crowding the mark
# against the bottom rule on all ten plain cards to accommodate two. Reported
# from a live table as "too low"; the tidier code was not worth the worse card.
#
# 1393 centres the ornate pair in their own band: scrollwork ends at 1337 and
# caps stand 43px at SIZE 58, so cap tops land at 1351 -- 14px of paper above,
# 13px below to the rule at 1406. Both gaps matter. At SIZE 72 they were 8 and
# 9, which survives a row-ink scan and still reads as the word touching the
# frame once the card is 68px wide. Re-measure 2 and 11 specifically if SIZE
# ever grows -- a plain card cannot show that collision.
FOOT_BASELINE = 1350
FOOT_BASELINE_ORNATE = 1393
ORNATE = {2, 11}
# Card 1's cartouche: the rule ends y31 and the digit starts y269, so the free
# head band is y32..268 (237px). The box was 144px tall at HEAD_TOP 76, which
# hung it 45px under the rule and read as a masthead rather than a mark. At
# 122px tall and HEAD_TOP 96 it sits 65px under the rule and 51px above the
# numeral -- fractionally below centre on purpose, so it reads as belonging to
# the card rather than crowning it. Keep the bottom gap at 45px or more; below
# that the frame and the digit start to look like one object at felt size.
HEAD_TOP = 96

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
    baseline = FOOT_BASELINE_ORNATE if card in ORNATE else FOOT_BASELINE
    layer = Image.new("RGBA", (img.width * SS, img.height * SS), (0, 0, 0, 0))
    _tracked(ImageDraw.Draw(layer), mark_font(SIZE * SS),
             img.width * SS / 2, baseline * SS, TRACKING * SS, (*MARK_INK, ALPHA))
    return Image.alpha_composite(img, layer.resize(img.size, Image.LANCZOS))


def head_cartouche(img, size=56, tracking=10, box_h=122, pad_x=44):
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


def render(card, mark=True):
    """The card face. `mark=False` stops before the maker's mark.

    Callers decide WHICH cards get one (see MARKED); this only decides whether
    to draw it on the card it was handed.

    The 9's underdot is NOT part of the mark and is drawn either way: it is
    what tells a 9 from a 6 (the real deck's 6 is undotted), so a card without
    it is misread rather than merely unbranded. The unmarked art is what the
    live SVG overlay draws onto -- serving card-src directly would ship a
    dotless 9 and put an ambiguous card on the table.
    """
    img = Image.open(os.path.join(SRC, f"{card}.png")).convert("RGBA")
    if card == 9:
        img = draw_dot(img)
    if not mark:
        return img
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
    ap.add_argument("--no-mark", action="store_true",
                    help="art WITHOUT the maker's mark (the 9 keeps its dot) -- "
                         "what ships once the mark is drawn live over the card")
    ap.add_argument("--out", default=os.getcwd(), help="where proof sheets go")
    args = ap.parse_args()

    if not os.path.exists(FACE):
        sys.exit(f"missing {FACE} -- see tools/fonts/OFL.txt")

    cards = [render(n, mark=n in MARKED and not args.no_mark) for n in range(1, 13)]
    if args.write:
        for n, img in zip(range(1, 13), cards):
            img.save(os.path.join(PUB, f"{n}.png"))
        print(f"rewrote 12 cards in {os.path.normpath(PUB)}")
    else:
        proof(cards, args.out)


if __name__ == "__main__":
    main()
