import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { WaitingListDrawer } from "./table/WaitingListDrawer";

function Dialog({ open, onClose, empty }: { open: boolean; onClose: () => void; empty?: boolean }) {
  const ref = useDialogFocus<HTMLDivElement>(open);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Test dialog">
      {empty ? (
        <p>Nothing to do here</p>
      ) : (
        <>
          <button onClick={onClose}>First</button>
          <input aria-label="Middle" />
          <button onClick={onClose}>Last</button>
        </>
      )}
    </div>
  );
}

function Harness({ empty }: { empty?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <button>Behind</button>
      <Dialog open={open} onClose={() => setOpen(false)} empty={empty} />
    </>
  );
}

describe("useDialogFocus", () => {
  it("moves focus into the dialog when it opens", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("returns focus to whatever opened it on close", () => {
    render(<Harness />);
    const opener = screen.getByText("Open");
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).not.toBe(opener);
    fireEvent.click(screen.getByText("Last")); // closes
    expect(document.activeElement).toBe(opener);
  });

  it("wraps Tab from the last control back to the first", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    screen.getByText("Last").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("wraps Shift+Tab from the first control back to the last", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    screen.getByText("First").focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Last"));
  });

  it("pulls focus back in if it has escaped the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    screen.getByText("Behind").focus(); // outside the dialog
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("focuses the container itself when the dialog holds nothing focusable", () => {
    render(<Harness empty />);
    fireEvent.click(screen.getByText("Open"));
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("does nothing at all while the dialog is closed", () => {
    render(<Harness />);
    const opener = screen.getByText("Open");
    opener.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(opener); // no trap engaged
  });

  // Same belt-and-braces as useEscapeKey.test.tsx: exercise a REAL dialog, so
  // the wiring (ref actually on the role="dialog" node) is covered, not just
  // the hook in isolation against a hand-built fixture.
  it("traps focus inside a real WaitingListDrawer", () => {
    const player = { id: "w1", firstName: "Zev", lastName: "", type: "player", presence: "online" } as any;
    render(
      <>
        <button>Outside</button>
        <WaitingListDrawer open onClose={() => {}} players={[{ player, isViewer: false, position: 1 }]} />
      </>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true); // focus moved in

    screen.getByText("Outside").focus(); // escape it
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true); // pulled back
  });
});
