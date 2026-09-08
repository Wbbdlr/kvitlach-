import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DockGrips } from "../DockGrips";

// Regression coverage for a real bug: the grips used to live once at the
// `.k-dock-row` level, positioned absolute against THAT box -- which is not
// the same box as the visible `.k-dock` bar whenever the row is stretched
// wider than the dock (compact breakpoint) or the dock isn't rendered at all
// (nobody's turn). Reported as "the grabber looks like it's floating off on
// its own" and as stale grip/reset marks left behind between round states.
// The fix nests DockGrips inside each `.k-dock` variant instead -- these
// tests just pin that it renders and wires up correctly wherever it's put,
// since the containment itself is enforced by JSX structure, not by this
// component.

function panel(overrides: Partial<{ moved: boolean }> = {}) {
  return {
    moveProps: { onPointerDown: vi.fn() },
    gripProps: { onPointerDown: vi.fn() },
    moved: overrides.moved ?? false,
    reset: vi.fn(),
  };
}

describe("DockGrips", () => {
  // Three move grips -- both left corners plus the bottom-right -- and one
  // resize grip in the top-right. The move handle was a single strip of
  // horizontal rules and is now corner brackets, rejected on sight as
  // "horizontal lines which look weird". The bottom-right one came later:
  // both of the others sit on the same edge, so a right-handed player had to
  // reach across the whole bar to move it.
  it("renders all three move corners and the resize grip, always", () => {
    render(<DockGrips dockPanel={panel()} />);
    const moves = screen.getAllByTitle("Drag to move the controls");
    expect(moves).toHaveLength(3);
    expect(moves.map((el) => el.className)).toEqual([
      expect.stringContaining("tl"),
      expect.stringContaining("bl"),
      expect.stringContaining("br"),
    ]);
    expect(screen.getByTitle("Drag to resize the controls")).toBeInTheDocument();
  });

  // The bottom-right bracket must not land on top of the bottom-LEFT one.
  // .k-dock-grip.move sets `left: 2px`, and a box with both left and right
  // set resolves to left -- so this variant has to clear it explicitly, and
  // the class is what carries that.
  it("gives the bottom-right corner its own class, not just `move`", () => {
    render(<DockGrips dockPanel={panel()} />);
    const br = screen.getAllByTitle("Drag to move the controls")[2];
    expect(br.className).toContain("br");
    expect(br.className).not.toContain("bl");
  });

  // Either corner has to work. A pair where only one is live is worse than a
  // single handle, because the dead one still looks grabbable.
  it("wires EVERY move corner's pointerdown to moveProps", () => {
    const dockPanel = panel();
    render(<DockGrips dockPanel={dockPanel} />);
    for (const grip of screen.getAllByTitle("Drag to move the controls")) {
      fireEvent.pointerDown(grip);
    }
    expect(dockPanel.moveProps.onPointerDown).toHaveBeenCalledTimes(3);
  });

  it("wires the resize grip's pointerdown to gripProps", () => {
    const dockPanel = panel();
    render(<DockGrips dockPanel={dockPanel} />);
    fireEvent.pointerDown(screen.getByTitle("Drag to resize the controls"));
    expect(dockPanel.gripProps.onPointerDown).toHaveBeenCalled();
  });

  it("hides the reset button until the panel has actually been moved", () => {
    render(<DockGrips dockPanel={panel({ moved: false })} />);
    expect(screen.queryByLabelText("Put the controls back where they started")).not.toBeInTheDocument();
  });

  it("shows reset once moved, and calls reset on click", () => {
    const dockPanel = panel({ moved: true });
    render(<DockGrips dockPanel={dockPanel} />);
    fireEvent.click(screen.getByLabelText("Put the controls back where they started"));
    expect(dockPanel.reset).toHaveBeenCalled();
  });

  it("stops a press on the reset button from also starting a drag on its container", () => {
    // The reset button sits inside the same positioned box a drag could
    // start from -- without stopPropagation a tap to reset would also arm a
    // move/resize gesture underneath it.
    const dockPanel = panel({ moved: true });
    const onContainerPointerDown = vi.fn();
    render(
      <div onPointerDown={onContainerPointerDown}>
        <DockGrips dockPanel={dockPanel} />
      </div>
    );
    fireEvent.pointerDown(screen.getByLabelText("Put the controls back where they started"));
    expect(onContainerPointerDown).not.toHaveBeenCalled();
  });
});
