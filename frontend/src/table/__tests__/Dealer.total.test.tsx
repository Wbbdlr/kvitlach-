import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Dealer } from "../Dealer";
import { Seat } from "../Seat";
import { seatPositions } from "../layout";
import { Card, Player, Turn } from "../../types";

// Reported live: "I don't see the banker's total tally any more -- other
// players have it still but the banker doesn't."
//
// It was there, technically. It had been folded onto the plate's caption line
// as 8px grey parchment text ("Bank · 17") while every player seat kept the
// .k-readout pill -- dark, 11px counter-scaled, bold amber value. A number a
// third the weight of everyone else's, in a different place, reads as missing,
// and a test that only asserted "the digits appear somewhere in the DOM" would
// have stayed green through the whole complaint.
//
// So these assert the PILL, and assert it by comparing the bank against a
// player seat rather than in isolation -- "the banker's total looks like
// everyone else's" is the actual requirement, and comparing the two is the
// only way to state it. Same shape as Dealer.reaction.test.tsx, for the same
// reason: that bug was also "one of the two renderers does it."

const card = (name: string, value: number): Card => ({ name, attributes: { values: [value] } });

const banker: Player = { id: "bank", firstName: "Gabbai", lastName: "", type: "admin", presence: "online" };
const punter: Player = { id: "p1", firstName: "Sruly", lastName: "", type: "player", presence: "online" };

// 9 + 8 = 17, no ace-style ambiguity, nowhere near 21 or a bust.
const hand = [card("9", 9), card("8", 8)];

const bankTurn = (over: Partial<Turn> = {}): Turn => ({
  player: banker,
  state: "pending",
  cards: hand,
  bet: 0,
  ...over,
});

const readout = (c: HTMLElement) => c.querySelector(".k-readout:not(.k-bank-split)");

describe("the banker's own hand total", () => {
  it("renders as a .k-readout pill, not as plate caption text", () => {
    const { container } = render(
      <Dealer turn={bankTurn()} bankerPlayer={banker} isViewerBanker viewerId="bank" bankerWallet={500} />
    );
    const pill = readout(container);
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain("Total:");
    expect(pill!.textContent).toContain("17");
    // The value carries the same <b> emphasis a seat's does -- .k-readout b is
    // what makes it amber, and without it the pill is the right box around the
    // wrong-looking number.
    expect(pill!.querySelector("b")?.textContent).toBe("17");
  });

  it("gives a seat and the bank the same pill for the same hand", () => {
    const seat = render(
      <Seat
        turn={{ player: punter, state: "lost", cards: hand, bet: 10 }}
        isAdmin={false}
        position={seatPositions(2)[0]}
      />
    );
    const bank = render(
      <Dealer
        turn={bankTurn({ state: "lost" })}
        bankerPlayer={banker}
        isViewerBanker={false}
        bankerWallet={500}
      />
    );
    const seatPill = readout(seat.container);
    const bankPill = readout(bank.container);
    expect(seatPill).not.toBeNull();
    expect(bankPill).not.toBeNull();
    expect(bankPill!.textContent!.trim()).toBe(seatPill!.textContent!.trim());
  });

  it("shows the UPCARD total to a spectator mid-round, not the real one", () => {
    // Not a concealment bug: selectors.ts deliberately reports what the table
    // can actually see (turn.cards.slice(1)) while the hole card is down, so
    // the bank's exposed 8 reads as an 8 to everyone else. Pinned here because
    // "the banker's pill matches a seat's" must not be read as "the banker's
    // pill leaks the banker's hand" -- the two requirements meet at this line.
    const { container } = render(
      <Dealer turn={bankTurn()} bankerPlayer={banker} isViewerBanker={false} viewerId="p1" bankerWallet={500} />
    );
    const pill = readout(container)!;
    expect(pill.querySelector("b")?.textContent).toBe("8");
    expect(pill.textContent).not.toContain("17");
    expect(pill.classList.contains("is-muted")).toBe(false);
  });

  it("renders the pill muted rather than absent when there is nothing to show", () => {
    // One card dealt, and it is the hole card: there is no visible total at
    // all. The pill has to survive that as a muted "hidden" -- vanishing from
    // the felt on every opening deal is most of what made the old placement
    // read as gone in the first place.
    const { container } = render(
      <Dealer
        turn={bankTurn({ cards: [card("9", 9)] })}
        bankerPlayer={banker}
        isViewerBanker={false}
        viewerId="p1"
        bankerWallet={500}
      />
    );
    const pill = readout(container)!;
    expect(pill).not.toBeNull();
    expect(pill.classList.contains("is-muted")).toBe(true);
    expect(pill.textContent).toContain("hidden");
  });

  it("sits below the hand, where a growing hand cannot overrun it", () => {
    // `is-flanking` anchored this to the CARDS and was overrun as the bank
    // drew (docs/mobile-ui-history.md #7). Riding .k-bank-hud -- a flow-laid
    // sibling AFTER .k-hand -- is what makes that structurally impossible, so
    // the relationship is worth pinning rather than leaving to the next
    // person's reading of the JSX.
    const { container } = render(
      <Dealer turn={bankTurn()} bankerPlayer={banker} isViewerBanker viewerId="bank" bankerWallet={500} />
    );
    const pill = readout(container)!;
    expect(pill.closest(".k-bank-hud")).not.toBeNull();
    const hand = container.querySelector(".k-hand")!;
    const bank = container.querySelector(".k-bank-hud")!;
    expect(hand.compareDocumentPosition(bank) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
