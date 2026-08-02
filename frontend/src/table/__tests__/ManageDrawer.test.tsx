import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ManageDrawer } from "../ManageDrawer";

// The reshuffle control used to be disabled ("Only available between
// rounds") with a server that silently reshuffled on its own whenever the
// carried-over deck ran low, mid-hand or not. Now the dealer is the only one
// who ever brings in a new shoe (see round.ts's createRound/drawCard both
// refusing rather than reshuffling), so the button must always be usable --
// these pin that it's live either way, and that the warning actually
// changes to reflect what reshuffling mid-hand really does.
function renderDrawer(overrides: { roundActive?: boolean; onReshuffleDeck?: () => void } = {}) {
  const onReshuffleDeck = overrides.onReshuffleDeck ?? vi.fn();
  render(
    <ManageDrawer
      open={true}
      onClose={vi.fn()}
      players={[]}
      wallets={{}}
      renameRequests={[]}
      buyInRequests={[]}
      roundHistoryCount={0}
      bankerWallet={500}
      onTopUp={vi.fn()}
      onSetWatermark={vi.fn()}
      onApproveRename={vi.fn()}
      onRejectRename={vi.fn()}
      onApproveBuyIn={vi.fn()}
      onRejectBuyIn={vi.fn()}
      onAdjustChips={vi.fn()}
      onKick={vi.fn()}
      onExportHistory={vi.fn()}
      onCloseRoom={vi.fn()}
      roundActive={overrides.roundActive ?? false}
      onReshuffleDeck={onReshuffleDeck}
    />
  );
  return { onReshuffleDeck };
}

describe("ManageDrawer reshuffle control -- the dealer's own choice", () => {
  it("is enabled between rounds, same as before", () => {
    renderDrawer({ roundActive: false });
    const button = screen.getByRole("button", { name: "Reshuffle deck" });
    expect(button).not.toBeDisabled();
  });

  it("is ALSO enabled mid-round -- reshuffling is no longer blocked while a hand is live", () => {
    renderDrawer({ roundActive: true });
    const button = screen.getByRole("button", { name: "Reshuffle deck" });
    expect(button).not.toBeDisabled();
    expect(screen.queryByText(/only available between rounds/i)).toBeNull();
  });

  it("warns about the live hand specifically when confirming mid-round", () => {
    renderDrawer({ roundActive: true });
    fireEvent.click(screen.getByRole("button", { name: "Reshuffle deck" }));
    expect(screen.getByText(/hand is in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/cards already dealt stay exactly as they are/i)).toBeInTheDocument();
  });

  it("uses the plain between-round wording when no hand is live", () => {
    renderDrawer({ roundActive: false });
    fireEvent.click(screen.getByRole("button", { name: "Reshuffle deck" }));
    expect(screen.getByText(/shuffle a fresh shoe in before the next round/i)).toBeInTheDocument();
    expect(screen.queryByText(/hand is in progress/i)).toBeNull();
  });

  it("only actually reshuffles after the confirm step, not on the first click", () => {
    const { onReshuffleDeck } = renderDrawer({ roundActive: true });
    fireEvent.click(screen.getByRole("button", { name: "Reshuffle deck" }));
    expect(onReshuffleDeck).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reshuffle" }));
    expect(onReshuffleDeck).toHaveBeenCalledTimes(1);
  });

  it("cancel backs out without reshuffling", () => {
    const { onReshuffleDeck } = renderDrawer({ roundActive: true });
    fireEvent.click(screen.getByRole("button", { name: "Reshuffle deck" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onReshuffleDeck).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reshuffle deck" })).toBeInTheDocument();
  });
});
