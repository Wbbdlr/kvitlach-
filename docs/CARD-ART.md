# Card art

Reference for the 12 card faces. CLAUDE.md carries only the rules you can
break without noticing; everything here is detail you need when you are
actually regenerating the art, and nowhere else.

## Shape of the assets

Flat PNGs, **946×1438**, paper `#F6F0F0`, genuinely transparent rounded
corners. `frontend/src/table/selectors.ts` maps rank → `/N.png` and is the only
thing that loads them.

**Only `1.png` … `12.png` are live.** `N-<32 hex>.png` are byte-identical
duplicates and `N_thumb.png` are unreferenced leftovers — verified by sha256
and by grepping every `.ts/.tsx/.html/.css/.json` in the repo on 2026-08-31.
Edit the plain files only; regenerating the other two sets is wasted work, and
*not* editing them is not a bug. (~1MB of dead weight, still uncleaned.)

On the felt a card draws at ~19% of source (92 stage units × `MAX_SCALE` 3 ÷
1438 — see `stage.ts`), so fine line work in the art is for the lobby cards,
link previews and print, not for the table.

## Measured geometry

Frame rule runs x24..923 / y27..1410. Clear foot band **y1180..1395**, clear
head band **y40..255**.

| card | digit ink bbox |
|---|---|
| `1` | x297..696, y271..1166 |
| `9` | x269..767, y268..1165 |
| `6` | x224..723, y269..1168 |
| `12` | x174..772, y322..1118 |

Cards **2 and 11** are the only two with an ornamental frame; its bottom
flourish reaches y1333 (row-ink scan over x60..886).

## The 9's underdot

**The 9 needs one; the 6 does not** — confirmed against a photo of a real
deck, where the 6 is undotted. Dotting both would be wrong twice over.

Spec: the `period` glyph from `DidoneRoomNumbers.otf`, Ø84px, baseline-aligned,
34px right of the numeral's tail. Anchor that gap to the ink's right edge
**across the dot's own vertical band (x=634)**, not to the digit bbox right
edge (x=767) — that is the bowl's widest point, far above the baseline, and
anchoring there leaves the dot visibly adrift.

`DidoneRoomNumbers.otf` has **no dotted-nine glyph and no GSUB** (52 glyphs,
unitsPerEm 1000, no uppercase letters at all). There is no font feature to
switch on; the dot has to be composited into the raster.

## The maker's mark

`SCHLESINGER` in Cinzel caps, `ALPHA = 140` (~55% ink), slate blue
`MARK_INK = (51, 80, 127)` — over the paper that lands near `#8B98B2`. The
numerals stay pure black; only the mark and its frame take the tint.

- Cards 2–12: plain foot line. `FOOT_BASELINE = 1352`, except **2 and 11 at
  1374** (see the trap in CLAUDE.md).
- Card 1: double-rule cartouche at `HEAD_TOP = 118`.
- **No crown.** Four were drawn — pearled coronet, trefoil, arched royal, open
  line — and every one read as pasted on. A stamped coronet is a solid
  silhouette sitting on a hairline frame; the two do not belong to the same
  drawing. If a crown is ever revisited, the sides of the points must be
  *concave*: straight-sided spikes read as a party hat, which is what the
  first attempt was.

## Fonts

**Windows system faces are for mockups only.** Old English Text MT, Kunstler
Script, Palace Script and Castellar are Monotype-licensed via Office. Pick the
*look* with them, then ship the SIL OFL stand-in — UnifrakturMaguntia, Pinyon
Script, Great Vibes and Cinzel respectively.

`tools/fonts/Cinzel[wght].ttf` is SIL OFL (licence alongside it). Its variable
default instance is wght 400 = Regular, so no axis pinning is needed. It lives
in `tools/`, not `public/`, on purpose: the mark is baked into the PNGs, so
shipping the face would push 125KB at every visitor for nothing.

## Regenerating

```bash
python tools/card-mark.py            # proof sheets, writes nothing
python tools/card-mark.py --write    # rewrite frontend/public/1..12.png
```

Requires `pillow` and `fonttools`. After a `--write`, look at **2 and 11**
before anything else.
