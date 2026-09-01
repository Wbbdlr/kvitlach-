import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardImages } from "../selectors";
import { APP_VERSION } from "../../version";
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

// New card art shipped in v7.9 to the same twelve URLs and did not appear for
// anyone: files in public/ keep their plain filenames, so browsers and the
// Cloudflare edge both served what they already had. The query string is the
// only thing that moves when the art changes.
describe("card art cache-busting", () => {
  it("versions every face with the current APP_VERSION", () => {
    for (const rank of ["1", "6", "9", "11", "12"]) {
      expect(cardImages[rank]).toBe(`/${rank}.png?v=${APP_VERSION}`);
    }
  });

  // index.css fetches blank.png by its bare URL, so a versioned copy here
  // would mean downloading that 2.6MB file a second time.
  it("leaves blank.png unversioned", () => {
    expect(cardImages.blank).toBe("/blank.png");
  });
});

// The mark is no longer baked into the PNGs -- public/ ships the unmarked
// render and this overlay is the ONLY thing that draws it. So "no mark
// rendered" is not a cosmetic regression here, it is the mark being gone.
describe("maker's mark overlay", () => {
  const mark = (container: HTMLElement) => container.querySelector(".k-cardmark");

  it("draws the mark on the cards that carry one", () => {
    for (const rank of ["1", "8", "12"]) {
      const { container } = render(<CardView card={{ name: rank, attributes: { values: [Number(rank)] } }} />);
      expect(mark(container), `card ${rank}`).toBeTruthy();
      expect(mark(container)?.innerHTML, `card ${rank}`).toContain("SCHLESINGER");
    }
  });

  it("creates no element at all for the other nine", () => {
    // Not an empty <svg>: the felt re-renders every card each round, and an
    // overlay per card would be nine wasted nodes per hand for nothing.
    for (const rank of ["2", "3", "5", "9", "10", "11"]) {
      const { container } = render(<CardView card={{ name: rank, attributes: { values: [Number(rank)] } }} />);
      expect(mark(container), `card ${rank}`).toBeNull();
    }
  });

  it("never marks a face-down card", () => {
    // hidden renders blank.png -- a mark on the card BACK would show the
    // table what is about to be dealt.
    const { container } = render(<CardView card={{ name: "8", attributes: { values: [8] } }} hidden />);
    expect(mark(container)).toBeNull();
  });

  it("aligns to the art, not to the layout box", () => {
    // The old list UI's fixed w-10/h-14 box is a different aspect ratio from
    // the 946x1438 card, so the img letterboxes inside it. preserveAspectRatio
    // makes the overlay letterbox identically; inset:0 alone would print the
    // mark a few px off the art.
    const { container } = render(<CardView card={{ name: "8", attributes: { values: [8] } }} size="md" />);
    const svg = mark(container);
    expect(svg?.getAttribute("viewBox")).toBe("0 0 946 1438");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  });

  it("desaturates with the card face on an Eleveroon reject", () => {
    // A mark that stayed blue on a greyed-out card reads as a separate thing
    // sitting on top of it, not as something printed on it.
    const { container } = render(
      <CardView card={{ name: "12", attributes: { values: [12], eleveroonIgnored: true } }} pastFirstPaint />
    );
    expect(mark(container)?.getAttribute("class")).toContain("grayscale");
  });
});
