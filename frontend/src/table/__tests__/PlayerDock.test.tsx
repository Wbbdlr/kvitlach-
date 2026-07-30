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

});

describe("PlayerDock BANK! confirmation", () => {
  it("opens a confirmation dialog instead of arming the bet field directly", () => {
    renderDock({ bankIncrement: 80 });
    fireEvent.click(screen.getByText("BANK!"));
    expect(screen.getByText("Bet BANK!?")).toBeInTheDocument();
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    expect(input.value).toBe("5"); // untouched until the player actually confirms
  });

  it("cancels without calling onBet", () => {
    const { onBet } = renderDock({ bankIncrement: 80 });
    fireEvent.click(screen.getByText("BANK!"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onBet).not.toHaveBeenCalled();
    expect(screen.queryByText("Bet BANK!?")).not.toBeInTheDocument();
  });

  it("confirms and sends the bank bet", () => {
    const { onBet } = renderDock({ bankIncrement: 80, wallet: 200 });
    fireEvent.click(screen.getByText("BANK!"));
    fireEvent.click(screen.getByText("Yes, bet BANK!"));
    expect(onBet).toHaveBeenCalledWith(80, { bank: true });
    expect(screen.queryByText("Bet BANK!?")).not.toBeInTheDocument();
  });

  it("blocks confirmation and explains when the wallet can't cover the full bank", () => {
    const { onBet } = renderDock({ bankIncrement: 80, wallet: 50 });
    fireEvent.click(screen.getByText("BANK!"));
    expect(screen.getByText("Not enough chips")).toBeInTheDocument();
    expect(screen.queryByText("Yes, bet BANK!")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    expect(onBet).not.toHaveBeenCalled();
  });

  it("automatically draws a card once the confirmed bank bet lands", () => {
    const onHit = vi.fn();
    const onBet = vi.fn();
    const { rerender } = render(
      <PlayerDock turn={baseTurn} wallet={200} bankIncrement={80} canBank onBet={onBet} onHit={onHit} onStand={vi.fn()} />
    );
    fireEvent.click(screen.getByText("BANK!"));
    fireEvent.click(screen.getByText("Yes, bet BANK!"));
    expect(onHit).not.toHaveBeenCalled(); // not until the bet actually lands

    rerender(
      <PlayerDock
        turn={{ ...baseTurn, bet: 80 }}
        wallet={200}
        bankIncrement={0}
        canBank={false}
        onBet={onBet}
        onHit={onHit}
        onStand={vi.fn()}
      />
    );
    expect(onHit).toHaveBeenCalledWith({ eleveroon: false });
  });

  it("does not auto-hit after a plain (non-bank) bet lands", () => {
    const onHit = vi.fn();
    const onBet = vi.fn();
    const { rerender } = render(
      <PlayerDock turn={baseTurn} wallet={200} bankIncrement={80} canBank onBet={onBet} onHit={onHit} onStand={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Bet"));
    rerender(
      <PlayerDock
        turn={{ ...baseTurn, bet: 5 }}
        wallet={200}
        bankIncrement={75}
        canBank
        onBet={onBet}
        onHit={onHit}
        onStand={vi.fn()}
      />
    );
    expect(onHit).not.toHaveBeenCalled();
  });
});
