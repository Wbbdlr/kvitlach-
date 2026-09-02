import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatsModal } from "../StatsModal";
import { StatsData } from "../useTableData";

const baseData: StatsData = {
  name: "Alice",
  wins: 2,
  losses: 1,
  pushes: 0,
  isBanker: false,
  netTotal: 10,
  entries: [
    { roundNumber: 2, status: "WON", statusClass: "text-emerald-700 font-bold", bet: "+$20", betClass: "text-emerald-600" },
    { roundNumber: 1, status: "LOST", statusClass: "text-rose-600 font-semibold", bet: "-$10", betClass: "text-rose-600" },
  ],
};

describe("StatsModal", () => {
  it("renders the player's name, tally, and per-round entries", () => {
    render(<StatsModal data={baseData} onClose={vi.fn()} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Player stats")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // wins
    expect(screen.getByText("Round 2")).toBeInTheDocument();
    expect(screen.getByText("Round 1")).toBeInTheDocument();
  });

  it("labels the banker's own modal differently", () => {
    render(<StatsModal data={{ ...baseData, isBanker: true }} onClose={vi.fn()} />);
    expect(screen.getByText("Bank stats")).toBeInTheDocument();
  });

  // The shades are the DIALOG palette, not the felt's: the panel behind this
  // is now the dark surface every popover shares, so 700-weight ink that read
  // fine on white does not read on it. selectors.ts still emits the felt's own
  // 700s for round history; those are lifted by a .k-dialog-scoped rule in
  // index.css instead, because that string is built where this file cannot
  // reach it.
  it("shows a signed net total, green for positive and red for negative", () => {
    const { rerender } = render(<StatsModal data={baseData} onClose={vi.fn()} />);
    expect(screen.getByText("Net won/lost")).toBeInTheDocument();
    expect(screen.getByText("+$10")).toHaveClass("text-emerald-300");

    rerender(<StatsModal data={{ ...baseData, netTotal: -25 }} onClose={vi.fn()} />);
    expect(screen.getByText("-$25")).toHaveClass("text-rose-300");
  });

  it("labels the banker's net total distinctly", () => {
    render(<StatsModal data={{ ...baseData, isBanker: true }} onClose={vi.fn()} />);
    expect(screen.getByText("Bank net")).toBeInTheDocument();
  });

  it("shows a placeholder when no rounds have completed yet", () => {
    render(<StatsModal data={{ ...baseData, entries: [] }} onClose={vi.fn()} />);
    expect(screen.getByText("No completed rounds yet.")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<StatsModal data={baseData} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked but not when the card itself is clicked", () => {
    const onClose = vi.fn();
    render(<StatsModal data={baseData} onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    fireEvent.click(screen.getByText("Alice"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
