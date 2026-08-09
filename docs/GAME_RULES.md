# Game rules (developer reference)

Kvitlach is a traditional Chanukah card game. It resembles blackjack but is
**not** blackjack — several rules below have no blackjack equivalent and are the
usual source of bugs. This documents the rules *as implemented*; the code
(`backend/src/deck.ts`, `turn.ts`, `round.ts`) is the source of truth. The
player-facing explanation lives in `frontend/src/RulesModals.tsx`.

## The deck

A Kvitlach deck is **24 cards**: the numbers 1–12, **two copies of each**. Not a
standard 52-card deck, and not 48. Larger tables combine multiple 24-card decks
into one shuffled shoe (`buildShoe`), the way a real table brings out a second
deck.

Card values (`deck.ts`):

| Card | Counts as | Notes |
|---|---|---|
| 1–10 | face value | |
| 2 | 2 | **rosier** ("framed") |
| 11 | 11 | **rosier** ("framed") |
| 12 | **12, 9, or 10** | flexible — see below |

## The flexible 12

The 12 is worth 12, 9, *or* 10, and **re-reads itself at every evaluation** —
including later in the same hand as more cards arrive. A hand holding a 12 has
no single total; it has a *set* of achievable totals.

`getSums()` returns every achievable sum across the whole hand (the cartesian
product of each card's possible values, pruned above 21). All rule checks must
consider that set:

- **Bust** only if *every* achievable total exceeds 21.
- **21** if *any* achievable total is exactly 21.
- "Best total" for display is the highest total not over 21.

Never collapse a 12 to a single value, and never use the best/highest total
where "any achievable total" is meant — that exact mistake caused a real
Eleveroon bug (a hand of 12+2 reads best as 14 but is *also* readable as 11).

## Rosier (framed) pair

A **two-card** hand where both cards are rosier type (2 and 11) is an automatic
win, regardless of its numeric total. Only ever a two-card hand.

## Hand outcomes

`calcState(cards)` resolves, in order:

1. any achievable total is 21 → **won**
2. rosier pair → **won**
3. every achievable total > 21 → **lost** (a *futch*)
4. otherwise → **pending**

Note a hand flips to **won** the instant 21 becomes reachable, during the
player's own turn — before the banker acts. A win decided later at showdown
arrives as a `standby` turn resolving to `won`. The two are different moments
and the UI sounds them differently.

## Blatt (no-wager draws)

A **blatt** is a draw taken with no money wagered. It cannot win or lose money:
it settles as a **push** whatever the cards say, including a bust. A blatt hand
also may not keep drawing past 21 — there's no legal move left, so the turn
ends rather than sitting there dead.

In code, a no-wager turn is `bet === 0 && settledBet === 0`. `calculateEndState`
must never relabel such a hand as lost — telling a player they lost a hand they
never wagered on is a bug, even though $0 moves either way.

## Futch

A **futch** is going over 21. It is *not* the same as losing.

This distinction matters most for the banker: the banker's `state` also reads
`"lost"` when they merely finish the round down on money with a perfectly good
hand. That's why `Turn.busted` is a separate field, set from the cards. Use
`busted` (or `statusDisplay`'s `FUTCHED!` label) for anything that means "went
over 21" — the futch sound, the futch banner, the futch tag.

## Eleveroon

An **opt-in** rule (off by default for players; always on for the banker). If a
player draws an 11 that would bust them, and their hand *before* that card is
readable as **exactly 11**, the drawn 11 is ignored instead of busting them.

Two implementation requirements:

- The "currently 11" check must consult **every achievable total**
  (`getSums(...).includes(11)`), not the best total.
- The ignored card stays in the hand, flagged `eleveroonIgnored`, and is
  excluded from later sum calculations. It is still rendered (with its own
  visual treatment) — the player should see what they were saved from.

## Showdown and the banker

- Players who neither bust nor hit 21 go to **standby** and are compared
  against the banker's final hand.
- **Ties go to the banker.**
- If the banker busts, every non-busted player wins regardless of total.
- The banker's per-round result is reported as both money (`bet` = net) and
  head-to-head counts (`beat` / `lostTo`) — one big loss can leave the banker
  down on money while still beating most of the table, and both are shown.

## BANK!

A player may wager the bank's entire remaining available window in one shot.
This locks the bank until the banker resolves that hand immediately. The bank's
available amount is tracked per-seat with reservations so several players can't
each claim the same chips. A plain bet landing exactly on the bank's remaining
amount is treated as a bank-lock too.

## Turn flow

One round = every seated player acts in turn order, then the banker. A turn
timer auto-skips a player who doesn't act. The server enforces turn state
(`turn_not_pending`, `not_your_turn`) — the client's disabled buttons are a
convenience, not the guard.
