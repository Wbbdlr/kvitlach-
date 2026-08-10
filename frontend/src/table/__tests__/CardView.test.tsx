import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { CardView } from "../CardView";
import { Card } from "../../types";

const rejectedCard: Card = { name: "11", attributes: { values: [11], eleveroonIgnored: true } };
const normalCard: Card = { name: "9", attributes: { values: [9] } };

// Mirrors CardView.tsx's DISCARD_FLIGHT_MS (340 + 340 + 620 + 480) -- the
// total time from mount to a freshly-rejected card unmounting itself once
// its own fly-out finishes.
const DISCARD_FLIGHT_MS = 340 + 340 + 620 + 480;

describe("CardView -- Eleveroon-rejected card", () => {
  it("shows the ring and badge, and plays the reject+fly-out motion, when freshly dealt this session", () => {
    const { container, getByText } = render(<CardView card={rejectedCard} pastFirstPaint />);
    expect(container.querySelector(".k-card-elev")).toBeTruthy();
    expect(container.querySelector(".k-card-elev-in")).toBeTruthy();
    expect(container.querySelector(".k-card-discard-out")).toBeTruthy();
    expect(getByText("Eleveroon")).toBeInTheDocument();
  });

  it("renders nothing at all on a reconnect, with no fresh deal at all", () => {
    // A reconnect/reload mounts an already-resolved ignored card for the
    // first time on THIS client -- it flew off to the discard pile in some
    // earlier session (see DiscardPile.tsx), so there's nothing left to show
    // here: no ring, no badge, no card.
    const { container, queryByText } = render(<CardView card={rejectedCard} pastFirstPaint={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(queryByText("Eleveroon")).not.toBeInTheDocument();
  });

  it("does not replay the reject animation for a card that was already there before this client connected", () => {
    const reconnected = render(<CardView card={rejectedCard} pastFirstPaint={false} />);
    expect(reconnected.container.querySelector(".k-card-elev-in")).toBeFalsy();
    expect(reconnected.container.querySelector(".k-card-discard-out")).toBeFalsy();
  });

  describe("once the fly-out finishes", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("vanishes from the hand -- the pile, not a ring left in the hand, is the record from then on", () => {
      const { container } = render(<CardView card={rejectedCard} pastFirstPaint />);
      expect(container.querySelector(".k-card-elev")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(DISCARD_FLIGHT_MS);
      });

      expect(container).toBeEmptyDOMElement();
    });

    it("stays put until the fly-out actually finishes, not a moment sooner", () => {
      const { container } = render(<CardView card={rejectedCard} pastFirstPaint />);

      act(() => {
        vi.advanceTimersByTime(DISCARD_FLIGHT_MS - 1);
      });

      expect(container.querySelector(".k-card-elev")).toBeTruthy();
    });
  });

  it("never marks a hidden card as ignored, even if the underlying card is flagged", () => {
    // Mirrors CardView's own elevActive = ignored && !hidden -- a face-down
    // card must not leak the fact that it was an Eleveroon save.
    const { container, queryByText } = render(<CardView card={rejectedCard} hidden pastFirstPaint />);
    expect(container.querySelector(".k-card-elev")).toBeFalsy();
    expect(queryByText("Eleveroon")).not.toBeInTheDocument();
  });

  it("applies none of the Eleveroon treatment to an ordinary card", () => {
    const { container, queryByText } = render(<CardView card={normalCard} pastFirstPaint />);
    expect(container.querySelector(".k-card-elev")).toBeFalsy();
    expect(queryByText("Eleveroon")).not.toBeInTheDocument();
  });
});
