import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoomInfoDrawer } from "../RoomInfoDrawer";

function renderDrawer(overrides: Partial<React.ComponentProps<typeof RoomInfoDrawer>> = {}) {
  const onRequestRename = vi.fn();
  const onRequestBuyIn = vi.fn();
  const onClose = vi.fn();
  render(
    <RoomInfoDrawer
      open
      onClose={onClose}
      roomName="The Kugel Corner"
      roomId="ROOM1"
      isAdmin={false}
      playerId="p1"
      renameRequests={[]}
      buyInRequests={[]}
      onRequestRename={onRequestRename}
      onRequestBuyIn={onRequestBuyIn}
      {...overrides}
    />
  );
  return { onRequestRename, onRequestBuyIn, onClose };
}

describe("RoomInfoDrawer", () => {
  it("shows the room name as the title and the Game ID separately", () => {
    renderDrawer();
    expect(screen.getByText("The Kugel Corner")).toBeInTheDocument();
    expect(screen.getByText("ROOM1")).toBeInTheDocument();
  });

  it("falls back to the room ID as the title when there's no room name", () => {
    renderDrawer({ roomName: undefined });
    expect(screen.getByText("Kvitlach table")).toBeInTheDocument();
  });

  it("offers sharing options", () => {
    renderDrawer();
    expect(screen.getByText("Copy invite link")).toBeInTheDocument();
    expect(screen.getByText("Share via WhatsApp")).toBeInTheDocument();
  });

  it("shows rename/buy-in self-service requests for a non-admin player", () => {
    renderDrawer({ isAdmin: false });
    expect(screen.getByText("Request name change")).toBeInTheDocument();
    expect(screen.getByText("Request more chips")).toBeInTheDocument();
  });

  it("hides rename/buy-in requests for the banker (they approve, not request)", () => {
    renderDrawer({ isAdmin: true });
    expect(screen.queryByText("Request name change")).not.toBeInTheDocument();
    expect(screen.queryByText("Request more chips")).not.toBeInTheDocument();
  });

  it("submits a rename request with the entered name", () => {
    const { onRequestRename } = renderDrawer();
    fireEvent.click(screen.getByText("Request name change"));
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "Yanky" } });
    fireEvent.click(screen.getByText("Submit rename request"));
    expect(onRequestRename).toHaveBeenCalledWith("Yanky", undefined);
  });

  it("submits a buy-in request with the entered amount", () => {
    const { onRequestBuyIn } = renderDrawer();
    fireEvent.click(screen.getByText("Request more chips"));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "50" } });
    fireEvent.click(screen.getByText("Submit chip request"));
    expect(onRequestBuyIn).toHaveBeenCalledWith(50, undefined);
  });

  it("shows a pending-approval message instead of the request button when one is already outstanding", () => {
    renderDrawer({
      renameRequests: [{ playerId: "p1", firstName: "Yanky", lastName: "", requestedAt: Date.now() }],
    });
    expect(screen.getByText(/Pending banker approval for Yanky/)).toBeInTheDocument();
  });

  it("does not render anything when closed", () => {
    const { container } = render(
      <RoomInfoDrawer
        open={false}
        onClose={vi.fn()}
        roomId="ROOM1"
        isAdmin={false}
        renameRequests={[]}
        buyInRequests={[]}
        onRequestRename={vi.fn()}
        onRequestBuyIn={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
