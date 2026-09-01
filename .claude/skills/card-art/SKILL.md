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
  two with an ornamental frame and use a lower foot baseline (`y1374` vs
  `y1352`) to clear its bottom flourish at `y1333`. A plain card cannot show
  that collision, so checking one proves nothing. Find it with a row-ink scan,
  not by eye on a half-scale sheet — that is how it was missed the first time.

## Sizes: design for 92px, not 946px

Source art is 946×1438. Cards render at **~92 CSS px** on the felt and **36px**
in the lobby. A mark that is 34px tall in the source is **3px** on screen.

The first mark shipped at `SIZE=46 / ALPHA=140`, was approved on a full-size
proof sheet, and was invisible in play. **Always proof at the real rendered
size** — 92px and 184px (2× phone screen) — not at full resolution. A variant
sheet at true size costs one script and settles the question in one round trip.

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
