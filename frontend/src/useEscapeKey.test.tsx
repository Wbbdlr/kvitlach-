import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { useEscapeKey } from "./useEscapeKey";
import { WaitingListDrawer } from "./table/WaitingListDrawer";

function Probe({ onClose, enabled }: { onClose: () => void; enabled?: boolean }) {
  useEscapeKey(onClose, enabled);
  return <div>probe</div>;
}

describe("useEscapeKey", () => {
  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<Probe onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const onClose = vi.fn();
    render(<Probe onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "e" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    // Several dialogs early-return null when closed, so they call the hook
    // above that return and pass `open`. Without this gate a hidden dialog
    // would still answer Escape.
    const onClose = vi.fn();
    render(<Probe onClose={onClose} enabled={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("detaches on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Probe onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes a real dialog, and not one that is closed", () => {
    // Through an actual modal rather than only the probe: the wiring is the
    // part that was missing, not the hook.
    const onClose = vi.fn();
    const { rerender } = render(<WaitingListDrawer open onClose={onClose} players={[]} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<WaitingListDrawer open={false} onClose={onClose} players={[]} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
