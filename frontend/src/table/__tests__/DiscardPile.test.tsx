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
});

describe("DiscardPile", () => {
  it("renders nothing when the round has no rejects yet", () => {
    const { container } = render(<DiscardPile turns={[makeTurn({ cards: [normalCard] })]} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count and opens the review on click, once something's been rejected", () => {
    const onOpen = vi.fn();
    const { getByText, getByRole } = render(
      <DiscardPile turns={[makeTurn({ cards: [ignoredCard, ignoredCard] })]} onOpen={onOpen} />
    );
    expect(getByText("2 out")).toBeInTheDocument();
    fireEvent.click(getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
