import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Dealer } from "../Dealer";
import { Seat } from "../Seat";
import { seatPositions } from "../layout";
import { Player, Turn } from "../../types";

// Ledger F1: the banker could send a reaction and be the only person at the
// table who never appeared to have said anything.
//
// ReactionLayer.tsx has always documented these as "rendered by Seat.tsx/
// Dealer.tsx directly". Seat.tsx did. Dealer.tsx never did -- the comment
// described an intention, and nothing tested it, so it read as true for as
// long as anyone cared to look. That is exactly the failure this file exists
// to make impossible: it asserts the two renderers agree, rather than
// asserting the banker's bubble in isolation, because "one of them does it"
// is precisely the state the bug lived in.

const banker: Player = { id: "bank", firstName: "Gabbai", lastName: "", type: "admin", presence: "online" };
const punter: Player = { id: "p1", firstName: "Sruly", lastName: "", type: "player", presence: "online" };

const turnFor = (player: Player): Turn => ({ player, state: "pending", cards: [], bet: 0 });

describe("reaction bubbles", () => {
  it("renders the banker's reaction, the same as any seat's", () => {
    const { container } = render(
      <Dealer turn={turnFor(banker)} bankerPlayer={banker} isViewerBanker={false} reactionEmoji="👏" />
    );
    const bubble = container.querySelector(".k-reaction");
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toBe("👏");
  });

  it("anchors the banker's bubble to the side, because above them is chrome", () => {
    // Seat.tsx chooses per seat (`sideReaction`), since an arc seat usually has
    // empty felt above it. The bank sits at the TOP of the oval, so there is
    // only ever one right answer here and it is not a decision to be passed in.
    const { container } = render(
      <Dealer turn={turnFor(banker)} bankerPlayer={banker} isViewerBanker={false} reactionEmoji="🔥" />
    );
    expect(container.querySelector(".k-reaction")!.classList.contains("is-side")).toBe(true);
  });

  it("renders nothing when the banker has not reacted", () => {
    const { container } = render(
      <Dealer turn={turnFor(banker)} bankerPlayer={banker} isViewerBanker={false} />
    );
    expect(container.querySelector(".k-reaction")).toBeNull();
  });

  it("gives a seat and the bank the same treatment for the same input", () => {
    const seat = render(
      <Seat turn={turnFor(punter)} isAdmin={false} position={seatPositions(2)[0]} reactionEmoji="👏" />
    );
    const bank = render(
      <Dealer turn={turnFor(banker)} bankerPlayer={banker} isViewerBanker={false} reactionEmoji="👏" />
    );
    expect(seat.container.querySelector(".k-reaction")?.textContent).toBe("👏");
    expect(bank.container.querySelector(".k-reaction")?.textContent).toBe("👏");
  });
});
