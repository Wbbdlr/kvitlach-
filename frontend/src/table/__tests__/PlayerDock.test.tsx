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

// The move/resize grips are exercised in DockGrips.test.tsx -- this is just
// enough shape for PlayerDock to render them without crashing.
const stubDockPanel = {
  moveProps: { onPointerDown: () => {} },
  gripProps: { onPointerDown: () => {} },
  moved: false,
  reset: () => {},
};

function renderDock(overrides: { wallet?: number; bankIncrement?: number; canBank?: boolean; onBet?: (a: number, o: { bank: boolean; eleveroon: boolean }) => void } = {}) {
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
      dockPanel={stubDockPanel}
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
    expect(onBet).toHaveBeenCalledWith(37, { bank: false, eleveroon: false });
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

  // Regression: Eleveroon only ever reached the server on the Hit path --
  // the checkbox is shared UI, but a plain Bet (the more common way to draw
  // once a wager is already down, since "Bet adds to the wager and deals a
  // card") silently ignored it, busting a player who'd deliberately turned
  // it on. Reported live 2026-08-10.
  it("includes the Eleveroon toggle's state on a plain bet, not just Hit", () => {
    const { onBet } = renderDock({ wallet: 200 });
    fireEvent.click(screen.getByLabelText("Eleveroon"));
    fireEvent.click(screen.getByText("Bet"));
    expect(onBet).toHaveBeenCalledWith(5, { bank: false, eleveroon: true });
  });

});

describe("PlayerDock quick-bet chips", () => {
  it("stays collapsed behind the trigger until tapped", () => {
    renderDock();
    expect(screen.queryByLabelText("Set bet to $10")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    expect(screen.getByLabelText("Set bet to $10")).toBeInTheDocument();
  });

  it("sets the field to the tapped amount and closes the panel", () => {
    renderDock();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Set bet to $10"));
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    expect(input.value).toBe("10");
    expect(screen.queryByLabelText("Set bet to $10")).not.toBeInTheDocument();
  });

  it("replaces rather than adds -- $25 after $5 lands on $25, not $30", () => {
    renderDock();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Set bet to $5"));
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Set bet to $25"));
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    expect(input.value).toBe("25");
  });

  it("does not call onBet by itself -- it only fills the field", () => {
    const { onBet } = renderDock();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Set bet to $25"));
    expect(onBet).not.toHaveBeenCalled();
  });

  it("clears a standing bet error the same as typing does", () => {
    renderDock({ wallet: 3 });
    fireEvent.click(screen.getByText("Bet")); // $5 default > $3 wallet
    expect(screen.getByText("Insufficient chips for this wager.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Set bet to $10"));
    expect(screen.queryByText("Insufficient chips for this wager.")).not.toBeInTheDocument();
  });

  it("closes on Escape without changing the field", () => {
    renderDock();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    expect(screen.getByLabelText("Set bet to $10")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Set bet to $10")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Bet amount") as HTMLInputElement).value).toBe("5");
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
    expect(onBet).toHaveBeenCalledWith(80, { bank: true, eleveroon: false });
    expect(screen.queryByText("Bet BANK!?")).not.toBeInTheDocument();
  });

  // Same regression as the plain-bet case above: BANK! also draws a card via
  // the bet itself (before the auto-hit that follows it), so it needs the
  // toggle's live state too, not just a hardcoded false.
  it("includes the Eleveroon toggle's state on a bank bet too", () => {
    const { onBet } = renderDock({ bankIncrement: 80, wallet: 200 });
    fireEvent.click(screen.getByLabelText("Eleveroon"));
    fireEvent.click(screen.getByText("BANK!"));
    fireEvent.click(screen.getByText("Yes, bet BANK!"));
    expect(onBet).toHaveBeenCalledWith(80, { bank: true, eleveroon: true });
  });

  it("blocks confirmation and explains when the wallet can't cover the full bank", () => {
    const { onBet } = renderDock({ bankIncrement: 80, wallet: 50 });
    fireEvent.click(screen.getByText("BANK!"));
    expect(screen.getByText("Not enough chips")).toBeInTheDocument();
    expect(screen.queryByText("Yes, bet BANK!")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    expect(onBet).not.toHaveBeenCalled();
  });

  // The shortfall message used to ALSO sit permanently under the dock as a
  // k-tag, which on a phone is a whole extra row of controls-crowding text
  // stating a condition that holds for the entire game. It belongs to the
  // moment you reach for BANK!, not to the dock.
  it("keeps the BANK! reason off the dock and on the button instead", () => {
    render(
      <PlayerDock
        turn={baseTurn}
        wallet={50}
        bankIncrement={0}
        canBank={false}
        bankDisabledReason="Bank is empty."
        onBet={vi.fn()}
        onHit={vi.fn()}
        onStand={vi.fn()}
        dockPanel={stubDockPanel}
      />
    );
    expect(screen.queryByText("Bank is empty.")).not.toBeInTheDocument();
    expect(screen.getByText("BANK!").closest("button")).toHaveAttribute("title", "Bank is empty.");
  });

  // The BANK! follow-up card is NOT this component's job any more -- it is
  // issued by state.ts off the bet's own ack (see bankAutoHit.test.ts).
  // Watching turn.bet from here, which is what this test used to pin, could
  // not actually work: the re-render it keyed on always lands while
  // pendingAction still blocks every action, and a seat that had already bet
  // never flips the boolean at all. Both were confirmed by test before the
  // behaviour moved.
  it("does not itself draw a card when the confirmed bank bet lands", () => {
    const onHit = vi.fn();
    const onBet = vi.fn();
    const { rerender } = render(
      <PlayerDock
        turn={baseTurn}
        wallet={200}
        bankIncrement={80}
        canBank
        onBet={onBet}
        onHit={onHit}
        onStand={vi.fn()}
        dockPanel={stubDockPanel}
      />
    );
    fireEvent.click(screen.getByText("BANK!"));
    fireEvent.click(screen.getByText("Yes, bet BANK!"));
    expect(onBet).toHaveBeenCalledWith(80, { bank: true, eleveroon: false });

    rerender(
      <PlayerDock
        turn={{ ...baseTurn, bet: 80 }}
        wallet={200}
        bankIncrement={0}
        canBank={false}
        onBet={onBet}
        onHit={onHit}
        onStand={vi.fn()}
        dockPanel={stubDockPanel}
      />
    );
    expect(onHit).not.toHaveBeenCalled();
  });

  it("does not auto-hit after a plain (non-bank) bet lands", () => {
    const onHit = vi.fn();
    const onBet = vi.fn();
    const { rerender } = render(
      <PlayerDock
        turn={baseTurn}
        wallet={200}
        bankIncrement={80}
        canBank
        onBet={onBet}
        onHit={onHit}
        onStand={vi.fn()}
        dockPanel={stubDockPanel}
      />
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
        dockPanel={stubDockPanel}
      />
    );
    expect(onHit).not.toHaveBeenCalled();
  });
});

describe("PlayerDock MAX button", () => {
  it("fills in the bank's cap when the wallet can comfortably cover more than that", () => {
    renderDock({ wallet: 200, bankIncrement: 50 });
    fireEvent.click(screen.getByText("MAX"));
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    // Nudged $1 under the bank's exact cap so a MAX tap can't silently land
    // on the same amount BANK! uses to trigger a bank-lock (see PlayerDock's
    // rawMax/maxBettable comment) -- 50 -> 49.
    expect(input.value).toBe("49");
  });

  it("fills in the wallet balance when that's the tighter limit, without any nudge", () => {
    renderDock({ wallet: 30, bankIncrement: 400 });
    fireEvent.click(screen.getByText("MAX"));
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    expect(input.value).toBe("30");
  });

  it("is disabled once neither the wallet nor the bank has any room left", () => {
    renderDock({ wallet: 0, bankIncrement: 50 });
    expect(screen.getByText("MAX")).toBeDisabled();
  });

  it("does not call onBet by itself -- it only fills the field", () => {
    const { onBet } = renderDock({ wallet: 200, bankIncrement: 50 });
    fireEvent.click(screen.getByText("MAX"));
    expect(onBet).not.toHaveBeenCalled();
  });
});
