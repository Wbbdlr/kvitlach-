# Mobile UI & layout — history

Closed work, kept out of the contract so the contract stays short enough to be
read before every change. Nothing here constrains new code; the rules that do
live in [mobile-ui.md](mobile-ui.md).

Two things make this worth keeping rather than deleting. The bug ledger records
what each symptom actually turned out to be, and in several cases that is not
what it was reported as -- the connector lines were never missing, they were
14x8 px; backgrounding was never state loss, `room:resume` already worked and
was simply never reached. And the refactor plan records which structural change
closed which bug, which is the evidence for the rules.

---

## 1 — Known layout bugs (closed)

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
| F1 | **The banker's reactions have never appeared.** `Dealer.tsx` rendered no `.k-reaction` at all — `Seat.tsx` did, `Dealer.tsx` did not, and `ReactionLayer.tsx`'s comment claimed both | Functional, not layout: the feature had never worked for one participant. **Fixed** on its own, not folded into step 3 — see the tester table below |

### Reported by testers — a category of its own

One live session with real players found things twelve screenshot viewports and
three test suites did not. That is not a gap to close by adding viewports; it is
a different **kind** of observation, and it is worth naming so it keeps its own
weight in triage:

- A sweep photographs **one moment, one viewpoint, one preference set**. It
  cannot see anything that only appears over time (backgrounding, reconnect),
  anything that depends on who is looking (T7), or anything that is *present and
  wrong* rather than absent.
- A test asserts what somebody already thought to assert. Every item below was
  in code that passed its suite.
- Testers report **symptoms, not causes**, and the symptom often names the wrong
  layer — "players are shifting seats" was a turn-order variable, "the lines are
  gone" is a collinear anchor, and "no alert when the banker wins" may not be a
  layout bug at all.

Findings, kept separate from the sweep ledger above so their provenance is not
lost:

| # | Reported as | Diagnosis | State |
|---|---|---|---|
| T1 | Players visibly change seats between rounds | Seat geometry was derived from `round.turns`, which the server rotates every round on purpose — one array doing two jobs | **Fixed** — `orderTurnsBySeat`, `seatOrder.test.ts` |
| T2 | Backgrounding the browser breaks the game | Two failures, one symptom, and neither is state loss — `room:resume` already rebuilds the hand and always did. (a) socket genuinely closed, reconnect timer **frozen with the tab**, so it wakes holding a backoff of up to 15s earned while the radio was off. (b) socket half-open: `readyState` OPEN over a connection the server hung up on, which `connect()`'s already-open guard treats as nothing to do, forever — this one never recovers | **Fixed** — `visibilitychange`/`online`/`pageshow` reconnect immediately and reset the attempt counter; a socket still claiming OPEN after 45s away is replaced rather than trusted |
| T3 | Banker's chip controls are misplaced and overlapping | Not the menu (an earlier note here said it was, wrongly). `.k-bank-decision` — the blocking "Bank depleted" prompt — sat at `top: 22%` of the VIEWPORT. 22% of a 360px phone is 79px and the panel is 141px tall, so it always started above the top chrome row. Measured at a full table: it covered the row carrying **Leave** and the BANK! banner explaining why it was there, at both phone sizes | **Fixed** — centred, which clears the chrome above and the dock below by construction. The inline "Bank is empty" tag was also implicated and measured clean |
| T4 | Pinch-to-zoom missing or broken | The browser's own pinch was never going to serve: `.k-fit` is a fixed `100dvh` box with `overflow: hidden` and `overscroll-behavior: none`, which is exactly the shape that leaves a page zoomable but unpannable — and in fullscreen or as an installed PWA the browser disables page pinch outright | **Fixed** — `pinchZoom.ts`, multiplying `--stage-scale` rather than fighting it. Verified by driving a real pinch through CDP, because `touch-action` is decided by the compositor, above JS |
| T5 | Bank total and reserved/free sit too high; viewer's readout is stranded in a corner; empty band between felt and dock | Two separate things. BankPanel was the dealer column's FIRST child — right about the association (the bank IS the banker) and wrong about where it lands, because the column is centred on its anchor, so hanging a panel off the top pushed the readout above the oval's rail entirely and onto the dark surround, where it read as chrome. The empty band on a desktop is the felt's own margin below the oval, which is by design | **Fixed** — BankPanel is the last child now, inside the rail; same association, opposite end of the same column. The band had nothing in it because there was nothing to put there; the readout is draggable now (T11) |
| T6 | Reservation connector lines and the chip have disappeared | Not disappeared, unreadable. The badge inherited `seatScale` and rendered **14×8 real px** at a full table on a 854×384 phone — a coin glyph and a dollar amount inside fourteen pixels — and the line was 0.32 alpha at 1.5 stage units, which resolves to a sub-pixel hairline once the stage scales down | **Fixed** — badge floored at 0.8; line at 2 device px via `non-scaling-stroke`. Same root cause as T8/T13 |
| T7 | Tagline gone from the top of the phone screen | Deliberately hidden at the compact breakpoint, to solve crowding in a chrome row that no longer exists — 3b collapsed that row to `⋯` + Leave | **Fixed** — the rule's reasoning is kept, its `display: none` is not |
| T8 | Own cards are tiny at a nine-player table and hard to read | `seatScale()` answers one question — how far must a seat shrink so **nameplates** stop overlapping — and was applied as one transform to the whole seat. Measured at a full table: the viewer's card 17×27 real px against the banker's 32×48, the banker being bigger only because they are not on the arc | **Fixed** — `viewerHandScale()`, a clearance calculation that can only ever return ≥ `seatShrink`. 28×43 on a phone, 58×87 on desktop |
| T9 | Bots bust on every 11 — they never claim Eleveroon | Backend bot policy. The rule is opt-in and `playBotTurn` passed no options, so the only players it visibly applied to were human | **Fixed** — `decideBotEleveroon`, `getSums` not `winningNumber` |
| T10 | No alert when the banker wins / futches | There was no alert; there was a caption. `k-futch-flash` covers the futch only, and is a label inside the dock replacing the words "Round complete" | **Fixed** — a table-wide toast, in the same diff-the-broadcast shape as the Eleveroon and bank-frame announcements, suppressed for the banker's own client |
| T11 | The viewer's own readout should be draggable and resizable, and stay where it is put | A product decision that cuts against Part 2, so it needs its own bounds: stay on screen, persist, and be undoable | **Fixed** — `draggablePanel.ts`. Expressed as a transform offset **from** the flow position, so an untouched panel is byte-for-byte the layout it already was |
| T12 | Toasts are still bottom-left, sharing the corner with the viewer's readout | The both-corners split was agreed and never built. The right corner is empty at every phone size (confirmed in the eleven-seat captures) | **Fixed** — `.k-hud-row`, `space-between`; neither corner knows the other exists |
| T13 | Reactions are tiny and unreadable at a crowded table | Same root cause as T6 and T8: `seatScale` shrinks a seat's *information* along with its geometry, and a reaction is the one thing on the felt whose whole purpose is being read from across the table. Measured at ~4px of emoji | **Fixed** — `--k-rx` counter-scales the bubble out of the seat's transform, applied in the keyframes because the animation owns `transform` for the bubble's whole life |
| T14 | The phone menu is unintuitive — chips, name changes and felt colours are too nested | Three levels, two of them unlabelled. Chips meant: unlabelled `⋯` → a button labelled only with the **room's name** → a collapsed "Request more chips" inside the drawer | **Fixed** — a column of named rows, the ones it is opened for first, felt/chips inline, plus an install row (the lobby banner is unreachable from inside a table) |
| T15 | When the shoe runs out the table just stops — the banker has to go looking for the reshuffle, and a solo player against the computer has no idea why nothing is happening | Not a bug in the reshuffle, a bug in its discoverability. It lives behind Manage → Deck → confirm for a real banker and behind the collapsed chrome menu in a practice room, and nothing at all announces the empty shoe. store.ts's own comment already knew the shape of it: "the fresh shoe arrived and the table was still dead" | **Fixed** — a centred prompt on the felt, the same shape as the bank-depleted one because it is the same situation: a blocking condition only one person can clear. Whoever cannot clear it is told what is being waited on. No confirm step — there is nothing to discard |
| F1 | The banker's reactions have never appeared | `ReactionLayer.tsx` has always claimed reactions are rendered by `Seat.tsx`/`Dealer.tsx`. `Seat.tsx` did; `Dealer.tsx` never did. The comment described an intention | **Fixed** — anchored `is-side` unconditionally; the bank is at the top of the oval, so "above it" is chrome |

> **Numbering note.** T11 and T12 are transposed in two commit subjects ("Give the
> empty corner the toasts... (T11)" is this table's T12, and "Let players park the
> readout where they want it (T12)" is this table's T11). The table is
> authoritative; the commits are not being rewritten to match.

---

## 2 — The refactor (complete)

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

## 3 — Closed after the refactor (v9.5 -> v9.6)

Reported against the live v9.5 build, all measured before and after.

| # | Report | Cause | Result |
|---|---|---|---|
| H1 | Cards cover the turn timer, mobile only | `--k-hand-scale` > 1 with centre `transform-origin` grew the hand upward; a transform is invisible to layout. Exactly 1 on desktop, which is why it was mobile-only | −4.7px → **+2.9px** at 854×384 |
| H2 | Reserved chips "nowhere near the player's spot" | Placed at a fraction along the bank→seat line, so derived from where the *bank* is. `isPlaceable` then dropped any chip whose seat was too close to the bank — which is the viewer's own seat, by construction | Anchored above its own seat; viewer's beside their cards |
| H3 | Reaction emoji unreadable | The compact sizing rule sat ~1500 lines above the base rule; a media query adds no specificity, so it had never applied on any phone. The 16px clamp ceiling then capped the counter-scale | 4.88 → **10.0 real px** at 390×844 |
| H4 | `…` menu pushed around during play | Anchored to its own button inside a `justify-content: flex-end` row, so any control to its right changing width dragged it | −67px → **0px** |
| H5 | Dialogs look nothing like the menu | They were still on the light Tailwind palette — `bg-white` panels over a dark table. Seven near-duplicate surface strings | One `--k-surface`; worst contrast 5.28:1 |
| H6 | Connector lines come out of the dealer's deck | The anchor is the dealer box's centre, and the deck sits at that centre. Defended by a comment describing a layout T5 had already changed | Origin inside the bank readout |
| H7 | Readout stranded in the bottom-left corner | Anchored to the stage's left edge while the controls panel is centred and content-width — the two had no relationship | `hud.x == dock.x`, 8px above |
| H8 | Maker's mark not in Cinzel | `JSON.stringify()` used to quote the font stack; HTML does not understand `\"`, so one attribute parsed as seven and `font-family` resolved to a backslash. Never rendered in Cinzel on any platform | Fixed; face loads |

**H8 is the one worth re-reading.** It survived because the fallback is
metrically almost identical for this one string — 724px vs 722.5px at 100px/600,
0.2% apart — so nothing shifted and no frame misfit gave it away. In lowercase
the same comparison is 655 vs 472. A defect with no visual tell needs a test that
parses, not one that eyeballs.

**Two were introduced during these fixes and caught by the sweep**, which is the
argument for the sweep: `k-reaction` × `k-resv` at 63/52/40% when the chip moved
above the seat, and `k-hand` × `k-viewer-hud` at 800×360 when the readout moved
above the dock. A third — the readout collapsing to 36px wide in round states
with no dock — was caught only by a screenshot, because a wrapped panel is ugly,
not overlapping.
