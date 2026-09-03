import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactionLayer } from "../ReactionLayer";

// The picker used to be position: absolute inside the control bar, which
// (docs/mobile-ui.md Part 3) put it under two ceilings at once: .k-controls's
// own stacking context (z-index 25, position: relative) capped it below the
// pre-round "Table ready" panel, and once the bar itself carried a resize
// transform, that transform became the containing block and shrank the
// picker's tap targets along with it. These pin the portal escape rather than
// the emoji grid, which nothing here changed.

let buttonRect = { top: 300, bottom: 336, left: 500, right: 536, width: 36, height: 36 };

function mockRect() {
  HTMLButtonElement.prototype.getBoundingClientRect = function () {
    return { ...buttonRect, x: buttonRect.left, y: buttonRect.top, toJSON: () => ({}) } as DOMRect;
  };
}

beforeEach(() => {
  buttonRect = { top: 300, bottom: 336, left: 500, right: 536, width: 36, height: 36 };
  mockRect();
  window.innerWidth = 640;
  window.innerHeight = 360;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the reaction picker", () => {
  it("renders the popover into document.body, not inside the control bar's own DOM", () => {
    const { container } = render(<ReactionLayer onReact={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("React"));
    // Portalled: found on the page, but not a descendant of the wrapper that
    // rendered the button. A component that stayed position: absolute would
    // fail this the same way the bar's resize transform used to break it --
    // by still being inside the ancestor it needs to escape.
    const popover = document.querySelector(".fixed.z-\\[60\\]");
    expect(popover).not.toBeNull();
    expect(container.querySelector(".relative.z-30")?.contains(popover)).toBe(false);
  });

  it("opens upward, anchored above the button, when there is more room above than below", () => {
    // Button near the bottom of a 360px-tall viewport -- 300px above it,
    // 24px below. Matches a landscape phone with the bar left in its default
    // resting spot.
    render(<ReactionLayer onReact={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("React"));
    const popover = document.querySelector(".fixed.z-\\[60\\]") as HTMLElement;
    expect(popover.style.bottom).not.toBe("");
    expect(popover.style.top).toBe("");
  });

  it("flips to open downward when the button sits near the top of the screen", () => {
    buttonRect = { top: 10, bottom: 46, left: 500, right: 536, width: 36, height: 36 };
    mockRect();
    render(<ReactionLayer onReact={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("React"));
    const popover = document.querySelector(".fixed.z-\\[60\\]") as HTMLElement;
    expect(popover.style.top).not.toBe("");
    expect(popover.style.bottom).toBe("");
  });

  it("aligns left instead of right when a right-aligned popover would run off the screen", () => {
    // Button near the LEFT edge -- the bar dragged into the corner. A
    // right edge at 100px minus the 340px picker width is deep negative.
    buttonRect = { top: 300, bottom: 336, left: 20, right: 56, width: 36, height: 36 };
    mockRect();
    render(<ReactionLayer onReact={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("React"));
    const popover = document.querySelector(".fixed.z-\\[60\\]") as HTMLElement;
    expect(popover.style.left).not.toBe("");
    expect(popover.style.right).toBe("");
  });

  it("sends the tapped emoji and closes", () => {
    const onReact = vi.fn();
    render(<ReactionLayer onReact={onReact} />);
    fireEvent.click(screen.getByLabelText("React"));
    fireEvent.click(screen.getByText("🔥"));
    expect(onReact).toHaveBeenCalledWith("🔥");
    expect(document.querySelector(".fixed.z-\\[60\\]")).toBeNull();
  });

  it("closes on an outside click, including one that lands outside the portal", () => {
    render(<ReactionLayer onReact={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("React"));
    expect(document.querySelector(".fixed.z-\\[60\\]")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector(".fixed.z-\\[60\\]")).toBeNull();
  });

  it("disables the button without opening anything", () => {
    render(<ReactionLayer onReact={vi.fn()} disabled />);
    expect(screen.getByLabelText("React")).toBeDisabled();
  });
});
