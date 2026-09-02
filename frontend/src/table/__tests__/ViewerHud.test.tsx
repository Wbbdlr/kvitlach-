import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewerHud } from "../ViewerHud";
import { Player, Turn } from "../../types";

const me: Player = { id: "p1", firstName: "Sara", lastName: "K", type: "player", presence: "online" };

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return { player: me, state: "pending", cards: [{ name: "9", attributes: { values: [9] } }], bet: 5, ...overrides };
}

function renderHud(props: Partial<React.ComponentProps<typeof ViewerHud>> = {}) {
  return render(<ViewerHud turn={makeTurn()} viewerId={me.id} roundState="playing" {...props} />);
}

// The bug this file exists for: statusDisplay() sees only the turn, and every
// unplayed turn in a round is `pending`. The panel had no notion of whose turn
// it actually was, so it read "Waiting..." to the one person the table was
// waiting ON -- next to their own timer bar counting down.
describe("ViewerHud's turn tag", () => {
  it("says it is your turn when the table is waiting on you", () => {
    renderHud({ isActiveTurn: true });
    expect(screen.getByText("Your turn")).toBeInTheDocument();
    expect(screen.queryByText("Waiting...")).not.toBeInTheDocument();
  });

  it("still says Waiting when the table is waiting on somebody else", () => {
    renderHud({ isActiveTurn: false });
    expect(screen.getByText("Waiting...")).toBeInTheDocument();
  });

  it("says Up next when you are on deck, which outranks the plain wait", () => {
    renderHud({ isActiveTurn: false, isNextTurn: true });
    expect(screen.getByText("Up next")).toBeInTheDocument();
  });

  it("prefers the live turn over Up next if both somehow arrive together", () => {
    renderHud({ isActiveTurn: true, isNextTurn: true });
    expect(screen.getByText("Your turn")).toBeInTheDocument();
  });

  // The panel styled itself as the active seat for the whole round, because
  // its old isCurrentTurn was just `pending`. The colour said "you're up" while
  // the words said "wait" -- two halves of one tag disagreeing.
  it("marks the panel active only on the real turn, not for the whole round", () => {
    const { container, unmount } = renderHud({ isActiveTurn: false });
    expect(container.querySelector(".k-viewer-hud")).not.toHaveClass("is-active");
    unmount();
    const active = renderHud({ isActiveTurn: true });
    expect(active.container.querySelector(".k-viewer-hud")).toHaveClass("is-active");
  });

  // Once the banker's hand is being resolved nobody's player turn is live, so
  // a stale isActiveTurn must not keep claiming the felt is waiting on you.
  it("drops the claim once the round has terminated", () => {
    renderHud({ isActiveTurn: true, roundState: "terminate" });
    expect(screen.queryByText("Your turn")).not.toBeInTheDocument();
  });

  it("leaves a settled turn's own result alone", () => {
    renderHud({ turn: makeTurn({ state: "won" }), isActiveTurn: true });
    expect(screen.getByText("WON")).toBeInTheDocument();
  });
});
