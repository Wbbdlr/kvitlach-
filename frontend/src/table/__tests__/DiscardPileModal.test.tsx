import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiscardPileModal } from "../DiscardPileModal";
import { DiscardEntry } from "../DiscardPile";

const entries: DiscardEntry[] = [
  { key: "p1-1", playerName: "Alice Smith", isBanker: false, card: { name: "11", attributes: { values: [11], eleveroonIgnored: true } } },
  { key: "bk-0", playerName: "Bank", isBanker: true, card: { name: "11", attributes: { values: [11], eleveroonIgnored: true } } },
];

describe("DiscardPileModal", () => {
  it("lists every discarded card with who it happened to", () => {
    render(<DiscardPileModal entries={entries} onClose={vi.fn()} />);
    expect(screen.getByText("Discarded this round")).toBeInTheDocument();
    expect(screen.getByText(/Alice Smith/)).toBeInTheDocument();
    expect(screen.getByText(/Bank \(bank\)/)).toBeInTheDocument();
  });

  it("only explains itself for an Eleveroon reject, not an ordinary resolved-hand card", () => {
    const mixed: DiscardEntry[] = [
      { key: "p1-0", playerName: "Alice Smith", isBanker: false, card: { name: "11", attributes: { values: [11], eleveroonIgnored: true } } },
      { key: "p2-0", playerName: "Bob Jones", isBanker: false, card: { name: "7", attributes: { values: [7] } } },
    ];
    render(<DiscardPileModal entries={mixed} onClose={vi.fn()} />);
    expect(screen.getByText(/Alice Smith -- saved by Eleveroon/)).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("shows a placeholder when nothing's been discarded", () => {
    render(<DiscardPileModal entries={[]} onClose={vi.fn()} />);
    expect(screen.getByText("No cards discarded yet.")).toBeInTheDocument();
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
