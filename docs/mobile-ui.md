# Mobile UI & layout — the design contract

The rules. What produced them is in [mobile-ui-history.md](mobile-ui-history.md) —
every constant here was measured, and the measurement lives there.

Most players are on a phone, in landscape. Minimum supported: **360px wide
portrait**, **640×360 landscape** for the table.

## Part 1 — The scene / HUD frame split

**A landscape phone has room for three rows: the dealer, the cards, and you.**
Everything else must live in the HUD frame or not exist. That budget is the
reason for the split, and it is not negotiable by making something smaller.

### Scene — inside the scaled stage

Positioned in 1280×760 stage units, scaled to the viewport.


| In the scene | Why |
|---|---|
| the felt, its rings and scrim | it *is* the surface |
| seats and their nameplates | the arc is the table's geography — who sits where |
| cards, hands, the fan | they are dealt *to* a place |
| the shoe and the discard pile | fixtures at the dealer's left and right hand |
| reservation lines and chips | they draw bank → player; the endpoints are the point |

### HUD frame — outside the stage, viewport-anchored

Flat px, never scaled. Chrome, not table.


| In the frame | Where |
|---|---|
| bank total, reserved / free | top status bar |
| round state, connection, table label | top status bar / chrome-top |
| your hand's total and your actions | the dock |
| toasts, banners, announcements | overlay tiers |
| reactions | the reaction lane (Part 3) |
| every drawer, modal and menu | overlay tiers |

**Which is it?** A place on the table goes in the scene; a thing being told to
the player goes in the frame; anything answering "both" is two elements. Nothing
in the frame may be positioned from a scene measurement, or the reverse.

## Part 2 — The nine rules


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

**5. One owner per axis.** Each element's x and y come from exactly one
source: a stage coordinate, a flow container, or a viewport anchor. Never two.

**6. The scene scales, the frame does not.** Nothing in the frame may
inherit `--stage-scale`. Anything in the scene that must stay legible
counter-scales with `clamp(min, calc(target / var(--stage-scale)), max)` — and the
ceiling must be high enough to still reach `target` at the smallest stage the
table draws at, or the clamp silently cancels the compensation.

**7. Reserve the space, don't rely on the gap.** A transform is invisible to
layout: pin `transform-origin` so a scaled element cannot grow into its
neighbour, rather than widening a gap that only holds at the scale it was
measured at. And space that exists only while something is running is not
reserved — if a row's *presence* is conditional, its *space* must not be. When a
permanent row changes a seat's real height, move the constants calibrated to that
height with it.

**8. A comment can outlive the layout it describes.** When you move an
element, grep for its name in comments, not just in code. A stale justification
reads as sound while the thing it defends has become wrong.

**9. Don't edit prose by line range.** Extracting or replacing a span of lines
cuts through sentences and leaves something that still parses, so nothing
flags it. It has silently truncated this file twice and `About.tsx` once —
a mid-sentence paragraph, a rule that ended on its own colon, and a regex
literal split into orphan lines. Edit prose by matching the text you mean to
change, and re-read the whole file afterwards.

## Part 3 — Z-index tiers

One scale, named, in `index.css`. Never a bare number, never a local `+1`.


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


Cross-tier overlap must be deliberate and commented; two things overlapping
*within* a tier is a Rule 1 problem, not a tier problem.

## Part 4 — Orientation is per-surface, and fixed

The table **requires landscape on a handheld** and is gated in portrait there.
**Larger viewports render the table in any orientation** — the stage scales to
fit, so a 768×1024 portrait tablet is a supported surface, not a broken one. The
lobby, landing and About/Contact/Disclaimer pages are portrait, ordinary
responsive pages.

**The gate must be total.** When it is up the table is not rendered, measured or
animated behind it — a covered table still runs its layout, and a stage measured
while hidden produces a stale `--stage-scale` on the first paint after rotation.

### The three portrait predicates

Three different questions. Never collapse them into one helper.


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

`viewport-fit=cover` is set. Every edge-anchored element already reads
`env(safe-area-inset-*)` through a `max()`. Adding a new one means adding the
inset too — and the right/left insets are not interchangeable, because a notch
swaps sides with rotation.

## Part 6 — Verification

**Never call a layout change done from reading code. Render it and look.**


**While iterating**, capture ONE viewport — `854x384`, the size most of the
reported bugs arrived at:

```bash
npm --prefix e2e run shot
```

**Before reporting a step done**, the full sweep, and *look at every image*:

```bash
npm --prefix e2e run screenshots
```

12 viewports plus the burgundy and green felts into `e2e/screenshots/`
(gitignored), ~4 min. Two narrower captures answer questions the sweep cannot,
because its practice table seats two bots and several of these bugs only appear
on a crowded one:

```bash
npm --prefix e2e run shot:full-table   # eleven seats, both bottom corners
npm --prefix e2e run shot:menu         # the phone chrome menu, open
```

**Browser concurrency is capped deliberately and must stay capped.** The sweep
runs `workers: 1`, the regression suite `workers: 2`. Playwright's `browser`
fixture is worker-scoped, so each viewport is a new BrowserContext inside one
process — raising the count multiplies Chrome processes, not throughput.

**The E2E frontend serves a built bundle, not the dev server.** Keep it that way:
a fresh BrowserContext has an empty HTTP cache, and the dev server serves every
module as its own request.

**Done checklist:** no unintended overlap · no clipped or truncated text ·
spacing on the 4/8/12/16/24/32/48 scale or commented · tap targets ≥ 44×44 ·
rendering crisp · no raw `z-index` values · nothing breaks at any tested size.

---


### An allowlist entry is not coverage

The sweep checks a list of classes; naming one does nothing unless a phase
renders it. Each run reports which listed classes never appeared — read that
line. The sweep also only sees classes following the `k-` convention, and only
above a 1px floor.

Choose the list by **positioning independence** — only elements that can move
independently can collide:

- **In:** independently positioned things carrying a player's information.
- **Out:** containers (a container always intersects its own contents) and
  elements absolutely positioned relative to something already listed.
- Ancestor/descendant pairs are skipped, so a parent stands in for its children.

Check desktop and tablet widths, not only phones: two independently-anchored
chrome clusters collide at the widths where one grows wide enough to reach the
other.


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

## Part 7 — Stage geometry

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
