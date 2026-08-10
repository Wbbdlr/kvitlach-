import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CardView } from "../CardView";
import { Card } from "../../types";

const rejectedCard: Card = { name: "11", attributes: { values: [11], eleveroonIgnored: true } };
const normalCard: Card = { name: "9", attributes: { values: [9] } };

describe("CardView -- Eleveroon-rejected card", () => {
  it("shows the permanent ring and badge when freshly dealt this session", () => {
    const { container, getByText } = render(<CardView card={rejectedCard} pastFirstPaint />);
    expect(container.querySelector(".k-card-elev")).toBeTruthy();
    expect(getByText("Eleveroon")).toBeInTheDocument();
  });

  it("shows the same permanent ring and badge on a reconnect, with no fresh deal at all", () => {
    // A reconnect/reload mounts an already-resolved ignored card for the
    // first time on THIS client -- pastFirstPaint is false/absent, but the
    // permanent marker must still show (it's not conditional on that).
    const { container, getByText } = render(<CardView card={rejectedCard} pastFirstPaint={false} />);
    expect(container.querySelector(".k-card-elev")).toBeTruthy();
    expect(getByText("Eleveroon")).toBeInTheDocument();
  });

  it("plays the one-shot reject animation only when genuinely new this session", () => {
    const freshlyMounted = render(<CardView card={rejectedCard} pastFirstPaint />);
    expect(freshlyMounted.container.querySelector(".k-card-elev-in")).toBeTruthy();
    expect(freshlyMounted.container.querySelector(".k-elev-badge-in")).toBeTruthy();
  });

  it("does not replay the reject animation for a card that was already there before this client connected", () => {
    const reconnected = render(<CardView card={rejectedCard} pastFirstPaint={false} />);
    expect(reconnected.container.querySelector(".k-card-elev-in")).toBeFalsy();
    expect(reconnected.container.querySelector(".k-elev-badge-in")).toBeFalsy();
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
