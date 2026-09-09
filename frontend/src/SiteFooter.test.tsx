import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SiteFooter from "./SiteFooter";
import { applyProfile, activeProfile } from "./familyProfile";
import { APP_VERSION, firstPushedDate } from "./version";

// The version badge used to be inert text -- a tester could see WHICH build
// they were on but not WHEN it shipped, so "did I get today's fix" still
// meant asking in chat. These pin the popup that answers it directly.
describe("the version badge's ship-date popup", () => {
  it("is closed by default", () => {
    render(<SiteFooter />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("opens on click and names the version and its real ship date from VERSION_HISTORY", () => {
    render(<SiteFooter />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`v${APP_VERSION}`) }));
    const popup = screen.getByRole("status");
    const date = firstPushedDate(APP_VERSION);
    expect(date).toBeDefined();
    // Formatted, not the raw "2026-09-03" -- a tester reads a date, not an
    // ISO string.
    const [year, month, day] = date!.split("-").map(Number);
    const formatted = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
    expect(popup.textContent).toContain(formatted);
  });

  it("toggles closed on a second click", () => {
    render(<SiteFooter />);
    const button = screen.getByRole("button", { name: new RegExp(`v${APP_VERSION}`) });
    fireEvent.click(button);
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes on an outside click", () => {
    render(<SiteFooter />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`v${APP_VERSION}`) }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<SiteFooter />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`v${APP_VERSION}`) }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("still renders the nav links and footer content unchanged", () => {
    render(<SiteFooter active="/about" />);
    expect(screen.getByRole("link", { name: "About" })).toHaveClass("text-ink");
    expect(screen.getByRole("link", { name: "Disclaimer" })).toBeInTheDocument();
    expect(screen.getByText(/ComputerRabbis.com/)).toBeInTheDocument();
  });
});

// A real fact about this file's own data, not just the wiring: every version
// this build could ever report has a real date behind it. Catches the one
// mistake this feature invites -- bumping APP_VERSION without appending to
// VERSION_HISTORY, which is a manual step at a different location in the
// same file (see deploy skill).
describe("version.ts's own history", () => {
  it("has a VERSION_HISTORY entry for the currently running APP_VERSION", () => {
    expect(firstPushedDate(APP_VERSION)).toBeDefined();
  });
});

// The exit lives in the footer rather than on the lobby's welcome banner: that
// banner is the family's own greeting, and a control that undoes it does not
// belong on it. Down here it is also on every page, not only the lobby.
describe("leaving family mode", () => {
  const DOV = {
    slug: "dov",
    name: "Dov",
    greeting: "Welcome, Dov Family",
    feltPrint: "משפחת",
    cardMark: "DOV",
    felt: "spruce",
    chip: "gold",
    accessCode: "",
  };

  afterEach(() => {
    applyProfile(null);
    localStorage.clear();
  });

  it("shows nothing at all when no family is active", () => {
    render(<SiteFooter />);
    expect(screen.queryByRole("button", { name: /exit/i })).not.toBeInTheDocument();
  });

  it("names the family on the button, so it is obvious what is being left", () => {
    applyProfile(DOV);
    render(<SiteFooter />);
    expect(screen.getByRole("button", { name: "Exit Dov Family Mode" })).toBeInTheDocument();
  });

  it("leaves, and says how to come back", () => {
    applyProfile(DOV);
    localStorage.setItem("kvitlach.family", "dov");
    render(<SiteFooter />);
    fireEvent.click(screen.getByRole("button", { name: "Exit Dov Family Mode" }));
    expect(activeProfile()).toBeNull();
    expect(localStorage.getItem("kvitlach.family")).toBeNull();
    expect(screen.queryByRole("button", { name: /exit/i })).not.toBeInTheDocument();
    expect(screen.getByText(/open your family/i)).toBeInTheDocument();
  });
});
