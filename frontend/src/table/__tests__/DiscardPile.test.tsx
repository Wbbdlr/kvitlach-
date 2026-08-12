import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DiscardPile, discardedEntries } from "../DiscardPile";
import { Player, Turn } from "../../types";

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1",
    firstName: "Alice",
    lastName: "Smith",
    type: "player",
    presence: "online",
    ...overrides,
  };
}

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    player: makePlayer(),
    state: "pending",
    cards: [],
    bet: 0,
    ...overrides,
  };
}

const ignoredCard = { name: "11", attributes: { values: [11], eleveroonIgnored: true } };
const normalCard = { name: "7", attributes: { values: [7] } };

describe("discardedEntries", () => {
  it("returns nothing when no card has been rejected", () => {
    const turns = [makeTurn({ cards: [normalCard, normalCard] })];
    expect(discardedEntries(turns)).toEqual([]);
  });

  it("collects one entry per rejected card, across every turn", () => {
    const alice = makeTurn({ player: makePlayer({ id: "p1", firstName: "Alice" }), cards: [normalCard, ignoredCard] });
    const bob = makeTurn({ player: makePlayer({ id: "p2", firstName: "Bob" }), cards: [ignoredCard] });
    const entries = discardedEntries([alice, bob]);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.playerName)).toEqual(["Alice Smith", "Bob Smith"]);
    expect(entries.every((e) => e.card === ignoredCard)).toBe(true);
  });

  it("flags the banker's own rejects separately from a player's", () => {
    const banker = makeTurn({ player: makePlayer({ id: "bk", type: "admin", firstName: "Bank" }), cards: [ignoredCard] });
    const [entry] = discardedEntries([banker]);
    expect(entry.isBanker).toBe(true);
  });

  it("logs every card once a hand is fully won or lost, not just rejects", () => {
    const won = makeTurn({ state: "won", cards: [normalCard, normalCard] });
    expect(discardedEntries([won])).toHaveLength(2);
    const lost = makeTurn({ state: "lost", cards: [normalCard, normalCard, normalCard] });
    expect(discardedEntries([lost])).toHaveLength(3);
  });

  it("keeps a standing or skipped hand's cards out -- their total is still hidden from everyone else", () => {
    // Mirrors selectors.ts's totalDisplay: "standby" (stood, banker hasn't
    // played yet) and "skipped" both stop short of the won/lost reveal, so
    // logging their cards here would leak exactly what that's protecting.
    const standing = makeTurn({ state: "standby", cards: [normalCard, normalCard] });
    expect(discardedEntries([standing])).toEqual([]);
    const skipped = makeTurn({ state: "skipped", cards: [normalCard, normalCard] });
    expect(discardedEntries([skipped])).toEqual([]);
  });

  it("logs the banker's cards on a 'standby' finish too, not just won/lost", () => {
    // Unlike a player, calculateEndState (round.ts) resolves the banker to
    // "standby" -- not won/lost -- whenever the bank finishes the round
    // even or ahead without busting or hitting a natural 21: the MOST
    // common banker outcome, not an edge case. selectors.ts's totalDisplay
    // already treats that as fully resolved/revealed for the banker (its
    // own bankerResolved check), so the discard pile must too.
    const banker = makeTurn({
      player: makePlayer({ id: "bk", type: "admin", firstName: "Bank" }),
      state: "standby",
      cards: [normalCard, normalCard],
    });
    const entries = discardedEntries([banker]);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.isBanker)).toBe(true);
  });

  it("still logs an Eleveroon reject immediately, before the rest of that hand resolves", () => {
    const midHand = makeTurn({ state: "pending", cards: [normalCard, ignoredCard] });
    const entries = discardedEntries([midHand]);
    expect(entries).toHaveLength(1);
    expect(entries[0].card).toBe(ignoredCard);
  });
});

describe("DiscardPile", () => {
  // DiscardPile takes the already-merged entries list, not turns -- TableRoot
  // is what merges shoe history with the live round (see state.ts's
  // advanceShoeDiscards), so these fixtures build DiscardEntry[] directly
  // rather than routing through discardedEntries().
  it("renders nothing when nothing's been discarded yet", () => {
    const { container } = render(<DiscardPile entries={[]} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count and opens the review on click, once something's been rejected", () => {
    const onOpen = vi.fn();
    const entries = discardedEntries([makeTurn({ cards: [ignoredCard, ignoredCard] })]);
    const { getByText, getByRole } = render(<DiscardPile entries={entries} onOpen={onOpen} />);
    expect(getByText("2 out")).toBeInTheDocument();
    fireEvent.click(getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
