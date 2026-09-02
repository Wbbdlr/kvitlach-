# Mobile UI & layout — the design contract

What goes where, why, and how it is verified. **Read Part 1 before writing any
layout code**; the rest is reference.

This file holds only what constrains NEW work. The bug ledger and the refactor
that closed it moved to [mobile-ui-history.md](mobile-ui-history.md) — worth
reading once, not worth carrying in every session. Six of that ledger's ten
bugs were one structural bug wearing six hats, and Part 1 is what stops the
seventh.

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
already broken — it just hasn't been photographed yet. A longer name, a wrapped
tag or a fifth card invalidates it silently, and the failure shows up on
somebody's phone rather than in a suite.

Every constant of this kind has now been deleted rather than corrected —
`BankPanel.tsx` once held four (`VIEWER_PLATE_TOP_CONST`, `DEALER_BOTTOM_CONST`,
`DEALER_STATUS_ROW_H`, `BANK_PILL_HEIGHT`) and searched for a gap between them;
there was no gap. `--controls-band: 84px` was the last one, a guessed dock
height that the dock had already outgrown. Both are gone, so this rule now has
no live counter-example — which is the point, and also why it is worth stating:
the next one will look reasonable too.

The same rule reaches past pixels. `seatScale()` is a nameplate-collision
number, and applying it to a whole seat shrank the cards, the reaction bubbles
and the bank's badges along with it — three things that collide with nothing.
**Ask what a number MEANS before reusing it, not just what it is currently
equal to.**

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
is empty most of the time — see [mobile-ui-history.md](mobile-ui-history.md)
for what that cost at 640×360 and what happened where the budget would not
carry it.

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

## Part 6 — Verification

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
runs `workers: 1`, which also means ONE Chrome — Playwright's `browser` fixture
is worker-scoped, so each viewport is a new BrowserContext inside one process,
not a new process. Raising it multiplies Chrome processes, not throughput. The
regression suite runs `workers: 2` for the same reason: `seat-cap.spec.ts`
alone drives thirteen live contexts.

**The E2E frontend serves a built bundle, not the dev server**, and should stay
that way. The dev server serves every module as its own request and a fresh
BrowserContext has an empty HTTP cache, so every new context paid for hundreds
of round trips before its page was usable. Serving `dist` cut the suite from
5.2m to 2.1m and exercises the artefact that actually ships.

**Every timeout is bounded — `navigationTimeout` and `actionTimeout` included.**
Playwright's navigation default is infinite. Leaving it there is what turned a
stalled click into a bare "test timeout exceeded" naming no assertion, and cost
three sessions of chasing a layout bug that did not exist.

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
