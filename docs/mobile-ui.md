# Mobile UI & layout — the design contract

The hard rules and the screenshot command live in `CLAUDE.md`. This file is the
contract they enforce: what goes where, why, and how it is verified.

**Read Part 1 before writing any layout code.** Six of the ten bugs in the
ledger (Part 6) were one structural bug wearing six hats, and Part 1 is what
stops the seventh.

---

## Part 1 — The scene / HUD frame split

The table renders in **two layers that must never be mixed**.

### Scene — inside the scaled stage

A fixed **1280×760** virtual stage, uniformly scaled to the viewport
(`table/stage.ts`), flattened vertically by `--vf`. Positioned in stage units.

Only things whose **position carries meaning** belong here:

| In the scene | Why |
|---|---|
| the felt, its rings and scrim | it *is* the surface |
| seats and their nameplates | the arc is the table's geography — who sits where |
| cards, hands, the fan | they are dealt *to* a place |
| the shoe and the discard pile | fixtures at the dealer's left and right hand |
| reservation lines and chips | they draw bank → player; the endpoints are the point |

### HUD frame — outside the stage, viewport-anchored

True viewport pixels. Never scaled. Anchored to the viewport's edges and safe
areas, laid out in **flow** (flex with `gap`), with real tap targets.

Everything else belongs here — **every number, every status, every button**:

| In the frame | Where |
|---|---|
| bank total, reserved / free | top status bar |
| round state, connection, table label | top status bar / chrome-top |
| your hand's total and your actions | the dock |
| toasts, banners, announcements | overlay tiers |
| reactions | the reaction lane (Part 3) |
| every drawer, modal and menu | overlay tiers |

### Why the split is absolute

Overlap inside a flow container is *structurally impossible*. You don't tune
it, verify it, or guard it — it cannot happen. Every recurring bug in Part 6
came from a readout living in the scene and being positioned by arithmetic
instead of by flow.

The arithmetic is unwinnable, and here is the proof. At 844×390 — a real
landscape phone — subtract the top chrome (44px) and the dock (54–66px) and
**~280px of vertical play space remains**. The design puts three stacked rows
in it: the dealer's box (~75px), the bank cluster (24px), and the viewer's own
seat (132–205px depending on crowding). Dealer + viewer alone is 207–280px. At
a full table that is the entire budget, exactly.

**A landscape phone card table has room for three rows: dealer, cards, you.
There is no fourth row.** `bankPanelTop()` is a function computing the gap
between two walls that already touch; it has no correct answer, and every past
fix was a better wrong one.

---

## Part 2 — The four rules

**1. Nothing persistent floats in the vertical centre of the felt.**
The centre column holds cards and nothing else. Persistent numbers live at the
frame's edges. This is universal in shipped mobile games — Hearthstone's mana,
Balatro's score, every poker app's pot and blinds sit on the chrome, never on
the board. A readout on the felt is competing with the only content that has
to be there.

**2. Position by containment, never by measuring a sibling's rendered height.**
If a layout formula references another component's measured size, the layout is
already broken — it just hasn't been photographed yet. `BankPanel.tsx` currently
holds four such constants (`VIEWER_PLATE_TOP_CONST = 205.75 / 2`,
`DEALER_BOTTOM_CONST = 75`, `DEALER_STATUS_ROW_H = 39`, `BANK_PILL_HEIGHT = 24`).
A longer name, a wrapped tag or a fifth card invalidates them silently. Put the
element in a container that bounds it instead.

**2b. Contrast is containment too: anything over the felt owns its own
background.**
Same rule, other property. The felt is a *user preference* — `theme.ts`'s
`FELTS` is green / burgundy / navy, per-client, in `localStorage`, never synced
— so text reading straight off it has its legibility decided by a value it does
not control, in someone else's browser. Never measure contrast once against
"the background"; there are three, and the player picks.

An element therefore paints `var(--felt-scrim)` behind itself, and any state
tint composites **over the scrim**, not over the felt (`.k-tag` does this with
`--tag-tint`). A scrim is fine where a solid slab reads as chrome bolted to the
table; a 6% wash is not a background.

Found by audit, not by eye: the shoe and discard captions had no background at
all and ran **3.1:1 on green, 3.8:1 on burgundy** — a 23% swing, both under AA —
and `.k-tag.muted`, on every idle seat, ran 4.3:1. Green was the default at the
time, so the worst case was what most players actually saw. Pinned by
`e2e/tests/felt-contrast.spec.ts` across all three felts.

`--felt-scrim` is **one token**. If some element ever wants a different value,
change the token or write down why that element genuinely differs — forking it
quietly is how one constant becomes the eight measured ones Part 6 records.

**3. Per-entity state rides on its entity, in a fixed-size box.**
The dealer's total and status belong *on* the dealer's plate as badges, not in a
sibling row beneath it that pushes everything below. A component whose height
varies with its content must not be something another component is anchored to.

**4. A transient message stays attached to whoever sent it, and its space is
reserved before it arrives.**

A reaction bubble points at the player who sent it, with a tail, always — at a
table of eleven, the tail is the only thing saying *who spoke*. That rules out
the single fixed lane an earlier draft of this rule called for: a lane cannot
point at anyone.

It also rules out the obvious alternative — anchoring to the seat and then
positioning the bubble "somewhere it does not cover anything". That is
position-by-knowing-your-neighbours, the exact class of rule this document
exists to delete, and it is how bug #4 happened (the bottom-centre seat's
"above" turned out to be the dealer's row).

The containment answer is a **reserved slot**: every seat allocates a
fixed-size bubble band whether or not a bubble is showing. A bubble that appears
occupies space that was already accounted for, so it cannot displace or cover
anything, and nothing has to be measured or avoided. The cost is that the band
is empty most of the time — see Part 7 step 3 for what that costs at 640×360 and
what happens where the budget will not carry it.

**The reservation applies inside the HUD too, not just on the felt.** Where the
compact fallback puts the bubble in the bottom-left HUD column, that column
already holds the viewer's own plate. A bubble that *grows* the column and
pushes the plate is the corridor problem rebuilt somewhere new — the same shape
as ledger #6 and #7. The slot is allocated there whether or not a bubble is
showing, exactly as on a seat.

**Queue policy** (an unstated queue is a bug waiting for a full table):

| | |
|---|---|
| Slots visible at once | **1**, in the compact fallback (the per-seat layout has no queue — each seat owns its own slot) |
| Display duration | **2.5s** per bubble, not the per-seat layout's 10s. Eleven seats × 10s is a 110-second backlog; nobody is reading a reaction to a hand that ended two minutes ago |
| Queue depth | **3** waiting, so worst-case latency is 7.5s |
| Overflow | **Drop oldest first.** A reaction is a live response to the hand in front of you. When the queue is full the stale one is the one nobody needs |
| In flight | The bubble currently showing always finishes its 2.5s; arrivals never truncate it, or a busy table becomes a flicker |
| Fair share | **A queued message from a sender not yet shown outranks a second message from one already shown.** 2.5s is a display duration, not a cooldown — without this, one chatty bot holds the slot back to back and nobody else is ever seen. Rank by "has this sender occupied the slot during the current drain", then by arrival; a repeat from the same sender only plays once no new sender is waiting |

---

## Part 3 — Z-index tiers

Eighteen ad-hoc values (1, 2, 9, 10, 11, 12, 20, 25, 30, 40, 42, 45, 46, 48, 50,
60, 70, 80) collapse to **twelve named tiers**, declared once as custom
properties on `:root`. Gaps of 10 and 100 leave room to insert without renumbering.

Use the token. **A raw `z-index` number in new code is a bug**, as is a Tailwind
`z-[n]` / `z-30` utility.

| Tier | Value | Holds | Replaces |
|---|---|---|---|
| `--z-felt-decor` | 10 | felt rings, scrim | 1 |
| `--z-scene-links` | 20 | `.k-resv-lines` | 2 |
| `--z-scene-props` | 30 | `.k-shoe`, `.k-discard`, `.k-resv` | 9, 11 |
| `--z-seat` | 40 | `.k-seat` | 10 |
| `--z-seat-raised` | 50 | `.k-seat.hand-fanned` | 20 |
| `--z-hud` | 100 | dock, tray, chrome-top, **top status bar** | 25, 30, 40 |
| `--z-hud-popover` | 200 | appearance panel, fullscreen hint, one-time nudges | 50, 60 |
| `--z-announce` | 300 | `.k-preround`, `.k-bank-banner`, `.k-bank-decision`, toasts | 42, 45 (toast), 46, 48 |
| `--z-fly` | 400 | `.table-fly-card` | 80 |
| `--z-reaction` | 500 | reaction bubbles (per-seat, in their reserved slots) | 45 (`.k-reaction`), 12 (vacated) |
| `--z-modal` | 600 | `.k-modal-overlay`, drawers | 70 |
| `--z-gate` | 700 | the rotate gate (Part 4) | 42 (`.k-rotate-hint`) |

Three deliberate ordering changes, called out so they aren't read as accidents:

- **`.table-fly-card` drops below the modal** (was 80 vs 70). A card animating
  over an open BANK! confirmation is wrong; the modal wins.
- **Reaction bubbles rise above announcements.** Safe only because they are
  `pointer-events: none` — `.k-bank-decision` is interactive and must stay
  clickable through them. That is a requirement of the tier, not a nicety.
- **The rotate gate takes its own top tier.** It is opaque and covers everything,
  which is the whole point of Part 4.

`.k-hand > :nth-child(n)` (2–8) is **exempt and stays as is** — it orders cards
*within* `.k-seat`'s own stacking context and never competes globally.

---

## Part 4 — Orientation is per-surface, and fixed

Settled product design, not a stopgap. Kvitlach is played on phones, in
landscape, one device per player.

State the constraint precisely — the short version ("the table is landscape
only") is false, and a false simplification in a contract is how the next
orientation bug gets built:

| Surface | Constraint | Architecture |
|---|---|---|
| **Table, handheld** (`isHandheld()`, short edge ≤ 820px) | **Requires landscape.** Portrait is gated, not laid out | scaled stage + HUD frame |
| **Table, larger viewports** (tablet, desktop) | **Any orientation.** The stage scales to fit and a 768px portrait tablet has vertical room to spare | same |
| **Lobby, landing, About/Contact/Disclaimer** | **Portrait** | ordinary responsive page (`PageShell`) |

A portrait tablet playing the table is **the stage working as designed**, not a
half-supported orientation state. It is a supported surface, so it is
photographed on every sweep (Part 8), not spot-checked.

**Do not build, stub, or leave hooks for a portrait *phone* table layout** — that
is the case the gate exists to refuse. Do not pull the lobby into the stage
architecture or its landscape assumptions. They are separate surfaces with
separate rules.

### Where the boundary sits

`App.tsx:419` — the `room ? <TableRoot/> : <lobby + footer/>` branch. That
ternary *is* the orientation boundary. Everything under `TableRoot` is
landscape; everything in the other arm is portrait.

The transition is driven by `table/immersive.ts`:

- `enterImmersive()` — called synchronously from the Join / Create / Play tap
  handlers (`App.tsx:355, 370, 383, 898`); requests fullscreen, then locks
  landscape. Must stay inside the gesture or the browser refuses it.
- `exitImmersive()` — called when leaving the room (`App.tsx:344`); unlocks and
  exits, so nobody lands back on the portrait lobby still locked sideways.
- `isHandheld()` — coarse pointer **and** short edge ≤ 820px. Phones only.

Both are **best-effort by design**: iOS Safari implements fullscreen for
`<video>` only, so every iPhone takes the refusal path and never rotates
programmatically. The gate below is therefore not a fallback — for iOS it is
the only mechanism, and it must work on its own merits.

### The gate must be total

Bug #1 came from a *half-handled* orientation state: `.k-rotate-hint` is a
`pointer-events: none` banner pinned top-centre, and **the whole table renders
underneath it**. On a 360px-wide portrait phone the chrome row wraps to three
rows (measured 136px tall at 375×812) and lands mid-felt over the dealer's plate
and a seat.

The compensation code this spawned is itself a symptom, and all of it goes:
`.k-chrome-top`'s portrait `+88px` offset (`index.css:1931`), `rotateHintShowing`
in `TableRoot.tsx:261`, and the `useMediaQuery` string that has to be kept
byte-identical to a CSS rule.

**The replacement is opaque, full-screen, at `--z-gate`, and nothing else paints
underneath it.** Not a banner over a broken layout — a door.

**The gate keeps its own `max-width: 540px` bound. It is NOT keyed to
`isHandheld()`.** `isHandheld()` matches a 768px portrait tablet (768 ≤ 820), so
reusing it here would gate exactly the device that is meant to keep playing.
This is the Part 2 rule #2 failure in predicate form: reusing a predicate that
answers a different question. Which brings us to —

### The three portrait predicates, and the question each one owns

The portrait-lobby → landscape-table handoff carries three independent
definitions of "small screen in portrait." They **answer different questions and
are allowed to differ.** What must never happen is one being reused for
another's question. Bug #9 was exactly that: a width-only test used for a
question whose answer lives on the height axis.

Each name below is repeated as a comment at its own definition site. If you add
a fourth, name its question here first.

| Predicate | Owns the question | Test | Why that test |
|---|---|---|---|
| `isHandheld()` (`table/immersive.ts`) | *"May we take over this device's orientation and fullscreen when it enters a table?"* | coarse pointer **and** short edge ≤ 820px | Measures the **device**, not the viewport, because it may already be held landscape. Deliberately generous: every call is best-effort and a refusal is a no-op, so over-matching costs nothing |
| `GATE_QUERY` (the rotate gate) | *"Is this viewport too small to render the table in portrait at all?"* | `(orientation: portrait) and (max-width: 540px)` | Measures the **rendered viewport**. In portrait, width *is* the short edge. 540 keeps a 768px tablet playing — the one number that must not become 820 |
| `COMPACT_QUERY` (`stage.ts`) | *"Is the rendered table cramped enough to need compact chrome and dock styling?"* | `(max-width: 520px), (max-height: 440px)` | An **OR across both axes**. The height arm is the one that catches a landscape phone, which is wide (854) but short (384). A width-only test here was bug #9 |

### One source for each string

A JS string that must stay byte-identical to a CSS rule, with nothing enforcing
it, is the same failure mode as the measured constants Part 2 deletes — silent
until a screenshot catches it. `frontend/src/table/breakpoints.ts` owns both
query strings. Two different enforcement mechanisms, because the two queries do
different jobs:

- **`GATE_QUERY` has no CSS rule at all.** The gate controls *rendering* — the
  table must not paint underneath it — which is a React decision, not a style.
  `TableRoot` reads `useMediaQuery(GATE_QUERY)` and returns the gate instead of
  the table. `.k-rotate-hint`'s media query is deleted outright, so there is
  nothing left to drift from.
- **`COMPACT_QUERY` keeps its CSS media queries** (it styles many rules across
  `index.css`; driving them from JS would be worse). The TS constant is pinned to
  the CSS by a test that reads `index.css` and compares — the same technique
  `cardMark.test.ts` already uses to pin a TS constant to `tools/card-mark.py`.
  Drift becomes a red test instead of a screenshot nobody took.

---

## Part 5 — Safe areas are already correct. Do not regress them.

`env(safe-area-inset-*)` is handled properly throughout `index.css`, **including
the landscape left/right case that most builds miss** (`index.css:1495, 1578–1579,
2191`) and the `viewport-fit=cover` in `index.html` that activates `env()` at all.
Every use is `max(Npx, env(...))`, so browsers without `env()` fall back to the
plain pixel value rather than to zero.

The one subtlety worth preserving: inside the scaled stage, insets are divided by
`--stage-scale` (`index.css:389, 393`) so a real-pixel inset stays a real-pixel
inset after scaling. New frame-layer code is outside the stage and must **not**
do that division.

---

## Part 6 — Known layout bugs

Newest first. **Read before touching layout** — several are the same structural
cause in different clothes, and fixing the specific rule beats regenerating the
layout. Keep to ten.

| # | Bug | Root cause | State |
|---|---|---|---|
| 1 | 768×1024: the BANK pill covered the branding tagline ("AH HEIMISHE CHANUKAH SHPIL" half-hidden) | Introduced by step 1 and caught by its own sweep. `.k-chrome-top` is `justify-content: flex-end`, so a flex item wider than the line overflows the **start** edge — leftward, over the branding. The bank readout is ~322px against ~294px of free row at that width | Fixed — `.k-bank-hud` wraps and can shrink, so the pair stacks inside its box instead of escaping it |
| 1b | `.k-hud-bottom-left` clears the dock by a hardcoded `--controls-band: 84px`, but the dock's tallest measured state is 79px + gutter and it is a full-width box | A guessed sibling height — rule 2, in code this refactor added. If the dock grows past the band, its box rises into the viewer's own readout | **OPEN** — leading suspect for the intermittent 800×360 spec failure below; not reproduced |
| 2 | Chrome buttons (Reshuffle / Practice Table / Leave) land mid-felt over the dealer's plate and a seat — portrait at 360 wide, and landscape at 640×360 | One cause, both orientations: `.k-chrome-top` was an unbounded wrapping flex row with nothing below it reserved, so every wrapped line landed lower over the stage | Landscape **fixed** by 3b — `ChromeMenu` collapses the controls behind one button and the row is `nowrap`, so it cannot wrap. Portrait still **OPEN** until step 4's gate |
| 3 | 640×360: bank pill + reserved/free sit centred, on top of the viewer's nameplate | `bankPanelPlacement` took the *centred* branch because the reclaimed corridor cleared `BANK_PILL_HEIGHT` at that vf, but the pill is not stacked at that width so it was far wider than the corridor was clear | Fixed by step 1 — the readout left the felt entirely |
| 4 | Viewer's reaction bubble covered the banker's total for its full 10s life | `.k-reaction` anchors `bottom: 100%` of its seat; the bottom-centre seat's "above" is the dealer's row | Patched (`is-side`) — closed properly by step 3 |
| 5 | Reaction bubbles unreadable on a phone (~8px) | Fixed `font-size` inside a stage scaled to 0.667; no counter-scale | Patched (counter-scale) — closed properly by step 3 |
| 6 | Dealer's "Total:" / status row 1px from the viewer's plate | Dealer's seat is never shrunk by `seatShrink` (players' are), so its chips are full size in the tightest column | Patched (`is-flanking`) — closed properly by step 2 |
| 7 | Dealer's flanking chips overrun by the bank's own hand as it drew | Anchored to the *cards*, which grow sideways; only visible in a resolved round | Patched — closed properly by step 2 |
| 8 | Bank pill exiled to the left rail, "nowhere near the center" | `bankPanelTop`'s two walls had crossed — a negative corridor. Tuned when `MIN_VF` was 0.5; it is 0.4 | Fixed by step 1 |
| 9 | Bank pill's *bottom* edge landed on the viewer's plate | The formula anchored only the pill's top edge | Fixed by step 1 |
| 10 | Seats overlapped the dealer on landscape phones | `seatScale()` compared player seats only; the dealer renders separately and was in no comparison | Fixed — `dealerClearanceScale` |

**Six of these (#3, #4, #6, #7, #8, #9) were one bug**: something in the centre
column collided with something else in the centre column. That is what Part 1
retires, and step 1 has now closed three of them by deletion rather than by
tuning.

**#1 is the counter-lesson and worth keeping in view.** Step 1 moved the bank
into a flow container, which is the right fix — and still shipped a new overlap,
because a flow container only contains what *fits* in it. Flow removes the
arithmetic; it does not remove the need to look. The sweep caught it in the same
run that confirmed the fix.

### Functional bugs — tracked separately, not part of the refactor

| # | Bug | Notes |
|---|---|---|
| F1 | **The banker's reactions have never appeared.** `Dealer.tsx` renders no `.k-reaction` at all — `Seat.tsx` does, `Dealer.tsx` does not | Functional, not layout: the feature has never worked for one participant. Must not be absorbed into step 3 and quietly closed as "reactions refactored" — it needs its own fix and its own test |

---

## Part 7 — The refactor

Three steps, each shipped and swept separately so a regression is attributable.
Every step is expected to **remove more code than it adds**; a step that comes
back net-positive on layout code means the plan changed and needs re-agreeing.

| Step | Change | Deletes | Closes |
|---|---|---|---|
| 1 | Bank cluster out of the felt's centre column, onto the banker's own plate | `bankPanelTop`, `corridorHeight`, `bankPanelPlacement`, `CORRIDOR_FLOOR`, `OFFSET_X_FRACTION`, `OFFSET_Y_COEF`, and the four measured constants | #3, #8, #9 |
| 1b | Viewer's own plate/total/status out of the felt into the bottom-left HUD | the viewer's on-felt identity block; `.k-toast-stack`'s own corner anchoring | removes the corridor's **lower wall** |
| 2 | Dealer total + status folded into the dealer plate as badges | `is-flanking`, `DEALER_STATUS_ROW_H` | #6, #7 |
| 3 | Reserved per-seat bubble slot (Part 2 rule 4) | `is-side`'s special-casing, the reaction counter-scale | #4, #5 |
| 3b | Bound `.k-chrome-top` in landscape so wrapped rows cannot land on the felt | the unbounded right-anchored row | #2, landscape half |
| 4 | Total rotate gate + `breakpoints.ts` | `.k-rotate-hint`'s media query, chrome-top's portrait `+88px` offset (`index.css:1931`), `rotateHintShowing` (`TableRoot.tsx:261`) | #2, portrait half |

**The order is not arbitrary.** 1b landed alongside 1 because putting the bank on
the dealer's plate grows that column downward, and only removing the viewer's
plate below it pays for that. 3b sits *after* 2, not before: step 2 is currently
load-bearing for a tree with a known overlap in it, so that gets cleared first —
then the chrome row, which is a live bug at 640×360 that none of the original
four steps addressed.

### What step 3's reserved slot costs

Reserving a bubble band on every seat is the containment answer, and at the
smallest supported size it is expensive. The arithmetic, so the trade gets made
with numbers rather than discovered afterwards:

At **640×360**, `--stage-scale` is 0.5 and `vf` bottoms out at 0.4, so the play
area is `760 × 0.4 = 304` stage px — **152 real px**. A bubble is ~24 real px
(13px text, 3px padding, 1px border) plus a 7px tail plus an 8px gap: **~39 real
px = 78 stage px**, or **~26% of the entire play area**, reserved on every seat
for something that is usually not there.

That does not fit. Two layouts, both containment, neither measuring anything:

- **Reserved per-seat slot** — bubble anchored to its speaker, tail pointing at
  them. Where the budget carries it.
- **Compact fallback** — one bubble at a time in the bottom-left HUD column,
  carrying the **sender's name**, so it still says who spoke without pointing.
  It costs no felt at all, because that column is already allocated.

The switch is the same `COMPACT_QUERY` everything else uses, so this adds no
fourth predicate. Stated concretely, because "above the threshold" is too vague
to verify:

| Viewport | compact? | Layout |
|---|---|---|
| 640×360, 800×360, 854×384, 844×390, 915×412, 896×414 | yes (height ≤ 440) | **fallback** |
| 1024×768 | no | reserved per-seat slot |
| 1512×950 | no | reserved per-seat slot |
| 768×1024 portrait | no | reserved per-seat slot |

**Every landscape phone is compact, so the "fallback" is the primary design.**
The table locks landscape on a handheld and every landscape phone matches on
height, so the bottom-left HUD bubble is what essentially every real player will
see. The reserved per-seat slot runs on exactly three non-phone viewports.

Build accordingly: the compact path gets the design attention and the careful
verification; the per-seat version is the edge case, not the reference.

**This includes the speaker tail.** It was asked for and restored deliberately
— at a table of eleven it is the only thing saying who spoke — but it belongs
to the per-seat layout, so almost no actual player will ever see one. Nobody
reading this later should mistake it for the primary design, and no future
decision should be justified by "the tail needs it". In the compact path the
sender's NAME does that job instead.

If the headroom measurement below fails — if 39px does not survive `seatScale`
packing eleven seats — **do not build the per-seat version at all.** Run compact
everywhere and record that here. Three viewports is not worth a second layout
that cannot be kept honest.

Predicted headroom at the three viewports above the line, from `computeFit`:

| Viewport | scale | vf | play area | bubble slot | share |
|---|---|---|---|---|---|
| 1024×768 | 0.80 | ~0.87 | ~529 real px | 39 real px | ~7% |
| 1512×950 | 1.18 | ~0.73 | ~655 real px | 39 real px | ~6% |
| 768×1024 | 0.60 | 1.0 | ~456 real px | 39 real px | ~9% |

**These are predictions, not measurements, and they are a gate on step 3 rather
than a licence to start it.** Before the per-seat slot ships, measure the real
rendered gap above each seat at those three viewports and confirm 39px fits with
the arc still legible — a play area with room in total can still be crowded once
`seatScale` has packed eleven seats onto it. Do not assume the budget carries
just because the viewport is not 640×360.

The z-index tiers (Part 3) land **as part of** this work, not as a later cleanup
— step 3's lane needs a defined top tier to live in. Step 4 is independent of
the first three and carries the single-source enforcement for both query strings.

---

## Part 8 — Verification

**While iterating**, render at the smallest supported size after each change —
`640x360-landscape`. Most breakage shows there first.

**Before reporting done**, run the full capture and *look at every image*:

```bash
npm --prefix e2e run screenshots
```

~3 minutes, 12 viewports into `e2e/screenshots/` (gitignored).

Portrait viewports split, exactly along Part 4's constraint — the capture keys
off the same `(portrait and width ≤ 540)` bound the gate does, so the two cannot
disagree about which devices are supported:

- **360×640, 390×844, 414×896** — gated. One shot of the gate, then stop. There
  is no playable portrait felt on a phone to photograph.
- **768×1024** — **supported, so it plays a full round like any landscape
  viewport.** A portrait tablet is a real surface; it gets photographed every
  sweep rather than spot-checked.

The capture drives real rounds through a real WebSocket, so it exercises
**worst-case content**, not placeholders — this is the part that finds bugs:

| worst case | how it gets there |
|---|---|
| longest plausible name | `LONG_NAME` fills the practice form ("Menachem Mendel") |
| widest reaction bubble | picks the longest phrase in the picker; bubbles are `nowrap` |
| fullest felt | `3-table-reaction` — dealt hand *and* a live bubble |
| longest tags, discard pile | `4-table-resolved` — the pile does not render before this |
| largest bank figures | reserved/free split only exists against a live wager |

Add a state here rather than eyeballing it once. A screenshot nobody re-renders
is worth less than the spec that keeps it honest.

### Per-viewpoint state — screenshots are blind to this by construction

**Anything that renders differently for "you" than for "them" needs an explicit
test. A screenshot cannot catch it, ever.** Every capture is taken from one
player's seat, so a thing that is correct from that seat and broken from every
other one photographs perfectly.

This is not hypothetical. Moving the viewer's identity into the HUD dropped
their own Eleveroon star, which had lived on the seat avatar: every other player
at the table could see that someone was calling it, and the one person who
needed to see it could not. Twelve viewports of screenshots showed nothing,
because the capture *is* that player. `App.tableView.test.tsx` caught it in
seconds.

The same shape is still open as ledger F1 — the banker's reactions have never
rendered at all.

When you change anything gated on `isMe`, `viewerId`, `isOwnerView`,
`isViewerBanker`, or card concealment, write the test. Assert the **behaviour**
("the player can see their own call"), not the location — the Eleveroon tests
originally asserted the mark was inside `.k-seat`, which made them fail for the
right reason but for the wrong stated cause.

### What the images cannot tell you

`e2e/tests/phone-layout.spec.ts` is the automated half: it asserts no two
information-carrying elements overlap, at three real Galaxy landscape sizes,
across three phases of a round. Screenshots catch what it is not looking at
(anything outside its allowlist, anything at a viewport it does not cover); the
spec catches what an eye skims past. Use both.

**Done checklist:** no unintended overlap · no clipped or truncated text ·
spacing on the 4/8/12/16/24/32/48 scale or commented · tap targets ≥ 44×44 ·
rendering crisp · no raw `z-index` values · nothing breaks at any tested size.

---

## Part 9 — Stage geometry

The felt is a fixed **1280×760** virtual stage scaled to the viewport
(`table/stage.ts`). Position in stage units, never viewport pixels.

- `--stage-scale` — the uniform scale. Counter-scale text against it when it
  must stay legible (`.k-plate-name`).
- `--vf` — vertical factor, `MIN_VF` 0.4…1, flattens the play area.
- `--play-top` — stage px reserved above the play area for the top chrome.
- `compact` (`StageFit.compact`) — matches the CSS breakpoint
  `(max-width: 520px), (max-height: 440px)` exactly. One definition, threaded
  from `useStageScale`, because two consumers disagreeing about compactness is
  how the dealer's row and the bank pill ended up in the same place.
