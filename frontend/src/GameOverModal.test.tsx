import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { GameOverModal } from "./GameOverModal";
import { GameOverSummary } from "./state";

// One round: the banker down $50, Sara up $30, Moshe up $20.
const rounds = [
  {
    roundId: "R1",
    roundNumber: 1,
    completedAt: 10,
    balances: [],
    turns: [
      { player: { id: "bank", firstName: "Zeide", type: "admin" }, state: "lost", bet: -50 },
      { player: { id: "p2", firstName: "Sara", lastName: "K", type: "player" }, state: "won", bet: 30 },
      { player: { id: "p3", firstName: "Moshe", type: "player" }, state: "won", bet: 20 },
    ],
  },
] as any;

function summary(over: Partial<GameOverSummary> = {}): GameOverSummary {
  return {
    roomId: "ROOM1",
    roomName: "Zeide's table",
    playerId: "p2",
    wasBanker: false,
    closedAt: 1000,
    rounds,
    ledger: [],
    ...over,
  };
}

function renderModal(over: Partial<GameOverSummary> = {}) {
  const onExport = vi.fn();
  const onClose = vi.fn();
  render(<GameOverModal summary={summary(over)} onExport={onExport} onClose={onClose} />);
  return { onExport, onClose };
}

describe("GameOverModal", () => {
  it("names the table and how long the night ran", () => {
    renderModal();
    expect(screen.getByText(/The banker closed Zeide's table after 1 round\./)).toBeTruthy();
  });

  it("tells the banker they were the one who ended it", () => {
    renderModal({ playerId: "bank", wasBanker: true });
    expect(screen.getByText(/You closed Zeide's table/)).toBeTruthy();
  });

  // The point of the screen: everyone reads their own number without opening
  // a downloaded file.
  it("leads with the viewer's own net", () => {
    renderModal();
    const mine = screen.getByText("Your night").parentElement!;
    expect(within(mine).getByText("+$30")).toBeTruthy();
  });

  it("shows the whole table's standings, banker first", () => {
    renderModal();
    const names = screen.getAllByText(/Zeide|Sara K|Moshe/).map((el) => el.textContent);
    expect(names[0]).toContain("Zeide");
    expect(screen.getByText("-$50")).toBeTruthy();
    expect(screen.getByText("+$20")).toBeTruthy();
  });

  it("marks which row is the viewer", () => {
    renderModal();
    expect(screen.getByText("(you)")).toBeTruthy();
  });

  // Both exports have to survive the room being gone -- that is the bug this
  // screen exists to fix. The personal one must carry the player id; passing
  // no id is what produces the whole-table sheet.
  it("exports the viewer's own sheet with their id, and the table's with none", () => {
    const { onExport } = renderModal();
    fireEvent.click(screen.getByText("Save my results"));
    expect(onExport).toHaveBeenCalledWith("p2");
    fireEvent.click(screen.getByText("Save the whole night"));
    expect(onExport).toHaveBeenLastCalledWith();
  });

  // A watcher never held a seat, so there is no "my results" to save and no
  // row to highlight -- but the night still happened and is still exportable.
  it("offers only the whole-table export to someone who never played", () => {
    renderModal({ playerId: undefined });
    expect(screen.queryByText("Save my results")).toBeNull();
    expect(screen.queryByText("Your night")).toBeNull();
    expect(screen.getByText("Save the whole night")).toBeTruthy();
  });

  it("says so plainly when the table closed before a round finished", () => {
    renderModal({ rounds: [] });
    expect(screen.getByText(/nothing to record/)).toBeTruthy();
    expect(screen.queryByText("Save the whole night")).toBeNull();
    expect(screen.queryByText("Final standings")).toBeNull();
  });

  it("dismisses back to the lobby", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText("Back to the lobby"));
    expect(onClose).toHaveBeenCalled();
  });
});
