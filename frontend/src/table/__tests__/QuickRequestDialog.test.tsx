import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QuickRequestDialog } from "../QuickRequestDialog";

const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf8").replace(/\r\n/g, "\n");

function renderDialog(props: Partial<React.ComponentProps<typeof QuickRequestDialog>> = {}) {
  const onClose = vi.fn();
  const onRequestRename = vi.fn();
  const onRequestBuyIn = vi.fn();
  const utils = render(
    <QuickRequestDialog
      kind="chips"
      onClose={onClose}
      onRequestRename={onRequestRename}
      onRequestBuyIn={onRequestBuyIn}
      {...props}
    />
  );
  return { ...utils, onClose, onRequestRename, onRequestBuyIn };
}

describe("QuickRequestDialog", () => {
  it("renders nothing until a kind is asked for", () => {
    renderDialog({ kind: undefined });
    expect(document.querySelector(".k-dialog")).toBeNull();
  });

  // The whole point of A8. These buttons used to open the Table Info drawer
  // with the right section pre-expanded, which answered a one-line question by
  // putting the room's ID, invite link, password and export controls on screen
  // first -- reported as the buttons taking you to the table settings menu.
  it("shows only the chip form -- none of the room's settings", () => {
    renderDialog({ kind: "chips" });
    expect(screen.getByText("Ask for chips")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit chip request/i })).toBeInTheDocument();
    expect(screen.queryByText(/game id/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invite link/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/export/i)).not.toBeInTheDocument();
    // ...and not the other request's form either.
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });

  it("shows only the rename form for the other button", () => {
    renderDialog({ kind: "rename" });
    expect(screen.getByText("Change my name")).toBeInTheDocument();
    expect(screen.queryByText(/amount \(required\)/i)).not.toBeInTheDocument();
  });

  it("submits the amount and closes itself", () => {
    const { onRequestBuyIn, onClose } = renderDialog({ kind: "chips" });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "Lost last round" } });
    fireEvent.submit(screen.getByRole("button", { name: /submit chip request/i }));
    expect(onRequestBuyIn).toHaveBeenCalledWith(250, "Lost last round");
    expect(onClose).toHaveBeenCalled();
  });

  it("submits a rename with the optional surname left out", () => {
    const { onRequestRename } = renderDialog({ kind: "rename" });
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Shaya" } });
    fireEvent.submit(screen.getByRole("button", { name: /submit rename request/i }));
    expect(onRequestRename).toHaveBeenCalledWith("Shaya", undefined);
  });

  // A player who already has one in flight opens this again to check on it,
  // not only to file another -- so the pending state has to come with the form
  // rather than staying behind in the drawer.
  it("carries the pending state, so re-opening it answers 'did that go through'", () => {
    renderDialog({
      kind: "chips",
      buyInRequest: { playerId: "p1", amount: 250, requestedAt: 0 },
    });
    expect(screen.getByText(/pending banker approval for \$250/i)).toBeInTheDocument();
  });

  // StageOverlay portals out of the render container, so these two reach for
  // the document rather than `container` -- which is empty here.
  it("closes on Escape and on a click outside", () => {
    const { onClose } = renderDialog({ kind: "chips" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    onClose.mockClear();
    fireEvent.click(document.querySelector(".k-dialog-scrim") as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when the form itself is clicked", () => {
    const { onClose } = renderDialog({ kind: "chips" });
    fireEvent.click(document.querySelector(".k-dialog") as Element);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// A7. The dialogs were retrofitted onto a dark surface by repainting the
// Tailwind text utilities they were built with, but a field's markup
// ("rounded border px-3 py-2") carries no colour utility at all, so it kept
// the browser's white-paper defaults inside a dark dialog.
describe("dialog form controls take the dialog's own surface", () => {
  it("paints fields from the surface tokens", () => {
    const at = CSS.indexOf('\n.k-dialog input:not([type="checkbox"]):not([type="radio"]),');
    expect(at, "the field rule is gone").toBeGreaterThan(-1);
    const body = CSS.slice(at, CSS.indexOf("}", at));
    expect(body).toContain("background-color: var(--k-surface-inset)");
    expect(body).toContain("color: var(--k-surface-ink)");
  });

  // The parts CSS cannot reach: a number input's spinner arrows, autofill's
  // background, an overflow scrollbar. Only color-scheme moves those.
  it("tells the browser to draw its own widgets dark too", () => {
    const at = CSS.indexOf("\n.k-dialog {");
    const body = CSS.slice(at, CSS.indexOf("\n}", at));
    expect(body).toContain("color-scheme: dark");
  });
});
