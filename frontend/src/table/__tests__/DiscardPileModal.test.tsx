import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiscardPileModal } from "../DiscardPileModal";
import { DiscardEntry } from "../DiscardPile";

const entries: DiscardEntry[] = [
  { key: "p1-1", playerName: "Alice Smith", isBanker: false, card: { name: "11", attributes: { values: [11], eleveroonIgnored: true } } },
  { key: "bk-0", playerName: "Bank", isBanker: true, card: { name: "11", attributes: { values: [11], eleveroonIgnored: true } } },
  { key: "p2-0", playerName: "Bob Jones", isBanker: false, card: { name: "7", attributes: { values: [7] } } },
];

describe("DiscardPileModal", () => {
  it("always shows the full 1-12 grid, tallying counts by face value rather than one row per card", () => {
    render(<DiscardPileModal entries={entries} onClose={vi.fn()} />);
    expect(screen.getByText("Discarded this round")).toBeInTheDocument();
    // Every value renders regardless of whether it's been discarded.
    for (let v = 1; v <= 12; v += 1) {
      expect(screen.getByAltText(`Card ${v}`)).toBeInTheDocument();
    }
    // Two 11s and one 7 in the fixture -- tallied, not listed.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    // No per-player attribution or Eleveroon explanation any more -- that
    // detail still lives at the seat itself, not in this tally.
    expect(screen.queryByText(/Alice/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Eleveroon/)).not.toBeInTheDocument();
  });

  it("keeps the exact same grid, just with nothing tallied, when nothing's been discarded", () => {
    render(<DiscardPileModal entries={[]} onClose={vi.fn()} />);
    for (let v = 1; v <= 12; v += 1) {
      expect(screen.getByAltText(`Card ${v}`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/discarded$/)).not.toBeInTheDocument();
  });

  it("calls onClose from the close button and the backdrop, not the card itself", () => {
    const onClose = vi.fn();
    render(<DiscardPileModal entries={entries} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
