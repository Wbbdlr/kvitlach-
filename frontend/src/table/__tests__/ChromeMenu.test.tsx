import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChromeMenu } from "../ChromeMenu";

// Collapsing the chrome hides its contents by design. It also hid the only
// thing that changes on the banker's screen when a player asks for chips or a
// name change -- that count lives inside Manage, and on a phone Manage lives
// inside here. "One tap away" and "invisible" are the same thing without a
// number on the trigger.
describe("ChromeMenu's attention badge", () => {
  it("shows nothing when nothing is waiting", () => {
    render(<ChromeMenu><button type="button">Manage</button></ChromeMenu>);
    expect(document.querySelector(".k-badge-count")).toBeNull();
    expect(screen.getByRole("button", { name: "Table controls" })).toBeInTheDocument();
  });

  it("shows the count, and says so to a screen reader", () => {
    render(<ChromeMenu badge={3}><button type="button">Manage</button></ChromeMenu>);
    expect(document.querySelector(".k-badge-count")?.textContent).toBe("3");
    expect(screen.getByRole("button", { name: /3 waiting for you/i })).toBeInTheDocument();
  });

  it("keeps its contents behind the button until opened", () => {
    render(<ChromeMenu badge={1}><button type="button">Manage</button></ChromeMenu>);
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
  });
});
