import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PracticeBankDialog } from "../PracticeBankDialog";
import { setNumberField } from "../../testing/numberField";

// A practice table's bank is the bot's, and the ordinary remedy for emptying
// it (Manage -> BANK) is admin-only, so it reaches nobody there. The first cut
// put chips back at a fixed 4x the buy-in; corrected straight away: "Practice
// bank they should just be able to select refill amount."

function open(overrides: Partial<React.ComponentProps<typeof PracticeBankDialog>> = {}) {
  const onRefill = vi.fn();
  const onClose = vi.fn();
  render(
    <PracticeBankDialog
      open
      buyIn={100}
      bankerName="Reb Yid"
      onClose={onClose}
      onRefill={onRefill}
      {...overrides}
    />
  );
  return { onRefill, onClose };
}

describe("choosing what to put back into a practice bank", () => {
  it("renders nothing until it is opened", () => {
    const { container } = render(
      <PracticeBankDialog open={false} buyIn={100} bankerName="Reb Yid" onClose={vi.fn()} onRefill={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the bot whose bank ran out", () => {
    open();
    expect(screen.getByText(/Reb Yid has no chips left/)).toBeInTheDocument();
  });

  // The lobby's own default for a new table, offered rather than imposed.
  it("opens on 4x the buy-in", () => {
    const { onRefill } = open();
    fireEvent.click(screen.getByText("Add to the bank"));
    expect(onRefill).toHaveBeenCalledWith(400);
  });

  it("sends whatever the player typed instead", () => {
    const { onRefill } = open();
    setNumberField(/Bank refill amount/, "250");
    fireEvent.click(screen.getByText("Add to the bank"));
    expect(onRefill).toHaveBeenCalledWith(250);
  });

  // Scaled off the table's own buy-in: a practice table can start at $10 or
  // $500, so a fixed set of chips would be pointless at one end and absurd at
  // the other.
  it("offers presets that mean something at this table's stakes", () => {
    const { onRefill } = open({ buyIn: 25 });
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("$250")).toBeInTheDocument();
    fireEvent.click(screen.getByText("$250"));
    fireEvent.click(screen.getByText("Add to the bank"));
    expect(onRefill).toHaveBeenCalledWith(250);
  });

  it("refuses to send nothing, and says why", () => {
    const { onRefill } = open();
    setNumberField(/Bank refill amount/, "0");
    fireEvent.click(screen.getByText("Add to the bank"));
    expect(onRefill).not.toHaveBeenCalled();
    expect(screen.getByText(/at least \$1/)).toBeInTheDocument();
  });

  it("closes itself once the chips are on their way", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByText("Add to the bank"));
    expect(onClose).toHaveBeenCalled();
  });
});
