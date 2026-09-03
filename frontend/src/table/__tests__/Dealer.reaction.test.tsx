import { afterEach, describe, expect, it } from "vitest";
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
//
// Both now portal to document.body (a later fix -- .k-seat is its own
// stacking context, position + z-index, which capped the bubble's LOCAL
// z-index below a dealt card's regardless of what number it carried; see
// Seat.tsx's reactionAnchor comment). Query document.body, not the render
// container -- a portalled node is a sibling of the container, not a
// descendant of it, in both DOMs equally, so this is still the same "do
// both renderers agree" check, just pointed at where they now actually
// agree to land.

const banker: Player = { id: "bank", firstName: "Gabbai", lastName: "", type: "admin", presence: "online" };
const punter: Player = { id: "p1", firstName: "Sruly", lastName: "", type: "player", presence: "online" };

const turnFor = (player: Player): Turn => ({ player, state: "pending", cards: [], bet: 0 });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("reaction bubbles", () => {
  it("renders the banker's reaction, the same as any seat's", () => {
    render(<Dealer turn={turnFor(banker)} bankerPlayer={banker} isViewerBanker={false} reactionEmoji="👏" />);
    const bubble = document.body.querySelector(".k-reaction");
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toBe("👏");
  });

  it("anchors the banker's bubble to the side, because above them is chrome", () => {
    // Seat.tsx chooses per seat (`sideReaction`), since an arc seat usually has
    // empty felt above it. The bank sits at the TOP of the oval, so there is
    // only ever one right answer here and it is not a decision to be passed in.
    render(<Dealer turn={turnFor(banker)} bankerPlayer={banker} isViewerBanker={false} reactionEmoji="🔥" />);
    expect(document.body.querySelector(".k-reaction")!.classList.contains("is-side")).toBe(true);
  });

  it("renders nothing when the banker has not reacted", () => {
    render(<Dealer turn={turnFor(banker)} bankerPlayer={banker} isViewerBanker={false} />);
    expect(document.body.querySelector(".k-reaction")).toBeNull();
  });

  it("gives a seat and the bank the same treatment for the same input", () => {
    render(<Seat turn={turnFor(punter)} isAdmin={false} position={seatPositions(2)[0]} reactionEmoji="👏" />);
    render(<Dealer turn={turnFor(banker)} bankerPlayer={banker} isViewerBanker={false} reactionEmoji="👏" />);
    // Not distinguishing which bubble is whose -- the point of this test was
    // never that, only that neither renderer silently skips the other's
    // input. Two seats' worth of "the bank never got the same treatment as a
    // seat" is exactly the bug both bubbles existing, with the same text, is
    // meant to rule out.
    const bubbles = document.body.querySelectorAll(".k-reaction");
    expect(bubbles).toHaveLength(2);
    bubbles.forEach((b) => expect(b.textContent).toBe("👏"));
  });

  // The actual bug, not just where the bubble ends up: reported as reaction
  // emoji getting covered by dealt cards. Both bubbles used to render as a
  // DESCENDANT of .k-seat -- position + z-index (10, fanned 20), its own
  // stacking context -- so .k-reaction's own z-index never once competed
  // against .table-fly-card (z-index: 80, appended straight to
  // document.body) at all. This is what actually closes that gap: the
  // bubble is no longer inside .k-seat's subtree to begin with.
  it("renders the bubble outside .k-seat's own subtree, not just visually on top of it", () => {
    render(<Seat turn={turnFor(punter)} isAdmin={false} position={seatPositions(2)[0]} reactionEmoji="👏" />);
    const seatEl = document.body.querySelector(".k-seat");
    const bubble = document.body.querySelector(".k-reaction");
    expect(seatEl).not.toBeNull();
    expect(bubble).not.toBeNull();
    expect(seatEl!.contains(bubble)).toBe(false);
  });
});
