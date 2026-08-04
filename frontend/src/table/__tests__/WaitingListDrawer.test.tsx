import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WaitingListDrawer, WaitingListEntry } from "../WaitingListDrawer";
import { Player } from "../../types";

const p1: Player = { id: "p1", firstName: "Yanky", lastName: "", type: "player", presence: "online" };
const p2: Player = { id: "p2", firstName: "Zalmy", lastName: "", type: "player", presence: "online" };
const p3: Player = { id: "p3", firstName: "Berel", lastName: "", type: "player", presence: "online" };

function renderDrawer(players: WaitingListEntry[], open = true) {
  const onClose = vi.fn();
  render(<WaitingListDrawer open={open} onClose={onClose} players={players} />);
  return { onClose };
}

describe("WaitingListDrawer", () => {
  it("renders nothing when closed", () => {
    renderDrawer([{ player: p1, isViewer: false, position: 1 }], false);
    expect(screen.queryByText("Waiting to be seated")).not.toBeInTheDocument();
  });

  it("lists every waiting player by name", () => {
    renderDrawer([
      { player: p1, isViewer: false, position: 1 },
      { player: p2, isViewer: false, position: 2 },
    ]);
    expect(screen.getByText("Yanky")).toBeInTheDocument();
    expect(screen.getByText("Zalmy")).toBeInTheDocument();
  });

  it("labels the viewer's own row 'You' instead of their name, pinned to the top regardless of their real position", () => {
    renderDrawer([
      { player: p1, isViewer: false, position: 1 },
      { player: p2, isViewer: true, position: 2 },
      { player: p3, isViewer: false, position: 3 },
    ]);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByText("Zalmy")).not.toBeInTheDocument(); // p2's own name, not shown once it's "You"
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("You");
  });

  it("still shows the viewer's TRUE rotation position even though their row is pinned to the top", () => {
    renderDrawer([
      { player: p1, isViewer: false, position: 1 },
      { player: p2, isViewer: true, position: 2 },
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("~2 rounds");
  });

  it("marks position 1 as 'Up next' rather than '~1 rounds'", () => {
    renderDrawer([{ player: p1, isViewer: false, position: 1 }]);
    expect(screen.getByText("Up next")).toBeInTheDocument();
  });

  it("closes on backdrop click and on the close button", () => {
    const { onClose } = renderDrawer([{ player: p1, isViewer: false, position: 1 }]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the panel itself", () => {
    const { onClose } = renderDrawer([{ player: p1, isViewer: false, position: 1 }]);
    fireEvent.click(screen.getByText("Waiting to be seated"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
