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

## Part 2 — The six rules

**Rule 1 — one owner per axis.** Each element's x and y come from exactly one
source: a stage coordinate, a flow container, or a viewport anchor. Never two.

**Rule 2 — position by containment, never by measuring a sibling.** If B must sit
below A, put B *inside* something that ends where A ends. Do not read A's height
and offset B by it. A shared stage coordinate is containment; a rendered
measurement is not.

**Rule 2b — contrast is containment too.** Anything over the felt owns its own
background. Text on raw felt is not legible at every felt colour, and the felt is
player-chosen. Composite scrim → tint → ink, in that order, and hold **4.5:1**.

**Rule 3 — the scene scales, the frame does not.** Nothing in the frame may
inherit `--stage-scale`. Anything in the scene that must stay legible
counter-scales with `clamp(min, calc(target / var(--stage-scale)), max)` — and the
ceiling must be high enough to still reach `target` at the smallest stage the
table draws at, or the clamp silently cancels the compensation.

**Rule 4 — one reaction slot per seat, with a queue.** Bubbles are anchored to
their seat and never float. Compact fallback policy:


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


**Rule 5 — reserve the space, don't rely on the gap.** A transform is invisible to
layout: pin `transform-origin` so a scaled element cannot grow into its
neighbour, rather than widening a gap that only holds at the scale it was
measured at. And space that exists only while something is running is not
reserved — if a row's *presence* is conditional, its *space* must not be. When a
permanent row changes a seat's real height, move the constants calibrated to that
height with it.

**Rule 6 — a comment can outlive the layout it describes.** When you move an
element, grep for its name in comments, not just in code. A stale justification
reads as sound while the thing it defends has become wrong.

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

a fourth, name its question here first.

| Predicate | Owns the question | Test | Why that test |
|---|---|---|---|
| `isHandheld()` (`table/immersive.ts`) | *"May we take over this device's orientation and fullscreen when it enters a table?"* | coarse pointer **and** short edge ≤ 820px | Measures the **device**, not the viewport, because it may already be held landscape. Deliberately generous: every call is best-effort and a refusal is a no-op, so over-matching costs nothing |
| `GATE_QUERY` (the rotate gate) | *"Is this viewport too small to render the table in portrait at all?"* | `(orientation: portrait) and (max-width: 540px)` | Measures the **rendered viewport**. In portrait, width *is* the short edge. 540 keeps a 768px tablet playing — the one number that must not become 820 |
| `COMPACT_QUERY` (`stage.ts`) | *"Is the rendered table cramped enough to need compact chrome and dock styling?"* | `(max-width: 520px), (max-height: 440px)` | An **OR across both axes**. The height arm is the one that catches a landscape phone, which is wide (854) but short (384). A width-only test here was bug #9 |


**One source for each string.** Two copies of player-facing orientation copy
drift, and the second is always the one a player reads.

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

**Screenshots are blind to conditional state.** Anything conditionally rendered
— banners, prompts, badges, the discard pile — needs a phase that produces it, or
it is untested however it is listed.

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
