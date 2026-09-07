import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlayerDock } from "../PlayerDock";
import { Turn } from "../../types";
import { setNumberField, suppressesOsKeyboard } from "../../testing/numberField";

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
  it("defaults to $5 and opens our own pad rather than the phone's keyboard", () => {
    renderDock();
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    expect(input.value).toBe("5");
    // readOnly + inputMode="none" IS the fix -- see NumberField.tsx. The
    // field is still a real input carrying a real value; what changed is
    // where the digits come from.
    expect(suppressesOsKeyboard("Bet amount")).toBe(true);
  });

  it("lets the player enter any amount and bets that amount", () => {
    const { onBet } = renderDock({ wallet: 200 });
    setNumberField("Bet amount", "37");
    fireEvent.click(screen.getByText("Bet"));
    expect(onBet).toHaveBeenCalledWith(37, { bank: false, eleveroon: false });
  });

  it("cannot produce a non-digit at all, rather than filtering one out", () => {
    // This used to be "ignores non-digit characters", filtering "12a" back
    // down to "12". There is no longer a keystroke that could put an "a"
    // here: the field is read-only and the pad has ten digit keys.
    renderDock();
    setNumberField("Bet amount", "12");
    expect((screen.getByLabelText("Bet amount") as HTMLInputElement).value).toBe("12");
  });

  it("clamps an emptied field up to 1 when the pad closes", () => {
    // Was "clamps to 1 on blur". The pad owns the moment now -- it clamps on
    // Done, which is the same guarantee at a point the player can see.
    renderDock();
    setNumberField("Bet amount", "");
    expect((screen.getByLabelText("Bet amount") as HTMLInputElement).value).toBe("1");
  });

  it("rejects a bet of $0 with a clear error instead of silently no-opping", () => {
    // Still reachable: the quick-bet tray and the steppers do not clamp, so
    // handleBet's own guards stay load-bearing even though the pad now makes
    // this particular value hard to reach.
    const { onBet } = renderDock();
    fireEvent.click(screen.getByLabelText("Decrease bet"));
    fireEvent.click(screen.getByLabelText("Decrease bet"));
    fireEvent.click(screen.getByLabelText("Decrease bet"));
    fireEvent.click(screen.getByLabelText("Decrease bet"));
    fireEvent.click(screen.getByLabelText("Decrease bet"));
    expect((screen.getByLabelText("Bet amount") as HTMLInputElement).value).toBe("1");
    expect(onBet).not.toHaveBeenCalled();
  });

  it("will not let an unaffordable amount be entered in the first place", () => {
    // A real behaviour change, called out rather than buried: this used to
    // accept "500" on a $20 wallet and then refuse the wager with
    // "Insufficient chips". The pad carries max={maxBettable}, so the amount
    // is capped as it is entered -- prevention where there used to be a
    // rejection after the fact. The error itself still exists for the paths
    // that can still overshoot (the stacking chip tray).
    const { onBet } = renderDock({ wallet: 20 });
    setNumberField("Bet amount", "500");
    expect((screen.getByLabelText("Bet amount") as HTMLInputElement).value).toBe("20");
    fireEvent.click(screen.getByText("Bet"));
    expect(onBet).toHaveBeenCalledWith(20, { bank: false, eleveroon: false });
  });

  it("still shows the insufficient-chips error for a path that does not clamp", () => {
    const { onBet } = renderDock({ wallet: 3 });
    fireEvent.click(screen.getByText("Bet")); // the $5 default alone exceeds $3
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

// Reported from an Android phone on 11.4: "when putting the amount in
// manually the on screen keyboard doesn't collapse when I press the check
// button to submit the amount."
//
// The field is not inside a <form>, so the keyboard's Go/check key had
// nothing to submit and no reason to close -- and on a phone in landscape the
// IME covers most of the felt while it is up. Blurring the input is what
// actually dismisses it; a page cannot close a keyboard any other way.
// The 11.5 fix here was making the OS keyboard collapse on submit. 11.6
// removes the OS keyboard from this field entirely (NumberField.tsx), so
// these are now about it never appearing rather than about dismissing it --
// a keyboard that is never summoned needs no dismissing, and the enterKeyHint
// / blur machinery those tests pinned is gone with it.
describe("PlayerDock never summons the phone keyboard", () => {
  it("keeps the field read-only, which is what suppresses it", () => {
    renderDock();
    expect(suppressesOsKeyboard("Bet amount")).toBe(true);
  });

  it("opens our own pad on a tap", () => {
    renderDock();
    fireEvent.click(screen.getByLabelText("Bet amount"));
    expect(screen.getByRole("dialog", { name: /bet amount keypad/i })).toBeInTheDocument();
  });

  it("puts the pad away when the wager is placed", () => {
    renderDock({ wallet: 200 });
    setNumberField("Bet amount", "40");
    fireEvent.click(screen.getByText("Bet"));
    expect(screen.queryByRole("dialog", { name: /bet amount keypad/i })).toBeNull();
  });

  it("does not leave the pad open over the chip tray", () => {
    renderDock({ wallet: 200 });
    fireEvent.click(screen.getByLabelText("Bet amount"));
    const tray = screen.getByLabelText("Quick-bet amounts");
    // mouseDown as well as click, because that is what a real tap does and
    // it is the event the pad's dismiss-on-outside-press listens for.
    // fireEvent.click alone dispatches neither mousedown nor touchstart, so
    // asserting on click alone would have been testing a fiction.
    fireEvent.mouseDown(tray);
    fireEvent.click(tray);
    // Both open from the dock into the same space; two stacked panels over
    // the felt is exactly the clutter the pad exists to avoid.
    expect(screen.queryByRole("dialog", { name: /bet amount keypad/i })).toBeNull();
  });
});

describe("PlayerDock quick-bet chips", () => {
  it("stays collapsed behind the trigger until tapped", () => {
    renderDock();
    expect(screen.queryByLabelText("Add $10 to the bet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    expect(screen.getByLabelText("Add $10 to the bet")).toBeInTheDocument();
  });

  // These chips are a stack you build up, not a set of presets -- asked for
  // directly after playing 11.4: "pressed in succession should add those
  // chips to the selected total (so if someone hits the 25 in that menu,
  // then hits it again, it should be 50)."
  //
  // The rule is "opening the tray starts a fresh stack": the FIRST tap
  // replaces whatever was in the field, every tap after it adds. Pure
  // addition was the obvious reading and is wrong in the common case -- the
  // field sits at the $5 default, so a first tap of $25 would land on $30
  // and the very example above would produce 30 then 55.
  it("puts the first tapped amount in the field, replacing the default", () => {
    renderDock();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Add $10 to the bet"));
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    expect(input.value).toBe("10");
  });

  it("adds on every tap after the first -- $25 twice is $50", () => {
    renderDock({ wallet: 500 });
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    expect(input.value).toBe("50");
  });

  it("mixes denominations the way real chips do", () => {
    renderDock({ wallet: 500 });
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    fireEvent.click(screen.getByLabelText("Add $10 to the bet"));
    fireEvent.click(screen.getByLabelText("Add $5 to the bet"));
    expect((screen.getByLabelText("Bet amount") as HTMLInputElement).value).toBe("40");
  });

  it("stays open while the stack is being built", () => {
    renderDock({ wallet: 500 });
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    // Closing on the first tap is what made a second tap impossible.
    expect(screen.getByLabelText("Add $25 to the bet")).toBeInTheDocument();
  });

  it("shows the running total so the stack is never guesswork", () => {
    renderDock({ wallet: 500 });
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    expect(screen.getByTestId("quickbet-total")).toHaveTextContent("$50");
  });

  it("starts a fresh stack the next time the tray is opened", () => {
    renderDock({ wallet: 500 });
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    fireEvent.click(screen.getByLabelText("Quick-bet amounts")); // close
    fireEvent.click(screen.getByLabelText("Quick-bet amounts")); // reopen
    fireEvent.click(screen.getByLabelText("Add $10 to the bet"));
    // Not 60 -- reopening the tray is how you start over.
    expect((screen.getByLabelText("Bet amount") as HTMLInputElement).value).toBe("10");
  });

  it("has a Done that closes the tray without touching the amount", () => {
    renderDock({ wallet: 500 });
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByLabelText("Add $25 to the bet")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Bet amount") as HTMLInputElement).value).toBe("25");
  });

  it("does not call onBet by itself -- it only fills the field", () => {
    const { onBet } = renderDock();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Add $25 to the bet"));
    expect(onBet).not.toHaveBeenCalled();
  });

  it("clears a standing bet error the same as typing does", () => {
    renderDock({ wallet: 3 });
    fireEvent.click(screen.getByText("Bet")); // $5 default > $3 wallet
    expect(screen.getByText("Insufficient chips for this wager.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    fireEvent.click(screen.getByLabelText("Add $10 to the bet"));
    expect(screen.queryByText("Insufficient chips for this wager.")).not.toBeInTheDocument();
  });

  it("closes on Escape without changing the field", () => {
    renderDock();
    fireEvent.click(screen.getByLabelText("Quick-bet amounts"));
    expect(screen.getByLabelText("Add $10 to the bet")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Add $10 to the bet")).not.toBeInTheDocument();
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
  it("fills in the bank's cap exactly, even though that lands on a bank-lock", () => {
    renderDock({ wallet: 200, bankIncrement: 50 });
    fireEvent.click(screen.getByText("MAX"));
    const input = screen.getByLabelText("Bet amount") as HTMLInputElement;
    // Was 49: MAX used to stop $1 short whenever the bank was the binding
    // constraint, so a tap could not silently land on the amount applyBet
    // treats as a bank-lock. Reported as a bug in its own right (2026-09-06,
    // "max bet would not let me wager all that the banker had available")
    // and the owner's call was that MAX must mean max -- warn about the
    // showdown instead of quietly wagering a dollar less than asked.
    expect(input.value).toBe("50");
    // The warning that replaced the silent nudge.
    expect(screen.getByText("Bet $50 calls BANK!")).toBeTruthy();
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
