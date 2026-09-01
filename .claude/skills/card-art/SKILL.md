---
name: card-art
description: Regenerate or change the Kvitlach card face PNGs — the Schlesinger maker's mark, the 9's underdot, card geometry, fonts. Use when changing how cards look, when new art is not appearing for players, or before touching anything in frontend/public/*.png.
---

# Card art

Full geometry, the dot spec, font licensing and regeneration steps:
[docs/CARD-ART.md](../../../docs/CARD-ART.md). Read it before changing the art.

## The three that bite

- **The PNGs are generated, not hand-edited.** `tools/card-mark.py`
  composites the mark and the 9's underdot from `tools/card-src/` into
  `frontend/public/`. Hand-editing a face is undone by the next run.

- **The generator reads `card-src/`, never `public/`. Do not "simplify" that
  into an in-place edit.** The mark is composited, so a generator reading its
  own output stamps a second SCHLESINGER over the first every run, and at
  thumbnail size the damage is invisible.

- **After any change to the mark, look at cards 2 and 11.** They are the only
  two with an ornamental frame, and its bottom flourish reaches `y1337` where
  the plain ten are clear from `y1172`. Their free band is **67px** against the
  others' 232px, and it is what caps `SIZE`. A plain card cannot show that
  collision, so checking one proves nothing. Find it with a row-ink scan, not
  by eye on a half-scale sheet — that is how it was missed the first time.

## Sizes: design for 68px, not 946px

Source art is 946×1438. Cards render at **68 CSS px** on the felt (measured on
the live table) and **36px** in the lobby — a 14× reduction.

The first mark shipped at `SIZE=46 / ALPHA=140`, approved on a full-resolution
proof sheet, and **did not appear at all** in play: eleven letters landed on
about two pixel rows and averaged to paper colour. Not faint — absent.

**Judge the mark by ink contrast measured AFTER the downscale**, over the
mark's own band (`x280..666, y1330..1400`), never by eye at full res:

| setting | contrast at full res | at 68px | verdict |
|---|---|---|---|
| 46 / 140 (shipped v7.9–8.5) | 104 | **38** | invisible |
| 72 / 220 (current) | 161 | **88** | reads |
| 90 / 210 | 157 | 88 | reads, but **does not fit cards 2 and 11** |

Current geometry: one baseline at `y1397` for all twelve (caps stand 53px at
`SIZE 72`, so cap tops land at `y1344` — 7px clear of the ornate scrollwork,
9px under the frame rule). Card 1 keeps its head cartouche, `HEAD_TOP=76`,
box 144px, in the 236px band between the rule at `y31` and the digit at `y269`.

`SIZE` cannot simply be raised: 90 reads no better and breaks the ornate pair.
`ALPHA` is the free lever, and a mark that changes size between cards looks
like a mistake rather than a maker's mark.

`ALPHA` and `MARK_INK` are constants in the generator and are **baked into the
raster** — no environment variable can change them. Edit and re-run.

## Verifying a change actually shipped

Two separate questions, and they have different answers:

1. **Are the right bytes in `public/`?** Pixel-diff `frontend/public/N.png`
   against `tools/card-src/N.png` — the differing region tells you where the
   mark landed.
2. **Is the server serving them?** Fetch from the live origin and compare
   sha256 against the local file. This distinguishes a caching problem from a
   rendering-size problem, which look identical to a user.

## Cache busting

Files in `public/` keep plain filenames forever, so browsers and the
Cloudflare edge go on serving bytes they already have. `table/selectors.ts`
appends `?v=${APP_VERSION}` for exactly this reason — new art shipped in v7.9
and appeared for nobody until the query string moved. Pinned by a test in
`CardView.test.tsx`.

`blank.png` is excluded on purpose: `index.css` fetches it by its bare URL
too, and a versioned copy would download that 2.6MB file twice.

## Known dead weight

`frontend/public/` still holds `N-<hash>.png` duplicates (byte-identical to
the live faces) and unreferenced `N_thumb.png` files — about 1MB. Only
`1.png`–`12.png` are live. Flagged repeatedly, never actioned.
