import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BankFrameModal } from "../BankFrameModal";
import type { BankFrameResult } from "../../types";

// The hand that won a BANK! showdown is never on the felt: settleBankOutcome
// overwrites the banker's turn with their redeal in the same call that
// resolves the frame. This panel is the only place those cards are ever shown,
// which is why it is worth pinning that they are actually IN it.

const C = (n: number) => ({ name: String(n), attributes: { values: [n] } });

const frame = (over: Partial<BankFrameResult> = {}): BankFrameResult => ({
  bankerId: "banker",
  cards: [C(9), C(9)],
  state: "won",
  beat: 3,
  lostTo: 0,
  settledAt: 1000,
  ...over,
});

describe("the held BANK! frame", () => {
  it("shows the cards the showdown was actually won with", () => {
    // The whole complaint: "we don't even know how he beat the first few
    // players". A total alone would not answer that.
    // Queried off document.body, not the render container: StageOverlay
    // portals out of the stage (a transformed ancestor otherwise shrinks and
    // clips anything position: fixed inside it), so the container is empty.
    render(<BankFrameModal frame={frame()} releasesBot={false} onContinue={() => {}} />);
    expect(document.body.querySelectorAll(".k-dialog img").length).toBe(2);
    expect(screen.getByText(/showed 18/i)).toBeInTheDocument();
  });

  it("says who it took the money from", () => {
    render(<BankFrameModal frame={frame()} releasesBot={false} onContinue={() => {}} />);
    expect(screen.getByText(/beat 3 players/i)).toBeInTheDocument();
  });

  it("counts one player without pluralising it", () => {
    render(<BankFrameModal frame={frame({ beat: 1 })} releasesBot={false} onContinue={() => {}} />);
    expect(screen.getByText(/beat 1 player\./i)).toBeInTheDocument();
  });

  it("names a bust as a bust", () => {
    render(
      <BankFrameModal frame={frame({ cards: [C(12), C(12)], state: "lost", busted: true, beat: 0, lostTo: 2 })} releasesBot={false} onContinue={() => {}} />
    );
    expect(screen.getByText(/futched/i)).toBeInTheDocument();
    expect(screen.getByText(/lost to 2/i)).toBeInTheDocument();
  });

  it("says so when nothing rode on it", () => {
    render(<BankFrameModal frame={frame({ beat: 0, lostTo: 0 })} releasesBot={false} onContinue={() => {}} />);
    expect(screen.getByText(/no wagers rode on it/i)).toBeInTheDocument();
  });

  it("names the banker when there is a person behind the bank", () => {
    render(<BankFrameModal frame={frame()} bankerName="Zeide Dov" releasesBot={false} onContinue={() => {}} />);
    expect(screen.getByText(/Zeide Dov's hand/i)).toBeInTheDocument();
  });

  it("labels the button for what pressing it does at a computer table", () => {
    render(<BankFrameModal frame={frame()} releasesBot onContinue={() => {}} />);
    expect(screen.getByRole("button", { name: /deal the next hand/i })).toBeInTheDocument();
  });

  it("continues on the button, and on Escape", () => {
    const onContinue = vi.fn();
    render(<BankFrameModal frame={frame()} releasesBot={false} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onContinue).toHaveBeenCalledTimes(2);
  });

  it("cannot be dismissed by clicking beside it", () => {
    // At a computer table this dialog is the only thing holding the bot, so a
    // stray tap on the scrim would hand back the very problem it fixes.
    const onContinue = vi.fn();
    render(<BankFrameModal frame={frame()} releasesBot onContinue={onContinue} />);
    fireEvent.click(document.body.querySelector(".k-dialog-scrim")!);
    expect(onContinue).not.toHaveBeenCalled();
  });
});
