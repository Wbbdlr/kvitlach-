import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlayerDock } from "../PlayerDock";
import { Turn } from "../../types";

const baseTurn: Turn = {
  player: { id: "p1", firstName: "Alice", lastName: "", type: "player", presence: "online" },
  state: "pending",
  cards: [],
  bet: 0,
};

function renderDock(overrides: { wallet?: number; bankIncrement?: number; canBank?: boolean; onBet?: (a: number, o: { bank: boolean }) => void } = {}) {
  const onBet = overrides.onBet ?? vi.fn();
  render(
    <PlayerDock
      turn={baseTurn}
      wallet={overrides.wallet ?? 100}
      bankIncrement={overrides.bankIncrement ?? 50}
      canBank={overrides.canBank ?? true}
      onBet={onBet}
      onHit={vi.fn()}
      onStand={vi.fn()}
    />
  );
  return { onBet };
}

describe("PlayerDock bet amount field", () => {
  it("defaults to $5 and is a real, directly editable input", () => {
    renderDock();
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    expect(input.value).toBe("5");
    expect(input.tagName).toBe("INPUT");
  });

  it("lets the player type any amount directly and bets that amount", () => {
    const { onBet } = renderDock({ wallet: 200 });
    const input = screen.getByLabelText("Bet amount");
    fireEvent.change(input, { target: { value: "37" } });
    fireEvent.click(screen.getByText("Bet"));
    expect(onBet).toHaveBeenCalledWith(37, { bank: false });
  });

  it("ignores non-digit characters", () => {
    renderDock();
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "12a" } });
    expect(input.value).toBe("12"); // the invalid keystroke was rejected
  });

  it("allows clearing the field mid-edit, then clamps to 1 on blur", () => {
    renderDock();
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe(""); // must be able to sit empty while retyping
    fireEvent.blur(input);
    expect(input.value).toBe("1");
  });

  it("rejects a bet of $0 with a clear error instead of silently no-opping", () => {
    const { onBet } = renderDock();
    const input = screen.getByLabelText("Bet amount");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByText("Bet"));
    expect(onBet).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a bet amount of at least $1.")).toBeInTheDocument();
  });

  it("rejects a typed amount larger than the wallet (\"if available\")", () => {
    const { onBet } = renderDock({ wallet: 20 });
    const input = screen.getByLabelText("Bet amount");
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.click(screen.getByText("Bet"));
    expect(onBet).not.toHaveBeenCalled();
    expect(screen.getByText("Insufficient chips for this wager.")).toBeInTheDocument();
  });

  it("still supports the +/- steppers alongside direct typing", () => {
    renderDock();
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    fireEvent.click(screen.getByLabelText("Increase bet"));
    expect(input.value).toBe("6");
    fireEvent.click(screen.getByLabelText("Decrease bet"));
    fireEvent.click(screen.getByLabelText("Decrease bet"));
    expect(input.value).toBe("4");
  });

  it("typing a new amount un-arms a selected BANK! wager", () => {
    renderDock({ bankIncrement: 80 });
    fireEvent.click(screen.getByText("BANK!"));
    expect(screen.getByText(/BANK! armed/)).toBeInTheDocument();
    const input = screen.getByLabelText("Bet amount");
    fireEvent.change(input, { target: { value: "9" } });
    expect(screen.queryByText(/BANK! armed/)).not.toBeInTheDocument();
  });
});
